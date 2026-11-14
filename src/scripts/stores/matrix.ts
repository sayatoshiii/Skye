import { derived, get, writable } from "svelte/store";
import {
  createRoomStore,
  getDirectMessages,
  getOrphanRooms,
  getSpaceTrees,
  getUnreadTotals,
  type RoomStore,
} from "../matrix/rooms";
import { loadSession } from "../matrix/session";
import { createSync, type SyncHandle, type SyncOptions } from "../matrix/sync";
import { createTimeline, type TimelineHandle } from "../matrix/timeline";
import type {
  CryptoHooks,
  RoomId,
  RoomSummary,
  Session,
  SyncState,
  TimelineEvent,
} from "../matrix/types";

export const session = writable<Session | null>(null);
export const syncState = writable<SyncState>("stopped");
export const rooms = writable<Record<RoomId, RoomSummary>>({});
export const currentRoomId = writable<RoomId | null>(null);
export const currentTimeline = writable<TimelineEvent[]>([]);
export const currentSpaceId = writable<RoomId | null>(null);

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
  sync.on("sync", (response) => roomStore?.applySync(response));
  sync.on("room_timeline", ({ roomId, events, limited, prevBatch }) => {
    const timeline =
      timelines[roomId] ??
      (roomId === get(currentRoomId) ? getTimeline(roomId) : undefined);
    timeline?.appendLive(events, limited, prevBatch);
  });
  sync.start();

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
  session.set(null);
};

export const selectRoom = async (roomId: RoomId | null) => {
  unsubscribeTimeline?.();
  unsubscribeTimeline = null;
  currentRoomId.set(roomId);

  if (!roomId) return currentTimeline.set([]);

  const timeline = getTimeline(roomId);
  currentTimeline.set(timeline.getEvents());
  unsubscribeTimeline = timeline.on("change", (events) =>
    currentTimeline.set(events),
  );
  roomStore?.markRead(roomId);

  if (timeline.getEvents().length === 0 && timeline.canPaginate())
    await timeline.paginateBackwards();
};

export const selectSpace = (spaceId: RoomId | null) =>
  currentSpaceId.set(spaceId);

export const loadOlderMessages = () => {
  const roomId = get(currentRoomId);
  return roomId
    ? getTimeline(roomId).paginateBackwards()
    : Promise.resolve(false);
};

export const sendMessage = (body: string) => {
  const roomId = get(currentRoomId);
  if (!roomId) throw new Error("No room selected.");

  return getTimeline(roomId).sendMessage(body);
};
