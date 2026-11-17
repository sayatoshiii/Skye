import { getRoomDisplayName, isUnread, unreadCountOf } from "../matrix/rooms";
import type { RoomSummary, UserId } from "../matrix/types";

export type RoomEntity = {
  id: string;
  alias?: string;
  name: string;
  topic?: string;
  avatar?: string;
  isDirect: boolean;
  directUserId?: UserId;
  directJoined: boolean;
  createdAt?: number;
  unread: number;
  mentions: number;
  hasUnread: boolean;
  muted: boolean;
  quiet: boolean;
};

export const toEntity = (room: RoomSummary, ownUserId?: UserId): RoomEntity => {
  const direct = room.directUserId ? room.members[room.directUserId] : undefined;

  return {
    id: room.roomId,
    alias: room.state["m.room.canonical_alias"]?.[""]?.content?.alias,
    name: room.name ?? direct?.displayName ?? getRoomDisplayName(room, ownUserId),
    topic: room.topic,
    avatar: room.avatarUrl ?? direct?.avatarUrl,
    isDirect: room.isDirect,
    directUserId: room.directUserId,
    directJoined: room.membership === "join",
    createdAt: room.state["m.room.create"]?.[""]?.origin_server_ts,
    unread: unreadCountOf(room),
    mentions: room.highlightCount,
    hasUnread: isUnread(room) || room.highlightCount > 0,
    muted: room.muted,
    quiet: room.muted || room.mentionsOnly,
  };
};
