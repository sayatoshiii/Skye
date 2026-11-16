import { derived, get, writable } from "svelte/store";
import { isMatrixError } from "../api/client";
import { sessionRequest } from "../matrix/session";
import type { Session, UserId } from "../matrix/types";
import { applyPresence, presenceDetails, registerAccountDataHook, session, setSyncPresence, synced, type Presence, type PresenceDetails } from "./matrix";

export const STATUS_TYPE = "chat.skye.status";

export type StatusMode = "online" | "idle" | "dnd" | "invisible";
export type PresenceKind = "online" | "idle" | "dnd" | "offline" | "unsupported";

export type OwnStatus = {
  mode: StatusMode;
  text?: string;
  emoji?: string;
  clearAt?: number;
};

const FETCH_CONCURRENCY = 2;
const MAX_TIMER = 2_147_000_000;

export const ownStatus = writable<OwnStatus>({ mode: "online" });
export const serverPresence = writable<"unknown" | "supported" | "unsupported">("unknown");
export const unsupportedUsers = writable<Set<UserId>>(new Set());
export const profileFields = writable<"stable" | "unstable" | null | undefined>(undefined);
export const profileStatuses = writable<Record<UserId, OwnStatus | null>>({});

const PROFILE_FIELD = STATUS_TYPE;
const UNSTABLE_FIELD = `uk.tcpip.msc4133.${STATUS_TYPE}`;
const profileRequested = new Set<UserId>();
const profileQueue: UserId[] = [];
let profileActive = 0;

const fieldBase = (current: Session, kind: "stable" | "unstable") =>
  kind === "stable" ? undefined : `${current.homeserver}/_matrix/client/unstable/uk.tcpip.msc4133/`;

const fieldEndpoint = (userId: UserId) => `profile/${encodeURIComponent(userId)}/${PROFILE_FIELD}`;

const parseStatus = (value: unknown): OwnStatus | null => {
  if (!value || typeof value !== "object") return null;
  const content = value as Record<string, unknown>;
  const clearAt = typeof content.clear_at === "number" ? content.clear_at : undefined;
  const expired = !!clearAt && clearAt <= Date.now();
  const mode = ["online", "idle", "dnd", "invisible"].includes(content.mode as string) ? (content.mode as StatusMode) : "online";
  return {
    mode,
    text: !expired && typeof content.text === "string" && content.text ? content.text : undefined,
    emoji: !expired && typeof content.emoji === "string" && content.emoji ? content.emoji : undefined,
    clearAt: expired ? undefined : clearAt,
  };
};

const pumpProfiles = () => {
  const current = get(session);
  const kind = get(profileFields);
  if (!current || !kind) return;

  while (profileActive < FETCH_CONCURRENCY && profileQueue.length) {
    const userId = profileQueue.shift()!;
    profileActive++;
    sessionRequest<Record<string, unknown>>(current, { base: fieldBase(current, kind), endpoint: fieldEndpoint(userId), method: "GET" })
      .then((content) => profileStatuses.update((all) => ({ ...all, [userId]: parseStatus(content?.[PROFILE_FIELD] ?? content?.[UNSTABLE_FIELD]) })))
      .catch(() => profileStatuses.update((all) => ({ ...all, [userId]: null })))
      .finally(() => {
        profileActive--;
        profileRequested.delete(userId);
        pumpProfiles();
      });
  }
};

const queueProfile = (userId: UserId) => {
  if (profileRequested.has(userId) || userId === get(session)?.userId) return;
  profileRequested.add(userId);
  profileQueue.push(userId);
  pumpProfiles();
};

const fallbackActive = () => !!get(profileFields) && get(serverPresence) === "unsupported";

const detectProfileFields = async (current: Session) => {
  const response = await sessionRequest<{ capabilities?: Record<string, { enabled?: boolean } | undefined> }>(current, {
    endpoint: "capabilities",
    method: "GET",
  }).catch(() => null);
  const capabilities = response?.capabilities ?? {};
  profileFields.set(
    capabilities["m.profile_fields"]?.enabled ? "stable" : capabilities["uk.tcpip.msc4133.profile_fields"]?.enabled ? "unstable" : null,
  );
};

