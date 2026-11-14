<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import {
    accentPresets,
    getAccent,
    getAccentPreset,
    isHexColour,
    setAccent,
    type AccentPreset,
  } from "../../scripts/settings/accent";

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  let open = $state(false);
  let accent = $state<string>(accentPresets.sky);
  let root: HTMLElement | undefined = $state();

  const active = $derived(getAccentPreset(accent));
  const expanded = (colour: string) =>
    colour.length === 4
      ? `#${[...colour.slice(1)].map((c) => c + c).join("")}`
      : colour;

  const choose = (colour: string) => {
    if (setAccent(colour)) accent = colour;
  };

  onMount(() => {
    accent = getAccent();

    const close = (event: PointerEvent) => {
      if (open && root && !root.contains(event.target as Node)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") open = false;
    };

    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  });
</script>

<div class="picker" bind:this={root}>
  <button
    class="trigger ghost press"
    aria-label={text("settings", "open")}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  </button>

  {#if open}
    <div class="popover surface col gap-md" role="dialog" aria-label={text("settings", "accent")}>
      <span class="xs bold label">{text("settings", "accent")}</span>
      <div class="row-nw gap-sm">
        {#each Object.entries(accentPresets) as [name, colour] (name)}
          <button
            class="swatch ghost press"
            style:--swatch={colour}
            title={text("settings", "presets", name as AccentPreset)}
            aria-label={text("settings", "presets", name as AccentPreset)}
            aria-pressed={active === name}
            onclick={() => choose(colour)}
          ></button>
        {/each}
        <label class="swatch custom press" style:--swatch={accent} aria-pressed={active === "custom"} title={text("settings", "custom")}>
          <input
            type="color"
            value={expanded(accent)}
            aria-label={text("settings", "custom")}
            oninput={(event) => choose(event.currentTarget.value)}
          />
        </label>
      </div>
      <input
        class="input hex sm"
        value={accent}
        maxlength="7"
        spellcheck="false"
        aria-label={text("settings", "custom")}
        onchange={(event) => {
          const value = event.currentTarget.value.trim();
          if (isHexColour(value)) choose(value);
          else event.currentTarget.value = accent;
        }}
      />
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }

  .trigger {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .trigger:hover,
  .trigger[aria-expanded="true"] {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .trigger[aria-expanded="true"] svg {
    transform: rotate(60deg);
  }

  svg {
    transition: transform var(--azure-duration-slow) var(--azure-ease-spring);
  }

  .popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--azure-spacing-md));
    z-index: var(--azure-z-popover);
    width: max-content;
    padding: var(--azure-spacing-md);
    background-color: var(--colours-surface-raised);
    border-radius: var(--azure-radius-lg);
    box-shadow:
      0 12px 32px -8px hsla(0, 0%, 0%, 0.6),
      inset 0 1px 0 hsla(0, 0%, 100%, 0.06);
    transform-origin: bottom right;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  .swatch {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    background-color: var(--swatch);
    box-shadow: 0 0 0 2px var(--colours-surface-raised);
  }

  .swatch:hover {
    transform: scale(1.08);
  }

  .swatch[aria-pressed="true"] {
    box-shadow:
      0 0 0 2px var(--colours-surface-raised),
      0 0 0 4px var(--swatch),
      0 0 14px var(--swatch);
  }

  .custom {
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
    overflow: hidden;
  }

  .custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .hex {
    width: 100%;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    font-family: ui-monospace, monospace;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
    }
  }

  @media (max-width: 767px) {
    .trigger {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .swatch {
      width: 36px;
      height: 36px;
    }
  }
</style>
