import { markdownToContent } from "../misc/formatting";
import { derived, get, writable } from "svelte/store";
import { isMatrixError } from "../api/client";
import {
  createRoomStore,
  getDirectMessages,
  getOrphanRooms,
  getSpaceTrees,
  getUnreadTotals,
  type RoomStore,
} from "../matrix/rooms";
import { DeviceId as WasmDeviceId, UserId as WasmUserId } from "@matrix-org/matrix-sdk-crypto-wasm";
import { clearSession, loadSession, SIGNOUT_REASON_KEY, logout, sessionRequest } from "../matrix/session";
import {
  clearSyncToken,
  createSync,
  type SyncHandle,
  type SyncOptions,
} from "../matrix/sync";
import {
  clearCryptoStore,
  createCrypto,
  type CryptoHandle,
  type RestoreProgress,
} from "../matrix/crypto";
import {
  initialVerification,
  type VerificationState,
} from "../matrix/verification";
import { createTimeline, type TimelineHandle } from "../matrix/timeline";
import type {
  CryptoHooks,
  EventId,
  RoomId,
  RoomMember,
  RoomSummary,
  Session,
  SyncState,
  TimelineEvent,
  UserId,
} from "../matrix/types";

export type Presence = "online" | "unavailable" | "offline";

export type PresenceDetails = {
  presence: Presence;
  statusMessage?: string;
  lastActiveAgo?: number;
  receivedAt: number;
  currentlyActive?: boolean;
  fetched?: boolean;
};

export type Profile = {
  userId: UserId;
  displayName?: string;
  avatarUrl?: string;
};

export const session = writable<Session | null>(null);
export const syncState = writable<SyncState>("stopped");
export const rooms = writable<Record<RoomId, RoomSummary>>({});
export const currentRoomId = writable<RoomId | null>(null);
export const currentTimeline = writable<TimelineEvent[]>([]);
export const currentSpaceId = writable<RoomId | null>(null);
export const synced = writable(false);
export const sessionExpired = writable(false);
export const presence = writable<Record<UserId, Presence>>({});
export const presenceDetails = writable<Record<UserId, PresenceDetails>>({});
export const joinedMembers = writable<Record<RoomId, Record<UserId, RoomMember>>>(
  {},
);
export const ownProfile = writable<Profile | null>(null);
export const canLoadOlder = writable(true);
export const restoreOpen = writable(false);
export const detached = writable(false);
export const canLoadNewer = writable(false);
export type ReadReceipt = { eventId: EventId; ts: number };
export const typingUsers = writable<Record<RoomId, UserId[]>>({});
export const readReceipts = writable<Record<RoomId, Record<UserId, ReadReceipt>>>({});
export const verification = writable<VerificationState>(initialVerification);

type AccountDataHook = (events: { type: string; content?: Record<string, unknown> }[]) => void;

const accountDataHooks = new Set<AccountDataHook>();

export const registerAccountDataHook = (hook: AccountDataHook) => {
  accountDataHooks.add(hook);
};

export const registerNotesHook = registerAccountDataHook;

const RESTORED_PREFIX = "history_restored";

const restoredKey = () => {
  const active = get(session);
  return active ? `${RESTORED_PREFIX}:${active.userId}:${active.deviceId}` : null;
};

