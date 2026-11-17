<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { accentPresets, getAccent, getAccentPreset, isHexColour, setAccent, type AccentPreset } from "../../scripts/settings/accent";
  import { mediaSettings, setHideRedacted, setShowCallEvents } from "../../scripts/settings/media";
  import { getMotionChoice, setMotionChoice, systemReducesMotion } from "../../scripts/settings/motion";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Icon from "./Icon.svelte";

  const THEMES = [{ id: "dark", window: "var(--colours-background)", rail: "var(--colours-surface)", block: "var(--colours-surface-raised)" }];
  const PRESETS = Object.entries(accentPresets) as [AccentPreset, string][];

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const look = (...path: string[]) => text("appearance", ...path);

  let accent = $state<string>(accentPresets.sky);
  let reduce = $state(false);
  let system = $state(false);
  let hex = $state("");

  const active = $derived(getAccentPreset(accent));
  const index = $derived(PRESETS.findIndex(([name]) => name === active));
  const expanded = (colour: string) => (colour.length === 4 ? `#${[...colour.slice(1)].map((c) => c + c).join("")}` : colour);

  const choose = (colour: string) => setAccent(colour) && ((accent = colour), (hex = expanded(colour).slice(1).toUpperCase()));

  const typed = (value: string) => {
    hex = value.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
    const colour = `#${hex.toLowerCase()}`;
    [3, 6].includes(hex.length) && setAccent(colour) && (accent = colour);
  };

  const toggleAnimations = (on: boolean) => {
    reduce = !on;
    setMotionChoice(!on);
  };

  const accentItems = (): MenuItem[] => [{ id: "accent-copy", label: look("copy_hex"), icon: MENU_ICONS.copy, run: () => copied(expanded(accent).toUpperCase()) }];

  onMount(() => {
    choose(getAccent());
    reduce = getMotionChoice();
    system = systemReducesMotion();
  });
</script>

