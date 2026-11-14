import { createEmitter } from "../misc/events";
import type {
  InvitedRoomSync,
  JoinedRoomSync,
  LeftRoomSync,
  Membership,
  MatrixEvent,
  PowerLevels,
  RoomId,
  RoomMember,
  RoomSummary,
  SpaceCategory,
  SpaceTree,
  StateEvent,
  SyncResponse,
  UserId,
} from "./types";

const createRoom = (roomId: RoomId, membership: Membership): RoomSummary => ({
  roomId,
  membership,
  isSpace: false,
  isDirect: false,
  children: [],
  parents: [],
  members: {},
  heroes: [],
  notificationCount: 0,
  highlightCount: 0,
  lastActivity: 0,
  state: {},
});

const getState = <C = Record<string, any>>(
  room: RoomSummary,
  type: string,
  stateKey = "",
) => room.state[type]?.[stateKey]?.content as C | undefined;

const isEmpty = (content?: Record<string, unknown>) =>
  !content || Object.keys(content).length === 0;

const deriveFromState = (room: RoomSummary) => {
  room.name = getState<{ name?: string }>(room, "m.room.name")?.name;
  room.topic = getState<{ topic?: string }>(room, "m.room.topic")?.topic;
  room.avatarUrl = getState<{ url?: string }>(room, "m.room.avatar")?.url;
  room.roomType = getState<{ type?: string }>(room, "m.room.create")?.type;
  room.isSpace = room.roomType === "m.space";
  room.encryption = getState(room, "m.room.encryption");
  room.powerLevels = getState<PowerLevels>(room, "m.room.power_levels");

  room.children = Object.entries(room.state["m.space.child"] ?? {})
    .filter(([, event]) => !isEmpty(event.content))
    .sort(
      ([a, eventA], [b, eventB]) =>
        String(eventA.content.order ?? "").localeCompare(
          String(eventB.content.order ?? ""),
        ) || a.localeCompare(b),
    )
    .map(([childId]) => childId);

  room.parents = Object.entries(room.state["m.space.parent"] ?? {})
    .filter(([, event]) => !isEmpty(event.content))
    .map(([parentId]) => parentId);

  room.members = Object.fromEntries(
    Object.entries(room.state["m.room.member"] ?? {}).map(
      ([userId, event]): [UserId, RoomMember] => [
        userId,
        {
          userId,
          membership: event.content.membership,
          displayName: event.content.displayname,
          avatarUrl: event.content.avatar_url,
        },
      ],
    ),
  );
};

const applyStateEvents = (room: RoomSummary, events: MatrixEvent[] = []) => {
  events
    .filter((event): event is StateEvent => event.state_key !== undefined)
    .forEach((event) => {
      (room.state[event.type] ??= {})[event.state_key] = event;
    });
};

export const getRoomDisplayName = (
  room: RoomSummary,
  ownUserId?: UserId,
): string => {
  if (room.name) return room.name;

  const alias = getState<{ alias?: string }>(
    room,
    "m.room.canonical_alias",
  )?.alias;
  if (alias) return alias;

  const heroes = room.heroes.filter((userId) => userId !== ownUserId);
  const names = heroes.map(
    (userId) => room.members[userId]?.displayName ?? userId,
  );

  return names.length ? names.join(", ") : room.roomId;
};

export const getPowerLevel = (room: RoomSummary, userId: UserId) =>
  room.powerLevels?.users?.[userId] ?? room.powerLevels?.users_default ?? 0;

export const canSendEvent = (
  room: RoomSummary,
  userId: UserId,
  eventType: string,
  isState = false,
) =>
  getPowerLevel(room, userId) >=
  (room.powerLevels?.events?.[eventType] ??
    (isState
      ? (room.powerLevels?.state_default ?? 50)
      : (room.powerLevels?.events_default ?? 0)));

export type RoomStoreEvents = {
  change: Record<RoomId, RoomSummary>;
};

