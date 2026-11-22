<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { answerShare, sharePicker, type ShareChoice, type ShareMode } from "../../scripts/stores/nativescreen";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import type { MenuItem } from "./MessageMenu.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Icon from "../settings/Icon.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  const HEIGHTS = [720, 1080, 1440, 0];
  const RATES = [15, 30, 60];
  const PRESETS: Record<Exclude<ShareMode, "custom">, { height: number; fps: number }> = { smooth: { height: 720, fps: 30 }, text: { height: 0, fps: 5 } };

  let surface = $state<ShareChoice["surface"]>("screen");
  let mode = $state<ShareMode>("smooth");
  let height = $state(1080);
  let fps = $state(30);
  let muted = $state(false);
  let apps = $state<string[]>(["*"]);
  let chosen: ShareChoice | null = null;

  const exit = dismissible(() => answerShare(chosen));
  const picked = $derived(mode === "custom" ? { height, fps } : PRESETS[mode]);
  const sound = $derived(muted ? [] : apps);
  const choices = $derived([{ id: "*", label: text("share_audio_all") }, ...($sharePicker?.apps ?? []).map((app) => ({ id: app, label: app }))]);
  const label = (value: number) => (value ? `${value}p` : text("share_native"));
  const summary = $derived(
    [text(`share_${mode}`), label(picked.height), text("share_fps").replace("{fps}", String(picked.fps)), sound.includes("*") ? text("share_audio_all") : sound.length === 1 ? text("share_app") : sound.length ? text("share_apps").replace("{count}", String(sound.length)) : text("share_silent")].join(" · "),
  );

  const toggle = (id: string) => (apps = id === "*" ? (apps.includes("*") ? [] : ["*"]) : apps.includes(id) ? apps.filter((app) => app !== id) : [...apps.filter((app) => app !== "*"), id]);
  const appItems = (id: string, name: string): MenuItem[] => [
    { id: `share-app-${id}`, label: text(apps.includes(id) ? "share_audio_drop" : "share_audio_pick").replace("{app}", name), icon: MENU_ICONS.read, selected: apps.includes(id), run: () => toggle(id) },
    { id: `share-app-only-${id}`, label: text("share_audio_only").replace("{app}", name), icon: MENU_ICONS.read, run: () => (apps = [id]) },
  ];
  const tileItems = (id: ShareChoice["surface"]): MenuItem[] => [{ id: `share-tile-${id}`, label: text("share_go"), icon: MENU_ICONS.read, run: () => ((surface = id), go()) }];
  const go = () => ((chosen = { surface, mode, ...picked, apps: sound }), exit.close());
  const cancel = () => ((chosen = null), exit.close());
</script>

