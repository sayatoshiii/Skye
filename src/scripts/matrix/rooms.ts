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
  readTs: 0,
  muted: false,
  mentionsOnly: false,
  lastActivity: 0,
  pinned: [],
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
  const pinned = getState<{ pinned?: unknown }>(room, "m.room.pinned_events")?.pinned;
  room.pinned = Array.isArray(pinned)
    ? [...new Set(pinned.filter((id): id is string => typeof id === "string"))]
    : [];

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

export const getTombstone = (room: RoomSummary) => {
  const event = room.state["m.room.tombstone"]?.[""];
  const replacement = event?.content?.replacement_room;
  return typeof replacement === "string"
    ? { replacement, sender: event!.sender ?? "", body: typeof event!.content.body === "string" ? event!.content.body : "" }
    : undefined;
};

export const getPredecessor = (room: RoomSummary) => {
  const predecessor = getState<{ predecessor?: { room_id?: unknown } }>(room, "m.room.create")?.predecessor?.room_id;
  return typeof predecessor === "string" ? predecessor : undefined;
};

export const isSuperseded = (room: RoomSummary, rooms: Record<RoomId, RoomSummary>) =>
  rooms[getTombstone(room)?.replacement ?? ""]?.membership === "join";

export type RoomStoreEvents = {
  change: Record<RoomId, RoomSummary>;
};

export const createRoomStore = (ownUserId: UserId) => {
  const emitter = createEmitter<RoomStoreEvents>();
  const rooms: Record<RoomId, RoomSummary> = {};
  let directRooms: Record<UserId, RoomId[]> = {};

  let mutedRooms = new Set<RoomId>();
  let mentionRooms = new Set<RoomId>();

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

    const unreadCount =
      sync["org.matrix.msc2654.unread_count"] ??
      sync.unread_count ??
      sync.unread_notifications?.["org.matrix.msc2654.unread_count"] ??
      sync.unread_notifications?.unread_count;
    if (typeof unreadCount === "number") room.unreadCount = unreadCount;

    for (const event of timelineEvents) {
      if (!isVisible(event) || !event.event_id) continue;
      const ts = event.origin_server_ts ?? 0;
      if (event.sender === ownUserId) {
        if (ts >= room.readTs) {
          room.readTs = ts;
          room.readEventId = event.event_id;
        }
      } else if (!room.latestForeign || ts >= room.latestForeign.ts)
        room.latestForeign = { eventId: event.event_id, ts };
    }

    for (const event of sync.ephemeral?.events ?? []) {
      if (event.type !== "m.receipt") continue;
      for (const [eventId, kinds] of Object.entries<Record<string, Record<UserId, { ts?: number }>>>(event.content ?? {})) {
        const mine = kinds?.["m.read"]?.[ownUserId] ?? kinds?.["m.read.private"]?.[ownUserId];
        if (!mine) continue;
        const ts = mine.ts ?? Date.now();
        if (ts >= room.readTs) {
          room.readTs = ts;
          room.readEventId = eventId;
        }
      }
    }

    const marker = sync.account_data?.events.find((event) => event.type === "m.fully_read");
    if (typeof marker?.content?.event_id === "string") room.fullyRead = marker.content.event_id;

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

    const pushRules = response.account_data?.events.find(
      (event) => event.type === "m.push_rules",
    );
    if (pushRules) [mutedRooms, mentionRooms] = getQuietRooms(pushRules.content);

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
    Object.values(rooms).forEach((room) => ((room.muted = mutedRooms.has(room.roomId)), (room.mentionsOnly = mentionRooms.has(room.roomId))));
    emitter.emit("change", { ...rooms });
  };

  const markRead = (roomId: RoomId) => {
    const room = rooms[roomId];
    if (!room || !isUnread(room) && !room.highlightCount && !room.notificationCount) return;

    room.notificationCount = 0;
    room.highlightCount = 0;
    room.unreadCount = room.unreadCount === undefined ? undefined : 0;
    if (room.latestForeign && room.latestForeign.ts >= room.readTs) {
      room.readTs = room.latestForeign.ts;
      room.readEventId = room.latestForeign.eventId;
    }
    emitter.emit("change", { ...rooms });
  };

  const setLocalUnread = (roomId: RoomId, count?: number) => {
    const room = rooms[roomId];
    if (!room || room.localUnread === count) return;
    room.localUnread = count;
    emitter.emit("change", { ...rooms });
  };

  const setPinned = (roomId: RoomId, pinned: string[]) => {
    const room = rooms[roomId];
    if (!room) return;

    const previous = room.state["m.room.pinned_events"]?.[""];
    (room.state["m.room.pinned_events"] ??= {})[""] = {
      ...(previous ?? { type: "m.room.pinned_events", state_key: "", event_id: "", sender: ownUserId, origin_server_ts: Date.now() }),
      content: { pinned },
    } as StateEvent;
    deriveFromState(room);
    emitter.emit("change", { ...rooms });
  };

  return {
    applySync,
    markRead,
    setPinned,
    on: emitter.on,
    setLocalUnread,
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
      rooms: collectRooms(subspace, new Set([space.roomId, subspace.roomId])).filter((child) => !isSuperseded(child, rooms)),
    }));

  return {
    space,
    rooms: children.filter((child) => !child.isSpace && !isSuperseded(child, rooms)),
    categories,
  };
};

