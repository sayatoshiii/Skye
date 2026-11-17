import { get } from "svelte/store";
import type { MenuItem } from "../../components/app/MessageMenu.svelte";
import { getLocalisedText } from "../accessibility/language/translation";
import { canModerate } from "../matrix/rooms";
import { loadSession, sessionRequest } from "../matrix/session";
import { currentRoomId, joinedMembers, rooms } from "../stores/matrix";
import { composerMentions } from "./mentions";
import { messageUser, openUserMenu, userMenu } from "../stores/navigation.svelte";
import { openFullProfile } from "../stores/profile";
import { settingsOpen, settingsSection } from "../stores/settings";
import { copied, toastKey } from "../stores/toast";
import { longpress } from "./longpress";
import { MENU_ICONS } from "./icons";
import { ignoredUsers, setIgnored } from "../stores/ignored";

type Target = { userId: string; roomId?: string } | undefined;

export const usermenu = (node: HTMLElement, target: Target) => {
  let current = target;
  const open = (x: number, y: number) => current && openUserMenu(current.userId, x, y, current.roomId);
  const oncontextmenu = (event: MouseEvent) => {
    if (!current || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    open(event.clientX, event.clientY);
  };
  const press = longpress(node, open);
  node.addEventListener("contextmenu", oncontextmenu);

  return {
    update: (next: Target) => (current = next),
    destroy: () => {
      press.destroy();
      node.removeEventListener("contextmenu", oncontextmenu);
    },
  };
};


const text = (...path: string[]) => getLocalisedText(undefined, "user_menu", ...path) as string;

export const insertMention = (userId: string) => {
  const roomId = get(currentRoomId) ?? "";
  const member = get(rooms)[roomId]?.members[userId] ?? get(joinedMembers)[roomId]?.[userId];
  composerMentions.insert?.({ kind: "user", id: userId, label: member?.displayName || userId.slice(1).split(":")[0] });
};

const ask = (kind: "kick" | "ban", userId: string, roomId: string) => (event: MouseEvent | KeyboardEvent) =>
  event.shiftKey ? void moderate(kind, userId, roomId) : (userMenu.confirm = { kind, userId, roomId });

export const moderate = async (kind: "kick" | "ban", userId: string, roomId: string, reason?: string) => {
  const session = loadSession();
  if (!session) return;
  try {
    await sessionRequest(session, {
      endpoint: `rooms/${encodeURIComponent(roomId)}/${kind}`,
      method: "POST",
      body: { user_id: userId, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
    });
    toastKey(kind === "kick" ? "kicked" : "banned", { icon: "leave", tone: "danger" });
  } catch {
    toastKey("moderate_failed", { icon: "leave", tone: "danger" });
  }
};

export const ignoreItem = (userId: string, separated = true): MenuItem => {
  const ignored = get(ignoredUsers).has(userId);
  return { id: "user-ignore", label: text(ignored ? "unignore" : "ignore"), icon: MENU_ICONS[ignored ? "show" : "hide"], filled: true, danger: !ignored, separated, run: () => void setIgnored(userId, !ignored) };
};

export const userMenuItems = (userId: string, roomId?: string): MenuItem[] => {
  const ownUserId = loadSession()?.userId;
  const room = roomId ? get(rooms)[roomId] : undefined;
  const profile: MenuItem = { id: "user-profile", label: text("profile"), icon: MENU_ICONS.profile, filled: true, run: () => openFullProfile(userId, roomId) };
  const copy: MenuItem = { id: "user-id", label: text("copy_id"), icon: MENU_ICONS.id, filled: true, run: () => copied(userId, "user_id_copied", "id") };

  if (userId === ownUserId)
    return [
      profile,
      { id: "user-edit", label: text("edit_profile"), icon: MENU_ICONS.edit, filled: true, run: () => (settingsSection.set("profile"), settingsOpen.set(true)) },
      copy,
    ];

  const moderation = (["kick", "ban"] as const).filter((kind) => room && ownUserId && canModerate(room, ownUserId, userId, kind));

  return [
    profile,
    { id: "user-mention", label: text("mention"), icon: MENU_ICONS.mention, filled: true, disabled: !composerMentions.insert, run: () => insertMention(userId) },
    { id: "user-message", label: text("message"), icon: MENU_ICONS.message, filled: true, run: () => void messageUser(userId) },
    copy,
    ignoreItem(userId),
    ...moderation.map((kind, index): MenuItem => ({ id: `user-${kind}`, label: text(kind), icon: MENU_ICONS[kind], filled: true, danger: true,  run: ask(kind, userId, roomId!) })),
  ];
};
