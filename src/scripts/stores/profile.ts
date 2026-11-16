import { get, writable } from "svelte/store";
import { getPowerLevel } from "../matrix/rooms";
import type { RoomId, RoomSummary, UserId } from "../matrix/types";
import { rooms, session, spaces } from "./matrix";
import { sessionRequest } from "../matrix/session";

export type ProfileAnchor = { rect: DOMRect; side: "left" | "right"; element?: HTMLElement };

export type ProfileTarget = { userId: UserId; roomId?: RoomId; anchor?: ProfileAnchor };

export const miniProfile = writable<ProfileTarget | null>(null);
export const fullProfile = writable<ProfileTarget | null>(null);

export const openMiniProfile = (
  userId: UserId,
  element: HTMLElement,
  side: ProfileAnchor["side"],
  roomId?: RoomId,
) =>
  get(miniProfile)?.anchor?.element === element
    ? undefined
    : matchMedia("(max-width: 767px)").matches
    ? openFullProfile(userId, roomId)
    : miniProfile.set({
    userId,
    roomId,
    anchor: { rect: element.getBoundingClientRect(), side, element },
  });

export const openFullProfile = (userId: UserId, roomId?: RoomId) => {
  miniProfile.set(null);
  fullProfile.set({ userId, roomId });
};

export const roleOf = (room: RoomSummary | undefined | null, userId: UserId) => {
  if (!room) return undefined;
  const level = getPowerLevel(room, userId);
  return level >= 100 ? "admin" : level >= 50 ? "moderator" : undefined;
};

export const isJoined = (room: RoomSummary, userId: UserId) =>
  room.members[userId]?.membership === "join";

export const sharedRooms = writable<Record<UserId, Set<RoomId>>>({});
const checked = new Map<string, Promise<boolean>>();

const memberIn = (roomId: RoomId, userId: UserId) => {
  const key = `${roomId}|${userId}`;
  const active = get(session);
  const lookup =
    checked.get(key) ??
    (active
      ? sessionRequest<{ membership?: string }>(active, {
          endpoint: `rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
          method: "GET",
        })
          .then((member) => member.membership === "join")
          .catch(() => false)
      : Promise.resolve(false));
  checked.set(key, lookup);
  return lookup;
};

const remember = (userId: UserId, roomIds: RoomId[]) =>
  roomIds.length &&
  sharedRooms.update((current) => ({ ...current, [userId]: new Set([...(current[userId] ?? []), ...roomIds]) }));

export const discoverMutual = async (userId: UserId) => {
  const active = get(session);
  if (!active) return;
  const candidates = Object.values(get(rooms)).filter((room) => room.membership === "join" && !room.isDirect && !isJoined(room, userId));
  const direct = await sessionRequest<{ joined?: RoomId[] }>(active, {
    base: `${active.homeserver.replace(/\/$/, "")}/_matrix/client/unstable/uk.half-shot.msc2666/`,
    endpoint: "user/mutual_rooms",
    method: "GET",
    query: { user_id: userId },
  }).catch(() => null);
  if (direct?.joined) return void remember(userId, direct.joined);
  const queue = [...candidates];
  const worker = async () => {
    for (let room = queue.shift(); room; room = queue.shift()) (await memberIn(room.roomId, userId)) && remember(userId, [room.roomId]);
  };
  await Promise.all(Array.from({ length: 4 }, worker));
};

export const getMutualRooms = (userId: UserId, ownUserId: UserId) => {
  const all = get(rooms);
  const known = get(sharedRooms)[userId];
  const shared = Object.values(all).filter(
    (room) => room.membership === "join" && !room.isDirect && (isJoined(room, userId) || !!known?.has(room.roomId)) && isJoined(room, ownUserId),
  );
  const grouped = new Map(
    shared.map((room) => {
      const parent = room.isSpace ? undefined : all[getSpaceFor(room.roomId) ?? ""];
      const entry = parent ?? room;
      return [entry.roomId, entry] as const;
    }),
  );
  return [...grouped.values()].sort((a, b) => Number(b.isSpace) - Number(a.isSpace) || b.lastActivity - a.lastActivity);
};

export const getSpaceFor = (roomId: RoomId) =>
  get(spaces).find(
    (tree) =>
      tree.rooms.some((room) => room.roomId === roomId) ||
      tree.categories.some((category) => category.rooms.some((room) => room.roomId === roomId)),
  )?.space.roomId;
