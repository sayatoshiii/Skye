<script lang="ts">
  import { untrack } from "svelte";
  import { renderEmoji } from "../../scripts/misc/emoji";
  import { swap } from "../../scripts/misc/swap";

  let { text = "", fade = true, live = false }: { text?: string; fade?: boolean; live?: boolean } = $props();

  const segmenter = new Intl.Segmenter();
  const graphemes = (value: string) => Array.from(segmenter.segment(value), (part) => part.segment);

  let previous = graphemes(untrack(() => text));
  let edits = 0;

  const html = $derived(renderEmoji(text));
  const edit = $derived.by(() => {
    const next = graphemes(text);
    const shared = Math.min(previous.length, next.length);
    const head = next.findIndex((part, index) => index >= shared || part !== previous[index]);
    const start = head < 0 ? next.length : head;
    const tail = next.slice(start).reverse().findIndex((part, index) => index >= shared - start || part !== previous[previous.length - 1 - index]);
    const end = next.length - (tail < 0 ? next.length - start : tail);
    const fresh = next.slice(start, end).join("");
    const gone = previous.slice(start, previous.length - (next.length - end)).join("");
    previous = next;
    return { head: next.slice(0, start).join(""), fresh, gone, tail: next.slice(end).join(""), key: fresh || gone ? ++edits : edits };
  });
</script>

{#if live}
  <span>{@html renderEmoji(edit.head)}{#key edit.key}{#if edit.gone}<span class="gone" aria-hidden="true"><span>{@html renderEmoji(edit.gone)}</span></span>{/if}<span class="fresh haze" style:--haze-blur="6px" style:--haze-scale="1">{@html renderEmoji(edit.fresh)}</span>{/key}{@html renderEmoji(edit.tail)}</span>
{:else}
  <span use:swap={fade ? text : ""}>{@html html}</span>
{/if}

<style>
  .fresh {
    display: inline-block;
    white-space: pre;
  }

  .gone {
    display: inline-grid;
    grid-template-columns: 0fr;
    vertical-align: bottom;
    opacity: 0;
    white-space: pre;
    pointer-events: none;
    animation: gone 420ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .gone > span {
    min-width: 0;
    overflow: hidden;
  }

  @keyframes gone {
    from {
      grid-template-columns: 1fr;
      opacity: 1;
      filter: blur(0);
    }
    35% {
      grid-template-columns: 1fr;
      opacity: 0.6;
      filter: blur(3px);
    }
    to {
      filter: blur(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gone {
      animation: none;
    }
  }
</style>
