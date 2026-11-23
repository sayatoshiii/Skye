import { syncState } from "./matrix";

const LOG_KEY = "skye:voice-log";
const LOG_MAX = 3000;

const readLog = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
  } catch {
    return [];
  }
};

const lines: string[] = typeof localStorage === "undefined" ? [] : readLog();
let pending: ReturnType<typeof setTimeout> | undefined;

const persist = () => {
  pending = undefined;
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(lines));
  } catch {
    lines.splice(0, lines.length >> 1);
  }
};

const show = (value: unknown) =>
  value instanceof Error ? `${value.name}: ${value.message}` : typeof value === "object" && value !== null ? (() => { try { return JSON.stringify(value); } catch { return String(value); } })() : String(value);

export const vlog = (event: string, ...details: unknown[]) => {
  lines.push(`${new Date().toISOString()} ${event}${details.length ? ` ${details.map(show).join(" ")}` : ""}`);
  lines.length > LOG_MAX && lines.splice(0, lines.length - LOG_MAX);
  pending ??= setTimeout(persist, 1500);
};

export const voiceLog = () => (pending && (clearTimeout(pending), persist()), `Skye voice log\n${navigator.userAgent}\n\n${lines.join("\n")}\n`);

export const clearVoiceLog = () => (lines.splice(0), persist());

typeof window !== "undefined" &&
  (window.addEventListener("online", () => vlog("network online")),
  window.addEventListener("offline", () => vlog("network offline")),
  document.addEventListener("visibilitychange", () => vlog(`page ${document.visibilityState}`)),
  document.addEventListener("freeze", () => vlog("page frozen")),
  document.addEventListener("resume", () => vlog("page resumed")),
  window.addEventListener("pagehide", () => (vlog("page hide"), persist())),
  navigator.mediaDevices?.addEventListener?.("devicechange", () => vlog("devices changed")),
  syncState.subscribe((state) => vlog(`sync ${state}`)));

const wakers = new Set<(why: string) => void>();
export const onWake = (hook: (why: string) => void) => void wakers.add(hook);
const wake = (why: string) => wakers.forEach((hook) => hook(why));

typeof window !== "undefined" &&
  (window.addEventListener("online", () => wake("online")), document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake("visible")), navigator.mediaDevices?.addEventListener?.("devicechange", () => wake("devices")));

let lastBeat = Date.now();
typeof window !== "undefined" &&
  setInterval(() => {
    const now = Date.now();
    now - lastBeat > 20000 && (vlog(`clock jumped ${Math.round((now - lastBeat) / 1000)}s, probably asleep`), wake("sleep"));
    lastBeat = now;
  }, 5000);
