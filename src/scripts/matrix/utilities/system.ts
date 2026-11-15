import type { TimelineEvent } from "../types";
import { CALL_MEMBER, POLL_END, relatedTo } from "./content";

export const SYSTEM_ICONS = {
  join: "M5 12h12m-5-5 5 5-5 5M19 4v16",
  leave: "M19 12H7m5-5-5 5 5 5M5 4v16",
  invite: "M15 19v-1a5 5 0 0 0-10 0v1M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm9-2v6m-3-3h6",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  pin: "M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6",
  shield: "M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  door: "M6 21V4h12v17M3 21h18M14 12h.01",
  server: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
  upgrade: "M12 19V5m-6 6 6-6 6 6",
  sparkle: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6",
  call: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  hangup: "M3 14c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1-2-3Z",
  poll: "M5 20V10m7 10V4m7 16v-7",
} as const;

export type SystemIcon = keyof typeof SYSTEM_ICONS;
export type MemberVerb = "joined" | "left" | "invited" | "removed" | "profile";

export type SystemLine = {
  icon: SystemIcon;
  key: string;
  params: Record<string, string>;
  detail?: string;
  verb?: MemberVerb;
  jump?: string;
  room?: string;
  tone?: "danger" | "accent";
};

type Resolve = (userId: string) => string;

const HISTORY: Record<string, string> = {
  world_readable: "history_anyone",
  shared: "history_shared",
  invited: "history_invited",
  joined: "history_joined",
};

const JOIN_RULES: Record<string, string> = {
  public: "join_public",
  invite: "join_invite",
  knock: "join_knock",
  restricted: "join_restricted",
  knock_restricted: "join_restricted",
};

const member = (event: TimelineEvent, resolve: Resolve): SystemLine | null => {
  const content = event.content;
  const previous = (event.unsigned?.prev_content ?? {}) as Record<string, any>;
  const target = event.state_key ?? event.sender;
  const actor = resolve(event.sender);
  const subject = typeof content.displayname === "string" && content.displayname ? content.displayname : typeof previous.displayname === "string" && previous.displayname ? previous.displayname : resolve(target);
  const reason = typeof content.reason === "string" && content.reason.trim() ? content.reason.trim() : undefined;
  const params = { actor, target: subject };
  const before = previous.membership;

  switch (content.membership) {
    case "join":
      if (before !== "join") return { icon: "join", key: "joined", params, verb: "joined", tone: "accent" };
      if (content.displayname !== previous.displayname) {
        if (!content.displayname) return { icon: "profile", key: "name_removed", params: { target: previous.displayname ?? resolve(target) }, verb: "profile" };
        if (!previous.displayname) return { icon: "profile", key: "name_set", params: { target: resolve(target), name: content.displayname }, verb: "profile" };
        return { icon: "profile", key: "name_changed", params: { target: previous.displayname, name: content.displayname }, verb: "profile" };
      }
      if (content.avatar_url !== previous.avatar_url)
        return { icon: "profile", key: content.avatar_url ? "avatar_changed" : "avatar_removed", params, verb: "profile" };
      return null;
    case "invite":
      return { icon: "invite", key: "invited", params, verb: "invited", detail: reason };
    case "knock":
      return { icon: "door", key: "knocked", params, verb: "joined", detail: reason };
    case "ban":
      return { icon: "ban", key: "banned", params, verb: "removed", detail: reason, tone: "danger" };
    case "leave":
      if (event.sender === target) return { icon: "leave", key: before === "invite" ? "rejected" : before === "knock" ? "knock_withdrawn" : "left", params, verb: "left" };
      if (before === "ban") return { icon: "shield", key: "unbanned", params, verb: "removed", detail: reason };
      if (before === "invite") return { icon: "leave", key: "invite_withdrawn", params, verb: "removed", detail: reason };
      return { icon: "leave", key: "kicked", params, verb: "removed", detail: reason, tone: "danger" };
  }

  return null;
};

const powerSummary = (event: TimelineEvent, resolve: Resolve): SystemLine => {
  const actor = resolve(event.sender);
  const now = (event.content.users ?? {}) as Record<string, number>;
  const before = (event.unsigned?.prev_content?.users ?? {}) as Record<string, number>;
  const fallback = Number(event.content.users_default ?? 0);
  const changed = [...new Set([...Object.keys(now), ...Object.keys(before)])].filter((user) => (now[user] ?? fallback) !== (before[user] ?? fallback));

  if (changed.length === 1) {
    const [user] = changed;
    return { icon: "shield", key: "power_user", params: { actor, target: resolve(user), from: String(before[user] ?? fallback), to: String(now[user] ?? fallback) } };
  }
  if (changed.length > 1) return { icon: "shield", key: "power_users", params: { actor, count: String(changed.length) } };
  return { icon: "shield", key: "power_changed", params: { actor } };
};

