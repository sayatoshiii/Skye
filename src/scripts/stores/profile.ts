import { get, writable } from "svelte/store";
import { getPowerLevel } from "../matrix/rooms";
import type { RoomId, RoomSummary, UserId } from "../matrix/types";
import { rooms, spaces } from "./matrix";

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
  matchMedia("(max-width: 767px)").matches
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

export const getMutualRooms = (userId: UserId, ownUserId: UserId) =>
  Object.values(get(rooms))
    .filter(
      (room) =>
        room.membership === "join" &&
        !room.isDirect &&
        isJoined(room, userId) &&
        isJoined(room, ownUserId),
    )
    .sort((a, b) => Number(b.isSpace) - Number(a.isSpace) || b.lastActivity - a.lastActivity);

export const getSpaceFor = (roomId: RoomId) =>
  get(spaces).find(
    (tree) =>
      tree.rooms.some((room) => room.roomId === roomId) ||
      tree.categories.some((category) => category.rooms.some((room) => room.roomId === roomId)),
  )?.space.roomId;
