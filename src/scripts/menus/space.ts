import { get } from "svelte/store";
import { getLocalisedText } from "../accessibility/language/translation";
import { serverNameFromUserId } from "../matrix/discovery";
import type { SpaceTree } from "../matrix/types";
import { toMatrixTo } from "../matrix/utilities/links";
import { canManageRooms } from "../matrix/utilities/power";
import { MENU_ICONS } from "../misc/icons";
import { markAsRead, rooms, session, spaces } from "../stores/matrix";
import { getSpaceRoomIds, openBrowse, openRoomCreator, openRoomSettings } from "../stores/navigation.svelte";
import { copied, toastKey } from "../stores/toast";
import { compose, type MenuOptions } from "./compose";
import { ask } from "./prompts.svelte";

export type SpaceMenuKey = "read" | "browse" | "create" | "settings" | "link" | "id" | "leave";

const text = (...path: string[]) => getLocalisedText(undefined, "space_menu", ...path) as string;

export const joinedRoomsOf = (tree: SpaceTree) =>
  [...getSpaceRoomIds(tree), ...tree.categories.map((category) => category.space.roomId)].filter((roomId) => get(rooms)[roomId]?.membership === "join");

export const spaceActions = (spaceId: string, options?: MenuOptions<SpaceMenuKey>) => {
  const tree = get(spaces).find((candidate) => candidate.space.roomId === spaceId);
  if (!tree) return [];
  const userId = get(session)?.userId ?? "";
  const alias = tree.space.state["m.room.canonical_alias"]?.[""]?.content?.alias;

  return compose<SpaceMenuKey>(
    [
      { key: "read", group: "space", item: () => ({ id: "read", label: text("mark_read"), icon: MENU_ICONS.read, run: () => (joinedRoomsOf(tree).forEach((roomId) => markAsRead(roomId)), toastKey("marked_read", { icon: "check", tone: "success" })) }) },
      { key: "browse", group: "space", item: () => ({ id: "browse", label: text("browse"), icon: MENU_ICONS.browse, run: () => openBrowse(spaceId) }) },
      { key: "create", group: "space", when: canManageRooms(tree.space, userId), item: () => ({ id: "create-room", label: text("create_room"), icon: MENU_ICONS.add, run: () => openRoomCreator(spaceId) }) },
      { key: "settings", group: "space", item: () => ({ id: "settings", label: text("settings"), icon: MENU_ICONS.settings, run: () => openRoomSettings(spaceId) }) },
      { key: "link", group: "share", item: () => ({ id: "link", label: text("copy_link"), icon: MENU_ICONS.link, run: () => copied(toMatrixTo(alias ?? spaceId, userId ? [serverNameFromUserId(userId)] : []), "link_copied", "link") }) },
      { key: "id", group: "share", item: () => ({ id: "id", label: text("copy_id"), icon: MENU_ICONS.id, run: () => copied(spaceId, "id_copied", "id") }) },
      { key: "leave", group: "danger", item: () => ({ id: "leave", label: text("leave"), icon: MENU_ICONS.leave, danger: true, run: () => ask("leave-space", spaceId) }) },
    ],
    options,
  );
};
