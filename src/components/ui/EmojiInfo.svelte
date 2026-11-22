<script lang="ts">
  import { writeClipboard } from "../../scripts/stores/toast";
  import { tick } from "svelte";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { findEmoji, formatCodepoints, loadEmojiIndex, type EmojiEntry } from "../../scripts/misc/emoji-data";

  let {
    anchor,
    unicode,
    src,
    onclose,
  }: {
    anchor: HTMLElement;
    unicode: string;
    src: string;
    onclose: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const GAP = 8;
  const MARGIN = 12;

  const exit = dismissible(() => onclose());

  export const dismiss = exit.close;

  let card: HTMLDivElement | undefined = $state();
  let entry = $state.raw<EmojiEntry | null>(null);
  let loaded = $state(false);
  let copied: "emoji" | "shortcode" | null = $state(null);
  let position: { x: number; y: number; below: boolean } | null = $state(null);

  const shortcode = $derived(entry?.shortcodes[0] ? `:${entry.shortcodes[0]}:` : null);

  const place = async () => {
    await tick();
    if (!card || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const below = rect.top - GAP - height < MARGIN;
    const x = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, MARGIN), innerWidth - width - MARGIN);
    const y = below ? Math.min(rect.bottom + GAP, innerHeight - height - MARGIN) : rect.top - GAP - height;
    position = { x, y, below };
  };

  $effect(() => {
    let alive = true;
    loadEmojiIndex()
      .then((index) => {
        entry = findEmoji(index, unicode);
        if (entry) anchor.setAttribute("aria-label", entry.label);
      })
      .catch(() => {})
      .finally(() => {
        if (!alive) return;
        loaded = true;
        place();
      });
    place();
    return () => (alive = false);
  });

  $effect(() => {
    const onkey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      exit.close();
      anchor.focus?.();
    };
    const onpointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card?.contains(target) || anchor.contains(target)) return;
      exit.close();
    };
    const onmove = () => place();
    document.addEventListener("keydown", onkey);
    document.addEventListener("pointerdown", onpointer, true);
    addEventListener("resize", onmove);
    addEventListener("scroll", onmove, true);
    return () => {
      document.removeEventListener("keydown", onkey);
      document.removeEventListener("pointerdown", onpointer, true);
      removeEventListener("resize", onmove);
      removeEventListener("scroll", onmove, true);
    };
  });

  const copy = async (kind: "emoji" | "shortcode") => {
    const value = kind === "emoji" ? unicode : shortcode;
    if (!value) return;
    try {
      await writeClipboard(value);
      copied = kind;
      setTimeout(() => copied === kind && (copied = null), 1400);
    } catch {}
  };
</script>

<span class="portal-anchor" hidden></span>
<div
  class="emoji-info col"
  class:below={position?.below}
  class:placed={!!position}
  class:closing={exit.closing}
  inert={exit.closing}
  onanimationend={exit.onanimationend}
  role="dialog"
  aria-label={text("emoji", "info")}
  tabindex="-1"
  bind:this={card}
  style:left="{position?.x ?? 0}px"
  style:top="{position?.y ?? 0}px"
  use:portal
>
  <div class="head row-nw align-centre gap-md">
    <img class="glyph" {src} alt={unicode} width="48" height="48" draggable="false" />
    <div class="meta col">
      {#if entry || loaded}
        <span class="title sm bold">{shortcode ?? entry?.label ?? text("emoji", "unknown")}</span>
      {:else}
        <span class="skeleton"></span>
      {/if}
      <span class="xs muted">{text("emoji", "default")}</span>
    </div>
  </div>
  <div class="details row-nw align-centre gap-sm xs">
    <span class="name">{entry?.label ?? text("emoji", "unknown")}</span>
    <span class="codepoints faint">{formatCodepoints(unicode)}</span>
    {#if entry?.version !== undefined}<span class="faint">· {text("emoji", "version").replace("{version}", String(entry.version))}</span>{/if}
  </div>
  <div class="actions row-nw gap-xs">
    <button type="button" class="action ghost press xs bold" onclick={() => copy("emoji")}>
      {copied === "emoji" ? text("emoji", "copied") : text("emoji", "copy_emoji")}
    </button>
    <button type="button" class="action ghost press xs bold" disabled={!shortcode} onclick={() => copy("shortcode")}>
      {copied === "shortcode" ? text("emoji", "copied") : text("emoji", "copy_shortcode")}
    </button>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .emoji-info {
    position: fixed;
    z-index: var(--azure-z-popover);
    width: min(280px, calc(100vw - 24px));
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.65);
    overflow: hidden;
    visibility: hidden;
    transform-origin: 50% 100%;
  }

  .emoji-info.below {
    transform-origin: 50% 0;
  }

  .emoji-info.placed {
    visibility: visible;
    animation: emoji-info-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .emoji-info.closing {
    pointer-events: none;
    animation: emoji-info-out var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes emoji-info-out {
    to {
      opacity: 0;
      scale: 0.94;
      translate: 0 4px;
    }
  }

  .head {
    padding: var(--azure-spacing-md);
  }

  .glyph {
    flex: none;
    width: 48px;
    height: 48px;
  }

  .meta {
    min-width: 0;
    gap: 2px;
  }

  .title {
    color: var(--colours-text-strong);
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--colours-text-muted);
    line-height: 1.35;
  }

  .details {
    flex-wrap: wrap;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-top: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-muted);
  }

  .name::first-letter {
    text-transform: uppercase;
  }

  .codepoints {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  }

  .skeleton {
    height: 12px;
    width: 120px;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-surface-hover);
  }

  .actions {
    justify-content: flex-end;
    padding: 0 var(--azure-spacing-sm) var(--azure-spacing-sm);
  }

  .action {
    padding: 5px 10px;
    border: 0;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    background-color: transparent;
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .action:hover:not(:disabled) {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  @keyframes emoji-info-in {
    from {
      opacity: 0;
      scale: 0.94;
      translate: 0 4px;
    }
  }

  @media (max-width: 767px) {
    .emoji-info.emoji-info {
      inset: auto 0 0 0 !important;
      width: 100%;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }

    .emoji-info.placed {
      animation: emoji-sheet-in var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .emoji-info.closing {
      animation: emoji-sheet-out var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .action {
      min-height: 40px;
    }

    @keyframes emoji-sheet-out {
      to {
        translate: 0 100%;
      }
    }

    @keyframes emoji-sheet-in {
      from {
        translate: 0 100%;
      }
    }
  }
</style>
