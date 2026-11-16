import { derived, get, writable } from "svelte/store";
import { getLocalisedText } from "../accessibility/language/translation";
import { isUnread, unreadCountOf } from "../matrix/rooms";
import type { MatrixEvent, RoomId, RoomSummary, SyncResponse } from "../matrix/types";
import { stripReplyFallback } from "../misc/formatting";
import { currentRoomId, decryptPreview, directMessages, registerLiveSyncHook, rooms, session, spaces } from "./matrix";
import { HOME, getSpaceRoomIds, openRoom } from "./navigation.svelte";

export type SpaceUnread = { unread: boolean; mentions: number };

const roomUnread = (room: RoomSummary) => !room.muted && isUnread(room);

export const unreadDirects = derived(directMessages, ($dms) =>
  $dms
    .filter((room) => room.membership === "join" && !room.muted && (isUnread(room) || room.highlightCount > 0))
    .map((room) => ({ room, count: Math.max(unreadCountOf(room), room.highlightCount) })),
);

export const directTotal = derived(unreadDirects, ($list) => $list.reduce((sum, item) => sum + item.count, 0));

export const spaceUnread = derived([spaces, rooms], ([$spaces, $rooms]) =>
  Object.fromEntries(
    $spaces.map((tree) => {
      const list = getSpaceRoomIds(tree)
        .map((roomId) => $rooms[roomId])
        .filter((room): room is RoomSummary => room?.membership === "join");
      return [
        tree.space.roomId,
        {
          unread: list.some(roomUnread),
          mentions: list.reduce((sum, room) => sum + room.highlightCount, 0),
        } satisfies SpaceUnread,
      ];
    }),
  ) as Record<RoomId, SpaceUnread>,
);

export const titleCount = derived([rooms, directTotal], ([$rooms, $direct]) =>
  Object.values($rooms)
    .filter((room) => !room.isDirect && room.membership === "join")
    .reduce((sum, room) => sum + room.highlightCount, $direct),
);

export const formatCount = (count: number) => (count > 99 ? "99+" : count.toLocaleString());

const pageTitle = derived([titleCount, rooms, currentRoomId, spaces], ([$count, $rooms, $roomId, $spaces]) => {
  const prefix = $count > 0 ? `(${formatCount($count)}) ` : "";
  const room = $roomId ? $rooms[$roomId] : undefined;
  if (!room) return `${prefix}Skye`;
  const name = room.name || room.directUserId || room.roomId;
  if (room.isDirect) return `${prefix}Skye · @${name.replace(/^@/, "")}`;
  const space = $spaces.find((tree) => getSpaceRoomIds(tree).includes(room.roomId));
  return `${prefix}Skye · #${name}${space ? ` (${space.space.name})` : ""}`;
});

if (typeof document !== "undefined") pageTitle.subscribe((title) => (document.title = title));

const PROMPT_KEY = "skye:notifications_prompt";

const readDismissed = () => {
  try {
    return localStorage.getItem(PROMPT_KEY) === "dismissed";
  } catch {
    return false;
  }
};

const supported = () => typeof window !== "undefined" && "Notification" in window;

export const notificationPrompt = writable(supported() && Notification.permission === "default" && !readDismissed());

export const enableNotifications = async () => {
  if (!supported()) return notificationPrompt.set(false);
  const result = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  notificationPrompt.set(result === "default");
};

export const dismissNotificationPrompt = () => {
  notificationPrompt.set(false);
  try {
    localStorage.setItem(PROMPT_KEY, "dismissed");
  } catch {}
};

const THROTTLE_MS = 4000;
const MAX_AGE_MS = 120000;
const lastNotified: Record<RoomId, number> = {};
let previousHighlights: Record<RoomId, number> = {};

const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

const previewOf = (event: MatrixEvent | null) => {
  if (!event) return text("notifications", "encrypted");
  const content = event.content ?? {};
  if (event.type === "m.sticker") return text("notifications", "sticker");
  const body = typeof content.body === "string" ? stripReplyFallback(content.body) : "";
  const kinds: Record<string, string> = { "m.image": "image", "m.video": "video", "m.audio": "audio", "m.file": "file" };
  if (kinds[content.msgtype]) return text("notifications", kinds[content.msgtype]);
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line || text("notifications", "new_message");
};

const mentionsMe = (event: MatrixEvent | null, room: RoomSummary, userId: string) => {
  if (!event) return false;
  const mentions = event.content?.["m.mentions"];
  if (Array.isArray(mentions?.user_ids)) return mentions.user_ids.includes(userId) || mentions.room === true;
  const body = typeof event.content?.body === "string" ? event.content.body.toLowerCase() : "";
  const name = room.members[userId]?.displayName?.toLowerCase();
  return body.includes(userId.toLowerCase()) || (!!name && body.includes(name));
};

const spaceOf = (roomId: RoomId) =>
  get(spaces).find((tree) => getSpaceRoomIds(tree).includes(roomId))?.space.roomId ?? HOME;

const show = (room: RoomSummary, title: string, body: string) => {
  try {
    const notification = new Notification(title, { body, tag: room.roomId, icon: "/favicon.svg" });
    notification.onclick = () => {
      window.focus();
      openRoom(room.isDirect ? HOME : spaceOf(room.roomId), room.roomId);
      notification.close();
    };
  } catch {}
};

const handleLive = async (response: SyncResponse) => {
  const active = get(session);
  const roomMap = get(rooms);
  const highlights = Object.fromEntries(Object.values(roomMap).map((room) => [room.roomId, room.highlightCount]));
  const before = previousHighlights;
  previousHighlights = highlights;
  if (!active || !supported() || Notification.permission !== "granted") return;

  for (const [roomId, sync] of Object.entries(response.rooms?.join ?? {})) {
    const room = roomMap[roomId];
    if (!room || room.muted) continue;
    if (roomId === get(currentRoomId) && document.hasFocus()) continue;
    if (Date.now() - (lastNotified[roomId] ?? 0) < THROTTLE_MS) continue;

    const event = (sync.timeline?.events ?? []).findLast(
      (candidate) =>
        candidate.sender !== active.userId &&
        candidate.state_key === undefined &&
        ["m.room.message", "m.room.encrypted", "m.sticker"].includes(candidate.type) &&
        candidate.content?.["m.relates_to"]?.rel_type !== "m.replace" &&
        Date.now() - (candidate.origin_server_ts ?? 0) < MAX_AGE_MS,
    );
    if (!event?.sender) continue;

    const clear = await decryptPreview(event, roomId);
    const highlighted = room.highlightCount > (before[roomId] ?? 0) || mentionsMe(clear, room, active.userId);
    if (!room.isDirect && !highlighted) continue;

    lastNotified[roomId] = Date.now();
    const sender = room.members[event.sender]?.displayName ?? event.sender.slice(1).split(":")[0];
    const roomName = room.name ?? (room.isDirect ? sender : roomId);
    show(room, roomName, `${sender}: ${previewOf(clear)}`);
  }
};

registerLiveSyncHook((response) => void handleLive(response));