export const createRoomStore = (ownUserId: UserId) => {
  const emitter = createEmitter<RoomStoreEvents>();
  const rooms: Record<RoomId, RoomSummary> = {};
  let directRooms: Record<UserId, RoomId[]> = {};

  const ensureRoom = (roomId: RoomId, membership: Membership) =>
    (rooms[roomId] ??= createRoom(roomId, membership));

  const applyDirect = () => {
    const directLookup = Object.fromEntries(
      Object.entries(directRooms).flatMap(([userId, roomIds]) =>
        roomIds.map((roomId) => [roomId, userId]),
      ),
    );

    Object.values(rooms).forEach((room) => {
      room.directUserId = directLookup[room.roomId];
      room.isDirect = room.directUserId !== undefined;
    });
  };

  const applyJoined = (roomId: RoomId, sync: JoinedRoomSync) => {
    const room = ensureRoom(roomId, "join");
    const timelineEvents = sync.timeline?.events ?? [];

    room.membership = "join";
    applyStateEvents(room, sync.state?.events);
    applyStateEvents(room, timelineEvents);

    if (sync.summary?.["m.heroes"]) room.heroes = sync.summary["m.heroes"];
    if (sync.summary?.["m.joined_member_count"] !== undefined)
      room.joinedMemberCount = sync.summary["m.joined_member_count"];

    if (sync.unread_notifications) {
      room.notificationCount =
        sync.unread_notifications.notification_count ?? 0;
      room.highlightCount = sync.unread_notifications.highlight_count ?? 0;
    }

    const latest = timelineEvents.at(-1)?.origin_server_ts;
    if (latest) room.lastActivity = Math.max(room.lastActivity, latest);

    deriveFromState(room);
  };

  const applyInvited = (roomId: RoomId, sync: InvitedRoomSync) => {
    const room = ensureRoom(roomId, "invite");

    room.membership = "invite";
    applyStateEvents(room, sync.invite_state?.events);
    deriveFromState(room);
  };

  const applyLeft = (roomId: RoomId, _sync: LeftRoomSync) => {
    delete rooms[roomId];
  };

  const applySync = (response: SyncResponse) => {
    const direct = response.account_data?.events.find(
      (event) => event.type === "m.direct",
    );
    if (direct) directRooms = direct.content as Record<UserId, RoomId[]>;

    Object.entries(response.rooms?.join ?? {}).forEach(([id, sync]) =>
      applyJoined(id, sync),
    );
    Object.entries(response.rooms?.invite ?? {}).forEach(([id, sync]) =>
      applyInvited(id, sync),
    );
    Object.entries(response.rooms?.leave ?? {}).forEach(([id, sync]) =>
      applyLeft(id, sync),
    );

    applyDirect();
    emitter.emit("change", { ...rooms });
  };

  const markRead = (roomId: RoomId) => {
    const room = rooms[roomId];
    if (!room) return;

    room.notificationCount = 0;
    room.highlightCount = 0;
    emitter.emit("change", { ...rooms });
  };

  return {
    applySync,
    markRead,
    on: emitter.on,
    getRoom: (roomId: RoomId) => rooms[roomId],
    getRooms: () => ({ ...rooms }),
    getDirectRooms: () => ({ ...directRooms }),
    getDisplayName: (room: RoomSummary) => getRoomDisplayName(room, ownUserId),
  };
};

export type RoomStore = ReturnType<typeof createRoomStore>;

const byActivity = (a: RoomSummary, b: RoomSummary) =>
  b.lastActivity - a.lastActivity;

export const getTopLevelSpaces = (rooms: Record<RoomId, RoomSummary>) =>
  Object.values(rooms).filter(
    (room) =>
      room.isSpace &&
      room.membership === "join" &&
      !room.parents.some((parentId) => rooms[parentId]?.isSpace) &&
      !Object.values(rooms).some(
        (other) => other.isSpace && other.children.includes(room.roomId),
      ),
  );

export const buildSpaceTree = (
  space: RoomSummary,
  rooms: Record<RoomId, RoomSummary>,
): SpaceTree => {
  const childOf = (parent: RoomSummary) =>
    parent.children
      .map((childId) => rooms[childId])
      .filter((child): child is RoomSummary => child !== undefined);

  const collectRooms = (
    parent: RoomSummary,
    seen: Set<RoomId>,
  ): RoomSummary[] =>
    childOf(parent).flatMap((child) => {
      if (seen.has(child.roomId)) return [];
      seen.add(child.roomId);
      return child.isSpace ? collectRooms(child, seen) : [child];
    });

  const children = childOf(space);
  const categories: SpaceCategory[] = children
    .filter((child) => child.isSpace)
    .map((subspace) => ({
      space: subspace,
      rooms: collectRooms(subspace, new Set([space.roomId, subspace.roomId])),
    }));

  return {
    space,
    rooms: children.filter((child) => !child.isSpace),
    categories,
  };
};

export const getSpaceTrees = (rooms: Record<RoomId, RoomSummary>) =>
  getTopLevelSpaces(rooms).map((space) => buildSpaceTree(space, rooms));

export const getDirectMessages = (rooms: Record<RoomId, RoomSummary>) =>
  Object.values(rooms)
    .filter((room) => room.isDirect)
    .sort(byActivity);

export const getOrphanRooms = (rooms: Record<RoomId, RoomSummary>) => {
  const inSpace = new Set(
    Object.values(rooms)
      .filter((room) => room.isSpace)
      .flatMap((room) => room.children),
  );

  return Object.values(rooms)
    .filter(
      (room) => !room.isSpace && !room.isDirect && !inSpace.has(room.roomId),
    )
    .sort(byActivity);
};

export const getUnreadTotals = (roomList: RoomSummary[]) =>
  roomList.reduce(
    (totals, room) => ({
      notificationCount: totals.notificationCount + room.notificationCount,
      highlightCount: totals.highlightCount + room.highlightCount,
    }),
    { notificationCount: 0, highlightCount: 0 },
  );
