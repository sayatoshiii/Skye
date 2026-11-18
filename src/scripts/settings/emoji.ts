import { derived, get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { registerAccountDataHook, session } from "../stores/matrix";
import { RECENT_EMOJI_KEY, RECENT_EMOJI_LIMIT, SKIN_TONE_KEY } from "./config";
import { findEmoji, whenEmojiIndex, type EmojiIndex } from "../misc/emoji-data";

const emojiIndex = writable<EmojiIndex | null>(null);
const isKnown = (unicode: string) => {
  const index = get(emojiIndex);
  return !index || !!findEmoji(index, unicode);
};

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
  isKnown(unicode) &&
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

export const removeRecent = (unicode: string) =>
  recentEmoji.update((current) => current.filter((item) => item !== unicode));

export const EMOJI_TYPE = "chat.skye.emoji";
const DEFAULT_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"];

export const favouriteEmoji = writable<string[]>([]);

registerAccountDataHook((events) => {
  const event = events.findLast((candidate) => candidate.type === EMOJI_TYPE);
  const list = event?.content?.favourites;
  if (Array.isArray(list)) favouriteEmoji.set(list.filter((item): item is string => typeof item === "string"));
});

export const isFavourite = (unicode: string) => get(favouriteEmoji).includes(unicode);

export const toggleFavourite = (unicode: string) => {
  if (!isFavourite(unicode) && !isKnown(unicode)) return;
  favouriteEmoji.update((current) => (current.includes(unicode) ? current.filter((item) => item !== unicode) : [...current, unicode]));
  const active = get(session);
  if (!active) return;
  sessionRequest(active, {
    endpoint: `user/${encodeURIComponent(active.userId)}/account_data/${EMOJI_TYPE}`,
    method: "PUT",
    body: { favourites: get(favouriteEmoji) },
  }).catch((error) => console.warn("Skye could not save favourite emoji", error));
};

export const quickEmoji = derived([favouriteEmoji, recentEmoji, emojiIndex], ([favourites, recent, index]) =>
  [...new Set([...favourites, ...recent, ...DEFAULT_QUICK])].filter((unicode) => !index || !!findEmoji(index, unicode)).slice(0, DEFAULT_QUICK.length),
);

whenEmojiIndex((index) => (emojiIndex.set(index), recentEmoji.update((current) => current.filter((unicode) => !!findEmoji(index, unicode)))));