{#if $sharePicker}
  <span class="portal-anchor" hidden></span>
  <div class="share-layer set-surface" class:closing={exit.closing} role="presentation" use:portal>
    <button type="button" class="share-scrim ghost" tabindex="-1" aria-hidden="true" onclick={cancel}></button>
    <div class="share-card col" role="dialog" aria-modal="true" aria-label={text("share_title")} tabindex="-1" inert={exit.closing} onanimationend={exit.onanimationend} onkeydown={(event) => event.key === "Escape" && cancel()}>
      <header class="row-nw align-centre">
        <h2 class="flex-max">{text("share_title")}</h2>
        <button type="button" class="round close ghost press" aria-label={text("share_audio_cancel")} onclick={cancel}><Icon name="close" /></button>
      </header>

      <div class="body row-nw">
        <div class="col flex-max gap-md">
          <div class="tiles row-nw" role="radiogroup" aria-label={text("share_title")}>
            {#each [["screen", "M3 4.5h18v12H3zM8 20h8M12 16.5V20"], ["window", "M3 4.5h18v15H3zM3 8.5h18M6 6.5h.01M8.5 6.5h.01"]] as [id, path] (id)}
              <button type="button" class="tile ghost press col centre gap-sm" class:on={surface === id} role="radio" aria-checked={surface === id} onclick={() => (surface = id as ShareChoice["surface"])} ondblclick={go} use:menu={() => tileItems(id as ShareChoice["surface"])}>
                <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d={path} /></svg>
                <span class="sm bold">{text(`share_${id}`)}</span>
              </button>
            {/each}
          </div>

            <section class="col gap-xs">
              <div class="row-nw align-centre gap-sm">
                <h3 class="flex-max">{text("share_sound")}</h3>
                <span class="xs muted">{text("share_mute")}</span>
                <Toggle checked={muted} label={text("share_mute")} onchange={(value) => (muted = value)} />
              </div>
              <p class="xs muted hint">{text("share_sound_hint")}</p>
              <div class="apps col gap-xs" class:dim={muted} inert={muted} role="group" aria-label={text("share_sound")}>
                {#each choices as choice (choice.id)}
                  {@const on = apps.includes(choice.id)}
                  <button type="button" class="app ghost press sm row-nw align-centre gap-sm" class:on class:faded={apps.includes("*") && choice.id !== "*"} role="checkbox" aria-checked={on} onclick={() => toggle(choice.id)} use:menu={() => appItems(choice.id, choice.label)}>
                    <span class="truncate flex-max">{choice.label}</span>
                    <span class="box" aria-hidden="true"><Icon name="check" size={14} /></span>
                  </button>
                {/each}
                {#if !$sharePicker.apps.length}<p class="xs faint empty">{text("share_audio_empty")}</p>{/if}
              </div>
            </section>
        </div>

        <aside class="quality col gap-xs" role="radiogroup" aria-label={text("share_quality")}>
          <h3>{text("share_quality")}</h3>
          {#each ["smooth", "text", "custom"] as id (id)}
            <button type="button" class="mode ghost press row-nw align-centre gap-sm" class:on={mode === id} role="radio" aria-checked={mode === id} onclick={() => (mode = id as ShareMode)}>
              <span class="col flex-max min-0">
                <span class="sm bold">{text(`share_${id}`)}</span>
                {#if id !== "custom"}<span class="xs muted">{text(`share_${id}_hint`)}</span>{/if}
              </span>
              <span class="dot" aria-hidden="true"></span>
            </button>
          {/each}
          <div class="custom col gap-sm" class:open={mode === "custom"} inert={mode !== "custom"}>
            <div class="col gap-xs">
              <span class="xs muted">{text("share_resolution")}</span>
              <div class="segments row-nw">
                {#each HEIGHTS as value (value)}<button type="button" class="segment ghost press xs bold" class:on={height === value} aria-pressed={height === value} onclick={() => (height = value)}>{label(value)}</button>{/each}
              </div>
            </div>
            <div class="col gap-xs">
              <span class="xs muted">{text("share_framerate")}</span>
              <div class="segments row-nw">
                {#each RATES as value (value)}<button type="button" class="segment ghost press xs bold" class:on={fps === value} aria-pressed={fps === value} onclick={() => (fps = value)}>{text("share_fps").replace("{fps}", String(value))}</button>{/each}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <footer class="row-nw align-centre gap-md">
        <div class="col flex-max min-0">
          <span class="sm bold">{text(`share_${surface}`)}</span>
          <span class="xs muted truncate">{summary}</span>
        </div>
        <button type="button" class="cancel ghost press sm bold" onclick={cancel}>{text("share_audio_cancel")}</button>
        <button type="button" class="live press sm bold" onclick={go}>{text("share_go")}</button>
      </footer>
    </div>
  </div>
  <span class="portal-anchor" hidden></span>
{/if}

<style>
  .share-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    display: grid;
    place-items: center;
  }

  .share-scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(6px);
    animation: share-fade var(--azure-duration-slow) var(--sheet);
  }

  .share-card {
    position: relative;
    width: min(860px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--line);
    background-color: var(--card);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    animation: share-pop var(--azure-duration-slow) var(--sheet);
  }

  .closing {
    pointer-events: none;
  }

  .closing .share-scrim {
    animation: exit-fade var(--azure-duration-md) var(--sheet) forwards;
  }

  .closing .share-card {
    animation: share-out var(--azure-duration-md) var(--sheet) forwards;
  }

  header {
    padding: 16px 16px 0 20px;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--colours-text-strong);
  }

  h3 {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-muted);
  }

  .close {
    color: var(--colours-text-muted);
  }

  .body {
    gap: 16px;
    padding: 16px 20px;
    overflow-y: auto;
  }

  .tiles {
    gap: 12px;
  }

  .tile {
    flex: 1;
    min-height: 150px;
    border-radius: 8px;
    border: 1px solid var(--line);
    color: var(--colours-text-muted);
    background-color: var(--fill);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .tile:hover {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
  }

  .tile.on {
    color: var(--colours-text-strong);
    border-color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 14%, var(--fill));
  }

  .hint {
    margin: 0;
  }

  .apps {
    max-height: 168px;
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--line);
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .apps.dim {
    opacity: 0.4;
  }

  .app,
  .mode {
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--colours-text);
    text-align: start;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .mode {
    min-height: 52px;
  }

  .app:hover,
  .mode:hover {
    background-color: var(--colours-surface-hover);
  }

  .app.faded {
    opacity: 0.5;
  }

  .box {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    border: 1.5px solid var(--colours-outline-strong);
    color: transparent;
    transition:
      background-color 240ms var(--sheet),
      border-color 240ms var(--sheet),
      color 240ms var(--sheet);
  }

  .app.on .box {
    color: white;
    border-color: var(--colours-accent);
    background-color: var(--colours-accent);
  }

  .quality {
    flex: 0 0 260px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background-color: var(--fill);
  }

  .quality h3 {
    padding: 0 10px 6px;
  }

  .dot {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid var(--colours-outline-strong);
    transition:
      border-color 240ms var(--sheet),
      box-shadow 240ms var(--sheet);
  }

  .mode.on .dot {
    border-color: var(--colours-accent);
    box-shadow: inset 0 0 0 4.5px var(--card), inset 0 0 0 10px var(--colours-accent);
  }

  .custom {
    display: grid;
    grid-template-rows: 0fr;
    padding: 0 10px;
    overflow: hidden;
    opacity: 0;
    transition:
      grid-template-rows var(--azure-duration-md) var(--sheet),
      opacity var(--azure-duration-md) var(--sheet),
      padding var(--azure-duration-md) var(--sheet);
  }

  .custom > * {
    min-height: 0;
  }

  .custom.open {
    grid-template-rows: 1fr 1fr;
    padding: 8px 10px 4px;
    opacity: 1;
  }

  .segments {
    padding: 3px;
    gap: 2px;
    border-radius: 7px;
    background-color: color-mix(in oklab, black 30%, var(--card));
  }

  .segment {
    flex: 1;
    min-height: 28px;
    border-radius: 5px;
    color: var(--colours-text-muted);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .segment.on {
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, white 12%, var(--card));
  }

  .empty {
    margin: 0;
    padding: 6px 10px;
  }

  footer {
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    background-color: color-mix(in oklab, black 18%, var(--card));
  }

  .cancel {
    min-height: 38px;
    padding: 0 16px;
    border-radius: 8px;
    color: var(--colours-text);
  }

  .cancel:hover {
    background-color: var(--colours-surface-hover);
  }

  .live {
    min-height: 38px;
    padding: 0 22px;
    border: 0;
    border-radius: 8px;
    color: white;
    background-color: var(--colours-accent);
    transition: filter var(--azure-duration-fast) var(--azure-ease-out);
  }

  .live:hover {
    filter: brightness(1.1);
  }

  @media (max-width: 640px) {
    .body {
      flex-direction: column;
    }

    .quality {
      flex-basis: auto;
    }
  }

  @keyframes share-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes share-pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes share-out {
    to {
      opacity: 0;
      transform: scale(0.97);
    }
  }
</style>
