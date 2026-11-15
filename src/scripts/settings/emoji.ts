import { writable } from "svelte/store";
import { RECENT_EMOJI_KEY, RECENT_EMOJI_LIMIT, SKIN_TONE_KEY } from "./config";

const load = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export const recentEmoji = writable<string[]>(typeof localStorage === "undefined" ? [] : load());

recentEmoji.subscribe((value) => {
  try {
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(value));
  } catch {}
});

export const useEmoji = (unicode: string) =>
  recentEmoji.update((current) => [unicode, ...current.filter((item) => item !== unicode)].slice(0, RECENT_EMOJI_LIMIT));

const loadTone = () => {
  try {
    const stored = Number(localStorage.getItem(SKIN_TONE_KEY));
    return stored >= 0 && stored <= 5 ? stored : 0;
  } catch {
    return 0;
  }
};

export const skinTone = writable<number>(typeof localStorage === "undefined" ? 0 : loadTone());

skinTone.subscribe((value) => {
  try {
    localStorage.setItem(SKIN_TONE_KEY, String(value));
  } catch {}
});
