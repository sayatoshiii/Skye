export type EmojiEntry = {
  hexcode: string;
  unicode: string;
  label: string;
  version?: number;
  group?: number;
  tone?: number | number[];
  shortcodes: string[];
  skins?: EmojiEntry[];
};

type RawEmoji = {
  hexcode: string;
  label: string;
  emoji: string;
  version?: number;
  group?: number;
  tone?: number | number[];
  skins?: RawEmoji[];
};

type Shortcodes = Record<string, string | string[]>;

export type EmojiIndex = {
  byHex: Map<string, EmojiEntry>;
  byShortcode: Map<string, EmojiEntry>;
  bases: EmojiEntry[];
};

export const MAX_EMOJI_VERSION = 17;

const TWEMOJI_QUIRKS: Record<string, string> = {
  "1f441-fe0f-200d-1f5e8-fe0f": "1f441-200d-1f5e8",
};

let pending: Promise<EmojiIndex> | null = null;
let ready: EmojiIndex | null = null;
const listeners: ((index: EmojiIndex) => void)[] = [];

export const normaliseHex = (hexcode: string) =>
  hexcode.toUpperCase().split("-").filter((part) => part !== "FE0F").join("-");

export const toHexcode = (unicode: string) =>
  [...unicode].map((character) => character.codePointAt(0)!.toString(16).toUpperCase()).join("-");

export const formatCodepoints = (unicode: string) =>
  [...unicode].map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");

const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

const build = (data: RawEmoji[], sources: Shortcodes[]): EmojiIndex => {
  const byHex = new Map<string, EmojiEntry>();
  const byShortcode = new Map<string, EmojiEntry>();
  const bases: EmojiEntry[] = [];

  const add = (raw: RawEmoji, base: boolean): EmojiEntry => {
    const shortcodes = [...new Set(sources.flatMap((source) => list(source[raw.hexcode])))];
    const entry: EmojiEntry = {
      hexcode: raw.hexcode,
      unicode: raw.emoji,
      label: raw.label,
      version: raw.version,
      group: raw.group,
      tone: raw.tone,
      shortcodes,
    };
    byHex.set(normaliseHex(raw.hexcode), entry);
    if (!base) return entry;
    bases.push(entry);
    shortcodes.forEach((code) => byShortcode.has(code) || byShortcode.set(code, entry));
    return entry;
  };

  data.filter((raw) => (raw.version ?? 0) < MAX_EMOJI_VERSION + 1).forEach((raw) => {
    const entry = add(raw, true);
    if (raw.skins) entry.skins = raw.skins.map((skin) => add(skin, false));
  });

  return { byHex, byShortcode, bases };
};

export const loadEmojiIndex = () =>
  (pending ??= Promise.all([
    import("emojibase-data/en/data.json"),
    import("emojibase-data/en/shortcodes/emojibase.json"),
    import("emojibase-data/en/shortcodes/github.json"),
    import("emojibase-data/en/shortcodes/cldr.json"),
  ]).then(([data, emojibase, github, cldr]) =>
    (ready = build(data.default as RawEmoji[], [emojibase.default, github.default, cldr.default] as Shortcodes[]), listeners.splice(0).forEach((run) => run(ready!)), ready),
  ));

export const whenEmojiIndex = (run: (index: EmojiIndex) => void) => (ready ? run(ready) : listeners.push(run));

export const peekEmojiIndex = () => ready;

export const findEmoji = (index: EmojiIndex, unicode: string) => index.byHex.get(normaliseHex(toHexcode(unicode))) ?? null;

export const searchEmoji = (index: EmojiIndex, query: string, recent: string[], limit = 8) => {
  const needle = query.toLowerCase();
  const scored: { entry: EmojiEntry; code: string; score: number }[] = [];

  index.bases.forEach((entry) => {
    let best: { code: string; score: number } | null = null;
    entry.shortcodes.forEach((code) => {
      const score = code.startsWith(needle) ? 0 : code.split("_").some((word) => word.startsWith(needle)) ? 1 : code.includes(needle) ? 2 : -1;
      if (score >= 0 && (!best || score < best.score || (score === best.score && code.length < best.code.length))) best = { code, score };
    });
    if (best) scored.push({ entry, ...(best as { code: string; score: number }) });
  });

  const rank = (unicode: string) => {
    const position = recent.indexOf(unicode);
    return position < 0 ? recent.length : position;
  };

  return scored
    .sort((a, b) => a.score - b.score || rank(a.entry.unicode) - rank(b.entry.unicode) || a.code.length - b.code.length)
    .slice(0, limit);
};

export const withTone = (entry: EmojiEntry, tone: number) =>
  (tone && entry.skins?.find((skin) => skin.tone === tone)) || entry;

export const twemojiFile = (unicode: string) => {
  const file = toHexcode(unicode.includes("\u200D") ? unicode : unicode.replace(/\uFE0F/g, "")).toLowerCase();
  return TWEMOJI_QUIRKS[file] ?? file;
};
