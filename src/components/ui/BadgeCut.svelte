<script lang="ts">
  import type { Snippet } from "svelte";
  import { formatCount } from "../../scripts/stores/unread";

  let { count = 0, size = 44, label, children }: { count?: number; size?: number; label?: string; children: Snippet } = $props();

  const shown = $derived(formatCount(count));
  const width = $derived(shown.length <= 1 ? 16 : shown.length === 2 ? 22 : 28);
</script>

<span class="badge-cut" class:on={count > 0} style:--s={`${size}px`} style:--bw={`${width}px`}>
  <span class="badge-cut-body">{@render children()}</span>
  {#if count > 0}
    <span class="count-pip xs bold" role="img" aria-label={label ?? shown}>{shown}</span>
  {/if}
</span>

<style>
  .badge-cut {
    --o: 4px;
    --cy: calc(var(--s) + var(--o) - 8px);
    position: relative;
    display: flex;
    flex: none;
    width: var(--s);
    height: var(--s);
  }

  .badge-cut-body {
    display: flex;
  }

  .on .badge-cut-body {
    mask:
      radial-gradient(circle at var(--cy) var(--cy), transparent 10.5px, black 11px),
      radial-gradient(circle at calc(var(--cy) - var(--bw) + 16px) var(--cy), transparent 10.5px, black 11px);
    mask-composite: intersect;
  }

  .count-pip {
    position: absolute;
    right: calc(-1 * var(--o));
    bottom: calc(-1 * var(--o));
    width: var(--bw);
    height: 16px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 16px;
    text-align: center;
    color: white;
    background-color: var(--colours-danger);
    pointer-events: none;
    animation: pip-pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  @keyframes pip-pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
</style>
