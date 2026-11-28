import { getLocalisedText } from "../../accessibility/language/translation";
import { toast } from "../../stores/toast";
import { creatorsOf, getPowerLevel } from "../rooms";
import type { PowerLevels, RoomSummary, Session } from "../types";
import { ROLES_EVENT, powerRead, readRoles, setPowerLevels, setRoles, type RoleMeta, type RolesContent } from "./power";
import { sendState } from "./state";

export type RoleSource = { levels: PowerLevels; roles: RoleMeta[]; creators: string[] };
export type SyncOutcome = { synced: number; skipped: number };

const CREATOR_ROLE = 100;

const rolesContent = (room: RoomSummary | undefined) => (room?.state[ROLES_EVENT]?.[""]?.content ?? {}) as Partial<RolesContent>;

const sorted = (record: Record<string, unknown>) => JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

const sameRoles = (a: RoleMeta[], b: RoleMeta[]) => JSON.stringify([...a].sort((x, y) => y.level - x.level)) === JSON.stringify([...b].sort((x, y) => y.level - x.level));

export const syncEnabled = (space: RoomSummary | undefined) => !!space?.isSpace && rolesContent(space).sync === true;

export const sourceOf = (space: RoomSummary): RoleSource => ({ levels: space.powerLevels ?? {}, roles: readRoles(space), creators: creatorsOf(space) });

export const syncingSpace = (rooms: Record<string, RoomSummary>, room: RoomSummary | undefined) =>
  room && !room.isSpace
    ? [...new Set([...room.parents, ...Object.values(rooms).filter((space) => space.isSpace && space.children.includes(room.roomId)).map((space) => space.roomId)])]
        .map((id) => rooms[id])
        .find(syncEnabled)
    : undefined;

export const childRooms = (rooms: Record<string, RoomSummary>, space: RoomSummary) =>
  space.children.map((id) => rooms[id]).filter((room): room is RoomSummary => !!room && !room.isSpace && room.membership === "join");

export const planFor = ({ levels, roles, creators }: RoleSource, room: RoomSummary, me: string) => {
  const base = levels.users_default ?? 0;
  const target: Record<string, number> = {
    ...Object.fromEntries(creators.map((userId) => [userId, CREATOR_ROLE])),
    ...Object.fromEntries(Object.entries(levels.users ?? {}).filter(([, level]) => level !== base)),
  };
  const roomBase = room.powerLevels?.users_default ?? 0;
  const own = getPowerLevel(room, me);
  const fixed = new Set([me, ...creatorsOf(room)]);
  const managed = new Set([...roles.map((role) => role.level), ...Object.values(target)]);
  const current = room.powerLevels?.users ?? {};
  const movable = (userId: string, to: number) => !fixed.has(userId) && (current[userId] ?? roomBase) < own && to <= own;
  const users = { ...current };
  Object.entries(current).forEach(([userId, level]) => !(userId in target) && managed.has(level) && movable(userId, roomBase) && delete users[userId]);
  Object.entries(target).forEach(([userId, level]) => movable(userId, level) && (level === roomBase ? delete users[userId] : (users[userId] = level)));
  const blocked = Object.entries(target).filter(([userId, level]) => !fixed.has(userId) && (current[userId] ?? roomBase) !== level && !movable(userId, level)).length;
  return { users, roles, blocked };
};

export const inSync = (source: RoleSource, room: RoomSummary, me: string) => {
  const plan = planFor(source, room, me);
  return sorted(plan.users) === sorted(room.powerLevels?.users ?? {}) && sameRoles(plan.roles, readRoles(room));
};

export const syncRoom = async (session: Session, source: RoleSource, room: RoomSummary) => {
  const plan = planFor(source, room, session.userId);
  const own = getPowerLevel(room, session.userId);
  const levels = room.powerLevels ?? {};
  const usersChanged = sorted(plan.users) !== sorted(levels.users ?? {});
  const rolesChanged = !sameRoles(plan.roles, readRoles(room));
  const canLevels = own >= powerRead("m.room.power_levels")(levels);
  const canRoles = own >= powerRead(ROLES_EVENT)(levels);
  await Promise.all([
    usersChanged && canLevels && setPowerLevels(session, room.roomId, { ...levels, users: plan.users }),
    rolesChanged && canRoles && setRoles(session, room.roomId, { ...rolesContent(room), roles: plan.roles }),
  ]);
  return (!usersChanged || canLevels) && (!rolesChanged || canRoles) && !plan.blocked;
};

