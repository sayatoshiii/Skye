import { escapeHTML } from "./emoji";

const BIT = {
  sym: 1,
  bold: 2,
  italic: 4,
  underline: 8,
  strike: 16,
  spoiler: 32,
  code: 64,
  link: 128,
  url: 256,
  mention: 512,
  quote: 1024,
  h1: 2048,
  h2: 4096,
  h3: 8192,
  block: 16384,
  pill: 32768,
  joined: 65536,
  before: 131072,
} as const;

const NAMES = Object.entries(BIT) as [keyof typeof BIT, number][];

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/y;
const MENTION = /@[\w.=\-+]+(?::[\w.-]+(?::\d+)?)?/y;
const HEADING = /^(#{1,3}) (?=\S)/;
const QUOTE = /^>>?>? /;
const FENCE = /^```/;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
const DELIMS = "*_~|";

type Run = { char: string; start: number; length: number; left: number; right: number; open: boolean; close: boolean };

const fill = (masks: Uint32Array, from: number, to: number, bit: number) => {
  for (let index = from; index < to; index++) masks[index] |= bit;
};

const pairBit = (char: string, size: number) =>
  char === "*" ? (size === 2 ? BIT.bold : BIT.italic)
  : char === "_" ? (size === 2 ? BIT.underline : BIT.italic)
  : char === "~" ? BIT.strike
  : BIT.spoiler;

const inline = (source: string, masks: Uint32Array, offset: number, end: number) => {
  const runs: Run[] = [];
  let index = offset;

  while (index < end) {
    const char = source[index];

    if (char === "`") {
      let size = 1;
      while (source[index + size] === "`") size++;
      const fence = "`".repeat(size);
      let close = source.indexOf(fence, index + size);
      while (close >= 0 && close < end && source[close + size] === "`") close = source.indexOf(fence, close + size + 1);
      if (close >= 0 && close + size <= end) {
        fill(masks, index, close + size, BIT.code);
        fill(masks, index, index + size, BIT.sym);
        fill(masks, close, close + size, BIT.sym);
        index = close + size;
        continue;
      }
      index += size;
      continue;
    }

    if (char === "[") {
      LINK.lastIndex = index;
      const match = LINK.exec(source);
      if (match && LINK.lastIndex <= end) {
        const textEnd = index + 1 + match[1].length;
        fill(masks, index, LINK.lastIndex, BIT.link);
        masks[index] |= BIT.sym;
        fill(masks, textEnd, textEnd + 2, BIT.sym);
        fill(masks, textEnd + 2, LINK.lastIndex - 1, BIT.url);
        masks[LINK.lastIndex - 1] |= BIT.sym;
        index = LINK.lastIndex;
        continue;
      }
    }

    if (char === "@" && (index === offset || SPACE.test(source[index - 1]))) {
      MENTION.lastIndex = index;
      const match = MENTION.exec(source);
      if (match && match[0].length > 1 && MENTION.lastIndex <= end) {
        fill(masks, index, MENTION.lastIndex, BIT.mention);
        index = MENTION.lastIndex;
        continue;
      }
    }

    if (DELIMS.includes(char)) {
      let length = 1;
      while (index + length < end && source[index + length] === char) length++;
      const before = index > offset ? source[index - 1] : " ";
      const after = index + length < end ? source[index + length] : " ";
      const paired = char === "~" || char === "|";
      let open = !SPACE.test(after);
      let close = !SPACE.test(before);
      if (char === "_") {
        open &&= !WORD.test(before);
        close &&= !WORD.test(after);
      }
      if (!(paired && length < 2) && (open || close))
        runs.push({ char, start: index, length, left: index, right: index + length, open, close });
      index += length;
      continue;
    }

    index++;
  }

  const stack: Run[] = [];
  for (const run of runs) {
    while (run.close && run.right > run.left) {
      let at = stack.length - 1;
      while (at >= 0 && stack[at].char !== run.char) at--;
      if (at < 0) break;
      const opener = stack[at];
      const available = Math.min(opener.right - opener.left, run.right - run.left);
      const paired = run.char === "~" || run.char === "|";
      if (paired && available < 2) break;
      const size = paired ? 2 : available >= 2 ? 2 : 1;
      const innerStart = opener.right;
      const innerEnd = run.left;
      fill(masks, innerStart - size, innerEnd + size, pairBit(run.char, size));
      fill(masks, innerStart - size, innerStart, BIT.sym);
      fill(masks, innerEnd, innerEnd + size, BIT.sym);
      opener.right -= size;
      run.left += size;
      stack.length = opener.right > opener.left ? at + 1 : at;
    }
    if (run.open && run.right > run.left) stack.push(run);
  }
};

