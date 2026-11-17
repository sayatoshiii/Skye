import { sessionRequest } from "../session";
import type { PowerLevels, RoomId, RoomSummary, Session } from "../types";

export const ROLES_EVENT = "chat.skye.roles";

export type RoleMeta = { level: number; name: string; color?: string; icon?: string };
export type RolesContent = { roles: RoleMeta[] };
export type Role = RoleMeta & { members: string[] };

export type Permission = {
  key: string;
  group: "general" | "members" | "messages" | "advanced";
  read: (levels: PowerLevels) => number;
  write: (levels: PowerLevels, value: number) => void;
};

const stateRead = (type: string) => (levels: PowerLevels) => levels.events?.[type] ?? levels.state_default ?? 50;
const messageRead = (type: string) => (levels: PowerLevels) => levels.events?.[type] ?? levels.events_default ?? 0;
const eventWrite = (type: string) => (levels: PowerLevels, value: number) => (levels.events = { ...levels.events, [type]: value });
const stateEvent = (key: string, group: Permission["group"], type: string): Permission => ({ key, group, read: stateRead(type), write: eventWrite(type) });
const messageEvent = (key: string, type: string): Permission => ({ key, group: "messages", read: messageRead(type), write: eventWrite(type) });
const field = (key: "invite" | "kick" | "ban" | "redact", group: Permission["group"], fallback: number): Permission => ({
  key,
  group,
  read: (levels) => levels[key] ?? fallback,
  write: (levels, value) => (levels[key] = value),
});

export const PERMISSIONS: Permission[] = [
  stateEvent("name", "general", "m.room.name"),
  stateEvent("topic", "general", "m.room.topic"),
  stateEvent("avatar", "general", "m.room.avatar"),
  stateEvent("alias", "general", "m.room.canonical_alias"),
  stateEvent("pinned", "general", "m.room.pinned_events"),
  { key: "state", group: "general", read: (levels) => levels.state_default ?? 50, write: (levels, value) => (levels.state_default = value) },
  field("invite", "members", 0),
  field("kick", "members", 50),
  field("ban", "members", 50),
  stateEvent("join_rules", "members", "m.room.join_rules"),
  stateEvent("history", "members", "m.room.history_visibility"),
  { key: "send", group: "messages", read: (levels) => levels.events_default ?? 0, write: (levels, value) => (levels.events_default = value) },
  messageEvent("react", "m.reaction"),
  messageEvent("sticker", "m.sticker"),
  field("redact", "messages", 50),
  { key: "notify", group: "messages", read: (levels) => levels.notifications?.room ?? 50, write: (levels, value) => (levels.notifications = { ...levels.notifications, room: value }) },
  stateEvent("permissions", "advanced", "m.room.power_levels"),
  stateEvent("encryption", "advanced", "m.room.encryption"),
  stateEvent("server_acl", "advanced", "m.room.server_acl"),
  stateEvent("upgrade", "advanced", "m.room.tombstone"),
];

export const PERMISSION_GROUPS: Permission["group"][] = ["general", "members", "messages", "advanced"];

export const DEFAULT_NAMES: Record<number, string> = { 100: "admin", 50: "moderator" };

export const powerRead = stateRead;

export const readRoles = (room: RoomSummary | undefined) =>
  ((room?.state[ROLES_EVENT]?.[""]?.content as RolesContent | undefined)?.roles ?? []).filter((role) => Number.isInteger(role?.level));

export const buildRoles = (levels: PowerLevels, meta: RoleMeta[], members: string[], fallbackName: (level: number) => string): Role[] => {
  const base = levels.users_default ?? 0;
  const used = Object.values(levels.users ?? {}).filter((level) => level !== base);
  const all = [...new Set([...meta.map((role) => role.level), ...used])].filter((level) => level !== base).sort((a, b) => b - a);
  const level = (userId: string) => levels.users?.[userId] ?? base;
  const pool = [...new Set([...members, ...Object.keys(levels.users ?? {})])];
  return all.map((value) => ({
    name: fallbackName(value),
    ...meta.find((role) => role.level === value),
    level: value,
    members: pool.filter((userId) => level(userId) === value),
  }));
};

export const grant = (levels: PowerLevels, permission: Permission, level: number, on: boolean) => permission.write(levels, level + Number(!on));

export const setPowerLevels = (session: Session, roomId: RoomId, content: PowerLevels) =>
  sessionRequest<{ event_id: string }>(session, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
    method: "PUT",
    body: content,
  });

export const setRoles = (session: Session, roomId: RoomId, content: RolesContent) =>
  sessionRequest<{ event_id: string }>(session, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/state/${ROLES_EVENT}/`,
    method: "PUT",
    body: content,
  });
