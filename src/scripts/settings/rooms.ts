import { CALL_ROOM_TYPES, KEYS_TYPE, RTC_MEMBER_TYPE } from "../matrix/utilities/rtc";
import { CALL_MEMBER } from "../matrix/utilities/content";
import type { PowerLevels } from "../matrix/types";

export type RoomAccess = "send" | "react" | "invite" | "call";

export type RoomPreset = { id: string; deny: RoomAccess[] };

export type RoomKind = {
  id: string;
  type?: string;
  ready: boolean;
  access: RoomAccess[];
  presets: RoomPreset[];
};

export const MODERATOR = 50;

const MESSAGING: RoomAccess[] = ["send", "react", "invite"];

export const ROOM_KINDS: RoomKind[] = [
  {
    id: "text",
    ready: true,
    access: MESSAGING,
    presets: [
      { id: "general", deny: [] },
      { id: "announcements", deny: ["send"] },
      { id: "readonly", deny: ["send", "react"] },
    ],
  },
  {
    id: "voice",
    type: CALL_ROOM_TYPES[0],
    ready: true,
    access: ["call", ...MESSAGING],
    presets: [
      { id: "open", deny: [] },
      { id: "listen", deny: ["send"] },
    ],
  },
];

export const ROOM_KINDS_FOLDED = 5;

export const kindOfType = (type: string | undefined) =>
  ROOM_KINDS.find((kind) => (kind.type ? kind.type === type || (kind.id === "voice" && CALL_ROOM_TYPES.includes(type ?? "")) : !type)) ?? ROOM_KINDS[0];

export const accessOf = (kind: RoomKind, preset: RoomPreset) =>
  Object.fromEntries(kind.access.map((key) => [key, !preset.deny.includes(key)])) as Record<RoomAccess, boolean>;

export const presetOf = (kind: RoomKind, access: Record<RoomAccess, boolean>) =>
  kind.presets.find((preset) => kind.access.every((key) => !preset.deny.includes(key) === access[key]));

const level = (allowed: boolean) => (allowed ? 0 : MODERATOR);

const PROTECTED: Record<string, number> = {
  "m.room.name": MODERATOR,
  "m.room.avatar": MODERATOR,
  "m.room.canonical_alias": MODERATOR,
  "m.room.power_levels": 100,
  "m.room.history_visibility": 100,
  "m.room.encryption": 100,
  "m.room.server_acl": 100,
  "m.room.tombstone": 100,
};

const CALL_EVENTS = [...CALL_MEMBER, RTC_MEMBER_TYPE, KEYS_TYPE];

export const powerOverrides = (access: Record<RoomAccess, boolean>): PowerLevels => ({
  events_default: level(access.send ?? true),
  invite: level(access.invite ?? true),
  events: {
    ...PROTECTED,
    "m.reaction": level(access.react ?? true),
    ...("call" in access ? Object.fromEntries(CALL_EVENTS.map((type) => [type, level(access.call)])) : {}),
  },
});