export const syncSpace = async (session: Session, source: RoleSource, targets: RoomSummary[]): Promise<SyncOutcome> => {
  const results = await Promise.allSettled(targets.map((room) => syncRoom(session, source, room)));
  const synced = results.filter((result) => result.status === "fulfilled" && result.value).length;
  return { synced, skipped: targets.length - synced };
};

export const setSync = (session: Session, space: RoomSummary, sync: boolean, roles = readRoles(space)) => setRoles(session, space.roomId, { ...rolesContent(space), roles, sync });

export const ROLES_BACKUP_EVENT = "chat.skye.roles.backup";

type Snapshot = { users: Record<string, number>; roles: RoleMeta[] };

const backupOf = (space: RoomSummary) => ((space.state[ROLES_BACKUP_EVENT]?.[""]?.content ?? {}) as { rooms?: Record<string, Snapshot> }).rooms ?? {};

export const hasBackup = (space: RoomSummary | undefined) => !!space && Object.keys(backupOf(space)).length > 0;

export const enableSync = async (session: Session, rooms: Record<string, RoomSummary>, space: RoomSummary) => {
  const targets = childRooms(rooms, space);
  await sendState(session, space.roomId, ROLES_BACKUP_EVENT, { rooms: Object.fromEntries(targets.map((room) => [room.roomId, { users: room.powerLevels?.users ?? {}, roles: readRoles(room) }])) });
  await setSync(session, space, true);
  return syncSpace(session, sourceOf(space), targets);
};

const restoreRoom = async (session: Session, room: RoomSummary, { users, roles }: Snapshot) => {
  const own = getPowerLevel(room, session.userId);
  const levels = room.powerLevels ?? {};
  const base = levels.users_default ?? 0;
  const current = levels.users ?? {};
  const fixed = new Set([session.userId, ...creatorsOf(room)]);
  const movable = (userId: string) => !fixed.has(userId) && (current[userId] ?? base) < own && (users[userId] ?? base) <= own;
  const ids = [...new Set([...Object.keys(current), ...Object.keys(users)])];
  const next = Object.fromEntries(ids.map((userId) => [userId, movable(userId) ? users[userId] : current[userId]]).filter(([, level]) => level !== undefined && level !== base));
  const blocked = ids.some((userId) => !fixed.has(userId) && (users[userId] ?? base) !== (current[userId] ?? base) && !movable(userId));
  const canLevels = own >= powerRead("m.room.power_levels")(levels);
  const canRoles = own >= powerRead(ROLES_EVENT)(levels);
  await Promise.all([canLevels && setPowerLevels(session, room.roomId, { ...levels, users: next }), canRoles && setRoles(session, room.roomId, { ...rolesContent(room), roles })]);
  return canLevels && canRoles && !blocked;
};

export const disableSync = async (session: Session, rooms: Record<string, RoomSummary>, space: RoomSummary, restore: boolean): Promise<SyncOutcome> => {
  const saved = backupOf(space);
  const targets = restore ? childRooms(rooms, space).filter((room) => saved[room.roomId]) : [];
  const results = await Promise.allSettled(targets.map((room) => restoreRoom(session, room, saved[room.roomId])));
  await setSync(session, space, false);
  restore && (await sendState(session, space.roomId, ROLES_BACKUP_EVENT, {}));
  const synced = results.filter((result) => result.status === "fulfilled" && result.value).length;
  return { synced, skipped: targets.length - synced };
};

export const canOfferSync = (space: RoomSummary | undefined, me: string) =>
  !!space && !syncEnabled(space) && space.children.length > 0 && [powerRead("m.room.power_levels"), powerRead(ROLES_EVENT)].every((read) => getPowerLevel(space, me) >= read(space.powerLevels ?? {}));

const phrase = (key: string, values: Record<string, number>) =>
  Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), getLocalisedText(undefined, "room_settings", "sync", key) as string);

export const announceSync = ({ synced, skipped }: SyncOutcome, restored = false) =>
  toast(skipped ? phrase(restored ? "restore_partial" : "partial", { synced, skipped }) : phrase(restored ? "restored" : "done", { count: synced }), { icon: "check", tone: skipped ? "danger" : "success" });