const emit = (source: string, masks: Uint32Array, from = 0, to = source.length, breaks = new Set<number>()) => {
  let html = "";
  let start = from;
  for (let index = from + 1; index <= to; index++) {
    if (index < to && masks[index] === masks[start] && source[index] !== "\n" && !breaks.has(index)) continue;
    const chunk = escapeHTML(source.slice(start, index));
    const mask = masks[start];
    if (!mask || source[start] === "\n") html += chunk;
    else {
      const visible = mask & BIT.sym ? mask & (BIT.sym | BIT.quote) : mask;
      const classes = NAMES.filter(([, bit]) => visible & bit).map(([name]) => `md-${name}`).join(" ");
      html += `<span class="${classes}">${chunk}</span>`;
    }
    start = index;
  }
  return html;
};

const TAG = /<\/?span[^>]*>|\n/g;

const blockLines = (html: string) => {
  const open: string[] = [];
  let result = "";
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    result += html.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[0] === "\n") result += `${"</span>".repeat(open.length)}</span>\n<span class="md-block">${open.join("")}`;
    else if (match[0][1] === "/") {
      open.pop();
      result += match[0];
    } else {
      open.push(match[0]);
      result += match[0];
    }
  }
  return `<span class="md-block">${result}${html.slice(last)}</span>`;
};

export type CodeHighlighter = (source: string, language: string) => string | null;

export const highlightMarkdown = (source: string, code?: CodeHighlighter, pills: { from: number; to: number }[] = []) => {
  const masks = new Uint32Array(source.length);
  const blocks: { from: number; to: number; language: string }[] = [];
  let fenced = false;
  let language = "";
  let bodyStart = 0;
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);

    if (FENCE.test(line)) {
      if (fenced && lineStart - 1 > bodyStart) blocks.push({ from: bodyStart, to: lineStart - 1, language });
      fenced = !fenced;
      language = fenced ? line.slice(3).trim() : "";
      bodyStart = lineEnd + 1;
      fill(masks, lineStart, lineEnd, BIT.block | BIT.sym);
    } else if (fenced) fill(masks, lineStart, lineEnd, BIT.block);
    else {
      let from = lineStart;
      const quote = QUOTE.exec(line);
      if (quote) {
        fill(masks, from, from + quote[0].length, BIT.quote | BIT.sym);
        from += quote[0].length;
      }
      const heading = HEADING.exec(source.slice(from, lineEnd));
      if (heading) {
        const bit = heading[1].length === 1 ? BIT.h1 : heading[1].length === 2 ? BIT.h2 : BIT.h3;
        fill(masks, from, lineEnd, bit);
        fill(masks, from, from + heading[0].length, BIT.sym);
        from += heading[0].length;
      }
      inline(source, masks, from, lineEnd);
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  const breaks = new Set<number>();
  for (const pill of pills) {
    const joined = pills.some((other) => other.to === pill.from) ? BIT.joined : 0;
    const before = pills.some((other) => other.from === pill.to) ? BIT.before : 0;
    masks.fill(BIT.pill | joined | before, pill.from, Math.min(pill.to, source.length));
    breaks.add(pill.from).add(pill.to);
  }

  if (fenced && source.length > bodyStart) blocks.push({ from: bodyStart, to: source.length, language });
  if (!code || !blocks.length) return `${emit(source, masks, 0, source.length, breaks)} `;

  let html = "";
  let at = 0;
  for (const block of blocks) {
    const result = code(source.slice(block.from, block.to), block.language);
    if (result === null) continue;
    html += emit(source, masks, at, block.from, breaks) + blockLines(result);
    at = block.to;
  }
  return `${html}${emit(source, masks, at, source.length, breaks)} `;
};

export type Edit = { from: number; to: number; insert: string; start: number; end: number };

type Layer = { token: string; left: number; right: number };

const SPLITS: Record<string, number[]> = { "*": [2, 1], "_": [2, 1], "~": [2], "|": [2], "`": [1] };

export const markerLayers = (value: string, start: number, end: number) => {
  const layers: Layer[] = [];
  let left = start;
  let right = end;

  while (left > 0 && right < value.length && value[left - 1] === value[right] && value[right] in SPLITS) {
    const char = value[right];
    let count = 0;
    while (left - count > 0 && right + count < value.length && value[left - 1 - count] === char && value[right + count] === char) count++;
    const sizes = SPLITS[char];
    let used = 0;
    const take = (size: number) => {
      layers.push({ token: char.repeat(size), left: left - used - size, right: right + used });
      used += size;
    };
    if (count === 3 && sizes.length === 2) {
      take(2);
      take(1);
    } else {
      let rest = count;
      for (const size of sizes) {
        while (rest >= size) {
          take(size);
          rest -= size;
        }
      }
    }
    if (!used) break;
    left -= used;
    right += used;
  }

  return layers;
};

