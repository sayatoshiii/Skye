import { get } from "svelte/store";
import { SETTINGS_ICONS } from "../../components/settings/icons";
import { getLocalisedText } from "../accessibility/language/translation";
import { serverNameFromUserId } from "../matrix/discovery";
import { canModerate, canSendEvent } from "../matrix/rooms";
import { toMatrixTo } from "../matrix/utilities/links";
import { canManageRooms } from "../matrix/utilities/power";
import { MENU_ICONS, ROOM_ICONS } from "../misc/icons";
import { placeCall } from "../stores/calls";
import { hiddenRooms, isRoomHidden, setRoomsHidden } from "../stores/hidden";
import { markAsRead, markUnread, rooms, session } from "../stores/matrix";
import { HOME, navigation, openRoom, openRoomSettings } from "../stores/navigation.svelte";
import { pushRules, roomLevel, setRoomLevel } from "../stores/pushrules";
import { copied, toastKey } from "../stores/toast";
import { callMembers, joinVoice, voice } from "../stores/voice";
import { compose, type MenuOptions } from "./compose";
import { ask, askLeave } from "./prompts.svelte";
import { userActions } from "./user";

export type RoomMenuKey = "person" | "open" | "voice" | "read" | "unread" | "notify" | "settings" | "link" | "id" | "hide" | "leave" | "delete";

const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

const NOTIFY_ICONS = { all: SETTINGS_ICONS.notifications, mentions: MENU_ICONS.mention };

const me = () => get(session)?.userId ?? "";

export const closureOf = (roomId: string) => {
  const all = get(rooms);
  const room = all[roomId];
  const self = me();
  const parents = Object.values(all).filter((entry) => entry.isSpace && entry.children.includes(roomId) && canManageRooms(entry, self)).map((entry) => entry.roomId);
  const present = Object.values(room?.members ?? {}).filter((member) => ["join", "invite"].includes(member.membership) && member.userId !== self);
  const members = present.filter((member) => room && canModerate(room, self, member.userId, "kick")).map((member) => member.userId);
  return { parents, members, stuck: present.length - members.length, allowed: !!room && parents.length > 0 && canSendEvent(room, self, "m.room.join_rules", true) };
};

export const roomActions = (roomId: string, { via, ...options }: MenuOptions<RoomMenuKey> & { via?: string[] } = {}) => {
  const room = get(rooms)[roomId];
  const joined = room?.membership === "join";
  const spaceId = navigation.spaceId;
  const inSpace = spaceId !== HOME;
  const direct = !!room?.isDirect;
  const partner = room?.directUserId;
  const live = !!get(callMembers)[roomId]?.length;
  const level = roomLevel(get(pushRules), roomId);
  const muted = level === "mute";
  const hidden = isRoomHidden(get(hiddenRooms), spaceId, roomId);
  const servers = via ?? (me() ? [serverNameFromUserId(me())] : []);

  return compose<RoomMenuKey>(
    [
      { key: "person", group: "person", when: direct && !!partner, item: () => userActions(partner!, { roomId, omit: ["ignore", "kick", "ban"] }) },
      { key: "open", group: "open", when: joined, optional: true, item: () => ({ id: "open", label: text("room_menu", "open"), icon: MENU_ICONS.open, run: () => openRoom(spaceId, roomId) }) },
      { key: "voice", group: "open", when: joined && get(voice)?.roomId !== roomId, item: () => ({ id: "voice", label: text("voice", live ? "join" : direct ? "call" : "start"), icon: direct ? SETTINGS_ICONS.call : SETTINGS_ICONS.headphones, run: () => void (direct ? placeCall(roomId) : joinVoice(roomId)) }) },
      { key: "read", group: "open", when: joined, item: () => ({ id: "read", label: text("room_menu", "mark_read"), icon: MENU_ICONS.read, run: () => (markAsRead(roomId), toastKey("marked_read", { icon: "check", tone: "success" })) }) },
      { key: "unread", group: "open", when: joined, item: () => ({ id: "unread", label: text("room_menu", "mark_unread"), icon: MENU_ICONS.unread, run: () => markUnread(roomId) && toastKey("marked_unread", { icon: "unread", tone: "accent" }) }) },
      {
        key: "notify",
        group: "notify",
        when: joined,
        item: () => [
          ...(["all", "mentions"] as const).map((choice) => ({ id: `notify-${choice}`, label: text("room_menu", `notify_${choice}`), icon: NOTIFY_ICONS[choice], selected: level === choice, run: () => setRoomLevel(roomId, choice) })),
          { id: "notify-mute", label: text("room_menu", muted ? "notify_unmute" : "notify_mute"), icon: muted ? MENU_ICONS.volume : MENU_ICONS.mute, run: () => setRoomLevel(roomId, muted ? "all" : "mute") },
        ],
      },
      { key: "settings", group: "manage", when: joined && !room?.isDirect, item: () => ({ id: "settings", label: text("room_menu", "settings"), icon: MENU_ICONS.settings, run: () => openRoomSettings(roomId) }) },
      { key: "link", group: "manage", item: () => ({ id: "link", label: text("room_menu", "copy_link"), icon: MENU_ICONS.link, run: () => copied(toMatrixTo(room?.state["m.room.canonical_alias"]?.[""]?.content?.alias ?? roomId, servers), "link_copied", "link") }) },
      { key: "id", group: "manage", item: () => ({ id: "id", label: text("room_menu", "copy_id"), icon: MENU_ICONS.id, run: () => copied(roomId, "id_copied", "id") }) },
      { key: "hide", group: "manage", when: joined && inSpace, item: () => ({ id: "hide", label: text("room_menu", hidden ? "show" : "hide"), icon: MENU_ICONS[hidden ? "show" : "hide"], run: () => (setRoomsHidden(spaceId, [roomId], !hidden), toastKey(hidden ? "shown" : "hidden", hidden ? { icon: "show", tone: "accent" } : { icon: "hide", tone: "danger" })) }) },
      { key: "leave", group: "danger", when: joined, item: () => ({ id: "leave", label: text("room_menu", "leave"), icon: MENU_ICONS.leave, danger: true, run: (event) => askLeave(roomId, event) }) },
      { key: "delete", group: "danger", when: inSpace && closureOf(roomId).allowed, item: () => ({ id: "delete", label: text("room_menu", "delete"), icon: ROOM_ICONS.remove, danger: true, run: () => ask("delete", roomId) }) },
    ],
    options,
  );
};