const writeProfileStatus = (status: OwnStatus) => {
  const current = get(session);
  const kind = get(profileFields);
  if (!current || !kind) return;
  sessionRequest(current, {
    base: fieldBase(current, kind),
    endpoint: fieldEndpoint(current.userId),
    method: "PUT",
    body: {
      [PROFILE_FIELD]: { mode: status.mode, text: status.text ?? null, emoji: status.emoji ?? null, clear_at: status.clearAt ?? null },
    },
  }).catch((error) => console.warn("Skye could not save your status to your profile", error));
};

const requested = new Set<UserId>();
const queue: UserId[] = [];
let active = 0;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let probed: string | null = null;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
const PROBE_WINDOW = 90_000;

const MODE_PRESENCE: Record<StatusMode, Presence> = {
  online: "online",
  idle: "unavailable",
  dnd: "unavailable",
  invisible: "offline",
};

export const statusMessage = (status: OwnStatus) =>
  [status.emoji, status.text].filter(Boolean).join(" ") || undefined;

const statusEndpoint = (userId: UserId) => `presence/${encodeURIComponent(userId)}/status`;

const fetchStatus = (current: Session, userId: UserId) =>
  sessionRequest<{ presence?: Presence; status_msg?: string; last_active_ago?: number; currently_active?: boolean }>(current, {
    endpoint: statusEndpoint(userId),
    method: "GET",
  });

const UNSUPPORTED_CODES = new Set(["M_FORBIDDEN", "M_UNRECOGNIZED", "M_NOT_FOUND"]);

const isUnsupported = (error: unknown) =>
  isMatrixError(error) && (UNSUPPORTED_CODES.has((error as { errcode?: string }).errcode ?? "") || [403, 404, 405, 501].includes((error as { status?: number }).status ?? 0));

const markUnsupported = (userId: UserId) =>
  unsupportedUsers.update((current) => new Set(current).add(userId));

const pump = () => {
  const current = get(session);
  if (!current) return;

  while (active < FETCH_CONCURRENCY && queue.length) {
    const userId = queue.shift()!;
    if (get(presenceDetails)[userId]) continue;
    active++;
    fetchStatus(current, userId)
      .then((content) => {
        if (!content?.presence) return markUnsupported(userId);
        if (get(presenceDetails)[userId] && !get(presenceDetails)[userId].fetched) return;
        applyPresence([{ sender: userId, content }], true);
      })
      .catch((error) => (isUnsupported(error) ? markUnsupported(userId) : requested.delete(userId)))
      .finally(() => {
        active--;
        pump();
      });
  }
};

export const ensurePresence = (userId: UserId | undefined) => {
  if (!userId || requested.has(userId)) return;
  if (get(presenceDetails)[userId]) return;
  requested.add(userId);
  queue.push(userId);
  pump();
  if (fallbackActive()) queueProfile(userId);
};

const queueAllProfiles = () => fallbackActive() && requested.forEach(queueProfile);

const publish = async (status: OwnStatus) => {
  const current = get(session);
  setSyncPresence(MODE_PRESENCE[status.mode]);
  if (!current) return;

  await sessionRequest(current, {
    endpoint: statusEndpoint(current.userId),
    method: "PUT",
    body: { presence: MODE_PRESENCE[status.mode], status_msg: statusMessage(status) ?? "" },
  })
    .then(() => {
      clearTimeout(probeTimer);
      probeTimer = setTimeout(() => serverPresence.update((value) => (value === "unknown" ? "unsupported" : value)), PROBE_WINDOW);
    })
    .catch((error) => isUnsupported(error) && serverPresence.set("unsupported"));
};

const persist = (status: OwnStatus) => {
  const current = get(session);
  if (!current) return;

  sessionRequest(current, {
    endpoint: `user/${encodeURIComponent(current.userId)}/account_data/${STATUS_TYPE}`,
    method: "PUT",
    body: {
      mode: status.mode,
      dnd: status.mode === "dnd",
      text: status.text ?? null,
      emoji: status.emoji ?? null,
      clear_at: status.clearAt ?? null,
    },
  }).catch((error) => console.warn("Skye could not save your status", error));
};