export const getSpaceTrees = (rooms: Record<RoomId, RoomSummary>) =>
  getTopLevelSpaces(rooms).map((space) => buildSpaceTree(space, rooms));

export const getDirectMessages = (rooms: Record<RoomId, RoomSummary>) =>
  Object.values(rooms)
    .filter((room) => room.isDirect && !isSuperseded(room, rooms))
    .sort(byActivity);

export const getOrphanRooms = (rooms: Record<RoomId, RoomSummary>) => {
  const inSpace = new Set(
    Object.values(rooms)
      .filter((room) => room.isSpace)
      .flatMap((room) => room.children),
  );

  return Object.values(rooms)
    .filter(
      (room) => !room.isSpace && !room.isDirect && !inSpace.has(room.roomId) && !isSuperseded(room, rooms),
    )
    .sort(byActivity);
};

const VISIBLE_TYPES = new Set(["m.room.message", "m.room.encrypted", "m.sticker", "m.poll.start", "org.matrix.msc3381.poll.start"]);

export const isVisible = (event: MatrixEvent) =>
  VISIBLE_TYPES.has(event.type) &&
  event.state_key === undefined &&
  !event.unsigned?.redacted_because &&
  event.content?.["m.relates_to"]?.rel_type !== "m.replace";

const getQuietRooms = (content: Record<string, any> = {}): [Set<RoomId>, Set<RoomId>] => {
  const muted = new Set<RoomId>();
  const mentions = new Set<RoomId>();
  const silent = (actions: unknown) =>
    Array.isArray(actions) && (actions.length === 0 || actions.includes("dont_notify")) && !actions.includes("notify");
  const global = content.global ?? {};

  for (const rule of global.room ?? [])
    if (rule?.enabled !== false && silent(rule.actions)) mentions.add(rule.rule_id);

  for (const rule of global.override ?? []) {
    if (rule?.enabled === false || !silent(rule.actions)) continue;
    const conditions: any[] = rule.conditions ?? [];
    const roomCondition = conditions.find((condition) => condition?.kind === "event_match" && condition.key === "room_id");
    if (roomCondition && conditions.length === 1) muted.add(roomCondition.pattern);
  }

  return [muted, mentions];
};

export const isUnread = (room: RoomSummary) => {
  if (room.membership !== "join") return false;
  if (room.localUnread) return true;
  if (room.notificationCount > 0 || (room.unreadCount ?? 0) > 0) return true;
  if (room.unreadCount === 0) return false;
  const latest = room.latestForeign;
  if (!latest) return false;
  if (latest.eventId === room.readEventId || latest.eventId === room.fullyRead) return false;
  return latest.ts > room.readTs;
};

export const unreadCountOf = (room: RoomSummary) =>
  Math.max(room.localUnread ?? 0, room.notificationCount, room.unreadCount ?? 0, isUnread(room) ? 1 : 0);

export const getUnreadTotals = (roomList: RoomSummary[]) =>
  roomList.reduce(
    (totals, room) => ({
      notificationCount: totals.notificationCount + room.notificationCount,
      highlightCount: totals.highlightCount + room.highlightCount,
    }),
    { notificationCount: 0, highlightCount: 0 },
  );

export const canPin = (room: RoomSummary, userId: UserId) =>
  canSendEvent(room, userId, "m.room.pinned_events", true);

export const canRedact = (room: RoomSummary, userId: UserId, sender: UserId) =>
  canSendEvent(room, userId, "m.room.redaction") &&
  (sender === userId || getPowerLevel(room, userId) >= (room.powerLevels?.redact ?? 50));

export const canModerate = (room: RoomSummary, userId: UserId, target: UserId, action: "kick" | "ban") =>
  userId !== target &&
  getPowerLevel(room, userId) >= (room.powerLevels?.[action] ?? 50) &&
  getPowerLevel(room, userId) > getPowerLevel(room, target);
