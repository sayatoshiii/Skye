import { derived, get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { currentTimeline, registerAccountDataHook, session } from "./matrix";
import { toastKey } from "./toast";

export const IGNORED_USERS_TYPE = "m.ignored_user_list";

export const ignoredUsers = writable<Set<string>>(new Set());

registerAccountDataHook((events) => {
  const event = events.findLast((candidate) => candidate.type === IGNORED_USERS_TYPE);
  const list = event?.content?.ignored_users;
  event && ignoredUsers.set(new Set(list && typeof list === "object" ? Object.keys(list) : []));
});

export const visibleTimeline = derived([currentTimeline, ignoredUsers], ([$timeline, $ignored]) =>
  $ignored.size ? $timeline.filter((event) => !$ignored.has(event.sender ?? "")) : $timeline,
);

export const setIgnored = async (userId: string, ignored: boolean) => {
  const active = get(session);
  if (!active) return;
  const previous = get(ignoredUsers);
  const next = new Set(previous);
  next[ignored ? "add" : "delete"](userId);
  ignoredUsers.set(next);

  await sessionRequest(active, {
    endpoint: `user/${encodeURIComponent(active.userId)}/account_data/${IGNORED_USERS_TYPE}`,
    method: "PUT",
    body: { ignored_users: Object.fromEntries([...next].map((id) => [id, {}])) },
  }).then(
    () => toastKey(ignored ? "ignored" : "unignored", { icon: "leave" }),
    () => (ignoredUsers.set(previous), toastKey("ignore_failed", { icon: "leave", tone: "danger" })),
  );
};