const readRestored = () => {
  try {
    const key = restoredKey();
    return !!key && localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const historyRestored = writable(false);

const markHistoryRestored = () => {
  historyRestored.set(true);
  try {
    const key = restoredKey();
    if (key) localStorage.setItem(key, "1");
  } catch {}
};

verification.subscribe((state) => {
  if (state.phase === "restored") queueMicrotask(markHistoryRestored);
});

session.subscribe(() => queueMicrotask(() => historyRestored.set(readRestored())));

export const spaces = derived(rooms, ($rooms) => getSpaceTrees($rooms));
export const directMessages = derived(rooms, ($rooms) =>
  getDirectMessages($rooms),
);
export const orphanRooms = derived(rooms, ($rooms) => getOrphanRooms($rooms));
export const currentRoom = derived([rooms, currentRoomId], ([$rooms, $id]) =>
  $id ? ($rooms[$id] ?? null) : null,
);
export const currentSpace = derived(
  [spaces, currentSpaceId],
  ([$spaces, $id]) => $spaces.find((tree) => tree.space.roomId === $id) ?? null,
);
export const undecryptable = derived(
  [currentTimeline, historyRestored],
  ([$timeline, $restored]) =>
    !$restored && $timeline.some((event) => event.decryptionFailed),
);
export const directUnread = derived(directMessages, ($dms) =>
  getUnreadTotals($dms),
);

let sync: SyncHandle | null = null;
let roomStore: RoomStore | null = null;
let crypto: CryptoHooks = {};
let cryptoHandle: CryptoHandle | null = null;
const timelines: Record<RoomId, TimelineHandle> = {};
let unsubscribeTimeline: (() => void) | null = null;

type ContextView = {
  roomId: RoomId;
  events: TimelineEvent[];
  start: string | null;
  end: string | null;
  busy: Promise<boolean> | null;
};

let context: ContextView | null = null;

const showContext = (view: ContextView) => {
  currentTimeline.set(view.events);
  canLoadOlder.set(view.start !== null);
  canLoadNewer.set(true);
};

const leaveContext = () => {
  const view = context;
  context = null;
  detached.set(false);
  canLoadNewer.set(false);
  if (!view) return;
  const timeline = timelines[view.roomId];
  if (!timeline || view.roomId !== get(currentRoomId)) return;
  currentTimeline.set(timeline.getEvents());
  canLoadOlder.set(timeline.canPaginate());
};
const receipts: Record<RoomId, EventId> = {};

let syncPresence: Presence = "online";

export const setSyncPresence = (value: Presence) => {
  syncPresence = value;
};

export const applyPresence = (events: { sender?: UserId; content: any }[], fetched = false) => {
  if (!events.length) return;

  presence.update((current) => ({
    ...current,
    ...Object.fromEntries(
      events
        .filter((event) => event.sender && event.content?.presence)
        .map((event) => [event.sender, event.content.presence as Presence]),
    ),
  }));

  const receivedAt = Date.now();

  presenceDetails.update((current) => ({
    ...current,
    ...Object.fromEntries(
      events
        .filter((event) => event.sender && event.content?.presence)
        .map((event) => [
          event.sender,
          {
            presence: event.content.presence as Presence,
            statusMessage: typeof event.content.status_msg === "string" ? event.content.status_msg : undefined,
            lastActiveAgo: typeof event.content.last_active_ago === "number" ? event.content.last_active_ago : undefined,
            currentlyActive: event.content.currently_active,
            receivedAt,
            fetched,
          } satisfies PresenceDetails,
        ]),
    ),
  }));
};

const applyEphemeral = (join: Record<RoomId, { ephemeral?: { events: { type: string; content: any }[] } }>) => {
  const typing: Record<RoomId, UserId[]> = {};
  const receipts: Record<RoomId, Record<UserId, ReadReceipt>> = {};

  for (const [roomId, room] of Object.entries(join)) {
    for (const event of room.ephemeral?.events ?? []) {
      if (event.type === "m.typing" && Array.isArray(event.content?.user_ids)) typing[roomId] = event.content.user_ids;
      if (event.type !== "m.receipt" || !event.content) continue;
      const target = (receipts[roomId] ??= {});
      for (const [eventId, kinds] of Object.entries<Record<string, Record<UserId, { ts?: number }>>>(event.content)) {
        for (const kind of ["m.read", "m.read.private"]) {
          for (const [userId, data] of Object.entries(kinds?.[kind] ?? {})) {
            const ts = typeof data?.ts === "number" ? data.ts : Date.now();
            if (!target[userId] || target[userId].ts <= ts) target[userId] = { eventId, ts };
          }
        }
      }
    }
  }

  if (Object.keys(typing).length) typingUsers.update((current) => ({ ...current, ...typing }));
  if (!Object.keys(receipts).length) return;
  readReceipts.update((current) => {
    const next = { ...current };
    for (const [roomId, users] of Object.entries(receipts)) {
      const merged = { ...next[roomId] };
      for (const [userId, receipt] of Object.entries(users))
        if (!merged[userId] || merged[userId].ts <= receipt.ts) merged[userId] = receipt;
      next[roomId] = merged;
    }
    return next;
  });
};

const loadProfile = async (active: Session) => {
  ownProfile.set({ userId: active.userId });

  const profile = await sessionRequest<{
    displayname?: string;
    avatar_url?: string;
  }>(active, {
    endpoint: `profile/${encodeURIComponent(active.userId)}`,
    method: "GET",
  }).catch(() => null);

  if (profile)
    ownProfile.set({
      userId: active.userId,
      displayName: profile.displayname,
      avatarUrl: profile.avatar_url,
    });
};

const loadMembers = async (roomId: RoomId) => {
  const active = get(session);
  if (!active || get(joinedMembers)[roomId]) return get(joinedMembers)[roomId];

  const response = await sessionRequest<{
    joined?: Record<UserId, { display_name?: string; avatar_url?: string }>;
  }>(active, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/joined_members`,
    method: "GET",
  }).catch(() => null);

  if (!response?.joined) return;

  joinedMembers.update((current) => ({
    ...current,
    [roomId]: Object.fromEntries(
      Object.entries(response.joined!).map(([userId, member]) => [
        userId,
        {
          userId,
          membership: "join",
          displayName: member.display_name,
          avatarUrl: member.avatar_url,
        },
      ]),
    ),
  }));

  return get(joinedMembers)[roomId];
};

const getEncryptionMembers = async (roomId: RoomId) => {
  const fetched = (await loadMembers(roomId)) ?? {};
  const synced = get(rooms)[roomId]?.members ?? {};
  const merged = { ...fetched, ...synced };

  return Object.values(merged)
    .filter((member) => member.membership === "join")
    .map((member) => member.userId);
};

const retryDecryption = (roomIds: RoomId[]) =>
  roomIds.forEach((roomId) => timelines[roomId]?.retryDecryption());

const startCrypto = (activeSession: Session) => {
  cryptoHandle = createCrypto({
    session: activeSession,
    getRoom: (roomId) => get(rooms)[roomId],
    getMembers: getEncryptionMembers,
    onKeysReceived: retryDecryption,
    onStoreLocked: () => queueMicrotask(() => resetLockedStore()),
    onStoreLost: () => queueMicrotask(() => resetLockedStore(STORE_LOST_REASON)),
    onVerification: (state) => {
      verification.set(state);
      if (state.phase === "incoming") restoreOpen.set(true);
    },
  });

  cryptoHandle
    .getMachine()
    .then((machine) => machine?.getBackupKeys())
    .then((keys) => keys?.decryptionKey && markHistoryRestored())
    .catch(() => undefined);

  return cryptoHandle.hooks;
};

let cryptoClosing: Promise<void> = Promise.resolve();

let resettingStore = false;

const STORE_LOST_REASON = "store_lost";
const PROMPTED_PREFIX = "verify_prompted";

const resetLockedStore = async (reason?: string) => {
  const active = get(session);
  if (!active || resettingStore) return;
  resettingStore = true;

  if (reason) {
    try {
      sessionStorage.setItem(SIGNOUT_REASON_KEY, reason);
    } catch {}
  }

  await stopCrypto();
  stopMatrix();
  await Promise.all([logout(active), clearCryptoStore(active)]);
  clearSyncToken();
  sessionExpired.set(true);
  resettingStore = false;
};

const stopCrypto = () => {
  const handle = cryptoHandle;
  cryptoHandle = null;
  crypto = {};
  verification.set(initialVerification);
  if (handle) cryptoClosing = handle.close().catch(() => undefined);
  return cryptoClosing;
};

const promptVerification = async (activeSession: Session) => {
  const key = `${PROMPTED_PREFIX}:${activeSession.userId}:${activeSession.deviceId}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return;
  }

  const handle = cryptoHandle;
  const machine = await handle?.getMachine();
  if (!handle || !machine) return;
  await handle.processOutgoing().catch(() => undefined);
  if (cryptoHandle !== handle) return;

  const userId = new WasmUserId(activeSession.userId);
  const identity = await machine.getIdentity(userId).catch(() => undefined);
  if (!identity) return;

  const device = await machine
    .getDevice(userId, new WasmDeviceId(activeSession.deviceId))
    .catch(() => undefined);
  const trusted = !!device && (device.isCrossSigningTrusted() || device.isLocallyTrusted());
  if (trusted || cryptoHandle !== handle || get(historyRestored)) return;

  try {
    localStorage.setItem(key, "1");
  } catch {}
  restoreOpen.set(true);
};

export const hasKeyBackup = async () =>
  (await cryptoHandle?.hasBackup()) ?? false;

export const restoreHistory = (
  secret: string,
  usePassphrase: boolean,
  onProgress?: (progress: RestoreProgress) => void,
) => {
  if (!cryptoHandle) throw new Error("No active Matrix session.");
  return cryptoHandle
    .restoreFromBackup(secret, usePassphrase, onProgress)
    .then((result) => {
      markHistoryRestored();
      return result;
    });
};

export const startVerification = () => cryptoHandle?.verification.start();
export const acceptVerification = () => cryptoHandle?.verification.accept();
export const confirmVerification = () => cryptoHandle?.verification.confirm();
export const cancelVerification = () => cryptoHandle?.verification.cancel();
export const clearVerification = () => cryptoHandle?.verification.clear();

const dropRoomCache = (roomId: RoomId) => {
  delete timelines[roomId];
  delete receipts[roomId];
  delete pinnedCache[roomId];
  if (context?.roomId === roomId) context = null;
};

export const waitForRoom = (roomId: RoomId, signal?: AbortSignal) =>
  new Promise<RoomSummary>((resolve, reject) => {
    let stop: (() => void) | undefined;
    const finish = () => queueMicrotask(() => stop?.());
    stop = rooms.subscribe((current) => {
      const room = current[roomId];
      if (room?.membership !== "join") return;
      finish();
      resolve(room);
    });
    signal?.addEventListener("abort", () => {
      finish();
      reject(signal.reason);
    }, { once: true });
  });

export const getDirectRoomMap = () => roomStore?.getDirectRooms() ?? {};

export const getTimeline = (roomId: RoomId) => {
  const active = get(session);
  if (!active) throw new Error("No active Matrix session.");

  return (timelines[roomId] ??= createTimeline({
    session: active,
    roomId,
    crypto,
  }));
};

export const startMatrix = (
  activeSession: Session | null = loadSession(),
  options: Omit<SyncOptions, "session"> = {},
) => {
  if (!activeSession || sync) return sync;

  crypto = options.crypto ?? startCrypto(activeSession);
  session.set(activeSession);
  roomStore = createRoomStore(activeSession.userId);
  roomStore.on("change", (next) => rooms.set(next));

  sync = createSync({ ...options, crypto, session: activeSession, presence: () => syncPresence });
  sync.on("state", (state) => syncState.set(state));
  sync.on("error", (error) => {
    if (!isMatrixError(error, "M_UNKNOWN_TOKEN")) return;
    const softLogout = error.body.soft_logout === true;
    stopCrypto().then(() =>
      softLogout ? undefined : clearCryptoStore(activeSession),
    );
    clearSession();
    clearSyncToken();
    sessionExpired.set(true);
  });
  sync.on("sync", (response) => {
    roomStore?.applySync(response);
    Object.keys(response.rooms?.leave ?? {}).forEach(dropRoomCache);
    applyPresence(response.presence?.events ?? []);
    applyEphemeral(response.rooms?.join ?? {});
    const accountData = response.account_data?.events ?? [];
    accountDataHooks.forEach((hook) => hook(accountData));
    if (!get(synced)) queueMicrotask(() => promptVerification(activeSession));
    synced.set(true);
  });
  sync.on("room_timeline", ({ roomId, events, limited, prevBatch }) => {
    const timeline =
      timelines[roomId] ??
      (roomId === get(currentRoomId) ? getTimeline(roomId) : undefined);
    timeline?.appendLive(events, limited, prevBatch);
  });
  sync.start();
  loadProfile(activeSession);

  return sync;
};

export const stopMatrix = () => {
  sync?.stop();
  stopCrypto();
  sync = null;
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  Object.keys(timelines).forEach((roomId) => delete timelines[roomId]);
  context = null;
  detached.set(false);
  Object.keys(pinnedCache).forEach((roomId) => delete pinnedCache[roomId]);
  rooms.set({});
  currentTimeline.set([]);
  currentRoomId.set(null);
  joinedMembers.set({});
  presence.set({});
  presenceDetails.set({});
  typingUsers.set({});
  readReceipts.set({});
  ownProfile.set(null);
  synced.set(false);
  session.set(null);
};

export const signOut = async () => {
  const active = get(session) ?? loadSession();
  stopMatrix();
  clearSyncToken();
  await stopCrypto();
  await Promise.all([logout(active), clearCryptoStore(active)]);
};

export const selectRoom = async (roomId: RoomId | null) => {
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  currentRoomId.set(roomId);

  if (!roomId) return currentTimeline.set([]);

  const timeline = getTimeline(roomId);
  currentTimeline.set(timeline.getEvents());
  canLoadOlder.set(timeline.canPaginate());
  context = null;
  detached.set(false);
  canLoadNewer.set(false);
  unsubscribeTimeline = timeline.on("change", (events) => {
    if (context) return;
    currentTimeline.set(events);
    canLoadOlder.set(timeline.canPaginate());
  });
  loadMembers(roomId);

  if (timeline.getEvents().length === 0 && timeline.canPaginate())
    await timeline.paginateBackwards().catch(() => false);

  canLoadOlder.set(timeline.canPaginate());
  markRoomRead(roomId);
};

export const markRoomRead = (roomId: RoomId | null = get(currentRoomId)) => {
  if (!roomId) return;

  roomStore?.markRead(roomId);

  const latest = getTimeline(roomId)
    .getEvents()
    .findLast((event) => !event.txnId || event.localStatus === "sent");

  if (
    !latest ||
    latest.event_id.startsWith("~") ||
    receipts[roomId] === latest.event_id
  )
    return;

  receipts[roomId] = latest.event_id;
  getTimeline(roomId)
    .sendReadReceipt(latest.event_id)
    .catch(() => delete receipts[roomId]);
};

export const retryMessage = (txnId: string) => {
  const roomId = get(currentRoomId);
  return roomId ? getTimeline(roomId).retry(txnId) : undefined;
};

export const selectSpace = (spaceId: RoomId | null) =>
  currentSpaceId.set(spaceId);

const pageContext = (view: ContextView, dir: "b" | "f") => {
  if (view.busy) return view.busy;
  const from = dir === "b" ? view.start : view.end;
  const timeline = getTimeline(view.roomId);

  view.busy = (async () => {
    if (from === null) {
      if (dir === "f") mergeContext(view, view.events.length);
      return false;
    }

    const page = await timeline.fetchPage(view.events, from, dir);
    if (context !== view) return false;

    if (dir === "b") {
      view.events = page.events;
      view.start = page.token;
      showContext(view);
      return page.token !== null;
    }

    const overlap = page.chunkIds.find((eventId) => timeline.hasEvent(eventId));
    view.events = page.events;
    view.end = page.token;

    if (overlap || page.token === null) {
      const cut = overlap ? view.events.findIndex((event) => event.event_id === overlap) : view.events.length;
      mergeContext(view, cut === -1 ? view.events.length : cut);
      return false;
    }

    showContext(view);
    return true;
  })()
    .catch((error) => {
      console.warn("Skye could not page the detached timeline", error);
      return false;
    })
    .finally(() => (view.busy = null));

  return view.busy;
};

const mergeContext = (view: ContextView, cut: number) => {
  const timeline = getTimeline(view.roomId);
  context = null;
  timeline.adoptOlder(view.events.slice(0, cut), view.start);
  detached.set(false);
  canLoadNewer.set(false);
  if (view.roomId !== get(currentRoomId)) return;
  currentTimeline.set(timeline.getEvents());
  canLoadOlder.set(timeline.canPaginate());
};

export const loadNewerMessages = () =>
  context ? pageContext(context, "f") : Promise.resolve(false);

export const returnToPresent = () => leaveContext();

export const isDetached = () => context !== null;

export const jumpToEvent = async (eventId: EventId) => {
  const roomId = requireRoom();
  const timeline = getTimeline(roomId);
  if (context?.events.some((event) => event.event_id === eventId)) return true;
  if (timeline.hasEvent(eventId)) {
    leaveContext();
    return true;
  }

  try {
    const loaded = await timeline.loadContext(eventId);
    if (get(currentRoomId) !== roomId) return false;

    const overlap = loaded.events.findIndex((event) => timeline.hasEvent(event.event_id));
    const view: ContextView = { roomId, ...loaded, busy: null };

    if (overlap !== -1) {
      context = view;
      mergeContext(view, overlap);
      return true;
    }

    context = view;
    detached.set(true);
    showContext(view);
    return true;
  } catch (error) {
    console.warn("Skye could not load message context", eventId, error);
    return false;
  }
};

export const loadOlderMessages = () => {
  const roomId = get(currentRoomId);
  if (!roomId) return Promise.resolve(false);
  if (context) return pageContext(context, "b");

  const timeline = getTimeline(roomId);
  return timeline
    .paginateBackwards()
    .catch(() => false)
    .finally(() => canLoadOlder.set(timeline.canPaginate()));
};

export type ReplyTarget = { eventId: EventId; sender: UserId };

const requireRoom = () => {
  const roomId = get(currentRoomId);
  if (!roomId) throw new Error("No room selected.");
  return roomId;
};

const withReply = (content: Record<string, any>, reply?: ReplyTarget) =>
  reply
    ? {
        ...content,
        "m.relates_to": { "m.in_reply_to": { event_id: reply.eventId } },
        "m.mentions": { user_ids: reply.sender === get(session)?.userId ? [] : [reply.sender] },
      }
    : content;

export const sendMessage = (body: string, reply?: ReplyTarget) =>
  getTimeline(requireRoom()).sendEvent(
    "m.room.message",
    withReply({ msgtype: "m.text", ...markdownToContent(body) }, reply),
  );

export const sendRoomMessage = (
  content: Record<string, any>,
  reply?: ReplyTarget,
  roomId: RoomId = requireRoom(),
) =>
  getTimeline(roomId).sendEvent("m.room.message", withReply(content, reply));

export const editRoomMessage = (eventId: EventId, body: string) => {
  const content = { msgtype: "m.text", ...markdownToContent(body) } as Record<string, any>;
  const fallback: Record<string, any> = { ...content, body: `* ${content.body}` };
  if (content.formatted_body) fallback.formatted_body = `* ${content.formatted_body}`;

  return getTimeline(requireRoom()).sendEvent("m.room.message", {
    ...fallback,
    "m.new_content": content,
    "m.relates_to": { rel_type: "m.replace", event_id: eventId },
  });
};

export const redactMessage = (eventId: EventId) =>
  getTimeline(requireRoom()).redact(eventId);

const pinnedCache: Record<RoomId, Record<EventId, Promise<TimelineEvent | null>>> = {};

export const fetchPinnedEvent = (roomId: RoomId, eventId: EventId) => {
  const cache = (pinnedCache[roomId] ??= {});

  return (cache[eventId] ??= (async () => {
    const timeline = getTimeline(roomId);
    const loaded = timeline.getEvents().find((event) => event.event_id === eventId);
    if (loaded && !loaded.decryptionFailed) return loaded;

    const event = await timeline.fetchEvent(eventId);
    if (event.decryptionFailed) {
      console.warn("Skye could not decrypt pinned event", eventId);
      delete cache[eventId];
    }
    return event;
  })().catch((error) => {
    console.warn("Skye could not load pinned event", eventId, error);
    delete cache[eventId];
    return null;
  }));
};

const updatePins = async (roomId: RoomId, change: (pinned: EventId[]) => EventId[]) => {
  const next = change(roomStore?.getRoom(roomId)?.pinned ?? []);

  try {
    await getTimeline(roomId).setPinned(next);
  } catch (error) {
    console.warn("Skye could not update pinned messages", roomId, error);
    throw error;
  }

  roomStore?.setPinned(roomId, next);
};

export const pinMessage = (eventId: EventId, roomId: RoomId = requireRoom()) =>
  updatePins(roomId, (pinned) => [...pinned.filter((id) => id !== eventId), eventId]);

export const unpinMessage = (eventId: EventId, roomId: RoomId = requireRoom()) =>
  updatePins(roomId, (pinned) => pinned.filter((id) => id !== eventId));

export const findInHistory = async (eventId: EventId, maxPages = 10) => {
  const roomId = requireRoom();
  const timeline = getTimeline(roomId);
  const has = () => timeline.getEvents().some((event) => event.event_id === eventId);

  for (let page = 0; page < maxPages && !has(); page++) {
    const more = await timeline.paginateBackwards().catch(() => false);
    canLoadOlder.set(timeline.canPaginate());
    if (!more && !has()) break;
  }

  return has();
};

export const sendRoomEvent = (type: string, content: Record<string, any>, roomId: RoomId = requireRoom()) =>
  getTimeline(roomId).sendEvent(type, content);

export const fetchRelations = (eventId: EventId, relType = "m.reference", roomId: RoomId = requireRoom()) =>
  getTimeline(roomId).fetchRelations(eventId, relType);

export const sendReaction = (eventId: EventId, key: string, roomId: RoomId = requireRoom()) =>
  getTimeline(roomId).sendEvent("m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key },
  });

export const sendTyping = (roomId: RoomId, typing: boolean) =>
  getTimeline(roomId).sendTyping(typing).catch(() => undefined);

export const discardMessage = (txnId: string) =>
  getTimeline(requireRoom()).discard(txnId);

if (import.meta.hot) import.meta.hot.dispose(() => stopMatrix());
