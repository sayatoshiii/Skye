<script lang="ts" module>
  export type MenuItem = {
    id: string;
    label: string;
    icon: string;
    danger?: boolean;
    disabled?: boolean;
    filled?: boolean;
    colour?: string;
    run: (event: MouseEvent | KeyboardEvent) => void;
  };
</script>

<script lang="ts">
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { tick } from "svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  let {
    items,
    x,
    y,
    label,
    minWidth,
    quick,
    quickLabel,
    onclose,
  }: {
    items: MenuItem[];
    x: number;
    y: number;
    label: string;
    minWidth?: number;
    quick?: { key: string; active: boolean; run: () => void }[];
    quickLabel?: string;
    onclose: () => void;
  } = $props();

  const exit = dismissible(() => onclose());
  const openedAt = performance.now();
  const dismiss = (event: Event) => {
    event.preventDefault();
    if (performance.now() - openedAt > 450) exit.close();
  };

  let menu: HTMLElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);

  $effect(() => {
    const at = { x, y };
    tick().then(() => {
      if (!menu) return;
      const gap = 8;
      const room = innerHeight - gap * 2;
      menu.style.maxHeight = `${room}px`;

      const rect = menu.getBoundingClientRect();
      const below = innerHeight - gap - at.y;
      const above = at.y - gap;
      const flip = rect.height > below && above > below;

      left = Math.max(gap, Math.min(at.x, innerWidth - rect.width - gap));
      top = Math.max(gap, Math.min(flip ? at.y - rect.height : at.y, innerHeight - rect.height - gap));
      menu.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    });
  });

  const buttons = () => [...(menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      return exit.close();
    }

    const list = buttons();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 };
    if (!(event.key in moves)) return;

    event.preventDefault();
    list.at(moves[event.key] % list.length)?.focus();
  };

  const choose = (item: MenuItem, event: MouseEvent | KeyboardEvent) => {
    exit.close();
    item.run(event);
  };
</script>

<div class="layer" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={dismiss} oncontextmenu={dismiss}></button>
  <div class="menu col" role="menu" onanimationend={exit.onanimationend} inert={exit.closing} aria-label={label} tabindex="-1" bind:this={menu} style:left="{left}px" style:top="{top}px" style:min-width={minWidth ? `${minWidth}px` : undefined} {onkeydown}>
    <span class="handle" aria-hidden="true"></span>
    {#if quick?.length}
      <div class="quick row-nw" role="group" aria-label={quickLabel}>
        {#each quick as option (option.key)}
          <button type="button" role="menuitem" class="quick-option ghost press" class:active={option.active} aria-pressed={option.active} aria-label={option.key} onclick={() => { exit.close(); option.run(); }}><EmojiText text={option.key} /></button>
        {/each}
      </div>
    {/if}
    {#each items as item (item.id)}
      <button type="button" role="menuitem" class="entry row-nw align-centre gap-md ghost press sm" class:danger={item.danger} disabled={item.disabled} onclick={(event) => choose(item, event)}>
        <span class="flex-max truncate">{item.label}</span>
        {#if item.filled}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill={item.colour ?? "currentColor"} fill-rule="evenodd" d={item.icon} /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style:color={item.colour}><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={item.icon} /></svg>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
  }

  .menu {
    overflow-y: auto;
    overscroll-behavior: contain;
    position: fixed;
    min-width: 200px;
    padding: var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 16px 48px -12px black,
      0 0 32px -16px var(--colours-accent-glow);
    outline: none;
    transform-origin: top left;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .handle {
    display: none;
  }

  .quick {
    justify-content: space-between;
    gap: 2px;
    padding-bottom: var(--azure-spacing-sm);
    margin-bottom: var(--azure-spacing-xs);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .quick-option {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background-color: var(--colours-surface-hover);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      scale var(--azure-duration-md) var(--azure-ease-spring);
  }

  .quick-option:hover,
  .quick-option:focus-visible {
    scale: 1.12;
  }

  .quick-option.active {
    background-color: color-mix(in oklab, var(--colours-accent) 22%, transparent);
    box-shadow: inset 0 0 0 1px var(--colours-accent);
  }

  .quick-option :global(img.emoji) {
    width: 22px;
    height: 22px;
  }

  .layer.closing {
    pointer-events: none;
  }

  .closing .menu {
    animation: exit-pop var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  .entry {
    min-height: 34px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text);
    text-align: left;
  }

  .entry svg {
    color: var(--colours-text-faint);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .entry:hover,
  .entry:focus-visible {
    outline: none;
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .entry:hover svg,
  .entry:focus-visible svg {
    color: var(--colours-accent);
  }

  .entry:disabled {
    opacity: 0.45;
    cursor: default;
    background: none;
  }

  .entry.danger,
  .entry.danger svg {
    color: var(--colours-danger);
  }

  .entry.danger:hover,
  .entry.danger:focus-visible {
    background-color: var(--colours-danger-soft);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @media (max-width: 767px) {
    .scrim {
      background-color: var(--colours-scrim);
      animation: fade var(--azure-duration-md) var(--azure-ease-out);
    }

    .menu {
      inset: auto 0 0 0 !important;
      min-width: 0;
      padding: var(--azure-spacing-sm) var(--azure-spacing-md) calc(var(--azure-spacing-md) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      animation: rise var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .handle {
      display: block;
      width: 36px;
      height: 4px;
      margin: 0 auto var(--azure-spacing-sm);
      border-radius: var(--azure-radius-pill);
      background-color: var(--colours-outline-strong);
    }

    .closing .scrim {
      animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .closing .menu {
      animation: exit-sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .entry {
      min-height: var(--azure-touch);
      font-size: var(--text-md);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