const scheduleClear = (status: OwnStatus) => {
  clearTimeout(clearTimer);
  if (!status.clearAt || !status.text && !status.emoji) return;
  clearTimer = setTimeout(
    () => setOwnStatus({ ...get(ownStatus), text: undefined, emoji: undefined, clearAt: undefined }),
    Math.min(Math.max(status.clearAt - Date.now(), 0), MAX_TIMER),
  );
};

export const setOwnStatus = (status: OwnStatus) => {
  ownStatus.set(status);
  scheduleClear(status);
  persist(status);
  writeProfileStatus(status);
  void publish(status);
};

const MODES = new Set<StatusMode>(["online", "idle", "dnd", "invisible"]);

registerAccountDataHook((events) => {
  const event = events.findLast((candidate) => candidate.type === STATUS_TYPE);
  if (!event?.content) return;

  const content = event.content;
  const mode = MODES.has(content.mode as StatusMode) ? (content.mode as StatusMode) : content.dnd === true ? "dnd" : "online";
  const clearAt = typeof content.clear_at === "number" ? content.clear_at : undefined;
  const expired = !!clearAt && clearAt <= Date.now();
  const next: OwnStatus = {
    mode,
    text: !expired && typeof content.text === "string" && content.text ? content.text : undefined,
    emoji: !expired && typeof content.emoji === "string" && content.emoji ? content.emoji : undefined,
    clearAt: expired ? undefined : clearAt,
  };

  const previous = get(ownStatus);
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  if (expired) return setOwnStatus(next);

  ownStatus.set(next);
  scheduleClear(next);
  setSyncPresence(MODE_PRESENCE[next.mode]);
});

serverPresence.subscribe(() => queueAllProfiles());

presenceDetails.subscribe((value) => {
  if (get(serverPresence) === "unsupported") return;
  if (Object.values(value).some((details) => !details.fetched)) serverPresence.set("supported");
});

synced.subscribe((value) => {
  const current = get(session);
  if (!value || !current || probed === current.userId) return;
  probed = current.userId;
  void detectProfileFields(current).then(queueAllProfiles);
  void publish(get(ownStatus));
});

session.subscribe((value) => {
  if (value) return queueMicrotask(pump);
  clearTimeout(clearTimer);
  clearTimeout(probeTimer);
  requested.clear();
  queue.length = 0;
  profileRequested.clear();
  profileQueue.length = 0;
  profileFields.set(undefined);
  profileStatuses.set({});
  probed = null;
  ownStatus.set({ mode: "online" });
  serverPresence.set("unknown");
  unsupportedUsers.set(new Set());
  setSyncPresence("online");
});

const modeKind = (mode: StatusMode): PresenceKind => (mode === "invisible" ? "offline" : mode);

const fromDetails = (details: PresenceDetails): PresenceKind =>
  details.presence === "online" ? "online" : details.presence === "unavailable" ? "idle" : "offline";

export const presenceKindOf = (
  userId: UserId | undefined,
  details: PresenceDetails | undefined,
  own: OwnStatus,
  self: UserId | undefined,
  server: "unknown" | "supported" | "unsupported",
  unsupported: Set<UserId>,
): PresenceKind => {
  if (userId && userId === self) return modeKind(own.mode);
  if (details && !details.fetched) return fromDetails(details);
  if ((!!userId && unsupported.has(userId)) || server === "unsupported") return "unsupported";
  return details ? fromDetails(details) : "unsupported";
};

export const presenceKinds = derived(
  [presenceDetails, ownStatus, session, serverPresence, unsupportedUsers],
  ([$details, $own, $session, $server, $unsupported]) =>
    (userId: UserId | undefined) =>
      presenceKindOf(userId, userId ? $details[userId] : undefined, $own, $session?.userId, $server, $unsupported),
);

export const statusTextOf = derived([presenceDetails, ownStatus, session, profileStatuses], ([$details, $own, $session, $profiles]) => (userId: UserId | undefined) => {
  if (!userId) return undefined;
  if (userId === $session?.userId) return statusMessage($own);
  const fallback = $profiles[userId];
  return $details[userId]?.statusMessage || (fallback ? statusMessage(fallback) : undefined);
});
