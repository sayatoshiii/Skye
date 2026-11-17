<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { ThreadSummary } from "../../scripts/matrix/timeline";
  import { toPreviewLine } from "../../scripts/misc/formatting";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  let {
    summary,
    getSender,
    items,
    onopen,
  }: {
    summary: ThreadSummary;
    getSender: (userId: string) => { name: string; avatar?: string };
    items: () => MenuItem[];
    onopen: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const latest = $derived(summary.latest);
  const author = $derived(latest?.sender ? getSender(latest.sender) : null);
  const countLabel = $derived(text("chat", summary.count === 1 ? "thread_reply_count" : "thread_replies_count").replace("{count}", String(summary.count)));
  const snippet = $derived(
    latest && (latest.redacted ? text("chat", "redacted") : latest.decryptionFailed || latest.type === "m.room.encrypted" ? text("chat", "encrypted") : toPreviewLine(latest.content)),
  );
</script>

<button type="button" class="thread-summary row-nw align-centre gap-sm ghost press sm" aria-label={`${text("chat", "open_thread")}: ${countLabel}`} onclick={onopen} use:menu={items}>
  <svg class="thread-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.thread} /></svg>
  <span class="count bold">{countLabel}</span>
  {#if author}
    <span class="latest row-nw align-centre gap-xs min-0">
      <Avatar name={author.name} url={author.avatar} size="18px" radius="50%" />
      <span class="name bold truncate"><EmojiText text={author.name} /></span>
      {#if snippet}<span class="snippet truncate muted"><EmojiText text={snippet} /></span>{/if}
    </span>
  {/if}
  <svg class="chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.29 6.71a.996.996 0 0 0 0 1.41L13.17 12l-3.88 3.88a.996.996 0 1 0 1.41 1.41l4.59-4.59a.996.996 0 0 0 0-1.41L10.7 6.7c-.38-.38-1.02-.38-1.41.01Z" /></svg>
</button>

<style>
  .thread-summary {
    max-width: min(100%, 520px);
    margin-top: var(--azure-spacing-xs);
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    color: var(--colours-text);
    text-align: left;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .thread-summary:hover,
  .thread-summary:focus-visible {
    outline: none;
    border-color: var(--colours-outline-strong);
    background-color: var(--colours-surface-hover);
  }

  .thread-icon,
  .count {
    flex: none;
    color: var(--colours-accent);
  }

  .latest {
    flex: 1 1 auto;
  }

  .name {
    flex: none;
    max-width: 40%;
  }

  .snippet {
    min-width: 0;
  }

  .chevron {
    flex: none;
    color: var(--colours-text-faint);
    transition: translate var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .thread-summary:hover .chevron {
    translate: 2px 0;
  }
</style>
