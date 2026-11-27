import { get } from "svelte/store";
import { loadSession, sessionRequest } from "../matrix/session";
import { currentRoomId, joinedMembers, rooms } from "../stores/matrix";
import { composerMentions } from "./mentions";
import { openUserMenu, userMenu } from "../stores/navigation.svelte";
import { toastKey } from "../stores/toast";
import { longpress } from "./longpress";

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

export const insertMention = (userId: string) => {
  const roomId = get(currentRoomId) ?? "";
  const member = get(rooms)[roomId]?.members[userId] ?? get(joinedMembers)[roomId]?.[userId];
  composerMentions.insert?.({ kind: "user", id: userId, label: member?.displayName || userId.slice(1).split(":")[0] });
};

export const askModeration = (kind: "kick" | "ban", userId: string, roomId: string) => (event: MouseEvent | KeyboardEvent) =>
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
