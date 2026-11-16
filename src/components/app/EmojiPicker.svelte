<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { tick } from "svelte";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getEmojiURL } from "../../scripts/misc/emoji";
  import { findEmoji, loadEmojiIndex, searchEmoji, twemojiFile, withTone, type EmojiEntry, type EmojiIndex } from "../../scripts/misc/emoji-data";
  import { favouriteEmoji, recentEmoji, removeRecent, skinTone, toggleFavourite } from "../../scripts/settings/emoji";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { longpress } from "../../scripts/misc/longpress";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";

  let {
    anchor,
    oninsert,
    onclose,
  }: {
    anchor: HTMLElement;
    oninsert: (unicode: string, keepOpen: boolean) => void;
    onclose: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const exit = dismissible(() => onclose());

  export const dismiss = exit.close;

  const CATEGORIES = [
    { id: "favourites", icon: "⭐", groups: [] },
    { id: "recent", icon: "🕘", groups: [] },
    { id: "people", icon: "😀", groups: [0, 1] },
    { id: "nature", icon: "🐻", groups: [3] },
    { id: "food", icon: "🍔", groups: [4] },
    { id: "activities", icon: "⚽", groups: [6] },
    { id: "travel", icon: "🚗", groups: [5] },
    { id: "objects", icon: "💡", groups: [7] },
    { id: "symbols", icon: "💖", groups: [8] },
    { id: "flags", icon: "🏁", groups: [9] },
  ];
  const TONES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
  const COLUMNS = 9;
  const CELL = 40;
  const MARGIN = 12;

  let card: HTMLDivElement | undefined = $state();
  let scroller: HTMLDivElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  let index = $state.raw<EmojiIndex | null>(null);
  let recent: string[] = $state.raw([]);
  let favourites: string[] = $state.raw([]);
  let emojiMenu: { entry: EmojiEntry; section: string; x: number; y: number } | null = $state.raw(null);
  let tone = $state(0);
  let query = $state("");
  let current = $state("people");
  let hovered = $state.raw<EmojiEntry | null>(null);
  let tones = $state(false);
  let position: { x: number; y: number } | null = $state(null);

  $effect(() => recentEmoji.subscribe((value) => (recent = value)));
  $effect(() => favouriteEmoji.subscribe((value) => (favourites = value)));

  const emojiItems = (entry: EmojiEntry, section: string): MenuItem[] => {
    const saved = favourites.includes(entry.unicode);
    const items: MenuItem[] = [
      { id: "favourite", label: text("emoji", saved ? "remove_favourite" : "add_favourite"), icon: saved ? MENU_ICONS.unstar : MENU_ICONS.star, run: () => toggleFavourite(entry.unicode) },
    ];
    if (section === "recent") items.push({ id: "recent", label: text("emoji", "remove_recent"), icon: MENU_ICONS.close, run: () => removeRecent(entry.unicode), danger: true });
    return items;
  };
  $effect(() => skinTone.subscribe((value) => (tone = value)));

  const src = (unicode: string) => getEmojiURL(twemojiFile(unicode));

  const sections = $derived.by(() => {
    if (!index) return [];
    const loaded = index;
    if (query.trim()) {
      const results = searchEmoji(loaded, query.trim().replace(/^:|:$/g, ""), recent, 180).map((item) => withTone(item.entry, tone));
      return [{ id: "results", entries: results }];
    }
    return CATEGORIES.map((category) => ({
      id: category.id,
      entries:
        category.id === "recent" || category.id === "favourites"
          ? (category.id === "recent" ? recent.slice(0, COLUMNS * 2) : favourites).map((unicode) => findEmoji(loaded, unicode)).filter((entry): entry is EmojiEntry => !!entry)
          : loaded.bases.filter((entry) => category.groups.includes(entry.group ?? -1)).map((entry) => withTone(entry, tone)),
    })).filter((section) => section.entries.length);
  });

  const preview = $derived(hovered ?? sections[0]?.entries[0] ?? null);

  let snapshot: DOMRect | null = anchor.isConnected ? anchor.getBoundingClientRect() : null;

  const place = async () => {
    await tick();
    if (!card) return;
    if (anchor.isConnected) snapshot = anchor.getBoundingClientRect();
    const rect = snapshot;
    if (!rect) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    position = {
      x: Math.min(Math.max(rect.right - width, MARGIN), innerWidth - width - MARGIN),
      y: Math.max(rect.top - 8 - height, MARGIN),
    };
  };

  $effect(() => {
    let alive = true;
    loadEmojiIndex()
      .then((loaded) => alive && (index = loaded))
      .catch(() => {});
    place().then(() => tick()).then(() => !matchMedia("(pointer: coarse)").matches && search?.focus());
    return () => (alive = false);
  });

  $effect(() => {
    const onpointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card?.contains(target) || anchor.contains(target) || emojiMenu) return;
      exit.close();
    };
    const onresize = () => place();
    document.addEventListener("pointerdown", onpointer, true);
    addEventListener("resize", onresize);
    return () => {
      document.removeEventListener("pointerdown", onpointer, true);
      removeEventListener("resize", onresize);
    };
  });

  const choose = (entry: EmojiEntry, event?: MouseEvent | KeyboardEvent) => {
    oninsert(entry.unicode, !!event?.shiftKey);
    if (event?.shiftKey) return;
    exit.close();
  };

  const jump = (id: string) => {
    query = "";
    tick().then(() => {
      const section = scroller?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (scroller && section) scroller.scrollTo({ top: section.offsetTop - scroller.offsetTop, behavior: "smooth" });
    });
  };

  const onscroll = () => {
    if (!scroller) return;
    const top = scroller.scrollTop + scroller.offsetTop + 8;
    let id = current;
    scroller.querySelectorAll<HTMLElement>("[data-section]").forEach((section) => {
      if (section.offsetTop <= top) id = section.dataset.section!;
    });
    current = id;
  };

  const cells = () => [...(scroller?.querySelectorAll<HTMLButtonElement>(".cell") ?? [])];

  const move = (from: HTMLElement, key: string) => {
    const all = cells();
    const at = all.indexOf(from as HTMLButtonElement);
    if (key === "ArrowLeft") return all[at - 1];
    if (key === "ArrowRight") return all[at + 1];
    const origin = from.getBoundingClientRect();
    const down = key === "ArrowDown";
    let best: HTMLButtonElement | undefined;
    let score = Infinity;
    for (const cell of all) {
      const rect = cell.getBoundingClientRect();
      const dy = down ? rect.top - origin.top : origin.top - rect.top;
      if (dy < 4) continue;
      const value = dy * 1000 + Math.abs(rect.left - origin.left);
      if (value < score) {
        score = value;
        best = cell;
      }
    }
    return best;
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (emojiMenu) return;
      if (tones) tones = false;
      else exit.close();
      return;
    }
    const target = event.target as HTMLElement;
    if (target === search) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        cells()[0]?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const first = sections[0]?.entries[0];
        if (first) choose(first, event);
      }
      return;
    }
    if (!target.classList.contains("cell") || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const next = move(target, event.key);
    if (next) next.focus();
    else if (event.key === "ArrowUp") search?.focus();
  };

  const focusCell = (entry: EmojiEntry) => (hovered = entry);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="emoji-picker col"
  class:placed={!!position}
  class:closing={exit.closing}
  inert={exit.closing}
  onanimationend={exit.onanimationend}
  role="dialog"
  aria-label={text("emoji", "picker")}
  tabindex="-1"
  bind:this={card}
  style:left="{position?.x ?? 0}px"
  style:top="{position?.y ?? 0}px"
  use:portal
  {onkeydown}
