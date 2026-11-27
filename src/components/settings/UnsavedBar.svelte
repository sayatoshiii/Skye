<script lang="ts">
  import { getContext } from "svelte";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import { menu } from "../../scripts/misc/entitymenu.svelte";

  let {
    open,
    busy = false,
    message,
    resetLabel,
    saveLabel,
    disabled = false,
    items,
    onreset,
    onsave,
  }: {
    open: boolean;
    busy?: boolean;
    message: string;
    resetLabel: string;
    saveLabel: string;
    disabled?: boolean;
    items?: () => MenuItem[];
    onreset: () => void;
    onsave: () => void;
  } = $props();

  const dock = getContext<{ element?: HTMLElement } | undefined>("settings-dock");

  let bar: HTMLDivElement | undefined = $state();

  $effect(() => {
    const target = dock?.element;
    bar && target && target.appendChild(bar);
  });

  export const nudge = () => bar && (bar.classList.remove("nudged"), void bar.offsetWidth, bar.classList.add("nudged"));
</script>

<div class="bar row-nw align-centre gap-sm" class:open={open || busy} inert={!(open || busy)} bind:this={bar} role="status" use:menu={items} onanimationend={(event) => event.target === bar && event.animationName.includes("flash") && bar?.classList.remove("nudged")}>
  <span class="unsaved-text truncate">{message}</span>
  <button type="button" class="unsaved-reset ghost press" disabled={busy} onclick={onreset}>{resetLabel}</button>
  <button type="button" class="unsaved-save ghost press" disabled={busy || disabled} onclick={onsave}>{saveLabel}</button>
</div>

<style>
  .bar {
    position: absolute;
    left: 50%;
    bottom: 0;
    max-width: calc(100% - 32px);
    padding: 6px 6px 6px 16px;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-foreground);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
    color: var(--colours-text);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    translate: -50% 24px;
    scale: 0.92;
    transition:
      translate 460ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 460ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 460ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .bar.open {
    opacity: 1;
    translate: -50% 0;
    scale: 1;
  }

  .unsaved-reset,
  .unsaved-save {
    flex: none;
    min-height: 30px;
    border-color: transparent;
    font-size: var(--text-sm);
  }

  .unsaved-reset {
    margin: 0 10px 0 20px;
    color: var(--colours-text-muted);
  }

  .unsaved-reset:hover:not(:disabled) {
    color: var(--colours-text-strong);
    text-decoration: underline;
  }

  .unsaved-save {
    padding: 0 16px;
    border-radius: var(--azure-radius-pill);
    font-weight: 600;
    color: var(--colours-on-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 78%, var(--colours-surface-raised));
    transition: background-color 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .unsaved-save:hover:not(:disabled) {
    background-color: var(--colours-accent);
  }

  .bar :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .bar:global(.nudged) {
    animation:
      unsaved-shake 500ms linear,
      unsaved-flash 600ms var(--azure-ease-out);
  }

  .bar:global(.nudged) .unsaved-text {
    animation: unsaved-bold 600ms var(--azure-ease-out);
  }

  .bar:global(.nudged) .unsaved-reset {
    animation: unsaved-reset-flash 600ms var(--azure-ease-out);
  }

  .bar:global(.nudged) .unsaved-save {
    animation: unsaved-save-flash 600ms var(--azure-ease-out);
  }

  @keyframes unsaved-bold {
    0%,
    35% {
      font-weight: 700;
    }
  }

  @keyframes unsaved-reset-flash {
    0%,
    35% {
      color: white;
    }
  }

  @keyframes unsaved-save-flash {
    0%,
    35% {
      color: var(--colours-danger);
      background-color: white;
    }
  }

  @keyframes unsaved-shake {
    10% {
      transform: translateX(-10px) scale(1.03);
    }
    22% {
      transform: translateX(9px) scale(1.02);
    }
    34% {
      transform: translateX(-7px) scale(1.01);
    }
    46% {
      transform: translateX(6px);
    }
    58% {
      transform: translateX(-4px);
    }
    70% {
      transform: translateX(3px);
    }
    84% {
      transform: translateX(-1px);
    }
  }

  @keyframes unsaved-flash {
    0%,
    35% {
      background-color: color-mix(in oklab, var(--colours-danger) 85%, var(--colours-surface-raised));
      border-color: var(--colours-danger);
      color: white;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar:global(.nudged) {
      animation: unsaved-flash 600ms var(--azure-ease-out);
    }
  }

  :global(:root[data-motion="reduce"]) .bar:global(.nudged) {
    animation: unsaved-flash 600ms var(--azure-ease-out);
  }

  @media (max-width: 767px) {
    .unsaved-text {
      font-size: var(--text-xs);
    }
  }
</style>
