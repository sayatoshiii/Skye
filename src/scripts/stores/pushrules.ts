import { get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import type { RoomId } from "../matrix/types";
import { registerAccountDataHook, session } from "./matrix";
import { toastKey } from "./toast";

export type PushRule = {
  rule_id: string;
  enabled?: boolean;
  default?: boolean;
  actions?: unknown[];
  conditions?: Record<string, unknown>[];
  pattern?: string;
};

export type PushKind = "override" | "content" | "room" | "sender" | "underride";

export type RuleSet = Partial<Record<PushKind, PushRule[]>>;

export type RoomLevel = "all" | "mentions" | "mute";

export const pushRules = writable<RuleSet>({});

registerAccountDataHook((events) => {
  const event = events.findLast((candidate) => candidate.type === "m.push_rules");
  event && pushRules.set(event.content?.global ?? {});
});

const SOUND = { set_tweak: "sound", value: "default" };

const loud = (actions: unknown[] = []) => actions.includes("notify") || actions.some((action) => (action as { set_tweak?: string })?.set_tweak === "sound");

const roomOverride = (rules: RuleSet, roomId: RoomId) =>
  (rules.override ?? []).find((rule) => rule.conditions?.length === 1 && rule.conditions[0]?.key === "room_id" && rule.conditions[0]?.pattern === roomId);

export const findRule = (rules: RuleSet, kind: PushKind, ruleId: string) => (rules[kind] ?? []).find((rule) => rule.rule_id === ruleId);

export const ruleOn = (rules: RuleSet, kind: PushKind, ruleId: string) => {
  const rule = findRule(rules, kind, ruleId);
  return !!rule && rule.enabled !== false && (ruleId === ".m.rule.master" || loud(rule.actions));
};

export const roomLevel = (rules: RuleSet, roomId: RoomId): RoomLevel => {
  const muted = roomOverride(rules, roomId);
  const room = findRule(rules, "room", roomId);
  const quiet = !!room && room.enabled !== false && !loud(room.actions);
  return muted && muted.enabled !== false && !loud(muted.actions) ? "mute" : quiet ? "mentions" : "all";
};

export const keywords = (rules: RuleSet) => (rules.content ?? []).filter((rule) => !rule.default && rule.pattern);

const call = (endpoint: string, method: string, body?: unknown) => {
  const active = get(session);
  return active ? sessionRequest(active, { endpoint: `pushrules/global/${endpoint}`, method, body }) : Promise.reject(new Error("No active Matrix session."));
};

const path = (kind: PushKind, ruleId: string) => `${kind}/${encodeURIComponent(ruleId)}`;

const refresh = () => call("", "GET").then((value) => pushRules.set((value as { global?: RuleSet })?.global ?? (value as RuleSet) ?? {}), () => undefined);

const saved = (work: Promise<unknown>) =>
  work.then(
    () => (refresh(), toastKey("settings_saved", { icon: "save", tone: "success" })),
    () => (refresh(), toastKey("settings_failed", { tone: "danger" })),
  );

const drop = (kind: PushKind, ruleId: string) => call(path(kind, ruleId), "DELETE").catch(() => undefined);

export const setRoomLevel = (roomId: RoomId, level: RoomLevel) => {
  const rules = get(pushRules);
  const muted = roomOverride(rules, roomId);
  const steps: Record<RoomLevel, () => Promise<unknown>> = {
    all: () => drop("room", roomId),
    mentions: () => call(path("room", roomId), "PUT", { actions: ["dont_notify"] }),
    mute: () => call(path("override", roomId), "PUT", { actions: [], conditions: [{ kind: "event_match", key: "room_id", pattern: roomId }] }),
  };
  const clearMute = level !== "mute" && muted ? drop("override", muted.rule_id) : Promise.resolve();
  return saved(clearMute.then(steps[level]));
};

export const setRuleOn = (kind: PushKind, ruleId: string, on: boolean) => {
  const rule = findRule(get(pushRules), kind, ruleId);
  const master = ruleId === ".m.rule.master";
  const actions = on ? ["notify", ...(/^\.m\.rule\.(message|encrypted)$/.test(ruleId) ? [] : [SOUND]), ...(kind === "content" || /mention|display_name|roomnotif/.test(ruleId) ? [{ set_tweak: "highlight" }] : [])] : [];
  const work = master || !rule ? call(`${path(kind, ruleId)}/enabled`, "PUT", { enabled: on }) : call(`${path(kind, ruleId)}/enabled`, "PUT", { enabled: true }).then(() => call(`${path(kind, ruleId)}/actions`, "PUT", { actions }));
  return saved(work);
};

export const addKeyword = (word: string) => {
  const pattern = word.trim();
  return pattern && saved(call(path("content", pattern), "PUT", { pattern, actions: ["notify", SOUND, { set_tweak: "highlight" }] }));
};

export const removeKeyword = (ruleId: string) => saved(call(path("content", ruleId), "DELETE"));