const innerSelection = (value: string, start: number, end: number) => {
  while (end - start > 2 && value[start] in SPLITS && value[start] === value[end - 1]) {
    const char = value[start];
    let count = 0;
    while (start + count < end - 1 - count && value[start + count] === char && value[end - 1 - count] === char) count++;
    if (!count || start + count >= end - count) break;
    start += count;
    end -= count;
  }
  return [start, end] as const;
};

export const toggleWrap = (value: string, selectionStart: number, selectionEnd: number, token: string): Edit => {
  const size = token.length;
  const [start, end] = innerSelection(value, selectionStart, selectionEnd);
  const layers = markerLayers(value, start, end);
  const layer = layers.find((entry) => entry.token === token || (token === "*" && entry.token === "_"));

  if (layer)
    return { from: layer.left, to: layer.right + size, insert: value.slice(layer.left + size, layer.right), start: start - size, end: end - size };

  const merge = token[0] === "*" || token[0] === "_" ? layers.find((entry) => entry.token[0] === token[0]) : undefined;
  if (merge) {
    const to = merge.right + merge.token.length;
    return { from: merge.left, to, insert: `${token}${value.slice(merge.left, to)}${token}`, start: start + size, end: end + size };
  }

  return { from: start, to: end, insert: `${token}${value.slice(start, end)}${token}`, start: start + size, end: end + size };
};

export const toggleLink = (value: string, start: number, end: number, placeholder: string): Edit => {
  const selected = value.slice(start, end);
  const wrapped = /^\[([^\]\n]*)\]\([^)\n]*\)$/.exec(selected);
  if (wrapped) return { from: start, to: end, insert: wrapped[1], start, end: start + wrapped[1].length };

  const after = /^\]\([^)\n]*\)/.exec(value.slice(end, end + 2048));
  if (value[start - 1] === "[" && after)
    return { from: start - 1, to: end + after[0].length, insert: selected, start: start - 1, end: end - 1 };

  const urlStart = start + selected.length + 3;
  return { from: start, to: end, insert: `[${selected}](${placeholder})`, start: urlStart, end: urlStart + placeholder.length };
};

export const toggleQuote = (value: string, start: number, end: number): Edit => {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const stop = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
  const to = stop < 0 ? value.length : stop;
  const lines = value.slice(from, to).split("\n");
  const quoted = lines.every((line) => line.startsWith("> "));
  const insert = lines.map((line) => (quoted ? line.slice(2) : `> ${line}`)).join("\n");
  return { from, to, insert, start: from, end: from + insert.length };
};

export type FormatAction = "bold" | "italic" | "underline" | "strike" | "spoiler" | "code" | "link" | "quote";

export const FORMAT_TOKENS: Record<Exclude<FormatAction, "link" | "quote">, string> = {
  bold: "**",
  italic: "*",
  underline: "__",
  strike: "~~",
  spoiler: "||",
  code: "`",
};

export const FORMAT_KEYS: { action: FormatAction; code: string; shift: boolean; label: string }[] = [
  { action: "bold", code: "KeyB", shift: false, label: "B" },
  { action: "italic", code: "KeyI", shift: false, label: "I" },
  { action: "underline", code: "KeyU", shift: false, label: "U" },
  { action: "strike", code: "KeyX", shift: true, label: "Shift+X" },
  { action: "spoiler", code: "KeyS", shift: true, label: "Shift+S" },
  { action: "code", code: "KeyE", shift: false, label: "E" },
  { action: "link", code: "KeyK", shift: false, label: "K" },
  { action: "quote", code: "Period", shift: true, label: "Shift+>" },
];

export const formatEdit = (action: FormatAction, value: string, start: number, end: number, placeholder: string): Edit =>
  action === "link" ? toggleLink(value, start, end, placeholder)
  : action === "quote" ? toggleQuote(value, start, end)
  : toggleWrap(value, start, end, FORMAT_TOKENS[action]);

export const insideFence = (source: string, caret: number) =>
  source
    .slice(0, caret)
    .split("\n")
    .filter((line) => /^ {0,3}```[^`]*$/.test(line)).length % 2 === 1;