>
  <div class="top row-nw align-centre gap-sm">
    <input
      class="search flex-max"
      type="search"
      placeholder={text("emoji", "search")}
      aria-label={text("emoji", "search")}
      bind:this={search}
      bind:value={query}
    />
    <div class="tone-wrap">
      <button type="button" class="tone-button ghost press" aria-label={text("emoji", "skin_tone")} aria-expanded={tones} onclick={() => (tones = !tones)}>
        <img src={src(TONES[tone])} alt="" draggable="false" />
      </button>
      {#if tones}
        <div class="tones col" role="listbox" aria-label={text("emoji", "skin_tone")}>
          {#each TONES as glyph, option (option)}
            <button
              type="button"
              class="tone-button ghost press"
              class:selected={option === tone}
              role="option"
              aria-selected={option === tone}
              aria-label={text("emoji", "tones", String(option))}
              onclick={() => {
                skinTone.set(option);
                tones = false;
              }}
            >
              <img src={src(glyph)} alt="" draggable="false" />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="body row-nw">
    <nav class="rail col" aria-label={text("emoji", "picker")}>
      {#each CATEGORIES.filter((category) => category.id !== "favourites" || favourites.length) as category (category.id)}
        <button
          type="button"
          class="rail-button ghost press"
          class:active={!query && current === category.id}
          aria-label={text("emoji", "categories", category.id)}
          use:tooltip={text("emoji", "categories", category.id)}
          onclick={() => jump(category.id)}
        >
          <img src={src(category.icon)} alt="" draggable="false" />
        </button>
      {/each}
    </nav>

    <div class="grid-scroll flex-max" bind:this={scroller} {onscroll}>
      {#if !index}
        <div class="placeholder"></div>
      {:else if !sections.length}
        <p class="empty sm faint">{text("emoji", "no_results")}</p>
      {/if}
      {#each sections as section (section.id)}
        <section class="section" data-section={section.id} style:contain-intrinsic-size="auto {Math.ceil(section.entries.length / COLUMNS) * CELL + 32}px">
          <h3 class="section-title xs bold">{text("emoji", "categories", section.id)}</h3>
          <div class="grid">
            {#each section.entries as entry (entry.hexcode)}
              <button
                type="button"
                class="cell"
                aria-label={entry.label}
                onclick={(event) => choose(entry, event)}
                oncontextmenu={(event) => {
                  event.preventDefault();
                  emojiMenu = { entry, section: section.id, x: event.clientX, y: event.clientY };
                }}
                use:longpress={(x, y) => (emojiMenu = { entry, section: section.id, x, y })}
                onmouseenter={() => focusCell(entry)}
                onfocus={() => focusCell(entry)}
              >
                <img src={src(entry.unicode)} alt={entry.unicode} loading="lazy" decoding="async" draggable="false" />
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </div>

  <div class="footer row-nw align-centre gap-sm">
    {#if preview}
      <img class="preview" src={src(preview.unicode)} alt="" draggable="false" />
      <div class="col preview-text">
        <span class="sm bold preview-name">{preview.label}</span>
        {#if preview.shortcodes[0]}<span class="xs faint">:{preview.shortcodes[0]}:</span>{/if}
      </div>
    {/if}
  </div>
</div>

{#if emojiMenu}
  <MessageMenu items={emojiItems(emojiMenu.entry, emojiMenu.section)} x={emojiMenu.x} y={emojiMenu.y} label={text("emoji", "emoji_actions")} onclose={() => (emojiMenu = null)} />
{/if}

<style>
  .emoji-picker {
    position: fixed;
    z-index: var(--azure-z-popover);
    width: min(424px, calc(100vw - 24px));
    height: min(440px, calc(100dvh - 120px));
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 16px 40px -12px rgb(0 0 0 / 0.7),
      0 0 32px -16px var(--colours-accent-glow);
    overflow: hidden;
    visibility: hidden;
    transform-origin: 100% 100%;
  }

  .emoji-picker.placed {
    visibility: visible;
    animation: picker-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .emoji-picker.closing {
    pointer-events: none;
    animation: picker-out var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes picker-out {
    to {
      opacity: 0;
      scale: 0.95;
      translate: 0 6px;
    }
  }

  .top {
    position: relative;
    z-index: 2;
    padding: var(--azure-spacing-sm);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .search {
    min-width: 0;
    height: 40px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: none;
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
    outline: none;
  }

  .search:focus,
  .search:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .tone-wrap {
    position: relative;
  }

  .tone-button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: var(--azure-radius-sm);
    background-color: transparent;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .tone-button:hover,
  .tone-button.selected {
    background-color: var(--colours-surface-hover);
  }

  .tone-button img {
    width: 22px;
    height: 22px;
  }

  .tones {
    position: absolute;
    top: 0;
    right: 0;
    padding: 2px;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-light);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.6);
    transform-origin: 50% 0;
    animation: picker-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .rail {
    flex: none;
    gap: 2px;
    padding: var(--azure-spacing-xs);
    overflow-y: auto;
    background-color: var(--colours-foreground);
  }

  .rail-button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--azure-radius-sm);
    background-color: transparent;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .rail-button img {
    width: 20px;
    height: 20px;
    filter: grayscale(1);
    opacity: 0.55;
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .rail-button:hover img,
  .rail-button.active img {
    filter: none;
    opacity: 1;
  }

  .rail-button.active {
    background-color: var(--colours-surface-hover);
  }

  .grid-scroll {
    position: relative;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--azure-spacing-xs) var(--azure-spacing-sm);
  }

  .section {
    content-visibility: auto;
  }

  .section-title {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 10px 6px 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
    background-color: var(--colours-surface-raised);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  }

  .cell {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    padding: 0;
    border: 0;
    border-radius: var(--azure-radius-sm);
    background-color: transparent;
    outline: none;
    transition: background-color var(--azure-duration-instant) var(--azure-ease-out);
  }

  .cell img {
    width: 32px;
    height: 32px;
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .cell:is(:hover, :focus-visible) {
    background-color: var(--colours-surface-hover);
  }

  .cell:is(:hover, :focus-visible) img {
    transform: scale(1.12);
  }

  .cell:focus-visible {
    box-shadow: inset 0 0 0 2px var(--colours-accent);
  }

  .placeholder {
    height: 100%;
  }

  .empty {
    padding: var(--azure-spacing-lg);
    text-align: center;
  }

  .footer {
    flex: none;
    height: 52px;
    padding: 0 var(--azure-spacing-md);
    border-top: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
  }

  .preview {
    width: 32px;
    height: 32px;
  }

  .preview-text {
    min-width: 0;
  }

  .preview-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--colours-text-strong);
  }

  .preview-name::first-letter {
    text-transform: uppercase;
  }

  @keyframes picker-in {
    from {
      opacity: 0;
      scale: 0.95;
      translate: 0 6px;
    }
  }

  @media (max-width: 767px) {
    .emoji-picker.emoji-picker {
      inset: auto 0 0 0 !important;
      width: 100%;
      height: 60dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }

    .emoji-picker.placed {
      animation: picker-sheet-in var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .emoji-picker.closing {
      animation: picker-sheet-out var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    @keyframes picker-sheet-out {
      to {
        translate: 0 100%;
      }
    }

    .cell img {
      width: 30px;
      height: 30px;
    }

    @keyframes picker-sheet-in {
      from {
        translate: 0 100%;
      }
    }
  }
</style>
