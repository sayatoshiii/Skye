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
import { clearSession, loadSession, logout, sessionRequest } from "../matrix/session";
import {
  clearSyncToken,
  createSync,
  type SyncHandle,
  type SyncOptions,
} from "../matrix/sync";
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
export const joinedMembers = writable<Record<RoomId, Record<UserId, RoomMember>>>(
  {},
);
export const ownProfile = writable<Profile | null>(null);
export const canLoadOlder = writable(true);

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
export const directUnread = derived(directMessages, ($dms) =>
  getUnreadTotals($dms),
);

let sync: SyncHandle | null = null;
let roomStore: RoomStore | null = null;
let crypto: CryptoHooks = {};
const timelines: Record<RoomId, TimelineHandle> = {};
let unsubscribeTimeline: (() => void) | null = null;
const receipts: Record<RoomId, EventId> = {};

const applyPresence = (events: { sender?: UserId; content: any }[]) => {
  if (!events.length) return;

  presence.update((current) => ({
    ...current,
    ...Object.fromEntries(
      events
        .filter((event) => event.sender && event.content?.presence)
        .map((event) => [event.sender, event.content.presence as Presence]),
    ),
  }));
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
  if (!active || get(joinedMembers)[roomId]) return;

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
};

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

  crypto = options.crypto ?? {};
  session.set(activeSession);
  roomStore = createRoomStore(activeSession.userId);
  roomStore.on("change", (next) => rooms.set(next));

  sync = createSync({ ...options, session: activeSession });
  sync.on("state", (state) => syncState.set(state));
  sync.on("error", (error) => {
    if (!isMatrixError(error, "M_UNKNOWN_TOKEN")) return;
    clearSession();
    clearSyncToken();
    sessionExpired.set(true);
  });
  sync.on("sync", (response) => {
    roomStore?.applySync(response);
    applyPresence(response.presence?.events ?? []);
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
  sync = null;
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  Object.keys(timelines).forEach((roomId) => delete timelines[roomId]);
  rooms.set({});
  currentTimeline.set([]);
  currentRoomId.set(null);
  joinedMembers.set({});
  presence.set({});
  ownProfile.set(null);
  synced.set(false);
  session.set(null);
};

export const signOut = async () => {
  const active = get(session) ?? loadSession();
  stopMatrix();
  clearSyncToken();
  await logout(active);
};

export const selectRoom = async (roomId: RoomId | null) => {
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  currentRoomId.set(roomId);

  if (!roomId) return currentTimeline.set([]);

  const timeline = getTimeline(roomId);
  currentTimeline.set(timeline.getEvents());
  canLoadOlder.set(timeline.canPaginate());
  unsubscribeTimeline = timeline.on("change", (events) => {
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

export const loadOlderMessages = () => {
  const roomId = get(currentRoomId);
  if (!roomId) return Promise.resolve(false);

  const timeline = getTimeline(roomId);
  return timeline
    .paginateBackwards()
    .catch(() => false)
    .finally(() => canLoadOlder.set(timeline.canPaginate()));
};

export const sendMessage = (body: string) => {
  const roomId = get(currentRoomId);
  if (!roomId) throw new Error("No room selected.");

  return getTimeline(roomId).sendMessage(body);
};
