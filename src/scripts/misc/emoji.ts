import twemoji from "@twemoji/api";

export const EMOJI_BASE = "/emoji/twemoji/";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHTML = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ESCAPES[character]);

export const getEmojiURL = (icon: string) => `${EMOJI_BASE}${icon}.svg`;

export const renderEmoji = (text: string) =>
  twemoji.parse(escapeHTML(text), {
    callback: getEmojiURL,
    className: "emoji",
    attributes: () => ({ draggable: "false", loading: "lazy" }),
  });

export const JUMBO_LIMIT = 27;

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|⃣/u;
const KEYCAP = /^[#*0-9]️?⃣$/u;
const LETTERS = /[\p{L}\p{N}\p{P}]/u;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export const isEmojiGrapheme = (grapheme: string) =>
  KEYCAP.test(grapheme) || (PICTOGRAPHIC.test(grapheme) && !LETTERS.test(grapheme));

export const isJumbo = (text: string) => {
  const compact = text.replace(/\s+/g, "");
  if (!compact || !segmenter) return false;
  let count = 0;
  for (const { segment } of segmenter.segment(compact)) {
    if (!isEmojiGrapheme(segment) || ++count > JUMBO_LIMIT) return false;
  }
  return count > 0;
};
