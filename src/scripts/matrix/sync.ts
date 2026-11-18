import { baseURL, isMatrixError, matrixRequest, sleep } from "../api/client";
import { createEmitter } from "../misc/events";
import type {
  CryptoHooks,
  Session,
  SyncEvents,
  SyncFilter,
  SyncResponse,
  SyncState,
} from "./types";

export const DEFAULT_SYNC_FILTER: SyncFilter = {
  presence: { types: ["m.presence"] },
  room: {
    state: { lazy_load_members: true },
    timeline: { limit: 10, lazy_load_members: true },
  },
};

export type SyncOptions = {
  session: Session;
  filter?: SyncFilter;
  since?: string;
  timeout?: number;
  maxBackoff?: number;
  crypto?: CryptoHooks;
  persistToken?: boolean;
  presence?: () => "online" | "unavailable" | "offline";
};

const CRYPTO_TIMEOUT = 10000;
const SINCE_KEY = "sync_since";
const FILTER_KEY = "sync_filter_id_v3";

const readStorage = (key: string) =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(key);

const writeStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return;
  value === null
    ? localStorage.removeItem(key)
    : localStorage.setItem(key, value);
};

export const clearSyncToken = () => {
  writeStorage(SINCE_KEY, null);
  writeStorage(FILTER_KEY, null);
};

export const uploadFilter = async (session: Session, filter: SyncFilter) =>
  (
    await matrixRequest<{ filter_id: string }>({
      base: baseURL.MATRIX(session.homeserver),
      endpoint: `user/${encodeURIComponent(session.userId)}/filter`,
      accessToken: session.accessToken,
      body: filter,
    })
  ).filter_id;

export const createSync = ({
  session,
  filter = DEFAULT_SYNC_FILTER,
  since,
  timeout = 30000,
  maxBackoff = 60000,
  crypto = {},
  persistToken = true,
  presence = () => "online",
}: SyncOptions) => {
  const emitter = createEmitter<SyncEvents>();
  let controller: AbortController | null = null;
  let state: SyncState = "stopped";
  let token = since ?? null;
  let filterId: string | null = persistToken ? readStorage(FILTER_KEY) : null;

  const setState = (next: SyncState) => {
    if (state === next) return;
    state = next;
    emitter.emit("state", next);
  };

  const ensureFilter = async () => {
    if (filterId) return filterId;

    filterId = await uploadFilter(session, filter).catch(() =>
      JSON.stringify(filter),
    );
    if (persistToken) writeStorage(FILTER_KEY, filterId);

    return filterId;
  };

  const syncOnce = (signal: AbortSignal) =>
    matrixRequest<SyncResponse>({
      base: baseURL.MATRIX(session.homeserver),
      endpoint: "sync",
      method: "GET",
      accessToken: session.accessToken,
      query: {
        filter: filterId,
        since: token ?? undefined,
        timeout: token ? timeout : 0,
        set_presence: presence(),
      },
      signal,
    });

  const handleResponse = async (response: SyncResponse) => {
    const cryptoSync = Promise.resolve()
      .then(() =>
        crypto.onSync?.({
      toDevice: response.to_device?.events ?? [],
      deviceLists: response.device_lists ?? {},
      oneTimeKeyCounts: response.device_one_time_keys_count ?? {},
      unusedFallbackKeyTypes: response.device_unused_fallback_key_types,
          nextBatch: response.next_batch,
        }),
      )
      .catch((error) => console.warn("Crypto sync failed", error));
    await Promise.race([cryptoSync, sleep(CRYPTO_TIMEOUT).catch(() => undefined)]);

    emitter.emit("sync", response);

    if (response.account_data?.events.length)
      emitter.emit("account_data", response.account_data.events);

    Object.entries(response.rooms?.join ?? {}).forEach(([roomId, room]) => {
      if (!room.timeline?.events.length && !room.timeline?.limited) return;

      emitter.emit("room_timeline", {
        roomId,
        events: room.timeline.events,
        limited: room.timeline.limited ?? false,
        prevBatch: room.timeline.prev_batch,
      });
    });

    token = response.next_batch;
  };

  const loop = async (signal: AbortSignal) => {
    let failures = 0;

    setState(token ? "catching_up" : "initialising");
    await ensureFilter();

    while (!signal.aborted) {
      try {
        const response = await syncOnce(signal);
        await handleResponse(response);

        failures = 0;
        setState("syncing");
      } catch (error) {
        if (signal.aborted) break;

        emitter.emit("error", error);

        if (isMatrixError(error, "M_UNKNOWN_TOKEN")) {
          setState("error");
          break;
        }

        failures++;
        setState("reconnecting");

        const backoff = isMatrixError(error)
          ? (error.retryAfterMs ?? 1000 * 2 ** failures)
          : 1000 * 2 ** failures;

        await sleep(Math.min(backoff, maxBackoff), signal).catch(
          () => undefined,
        );
      }
    }

    if (state !== "error") setState("stopped");
  };

  const start = () => {
    if (controller) return;

    controller = new AbortController();
    loop(controller.signal).finally(() => (controller = null));
  };

  const stop = () => {
    controller?.abort();
    controller = null;
    setState("stopped");
  };

  return {
    start,
    stop,
    on: emitter.on,
    off: emitter.off,
    getState: () => state,
    getSinceToken: () => token,
    isRunning: () => controller !== null,
  };
};

export type SyncHandle = ReturnType<typeof createSync>;