<section class="set-section" data-part="theme">
  <div class="head col">
    <h3 class="set-heading title">{look("theme")}</h3>
    <p class="set-hint">{look("theme_hint")}</p>
  </div>
  <div class="themes" role="radiogroup" aria-label={look("theme")}>
    {#each THEMES as theme (theme.id)}
      <button type="button" class="theme ghost" role="radio" aria-checked="true" style:--window={theme.window} style:--rail={theme.rail} style:--block={theme.block}>
        <span class="mock" aria-hidden="true">
          <span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
          <span class="mock-body">
            <span class="mock-rail"><i></i><i></i><i></i></span>
            <span class="mock-main"><i class="wide"></i><i></i><i></i><i class="wide"></i></span>
          </span>
        </span>
        <span class="theme-label row-nw align-centre gap-sm">
          <span class="radio"><Icon name="check" size={12} /></span>
          <span class="md">{look(theme.id)}</span>
        </span>
      </button>
    {/each}
  </div>
</section>

<section class="set-section" data-part="accent">
  <div class="split">
    <div class="head col">
      <h3 class="set-heading title">{text("accent")}</h3>
      <p class="set-hint">{look("accent_hint")}</p>
    </div>
    <div class="col picker" use:menu={accentItems}>
      <div class="swatches" role="radiogroup" aria-label={text("accent")}>
        <span class="ring" class:shown={index >= 0} style:--index={Math.max(index, 0)} aria-hidden="true"></span>
        {#each PRESETS as [name, colour] (name)}
          <button type="button" class="swatch ghost press" role="radio" style:--swatch={colour} use:tooltip={text("presets", name)} aria-label={text("presets", name)} aria-checked={active === name} onclick={() => choose(colour)}></button>
        {/each}
      </div>
      <div class="custom row-nw align-centre gap-sm">
        <span class="sm faint">{look("custom_colour")}</span>
        <label class="set-input hex">
          <span class="faint">#</span>
          <input value={hex} maxlength="6" spellcheck="false" autocomplete="off" aria-label={look("custom_colour")} oninput={(event) => typed(event.currentTarget.value)} onblur={() => (hex = expanded(accent).slice(1).toUpperCase())} />
        </label>
        <label class="preview press" class:selected={active === "custom"} style:--swatch={accent} use:tooltip={look("pick")}>
          <input type="color" value={expanded(accent)} aria-label={look("pick")} oninput={(event) => choose(event.currentTarget.value)} />
        </label>
      </div>
    </div>
  </div>
</section>

<section class="set-section" data-part="motion">
  <div class="split">
    <div class="head col">
      <h3 class="set-heading title">{look("animations")}</h3>
      <p class="set-hint">{look(system ? "animations_system" : "animations_hint")}</p>
    </div>
    <Toggle checked={!system && !reduce} disabled={system} label={look("animations")} onchange={toggleAnimations} />
  </div>
</section>

<section class="set-section" data-part="redacted">
  <div class="split">
    <div class="head col">
      <h3 class="set-heading title">{look("hide_redacted")}</h3>
      <p class="set-hint">{look("hide_redacted_hint")}</p>
    </div>
    <Toggle checked={$mediaSettings.hideRedacted} label={look("hide_redacted")} onchange={setHideRedacted} />
  </div>
</section>

<section class="set-section" data-part="calls">
  <div class="split">
    <div class="head col">
      <h3 class="set-heading title">{look("show_call_events")}</h3>
      <p class="set-hint">{look("show_call_events_hint")}</p>
    </div>
    <Toggle checked={$mediaSettings.showCallEvents} label={look("show_call_events")} onchange={setShowCallEvents} />
  </div>
</section>

<style>
  .head {
    gap: 4px;
    min-width: 0;
  }

  .title {
    font-size: 19px;
    font-weight: 600;
  }

  .split {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--azure-spacing-xl);
  }

  .themes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--azure-spacing-lg);
    align-items: end;
  }

  .theme {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid var(--line, var(--colours-outline-hairline));
    background-color: var(--fill, var(--colours-surface-hover));
    text-align: left;
    transition:
      transform var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1),
      border-color var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .theme:hover {
    transform: translateY(-2px) scale(1.015);
    box-shadow: 0 14px 30px -18px black;
  }

  .theme[aria-checked="true"] {
    border-color: var(--colours-accent);
    box-shadow: 0 0 0 1px var(--colours-accent);
  }

  .mock {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 14px 14px 0;
    padding: 8px;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    background-color: var(--window);
    border: 1px solid var(--line, var(--colours-outline-hairline));
  }

  .dots {
    display: flex;
    gap: 4px;
  }

  .dot {
    flex: none;
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #ff5f57;
  }

  .dot:nth-child(2) {
    background-color: #febc2e;
  }

  .dot:nth-child(3) {
    background-color: #28c840;
  }

  .mock-body {
    flex: 1;
    display: grid;
    grid-template-columns: 28% 1fr;
    gap: 6px;
  }

  .mock-rail,
  .mock-main {
    display: grid;
    gap: 5px;
    align-content: start;
  }

  .mock-rail {
    padding: 5px;
    border-radius: 5px;
    background-color: var(--rail);
  }

  .mock-main {
    grid-template-columns: 1fr 2fr;
  }

  .mock i {
    height: 10px;
    border-radius: 3px;
    background-color: var(--block);
  }

  .mock-main i.wide {
    grid-column: span 2;
    height: 14px;
  }

  .mock-main i.wide:first-child {
    background-color: color-mix(in oklab, var(--colours-accent) 55%, var(--block));
  }

  .theme-label {
    margin-top: 14px;
    padding: 12px 14px;
    color: var(--colours-text-strong);
    font-weight: 500;
    transition: background-color var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .theme[aria-checked="true"] .theme-label {
    background-color: color-mix(in oklab, var(--colours-accent) 14%, transparent);
  }

  .radio {
    width: 18px;
    height: 18px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: transparent;
    box-shadow: inset 0 0 0 1.5px var(--colours-text-faint);
    transition:
      background-color var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1),
      color var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .theme[aria-checked="true"] .radio {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
    box-shadow: none;
  }


  .picker {
    flex: none;
    align-items: flex-end;
    gap: var(--azure-spacing-md);
  }

  .swatches {
    --size: 32px;
    --gap: 14px;
    position: relative;
    display: flex;
    gap: var(--gap);
  }

  .swatch {
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background-color: var(--swatch);
  }

  .ring {
    position: absolute;
    top: -4px;
    left: -4px;
    width: calc(var(--size) + 8px);
    height: calc(var(--size) + 8px);
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--colours-text-strong);
    opacity: 0;
    pointer-events: none;
    transform: translateX(calc(var(--index) * (var(--size) + var(--gap)))) scale(0.8);
    transition:
      transform var(--azure-duration-slow) cubic-bezier(0.34, 1.4, 0.64, 1),
      opacity var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .ring.shown {
    opacity: 1;
    transform: translateX(calc(var(--index) * (var(--size) + var(--gap)))) scale(1);
  }

  .hex {
    width: 112px;
    min-height: 36px;
    gap: 2px;
  }

  .hex input {
    font-family: ui-monospace, monospace;
    font-size: max(16px, var(--text-sm));
    text-transform: uppercase;
  }

  .preview {
    position: relative;
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    cursor: pointer;
    background-color: var(--swatch);
    box-shadow: 0 0 0 2px var(--card, var(--colours-background));
    transition: box-shadow var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .preview.selected {
    box-shadow:
      0 0 0 2px var(--card, var(--colours-background)),
      0 0 0 4px var(--colours-text-strong);
  }

  .preview input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  @media (max-width: 1023px) {
    .themes {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

  }

  @media (max-width: 767px) {
    .split {
      flex-direction: column;
      gap: var(--azure-spacing-md);
    }

    .split :global(.toggle) {
      align-self: flex-end;
    }

    .picker {
      align-self: stretch;
    }
  }
</style>
