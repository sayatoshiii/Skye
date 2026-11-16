<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import type { Snippet } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ensurePresence, presenceKinds } from "../../scripts/stores/presence";

  let { userId, size, hint, children }: { userId?: string; size: number; hint?: string; children: Snippet } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  $effect(() => {
    const id = userId;
    queueMicrotask(() => ensurePresence(id));
  });

  const kind = $derived($presenceKinds(userId));
  const label = $derived(hint ? `${text("presence", kind)}. ${hint}` : text("presence", kind));
  const dot = $derived(size <= 32 ? 10 : size <= 40 ? 12 : Math.round(size * 0.25));
  const gap = $derived(size <= 40 ? 3 : Math.round(dot * 0.25));
</script>

<span class="presence-avatar" style:--a={`${size}px`} style:--d={`${dot}px`} style:--g={`${gap}px`}>
  <span class="cut">{@render children()}</span>
  {#if userId}
    <span class="presence-dot {kind}" role="img" aria-label={label} use:tooltip={label}></span>
  {/if}
</span>

<style>
  .presence-avatar {
    --c: calc(var(--a) * 0.8536 + var(--presence-outset, 0px));
    position: relative;
    display: flex;
    flex: none;
    width: var(--a);
    height: var(--a);
  }

  .cut {
    display: flex;
    border-radius: 50%;
    mask: radial-gradient(circle at var(--c) var(--c), transparent calc(var(--d) / 2 + var(--g) - 0.5px), black calc(var(--d) / 2 + var(--g)));
  }

  .presence-dot {
    position: absolute;
    left: calc(var(--c) - var(--d) / 2);
    top: calc(var(--c) - var(--d) / 2);
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    pointer-events: auto;
    background-color: #80848e;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .online {
    background-color: var(--colours-success);
  }

  .idle {
    background-color: var(--colours-warning);
    mask: radial-gradient(circle at 18% 18%, transparent 36%, black 37%);
  }

  .dnd {
    background-color: var(--colours-danger);
    mask:
      linear-gradient(black, black) center / 60% 24% no-repeat,
      linear-gradient(black, black);
    mask-composite: exclude;
  }

  .offline {
    mask: radial-gradient(circle, transparent 30%, black 31%);
  }

  .unsupported {
    display: grid;
    place-items: center;
  }

  .unsupported::after {
    content: "?";
    font-size: calc(var(--d) * 0.78);
    font-weight: 800;
    line-height: 1;
    color: var(--colours-background);
  }
</style>
