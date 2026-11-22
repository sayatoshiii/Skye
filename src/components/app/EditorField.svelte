<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import EmojiText from "../ui/EmojiText.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getEmojiURL, isEmojiGrapheme, isJumbo, renderEmoji } from "../../scripts/misc/emoji";
  import { loadEmojiIndex, peekEmojiIndex, searchEmoji, twemojiFile, type EmojiEntry } from "../../scripts/misc/emoji-data";
  import { recentEmoji, useEmoji } from "../../scripts/settings/emoji";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import Avatar from "../ui/Avatar.svelte";
  import { currentRoom, currentTimeline, joinedMembers, loadMembers, rooms, session, spaces } from "../../scripts/stores/matrix";
  import { getHomeRoomIds, getSpaceRoomIds, navigation } from "../../scripts/stores/navigation.svelte";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import { composerMentions, pillText, shiftPills, type MentionTarget, type Pill } from "../../scripts/misc/mentions";
  import { FORMAT_KEYS, formatEdit, highlightMarkdown, insideFence, type Edit, type FormatAction } from "../../scripts/misc/markdown-highlight";

  type Props = {
    value: string;
    pills?: Pill[];
    field?: HTMLTextAreaElement;
    label: string;
    composer?: boolean;
    variant?: "composer" | "edit";
    onsubmit: () => void;
    onkey?: (event: KeyboardEvent) => void;
    onfiles?: (files: File[]) => void;
  };

  let {
    value: draft = $bindable(),
    pills = $bindable([]),
    field = $bindable(),
    label,
    composer = false,
    variant = "composer",
    onsubmit,
    onkey,
    onfiles,
  }: Props = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const FORMAT_ICONS: Record<FormatAction, string> = {
    bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
    strike: "M5 12h14M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.4 1 2.3 3 2.8M8 16.5c.6 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3",
    spoiler: "m3 3 18 18M10.6 6.1Q11.3 6 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.5 7.5C4.3 9.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1M10 10a3 3 0 0 0 4 4",
    code: "m8 8-4 4 4 4m8-8 4 4-4 4",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    quote: "M5 5v14M10 8h9M10 12h9M10 16h6",
  };

  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modLabel = text("format", mac ? "mod_mac" : "mod");
  const touch = () => matchMedia("(pointer: coarse)").matches;

  let mirror: HTMLDivElement | undefined = $state();
  let toolbar: { x: number; y: number; below: boolean } | null = $state(null);

  const CODE_CACHE = 64;
  const codeCache = new Map<string, string | null>();
  let codeVersion = $state(0);

  const highlightBlock = (source: string, language: string) => {
    const key = `${language}\n${source}`;
    if (codeCache.has(key)) return codeCache.get(key)!;
    if (codeCache.size >= CODE_CACHE) codeCache.clear();
    codeCache.set(key, null);
    import("../../scripts/misc/highlight").then(async ({ highlightCode }) => {
      const html = await highlightCode(source, language).catch(() => null);
      if (!html || codeCache.get(key) !== null) return;
      codeCache.set(key, html);
      codeVersion++;
    });
    return null;
  };

  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  const emojify = (chunk: string) =>
    /[^\x00-\x7f]/.test(chunk)
      ? Array.from(graphemes.segment(chunk), ({ segment }) => {
          if (!isEmojiGrapheme(segment)) return segment;
          const image = renderEmoji(segment);
          return image.startsWith("<img") ? `<span class="md-emoji">${segment}${image}</span>` : segment;
        }).join("")
      : chunk;

  const highlighted = $derived.by(() => {
    codeVersion;
    return highlightMarkdown(draft, highlightBlock, pills.filter((pill) => pill.to <= draft.length)).replace(/(^|>)([^<]+)/g, (_, edge, chunk) => edge + emojify(chunk));
  });
  const scale = $derived(isJumbo(draft) ? "jumbo" : draft.includes("\n") ? "" : (/^(#{1,3}) (?=\S)/.exec(draft)?.[1].length ?? "").toString());
  let lastScale = "";

  const resize = () => {
    if (!field) return;
    const from = field.offsetHeight;
    field.style.height = "auto";
    const to = field.scrollHeight;
    const animate = scale !== lastScale;
    lastScale = scale;
    field.classList.toggle("composer-grow", animate);
    field.style.height = `${animate ? from : to}px`;
    if (animate) {
      field.offsetHeight;
      field.style.height = `${to}px`;
    }
    syncScroll();
  };

  const syncScroll = () => {
    if (mirror && field) mirror.scrollTop = field.scrollTop;
  };

  $effect(() => {
    draft;
    scale;
    resize();
  });

  const locate = (offset: number): [Node, number] | null => {
    if (!mirror) return null;
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
      last = node;
    }
    return last ? [last, last.length] : null;
  };

  const updateToolbar = () => {
    if (!field || !mirror || document.activeElement !== field || field.selectionStart === field.selectionEnd || touch()) {
      toolbar = null;
      return;
    }
    syncScroll();
    const start = locate(field.selectionStart);
    const end = locate(field.selectionEnd);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const bounds = field.getBoundingClientRect();
    const first = rects.find((rect) => rect.bottom > bounds.top && rect.top < bounds.bottom) ?? rects[0];
    if (!first) return;
    const line = rects.filter((rect) => Math.abs(rect.top - first.top) < 2);
    const left = Math.min(...line.map((rect) => rect.left));
    const right = Math.max(...line.map((rect) => rect.right));
    const top = Math.max(first.top, bounds.top);
    const below = top < 56;
    toolbar = {
      x: Math.min(Math.max((left + right) / 2, 160), innerWidth - 160),
      y: below ? first.bottom : top,
      below,
    };
  };

  const EMOJI_QUERY = /(?:^|\s):([\w+-]{2,})$/;
  const EMOJI_CODE = /(?:^|\s):([\w+-]+):$/;

  let recent: string[] = $state.raw([]);
  type Suggestion =
    | { key: string; kind: "emoji"; entry: EmojiEntry; code: string }
    | { key: string; kind: "mention"; target: MentionTarget; name: string; detail: string; avatar?: string; other?: boolean };
  type Mode = "emoji" | "members" | "rooms";

  const MENTION_QUERY = /(?:^|\s)([@#])([^\n@#]{0,48})$/;
  const LIMIT = 8;

  let suggest: { mode: Mode; start: number; end: number; items: Suggestion[]; x: number; y: number } | null = $state.raw(null);
  let lastValue = draft;
  const fetched = new Set<string>();

  const match = (query: string, ...fields: (string | undefined)[]) => {
    if (!query) return 4;
    const words = query.split(/\s+/).filter(Boolean);
    const joined = words.join("");
    let best = Infinity;
    fields.forEach((field, index) => {
      const value = field?.toLowerCase() ?? "";
      const parts = value.split(/[\s._:-]+/);
      if (value.startsWith(query) || value.replace(/\s+/g, "").startsWith(joined)) best = Math.min(best, index);
      else if (words.every((word) => parts.some((part) => part.startsWith(word)))) best = Math.min(best, index + 1);
      else if (value.includes(query)) best = Math.min(best, index + 2);
      else if (words.length === 1 && [...query].every(((at) => (char: string) => (at = value.indexOf(char, at) + 1) > 0)(0))) best = Math.min(best, index + 3);
    });
    return best;
  };

  const memberItems = (query: string): Suggestion[] => {
    const room = $currentRoom;
    if (!room) return [];
    if (!fetched.has(room.roomId)) {
      fetched.add(room.roomId);
      loadMembers(room.roomId).then(() => suggest?.mode === "members" && updateSuggest());
    }
    const members = { ...($joinedMembers[room.roomId] ?? {}), ...room.members };
    const speakers = [...new Set($currentTimeline.map((event) => event.sender).reverse())];
    const rank = (userId: string) => (speakers.indexOf(userId) + 1 || Infinity);
    const items = Object.values(members)
      .filter((member) => member.membership === "join")
      .map((member) => ({ member, score: match(query, member.displayName, member.userId.slice(1).split(":")[0], member.userId.slice(1)) }))
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => a.score - b.score || rank(a.member.userId) - rank(b.member.userId) || (a.member.displayName ?? a.member.userId).localeCompare(b.member.displayName ?? b.member.userId))
      .slice(0, LIMIT)
      .map(({ member }): Suggestion => {
        const name = member.displayName || member.userId;
        return { key: member.userId, kind: "mention", target: { kind: "user", id: member.userId, label: name }, name, detail: member.userId, avatar: member.avatarUrl };
      });
    const own = $session?.userId;
    const allowed = own && getPowerLevel(room, own) >= (room.powerLevels?.notifications?.room ?? 50);
    if (allowed && match(query, "room") < Infinity)
      items.splice(Math.min(items.length, query ? LIMIT : 0), 0, { key: "@room", kind: "mention", target: { kind: "everyone", id: "@room", label: "room" }, name: "@room", detail: text("mention", "everyone") });
    return items.slice(0, LIMIT);
  };

  const roomItems = (query: string): Suggestion[] => {
    const server = $session?.userId.split(":").slice(1).join(":");
    const tree = $spaces.find((candidate) => candidate.space.roomId === navigation.spaceId);
    const local = new Set(tree ? [tree.space.roomId, ...getSpaceRoomIds(tree)] : getHomeRoomIds());
    return Object.values($rooms)
      .filter((room) => room.membership === "join" && !room.isDirect)
      .map((room) => {
        const alias: string | undefined = room.state["m.room.canonical_alias"]?.[""]?.content?.alias;
        return { room, alias, other: !local.has(room.roomId), score: match(query, room.name, alias?.slice(1)) };
      })
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => Number(a.other) - Number(b.other) || a.score - b.score || b.room.lastActivity - a.room.lastActivity)
      .slice(0, LIMIT)
      .map(({ room, alias, other }): Suggestion => {
        const name = room.name || alias || room.roomId;
        return {
          key: room.roomId,
          kind: "mention",
          target: { kind: "room", id: alias ?? room.roomId, label: name, via: alias || !server ? undefined : [server] },
          name,
          detail: alias ?? text("mention", room.isSpace ? "space" : "room"),
          avatar: room.avatarUrl,
          other,
        };
      });
  };
  let active = $state(0);

  $effect(() => recentEmoji.subscribe((value) => (recent = value)));

  const twemojiSrc = (unicode: string) => getEmojiURL(twemojiFile(unicode));

  const inCode = (before: string) => {
    if ((before.match(/```/g)?.length ?? 0) % 2) return true;
    const line = before.slice(before.lastIndexOf("\n") + 1).replace(/```/g, "");
    return (line.match(/`/g)?.length ?? 0) % 2 === 1;
  };

  const closeSuggest = () => {
    suggest = null;
    active = 0;
  };

  const updateSuggest = () => {
    if (!field || document.activeElement !== field || field.selectionStart !== field.selectionEnd) return closeSuggest();
    const caret = field.selectionStart;
    const before = field.value.slice(0, caret);
    if (inCode(before) || pills.some((pill) => pill.from < caret && pill.to >= caret)) return closeSuggest();
    const found = before.match(MENTION_QUERY);
    const at = found ? caret - found[2].length - 1 : -1;
    const mention = found && !/^\s/.test(found[2]) && !pills.some((pill) => pill.from <= at && at < pill.to) ? found : null;
    const emoji = mention ? null : before.match(EMOJI_QUERY);
    if (!mention && !emoji) return closeSuggest();
    let mode: Mode = "emoji";
    let items: Suggestion[];
    if (mention) {
      mode = mention[1] === "@" ? "members" : "rooms";
      items = mode === "members" ? memberItems(mention[2].toLowerCase()) : roomItems(mention[2].toLowerCase());
    } else {
      const index = peekEmojiIndex();
      if (!index) {
        loadEmojiIndex().then(updateSuggest).catch(() => {});
        return;
      }
      items = searchEmoji(index, emoji![1], recent).map((item) => ({ key: item.entry.hexcode, kind: "emoji", ...item }));
    }
    if (!items.length) return closeSuggest();
    const start = caret - (mention ? mention[2] : emoji![1]).length - 1;
    const point = locate(start);
    const bounds = (variant === "composer" ? field.closest(".field") : field)?.getBoundingClientRect() ?? field.getBoundingClientRect();
    let x = bounds.left;
    if (point) {
      const range = document.createRange();
      range.setStart(...point);
      range.setEnd(...point);
      x = range.getBoundingClientRect().left || x;
    }
    if (suggest?.start !== start) active = 0;
    suggest = {
      mode,
      start,
      end: caret,
      items,
      x: Math.min(Math.max(x - 12, 12), innerWidth - 332),
      y: innerHeight - bounds.top + 8,
    };
  };

  const insertEmoji = (unicode: string, from: number, to: number) => {
    const insert = `${unicode} `;
    apply({ from, to, insert, start: from + insert.length, end: from + insert.length });
    useEmoji(unicode);
    closeSuggest();
  };

  export const insert = (value: string) => {
    if (!field) return;
    const from = field.selectionStart;
    apply({ from, to: field.selectionEnd, insert: value, start: from + value.length, end: from + value.length });
  };

  const insertPill = (target: MentionTarget, from: number, to: number) => {
    const label = pillText(target);
    const insert = `${label} `;
    apply({ from, to, insert, start: from + insert.length, end: from + insert.length });
    pills = [...pills, { ...target, from, to: from + label.length }];
    closeSuggest();
  };

  const pickSuggestion = (position = active) => {
    const item = suggest?.items[position];
    if (!suggest || !item) return;
    if (item.kind === "emoji") insertEmoji(item.entry.unicode, suggest.start, suggest.end);
    else insertPill(item.target, suggest.start, suggest.end);
  };

  const syncPills = (value: string) => {
    if (value === lastValue) return;
    pills = shiftPills(pills, lastValue, value);
    lastValue = value;
  };

  $effect.pre(() => syncPills(draft));

  $effect(() => {
    if (!composer) return;
    composerMentions.insert = (target) => {
      if (!field) return;
      field.focus();
      const from = field.selectionStart;
      const pad = from && !/\s/.test(field.value[from - 1]) ? " " : "";
      if (pad) apply({ from, to: field.selectionEnd, insert: pad, start: from + 1, end: from + 1 });
      insertPill(target, from + pad.length, field.selectionEnd);
    };
    return () => (composerMentions.insert = undefined);
  });

  const oninput = (event: Event) => {
    if (!field) return;
    syncPills(field.value);
    if ((event as InputEvent).inputType === "insertText" && field.value[field.selectionStart - 1] === ":" && field.selectionStart === field.selectionEnd) {
      const caret = field.selectionStart;
      const before = field.value.slice(0, caret);
      const match = before.match(EMOJI_CODE);
      const entry = match && !inCode(before) ? peekEmojiIndex()?.byShortcode.get(match[1].toLowerCase()) : null;
      if (match && entry) {
        insertEmoji(entry.unicode, caret - match[1].length - 2, caret);
        return;
      }
    }
    updateSuggest();
  };

  const suggestKeys = (event: KeyboardEvent) => {
    if (!suggest) return false;
    const count = suggest.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      pickSuggestion();
    } else if (event.key === "Escape") {
      closeSuggest();
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  const apply = (edit: Edit) => {
    if (!field) return;
    field.focus();
    field.setSelectionRange(edit.from, edit.to);
    const done = edit.insert
      ? document.execCommand("insertText", false, edit.insert)
      : edit.from === edit.to || document.execCommand("delete");
    if (!done) {
      field.setRangeText(edit.insert, edit.from, edit.to, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.setSelectionRange(edit.start, edit.end);
    updateToolbar();
  };

  const format = (action: FormatAction) => {
    if (!field) return;
    apply(formatEdit(action, field.value, field.selectionStart, field.selectionEnd, text("format", "link_placeholder")));
  };

  const replaceRange = (target: HTMLTextAreaElement, from: number, to: number, value: string) => {
    target.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, value)) {
      target.setRangeText(value, from, to, "end");
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const indent = (target: HTMLTextAreaElement, outdent: boolean) => {
    const { value, selectionStart: start, selectionEnd: end } = target;
    if (!outdent && !value.slice(start, end).includes("\n")) return replaceRange(target, start, end, "\t");
    const from = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(from, end);
    const lines = block.split("\n");
    const next = lines.map((line) => (outdent ? line.replace(/^(\t| {1,4})/, "") : `\t${line}`)).join("\n");
    if (next === block) return;
    replaceRange(target, from, end, next);
    const shift = (outdent ? -(lines[0].length - lines[0].replace(/^(\t| {1,4})/, "").length) : 1);
    target.setSelectionRange(Math.max(from, start + shift), from + next.length);
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (suggestKeys(event)) return;
    if (event.key === "Backspace" && field && field.selectionStart === field.selectionEnd) {
      const pill = pills.find((entry) => entry.to === field!.selectionStart);
      if (pill) {
        event.preventDefault();
        apply({ from: pill.from, to: pill.to, insert: "", start: pill.from, end: pill.from });
        return;
      }
    }
    if ((mac ? event.metaKey : event.ctrlKey) && !event.altKey) {
      const bind = FORMAT_KEYS.find((entry) => entry.code === event.code && entry.shift === event.shiftKey);
      if (bind) {
        event.preventDefault();
        format(bind.action);
        return;
      }
    }
    onkey?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey && field && insideFence(field.value, field.selectionStart)) {
      event.preventDefault();
      indent(field, event.shiftKey);
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || touch()) return;

    event.preventDefault();
    if (!(mac ? event.metaKey : event.ctrlKey) && field && insideFence(field.value, field.selectionStart)) {
      if (!document.execCommand("insertText", false, "\n")) {
        field.setRangeText("\n", field.selectionStart, field.selectionEnd, "end");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    onsubmit();
  };

  const SHORTCODE_IN_TEXT = /(^|\s):([a-z0-9_+-]+):(?=\s|$)/gi;

  const convertShortcodes = (text: string, lookup: (code: string) => string | undefined, startsInCode: boolean) => {
    let fenced = startsInCode;
    return text
      .split(/(```)/)
      .map((part) => {
        if (part === "```") {
          fenced = !fenced;
          return part;
        }
        if (fenced) return part;
        return part
          .split(/(`[^`\n]*`)/)
          .map((chunk) =>
            chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 1
              ? chunk
              : chunk.replace(SHORTCODE_IN_TEXT, (whole, lead, code) => {
                  const unicode = lookup(code.toLowerCase());
                  return unicode ? `${lead}${unicode}` : whole;
                }),
          )
          .join("");
      })
      .join("");
  };

  const onpaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length && onfiles) {
      event.preventDefault();
      onfiles(files);
      return;
    }

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!field || !/:[a-z0-9_+-]+:/i.test(text)) return;

    event.preventDefault();
    const from = field.selectionStart;
    const to = field.selectionEnd;
    const before = field.value.slice(0, from);
    const startsInCode = (before.match(/```/g)?.length ?? 0) % 2 === 1;

    loadEmojiIndex()
      .then((index) => convertShortcodes(text, (code) => index.byShortcode.get(code)?.unicode, startsInCode))
      .catch(() => text)
      .then((insert) => apply({ from, to, insert, start: from + insert.length, end: from + insert.length }));
  };

  $effect(() => {
    const onselection = () => {
      if (document.activeElement !== field) return;
      updateToolbar();
      if (suggest && (field!.selectionStart < suggest.start || field!.selectionStart !== field!.selectionEnd)) closeSuggest();
    };
    document.addEventListener("selectionchange", onselection);
    addEventListener("resize", updateToolbar);
    return () => {
      document.removeEventListener("selectionchange", onselection);
      removeEventListener("resize", updateToolbar);
    };
  });
</script>

<div class="editor flex-max" class:edit={variant === "edit"} data-scale={scale || undefined}>
  <div class="mirror" aria-hidden="true" bind:this={mirror}>{@html highlighted}</div>
  <textarea
    rows="1"
    enterkeyhint={variant === "edit" ? "done" : "send"}
    placeholder={variant === "edit" ? undefined : label}
    aria-label={label}
    bind:value={draft}
    bind:this={field}
    data-composer={composer || undefined}
    onscroll={syncScroll}
    onblur={() => {
      toolbar = null;
      closeSuggest();
    }}
    {oninput}
    onselect={updateToolbar}
    {onkeydown}
    {onpaste}
  ></textarea>
</div>

{#if suggest}
  <span class="portal-anchor" hidden></span>
  <div
    class="emoji-suggest col"
    role="listbox"
    tabindex="-1"
    aria-label={text(suggest.mode === "emoji" ? "emoji" : "mention", "suggestions")}
    style:left="{suggest.x}px"
    style:bottom="{suggest.y}px"
    use:portal
    onmousedown={(event) => event.preventDefault()}
  >
    <span class="suggest-title xs bold faint">{(suggest.mode === "emoji" ? text("emoji", "matching") : text("mention", suggest.mode)).replace("{query}", draft.slice(suggest.start, suggest.end))}</span>
    {#each suggest.items as item, position (item.key)}
      {#if item.kind === "mention" && item.other && position > 0 && !(suggest.items[position - 1] as { other?: boolean }).other}
        <span class="suggest-title suggest-split xs bold faint">{text("mention", "other_rooms")}</span>
      {/if}
      <button
        type="button"
        class="suggestion row-nw align-centre gap-sm press"
        class:active={position === active}
        role="option"
        aria-selected={position === active}
        onmousemove={() => (active = position)}
        onclick={() => pickSuggestion(position)}
      >
        {#if item.kind === "emoji"}
          <img class="suggest-glyph" src={twemojiSrc(item.entry.unicode)} alt={item.entry.unicode} draggable="false" />
          <span class="sm bold">:{item.code}:</span>
        {:else}
          <Avatar name={item.name} url={item.avatar} size="22px" radius={item.target.kind === "user" ? "50%" : "25%"} />
          <span class="sm bold truncate"><EmojiText text={item.name} /></span>
          <span class="suggest-detail xs faint truncate">{item.detail}</span>
        {/if}
      </button>
    {/each}
  </div>
  <span class="portal-anchor" hidden></span>
{/if}

{#if toolbar}
  <span class="portal-anchor" hidden></span>
  <div
    class="format-bar row-nw align-centre"
    class:below={toolbar.below}
    role="toolbar"
    tabindex="-1"
    aria-label={text("format", "toolbar")}
    style:left="{toolbar.x}px"
    style:top="{toolbar.y}px"
    use:portal
    onmousedown={(event) => event.preventDefault()}
  >
    {#each FORMAT_KEYS as bind (bind.action)}
      <button type="button" class="format ghost press" aria-label={text("format", bind.action)} use:tooltip={`${text("format", bind.action)} ${[modLabel, ...bind.label.split("+")].map((key) => `[[${key}]]`).join(" ")}`} aria-keyshortcuts="{mac ? 'Meta' : 'Control'}+{bind.label}" onclick={() => format(bind.action)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={FORMAT_ICONS[bind.action]} /></svg>
      </button>
      {#if bind.action === "code"}<span class="divider" aria-hidden="true"></span>{/if}
    {/each}
  </div>
  <span class="portal-anchor" hidden></span>
{/if}

<style>
  .editor {
    --composer-text: var(--text-md);
    --composer-line: 20px;
    --composer-weight: inherit;
    --composer-emoji: 1.25em;
    position: relative;
    display: grid;
    min-width: 0;
  }

  textarea,
  .mirror {
    margin: 0;
    padding: 9px 0;
    border: 0;
    font: inherit;
    font-size: var(--composer-text);
    font-weight: var(--composer-weight);
    font-kerning: normal;
    letter-spacing: normal;
    line-height: var(--composer-line);
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: normal;
    tab-size: 4;
  }

  textarea {
    position: relative;
    width: 100%;
    min-width: 0;
    max-height: 40vh;
    resize: none;
    outline: none;
    background: none;
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: var(--colours-text-strong);
    scrollbar-width: none;
  }

  textarea:global(.composer-grow) {
    transition: height var(--azure-duration-fast) var(--azure-ease-out);
  }

  .editor[data-scale="jumbo"] {
    --composer-text: 30px;
    --composer-line: 40px;
    --composer-emoji: 36px;
  }

  .editor:is([data-scale="1"], [data-scale="2"], [data-scale="3"]) {
    --composer-weight: 700;
  }

  .editor[data-scale="1"] {
    --composer-text: calc(var(--composer-base, var(--text-md)) * 1.5);
    --composer-line: 1.3;
  }

  .editor[data-scale="2"] {
    --composer-text: calc(var(--composer-base, var(--text-md)) * 1.3);
    --composer-line: 1.3;
  }

  .editor[data-scale="3"] {
    --composer-text: calc(var(--composer-base, var(--text-md)) * 1.1);
    --composer-line: 1.3;
  }

  textarea::-webkit-scrollbar {
    display: none;
  }

  textarea::selection {
    background-color: color-mix(in oklab, var(--colours-accent) 35%, transparent);
  }

  textarea::placeholder {
    color: var(--colours-text-faint);
    -webkit-text-fill-color: var(--colours-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: var(--colours-text-strong);
  }

  .mirror :global(.md-bold),
  .mirror :global(.md-h1),
  .mirror :global(.md-h2),
  .mirror :global(.md-h3) {
    text-shadow:
      0.35px 0 0 currentColor,
      -0.35px 0 0 currentColor;
  }

  .mirror :global(.md-h1) {
    color: var(--colours-accent-strong);
  }

  .mirror :global(.md-italic) {
    font-family: "Montserrat Upright", sans-serif;
    font-style: italic;
    font-synthesis: style;
  }

  .mirror :global(.md-underline) {
    text-decoration-line: underline;
    text-underline-offset: 3px;
  }

  .mirror :global(.md-strike) {
    text-decoration-line: line-through;
    color: var(--colours-text-muted);
  }

  .mirror :global(.md-underline.md-strike) {
    text-decoration-line: underline line-through;
  }

  .mirror :global(.md-code),
  .mirror :global(.md-block) {
    color: var(--colours-text);
    background-color: var(--colours-surface-active);
    box-shadow: 0 0 0 1px var(--colours-surface-active);
  }

  .mirror :global(.md-spoiler) {
    color: var(--colours-text-muted);
    background-color: color-mix(in oklab, var(--colours-text-faint) 22%, transparent);
  }

  .mirror :global(.md-quote) {
    box-shadow: inset 3px 0 0 var(--colours-outline-strong);
  }

  .mirror :global(.md-link) {
    color: var(--colours-accent);
  }

  .mirror :global(.md-url) {
    text-decoration-line: underline;
    text-decoration-color: color-mix(in oklab, var(--colours-accent) 50%, transparent);
  }

  .mirror :global(.md-mention) {
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    box-shadow: 0 0 0 2px var(--colours-accent-faint);
    border-radius: var(--azure-radius-sm);
  }

  .mirror :global(.md-emoji) {
    position: relative;
    color: transparent;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
  }

  .mirror :global(.md-emoji img.emoji) {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--composer-emoji);
    height: var(--composer-emoji);
    margin: 0;
    translate: -50% -50%;
  }

  .mirror :global(.md-sym.md-sym) {
    color: var(--colours-text-faint);
    text-shadow: none;
    text-decoration-line: none;
    font-style: normal;
  }

  .emoji-suggest {
    position: fixed;
    z-index: var(--azure-z-popover);
    width: 320px;
    padding: 4px;
    gap: 1px;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-light);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 8px 24px -8px rgb(0 0 0 / 0.6),
      0 0 24px -12px var(--colours-accent-glow);
    transform-origin: 0 100%;
    animation: pop-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .suggest-title {
    padding: 4px 8px 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .suggest-split {
    margin-top: var(--azure-spacing-xs);
    padding-top: var(--azure-spacing-sm);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .suggestion {
    min-height: 36px;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--azure-radius-sm);
    text-align: left;
    background-color: transparent;
    color: var(--colours-text-muted);
    transition: background-color var(--azure-duration-instant) var(--azure-ease-out);
  }

  .suggestion.active {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .suggest-detail {
    margin-left: auto;
    min-width: 0;
    flex-shrink: 1;
  }

  .mirror :global(.md-pill) {
    color: var(--colours-accent-strong);
    background-color: var(--colours-accent-soft);
    box-shadow: 0 0 0 2px var(--colours-accent-soft);
    border-radius: var(--azure-radius-sm);
  }

  .suggest-glyph {
    width: 22px;
    height: 22px;
    flex: none;
  }

  @media (max-width: 767px) {
    .emoji-suggest {
      left: 8px !important;
      right: 8px;
      width: auto;
    }

    .suggestion {
      min-height: 44px;
    }
  }

  .format-bar {
    position: fixed;
    z-index: var(--azure-z-popover);
    gap: 2px;
    padding: 4px;
    translate: -50% calc(-100% - 8px);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-light);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 8px 24px -8px rgb(0 0 0 / 0.6),
      0 0 24px -12px var(--colours-accent-glow);
    transform-origin: 50% 100%;
    animation: pop-in var(--azure-duration-md) var(--azure-ease-spring);
    transition:
      left var(--azure-duration-fast) var(--azure-ease-out),
      top var(--azure-duration-fast) var(--azure-ease-out);
  }

  .format-bar.below {
    translate: -50% 8px;
    transform-origin: 50% 0;
  }

  .format {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .format:hover,
  .format:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .format:active svg {
    transform: scale(0.85);
  }

  .divider {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background-color: var(--colours-outline-hairline);
  }


  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .format-bar {
      animation-duration: 1ms;
      transition: none;
    }
  }

  .editor.edit {
    --composer-line: 22px;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-background);
  }

  .edit :is(textarea, .mirror) {
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
  }

  .edit .mirror {
    color: var(--colours-text);
  }

  .mirror :global(.md-pill.md-before) {
    clip-path: inset(-2px 1px -2px -2px round var(--azure-radius-sm));
  }

  .mirror :global(.md-pill.md-joined) {
    clip-path: inset(-2px -2px -2px 0 round var(--azure-radius-sm));
  }

  .mirror :global(.md-pill.md-joined.md-before) {
    clip-path: inset(-2px 1px -2px 0 round var(--azure-radius-sm));
  }

  @media (max-width: 767px) {
    .editor {
      --composer-base: 16px;
      --composer-text: 16px;
    }
  }
</style>
