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