export const describeSystem = (event: TimelineEvent, resolve: Resolve, callStart?: (callId: string) => TimelineEvent | undefined): SystemLine | null => {
  const actor = resolve(event.sender);
  const content = event.content ?? {};
  const previous = (event.unsigned?.prev_content ?? {}) as Record<string, any>;

  switch (event.type) {
    case "m.room.member":
      return member(event, resolve);
    case "m.room.name":
      return content.name ? { icon: "edit", key: "room_name", params: { actor, name: String(content.name) } } : { icon: "edit", key: "room_name_removed", params: { actor } };
    case "m.room.topic":
      return content.topic ? { icon: "edit", key: "room_topic", params: { actor }, detail: String(content.topic) } : { icon: "edit", key: "room_topic_removed", params: { actor } };
    case "m.room.avatar":
      return { icon: "profile", key: content.url ? "room_avatar" : "room_avatar_removed", params: { actor } };
    case "m.room.create":
      return { icon: "sparkle", key: "room_created", params: { actor }, tone: "accent" };
    case "m.room.encryption":
      return { icon: "lock", key: "encryption", params: {} };
    case "m.room.pinned_events": {
      const now: string[] = Array.isArray(content.pinned) ? content.pinned : [];
      const before: string[] = Array.isArray(previous.pinned) ? previous.pinned : [];
      const added = now.find((id) => !before.includes(id));
      if (added) return { icon: "pin", key: "pinned", params: { actor }, jump: added };
      const removed = before.find((id) => !now.includes(id));
      if (removed) return { icon: "pin", key: "unpinned", params: { actor }, jump: removed };
      return { icon: "pin", key: "pins_changed", params: { actor } };
    }
    case "m.room.power_levels":
      return powerSummary(event, resolve);
    case "m.room.history_visibility":
      return { icon: "eye", key: HISTORY[content.history_visibility] ?? "history_changed", params: { actor } };
    case "m.room.join_rules":
      return { icon: "door", key: JOIN_RULES[content.join_rule] ?? "join_changed", params: { actor } };
    case "m.room.server_acl":
      return { icon: "server", key: "server_acl", params: { actor } };
    case "m.room.tombstone":
      return { icon: "upgrade", key: "tombstone", params: { actor }, detail: typeof content.body === "string" ? content.body : undefined, room: typeof content.replacement_room === "string" ? content.replacement_room : undefined, tone: "accent" };
    case "m.call.invite":
      return { icon: "call", key: "call_started", params: { actor }, tone: "accent" };
    case "m.call.hangup": {
      const start = typeof content.call_id === "string" ? callStart?.(content.call_id) : undefined;
      const minutes = start ? Math.max(1, Math.round((event.origin_server_ts - start.origin_server_ts) / 60000)) : 0;
      return minutes ? { icon: "hangup", key: "call_ended_after", params: { actor, minutes: String(minutes) } } : { icon: "hangup", key: "call_ended", params: { actor } };
    }
  }

  if (CALL_MEMBER.includes(event.type)) {
    const active = (value: Record<string, any>) => Object.keys(value ?? {}).length > 0 && !(Array.isArray(value.memberships) && !value.memberships.length);
    const nowActive = active(content);
    if (nowActive === active(previous)) return null;
    return nowActive ? { icon: "call", key: "call_joined", params: { actor }, tone: "accent" } : { icon: "hangup", key: "call_left", params: { actor } };
  }

  if (POLL_END.includes(event.type)) return { icon: "poll", key: "poll_ended", params: { actor }, jump: relatedTo(event) };

  return null;
};

export const SYSTEM_TYPES = [
  "m.room.member",
  "m.room.name",
  "m.room.topic",
  "m.room.avatar",
  "m.room.create",
  "m.room.encryption",
  "m.room.pinned_events",
  "m.room.power_levels",
  "m.room.history_visibility",
  "m.room.join_rules",
  "m.room.server_acl",
  "m.room.tombstone",
  "m.call.invite",
  "m.call.hangup",
  ...CALL_MEMBER,
  ...POLL_END,
];
