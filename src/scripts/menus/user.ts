import { get } from "svelte/store";
import { getLocalisedText } from "../accessibility/language/translation";
import { canModerate } from "../matrix/rooms";
import { loadSession } from "../matrix/session";
import { MENU_ICONS } from "../misc/icons";
import { composerMentions } from "../misc/mentions";
import { askModeration, insertMention } from "../misc/usermenu";
import { ignoredUsers, setIgnored } from "../stores/ignored";
import { rooms } from "../stores/matrix";
import { messageUser } from "../stores/navigation.svelte";
import { openFullProfile } from "../stores/profile";
import { settingsOpen, settingsSection } from "../stores/settings";
import { copied } from "../stores/toast";
import { compose, type MenuOptions } from "./compose";

export type UserMenuKey = "profile" | "edit" | "mention" | "message" | "id" | "ignore" | "kick" | "ban";

const text = (...path: string[]) => getLocalisedText(undefined, "user_menu", ...path) as string;

export const userActions = (userId: string, { roomId, ...options }: MenuOptions<UserMenuKey> & { roomId?: string } = {}) => {
  const me = loadSession()?.userId;
  const self = userId === me;
  const room = roomId ? get(rooms)[roomId] : undefined;
  const ignored = get(ignoredUsers).has(userId);
  const can = (kind: "kick" | "ban") => !!room && !!me && canModerate(room, me, userId, kind);

  return compose<UserMenuKey>(
    [
      { key: "profile", group: "person", item: () => ({ id: "user-profile", label: text("profile"), icon: MENU_ICONS.profile, filled: true, run: () => openFullProfile(userId, roomId) }) },
      { key: "edit", group: "person", when: self, item: () => ({ id: "user-edit", label: text("edit_profile"), icon: MENU_ICONS.edit, filled: true, run: () => (settingsSection.set("profile"), settingsOpen.set(true)) }) },
      { key: "mention", group: "person", when: !self, item: () => ({ id: "user-mention", label: text("mention"), icon: MENU_ICONS.mention, filled: true, disabled: !composerMentions.insert, run: () => insertMention(userId) }) },
      { key: "message", group: "person", when: !self, item: () => ({ id: "user-message", label: text("message"), icon: MENU_ICONS.message, filled: true, run: () => void messageUser(userId) }) },
      { key: "id", group: "person", item: () => ({ id: "user-id", label: text("copy_id"), icon: MENU_ICONS.id, filled: true, run: () => copied(userId, "user_id_copied", "id") }) },
      { key: "ignore", group: "safety", when: !self, item: () => ({ id: "user-ignore", label: text(ignored ? "unignore" : "ignore"), icon: MENU_ICONS[ignored ? "show" : "hide"], filled: true, danger: !ignored, run: () => void setIgnored(userId, !ignored) }) },
      ...(["kick", "ban"] as const).map((kind) => ({ key: kind, group: "safety", when: can(kind), item: () => ({ id: `user-${kind}`, label: text(kind), icon: MENU_ICONS[kind], filled: true, danger: true, run: askModeration(kind, userId, roomId!) }) })),
    ],
    options,
  );
};
