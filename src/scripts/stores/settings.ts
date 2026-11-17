import { get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { registerAccountDataHook, session } from "./matrix";

export const SETTINGS_TYPE = "chat.skye.settings";

export type NotifyPrefs = { directs: boolean; mentionsOnly: boolean };

export const DEFAULT_NOTIFY: NotifyPrefs = { directs: true, mentionsOnly: true };

export type SettingsSection = "profile" | "account" | "devices" | "privacy" | "appearance" | "notifications";

export const settingsOpen = writable(false);
export const settingsSection = writable<SettingsSection | null>(null);
export const unsavedChanges = writable(false);
export const unsavedNudge = writable(0);

export const guardUnsaved = () => {
  if (!get(unsavedChanges)) return false;
  unsavedNudge.update((count) => count + 1);
  return true;
};

export const notifyPrefs = writable<NotifyPrefs>(DEFAULT_NOTIFY);

let content: Record<string, unknown> = {};

const readNotify = (value: unknown): NotifyPrefs => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    directs: typeof raw.directs === "boolean" ? raw.directs : DEFAULT_NOTIFY.directs,
    mentionsOnly: typeof raw.mentions_only === "boolean" ? raw.mentions_only : DEFAULT_NOTIFY.mentionsOnly,
  };
};

registerAccountDataHook((events) => {
  const event = events.findLast((candidate) => candidate.type === SETTINGS_TYPE);
  if (!event?.content) return;
  content = event.content;
  notifyPrefs.set(readNotify(content.notifications));
});

export const saveNotifyPrefs = async (prefs: NotifyPrefs) => {
  const active = get(session);
  if (!active) throw new Error("No active Matrix session.");
  const previous = get(notifyPrefs);
  notifyPrefs.set(prefs);
  const next = { ...content, notifications: { directs: prefs.directs, mentions_only: prefs.mentionsOnly } };
  try {
    await sessionRequest(active, {
      endpoint: `user/${encodeURIComponent(active.userId)}/account_data/${SETTINGS_TYPE}`,
      method: "PUT",
      body: next,
    });
    content = next;
  } catch (error) {
    notifyPrefs.set(previous);
    throw error;
  }
};
