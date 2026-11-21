import { derived } from "svelte/store";
import { mediaSettings } from "../settings/media";

const PHRASES = [
  "ty", "tyvm", "tysm", "tyty", "thx", "thnx", "thanx", "tq", "thank you", "thank u", "thank you so much", "thank you very much", "thanks", "thanks so much",
  "thanks a lot", "many thanks", "thanks a bunch", "cheers", "ty so much", "ty very much", "ily", "ilysm", "ily2", "ily too", "love you", "love u", "love ya",
  "i love you", "i love u", "love you too", "i love you too", "love you so much", "i love you so much", "luv you", "luv u", "good bot", "good boy", "good girl",
  "you're the best", "youre the best", "ur the best", "you are the best", "appreciate it", "appreciate you", "much appreciated", "<3", "<33", "<333",
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
const PATTERN = new RegExp(`^(?:${PHRASES.map(escape).join("|")})(?:\\s+(?:so|very)\\s+much)?(?:\\s+(?:@?\\S+|everyone|all|guys|again))?$`, "i");
const HEART_ONLY = /^(?:\p{Extended_Pictographic}\uFE0F?|\u2764\uFE0F?(?:\u200D\p{Extended_Pictographic})?|\s|<3+)+$/u;
const HEART = /[\u2764\u2665\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F49C}\u{1FA77}\u{1F90D}\u{1F5A4}\u{1F90E}\u{1FA75}\u{1FA76}\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F49D}\u{1F49E}\u{1F970}\u{1F60D}]/u;

export const isFriendly = (body?: string) => {
  const text = (body ?? "").split("\n").filter((line) => !line.startsWith(">")).join(" ").trim().replace(/[!.~,?\u2026]+$/u, "").replace(/\s+[\p{Extended_Pictographic}\uFE0F\u200D]+$/u, "").trim();
  return !!text && text.length <= 48 && (PATTERN.test(text) || (HEART_ONLY.test((body ?? "").trim()) && HEART.test(body ?? "") && [...(body ?? "").trim()].length <= 12));
};

const SETS = [
  ["❤️", "🩷", "🤍"],
  ["🧡", "💛", "❤️"],
  ["💚", "💙", "💜"],
  ["💙", "🤍", "🩵"],
  ["💜", "🩷", "💙"],
  ["💛", "💚", "🧡"],
  ["❤️", "🧡", "💛", "💚", "💙", "💜"],
];

let last = -1;
export const heartSet = () => {
  const index = (last + 1 + Math.floor(Math.random() * (SETS.length - 1))) % SETS.length;
  last = index;
  return SETS[index];
};

export const heartsOn = derived(mediaSettings, (settings) => settings.friendlyHearts);
