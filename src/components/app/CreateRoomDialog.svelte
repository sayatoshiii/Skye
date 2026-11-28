<script lang="ts">
  import { flip } from "svelte/animate";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { createRoomIn, type RoomHistory } from "../../scripts/matrix/utilities/creation";
  import { sourceOf, syncEnabled, syncRoom } from "../../scripts/matrix/utilities/rolesync";
  import { MENU_ICONS, ROOM_ICONS } from "../../scripts/misc/icons";
  import { haze, roll } from "../../scripts/misc/haze";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { ROOM_KINDS, ROOM_KINDS_FOLDED, accessOf, powerOverrides, presetOf, type RoomAccess, type RoomKind, type RoomPreset } from "../../scripts/settings/rooms";
  import { rooms, session, spaces } from "../../scripts/stores/matrix";
  import { toEntity } from "../../scripts/stores/entities";
  import { getSpaceRoomIds, navigation, openRoom } from "../../scripts/stores/navigation.svelte";
  import { fluid } from "../auth/motion";
  import { SETTINGS_ICONS } from "../settings/icons";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import MorphText from "../ui/MorphText.svelte";
  import Toggle from "../ui/Toggle.svelte";

  let { parentId, onclose }: { parentId: string; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "create_room", ...path) as string;

  const parent = $derived($rooms[parentId]);
  const parentName = $derived(parent ? toEntity(parent, $session?.userId).name : "");

  let kind = $state<RoomKind>(ROOM_KINDS[0]);
  let access = $state(accessOf(ROOM_KINDS[0], ROOM_KINDS[0].presets[0]));
  let expanded = $state(false);
  let name = $state("");
  const HISTORY: RoomHistory[] = ["shared", "invited", "joined"];

  const sealed = $rooms[parentId]?.state["m.room.join_rules"]?.[""]?.content?.join_rule !== "public";

  let hidden = $state(false);
  let encrypted = $state(sealed);
  let history = $state<RoomHistory>("shared");
  let panel = $state<"access" | "advanced" | null>(null);
  let picker = $state<{ x: number; y: number; width: number } | null>(null);
  let extras = $state(0);
  let busy = $state(false);
  let failed = $state(false);
  let grid = $state(0);
  let toggles = $state(0);
  let settled = $state(false);

  requestAnimationFrame(() => requestAnimationFrame(() => (settled = true)));

  const PRESET_ICONS: Record<string, string> = {
    general: MENU_ICONS.message,
    announcements: "M4.5 10a2 2 0 0 1 2-2h3l9-4.5a1 1 0 0 1 1.45.9v15.2a1 1 0 0 1-1.45.9L9.5 16h-1v3a1 1 0 1 1-2 0v-3a2 2 0 0 1-2-2v-4Z",
    readonly: SETTINGS_ICONS.privacy,
    open: SETTINGS_ICONS.headphones,
    listen: SETTINGS_ICONS.speaker,
  };

  const preset = $derived(presetOf(kind, access));
  const presetItems = $derived<MenuItem[]>(kind.presets.map((item) => ({ id: item.id, label: text("presets", item.id, "name"), icon: PRESET_ICONS[item.id], selected: preset?.id === item.id, run: () => apply(item) })));
  const shown = $derived(expanded ? ROOM_KINDS : ROOM_KINDS.slice(0, ROOM_KINDS_FOLDED));
  const slug = $derived(name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, ""));

  const exit = dismissible(() => onclose());
  const close = () => !busy && exit.close();

  const choose = (next: RoomKind) => next.ready && next.id !== kind.id && ((kind = next), (access = accessOf(next, next.presets[0])));
  const apply = (next: RoomPreset) => (access = accessOf(kind, next));
  const adjust = (key: RoomAccess, value: boolean) => (access = { ...access, [key]: value });
  const reveal = (next: "access" | "advanced") => (panel = panel === next ? null : next);
  const pick = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    picker = { x: rect.left, y: rect.bottom + 6, width: rect.width };
  };
  const conceal = (value: boolean) => ((hidden = value), (encrypted = value || sealed), (history = value ? "joined" : "shared"));

  const listed = (roomId: string) =>
    new Promise<void>((resolve) => {
      let stop: (() => void) | undefined;
      const done = () => (clearTimeout(timer), queueMicrotask(() => stop?.()), resolve());
      const timer = setTimeout(done, 15000);
      stop = spaces.subscribe((trees) => trees.some((tree) => getSpaceRoomIds(tree).includes(roomId)) && $rooms[roomId]?.membership === "join" && done());
    });

  const create = async () => {
    if (!$session || !slug || busy) return;
    busy = true;
    failed = false;
    try {
      const roomId = await createRoomIn($session, {
        parentId,
        name: slug,
        type: kind.type,
        power: powerOverrides(access),
        hidden,
        encrypted,
        history,
      });
      await listed(roomId);
      const space = $rooms[parentId];
      space && syncEnabled(space) && $rooms[roomId] && void syncRoom($session, sourceOf(space), $rooms[roomId]).catch(() => undefined);
      openRoom(navigation.spaceId, roomId);
      busy = false;
      exit.close();
    } catch {
      busy = false;
      failed = true;
    }
  };
</script>

{#snippet glyph(entry: RoomKind, size: number)}
  {#if entry.id === "text"}
    <span class="hash" style:font-size="{size}px" aria-hidden="true">#</span>
  {:else}
    <Icon d={ROOM_ICONS[entry.id]} {size} />
  {/if}
{/snippet}

<span class="portal-anchor" hidden></span>
<div class="layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim modal-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="dialog modal-sheet col" class:settled onanimationend={exit.onanimationend} inert={exit.closing} role="dialog" aria-modal="true" aria-labelledby="create-room-title" aria-busy={busy} tabindex="-1" onkeydown={(event) => event.key === "Escape" && close()}>
    <header class="head row-nw align-start gap-md">
      <div class="col gap-xs flex-max min-0">
        <h3 id="create-room-title" class="xl bold">{text("title")}</h3>
        <p class="sm faint truncate">{text("in").replace("{name}", parentName)}</p>
      </div>
      <Button variant="quiet" class="close" icon={SETTINGS_ICONS.close} aria-label={text("close")} onclick={close} />
    </header>

    <div class="body col gap-lg">
      <section class="col gap-sm">
        <span class="label bold">{text("type")}</span>
        <div class="fold" style:height="{grid}px">
          <div class="kinds" bind:offsetHeight={grid}>
            {#each shown as entry (entry.id)}
              <button type="button" class="kind ghost press col gap-xs" class:selected={kind.id === entry.id} class:soon={!entry.ready} aria-pressed={kind.id === entry.id} aria-disabled={!entry.ready} animate:flip={{ duration: 340, easing: fluid }} in:haze onclick={() => choose(entry)}>
                <span class="row-nw align-centre gap-sm">
                  <span class="glyph row-nw centre">{@render glyph(entry, 20)}</span>
                  {#if !entry.ready}<span class="badge xs bold">{text("soon")}</span>{/if}
                </span>
                <span class="sm bold">{text("kinds", entry.id, "name")}</span>
                <span class="xs faint">{text("kinds", entry.id, "hint")}</span>
              </button>
            {/each}
            {#if ROOM_KINDS.length > ROOM_KINDS_FOLDED}
            <button type="button" class="kind more ghost press col centre gap-xs" onclick={() => (expanded = !expanded)}>
              {#key expanded}
                <span class="glyph plain row-nw centre haze"><Icon d={ROOM_ICONS[expanded ? "less" : "more"]} size={20} /></span>
              {/key}
              <MorphText class="sm bold" text={expanded ? text("less") : text("more").replace("{count}", String(ROOM_KINDS.length - ROOM_KINDS_FOLDED))} />
            </button>
            {/if}
          </div>
        </div>
      </section>

      <section class="col gap-sm">
        <span class="label bold">{text("preset")}</span>
        <button type="button" class="select ghost press row-nw align-centre gap-md" class:open={!!picker} aria-haspopup="menu" aria-expanded={!!picker} onclick={pick}>
          <span class="select-icon row-nw centre"><Icon d={preset ? PRESET_ICONS[preset.id] : MENU_ICONS.settings} size={18} /></span>
          <span class="col flex-max min-0">
            <MorphText class="md" text={preset ? text("presets", preset.id, "name") : text("custom")} />
            <span class="sm faint truncate">{preset ? text("presets", preset.id, "hint") : text("custom_hint")}</span>
          </span>
          <Icon class="caret" d={ROOM_ICONS.chevron} size={18} />
        </button>
        <button type="button" class="customise ghost press row-nw align-centre gap-xs sm" aria-expanded={panel === "access"} onclick={() => reveal("access")}>
          <Icon class={["chevron", { open: panel === "access" }]} d={ROOM_ICONS.chevron} size={14} />
          {text("customise")}
        </button>
        <div class="fold" style:height="{panel === "access" ? toggles : 0}px" inert={panel !== "access"}>
          <div class="access col" class:shut={panel !== "access"} bind:offsetHeight={toggles}>
            {#each kind.access as key (key)}
              <div class="access-row row-nw align-centre gap-md">
                <span class="sm flex-max">{text("access", key)}</span>
                <Toggle checked={access[key]} label={text("access", key)} onchange={(value) => adjust(key, value)} />
              </div>
            {/each}
          </div>
        </div>
      </section>

      <section class="col gap-sm">
        <label class="label bold" for="create-room-name">{text("name")}</label>
        <label class="field row-nw align-centre gap-sm">
          <span class="faint roll-slot">
            {#key kind.id}<span class="row-nw centre" in:roll={{ y: -16 }} out:roll>{@render glyph(kind, 16)}</span>{/key}
          </span>
          <input id="create-room-name" class="md flex-max" placeholder={text("placeholder")} autocomplete="off" spellcheck="false" bind:value={name} onkeydown={(event) => event.key === "Enter" && create()} />
        </label>
      </section>

      <div class="row-nw align-centre gap-lg">
        <div class="col gap-xs flex-max">
          <span class="md row-nw align-centre gap-xs">
            <Icon d={SETTINGS_ICONS.privacy} size={14} />
            {text("private")}
          </span>
          <span class="sm faint">{text("private_hint")}</span>
        </div>
        <Toggle checked={hidden} label={text("private")} onchange={conceal} />
      </div>

      <section class="col gap-sm">
        <button type="button" class="customise ghost press row-nw align-centre gap-xs sm" aria-expanded={panel === "advanced"} onclick={() => reveal("advanced")}>
          <Icon class={["chevron", { open: panel === "advanced" }]} d={ROOM_ICONS.chevron} size={14} />
          {text("advanced")}
        </button>
        <div class="fold" style:height="{panel === "advanced" ? extras : 0}px" inert={panel !== "advanced"}>
          <div class="access col" class:shut={panel !== "advanced"} bind:offsetHeight={extras}>
            <div class="access-row row-nw align-centre gap-md">
              <span class="col flex-max">
                <span class="sm">{text("encryption")}</span>
                <span class="xs faint">{text("encryption_hint")}</span>
              </span>
              <Toggle checked={encrypted} label={text("encryption")} onchange={(value) => (encrypted = value)} />
            </div>
            <div class="access-row col gap-sm">
              <span class="sm">{text("history")}</span>
              <div class="set-choice row-nw" role="radiogroup" aria-label={text("history")} style:--index={HISTORY.indexOf(history)} style:--count={HISTORY.length}>
                <span class="set-thumb" aria-hidden="true"></span>
                {#each HISTORY as option (option)}
                  <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={history === option} onclick={() => (history = option)}>{text("histories", option)}</button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </section>

      {#if failed}<p class="sm danger" in:haze>{text("failed")}</p>{/if}
    </div>

    <footer class="actions">
      <Button large disabled={busy} onclick={close}>{text("cancel")}</Button>
      <Button large variant="primary" disabled={!slug || busy} onclick={create}>{text(busy ? "creating" : "create")}</Button>
    </footer>
  </div>
</div>
<span class="portal-anchor" hidden></span>

{#if picker}
  <MessageMenu items={presetItems} x={picker.x} y={picker.y} minWidth={picker.width} label={text("preset")} onclose={() => (picker = null)} />
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
    padding: var(--azure-spacing-lg);
  }

  .scrim {
    position: absolute;
    inset: 0;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
  }

  .dialog {
    position: relative;
    width: min(100%, 480px);
    max-height: calc(100dvh - 2 * var(--azure-spacing-lg));
    overflow: hidden;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
  }

  h3, p {
    margin: 0;
  }

  h3, .kind .bold, .field input {
    color: var(--colours-text-strong);
  }

  .head {
    flex: none;
    padding: var(--azure-spacing-xl) calc(var(--azure-spacing-xl) + 4px) var(--azure-spacing-lg);
  }

  .body {
    min-height: 0;
    padding: 0 calc(var(--azure-spacing-xl) + 4px);
    overflow-y: auto;
    scrollbar-width: none;
  }

  .label {
    font-size: var(--text-md);
  }

  .fold {
    margin: -4px;
    padding: 4px;
    overflow: hidden;
    box-sizing: content-box;
  }

  .settled .fold {
    transition: height 340ms var(--azure-ease-fluid);
  }

  .kinds {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--azure-spacing-sm);
  }

  .kind {
    min-height: 104px;
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-background);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    text-align: left;
    transition:
      background-color var(--azure-duration-md) var(--azure-ease-fluid),
      box-shadow var(--azure-duration-md) var(--azure-ease-fluid),
      scale var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .kind:hover {
    background-color: var(--colours-surface);
  }

  .kind:active:not(.soon) {
    scale: var(--press, 0.97);
  }

  .kind.selected {
    background-color: var(--colours-accent-faint);
    box-shadow: inset 0 0 0 1px var(--colours-accent);
  }

  .kind.soon {
    cursor: default;
  }

  .kind.soon > * {
    opacity: 0.45;
  }

  .kind.soon .badge {
    opacity: 1;
  }

  .kind.more {
    text-align: center;
    color: var(--colours-text-muted);
    background-color: transparent;
  }

  .kind.more:hover {
    color: var(--colours-text-strong);
  }

  .glyph {
    width: 34px;
    height: 34px;
    margin-bottom: var(--azure-spacing-xs);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .glyph.plain {
    color: inherit;
    background-color: transparent;
  }

  .badge {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-text-muted);
    background-color: var(--colours-surface-raised);
  }

  .hash {
    width: 1em;
    font-weight: 500;
    line-height: 1;
    text-align: center;
  }

  .select {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md) var(--azure-spacing-sm) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-background);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    text-align: left;
    transition:
      background-color var(--azure-duration-md) var(--azure-ease-fluid),
      box-shadow var(--azure-duration-md) var(--azure-ease-fluid),
      scale var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .select:hover,
  .select.open {
    background-color: var(--colours-surface);
  }

  .select :global(.md) {
    color: var(--colours-text-strong);
  }

  .select-icon {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .select :global(.caret) {
    flex: none;
    color: var(--colours-text-muted);
    rotate: 90deg;
    transition: rotate 340ms var(--azure-ease-fluid);
  }

  .select.open :global(.caret) {
    rotate: -90deg;
  }

  .customise {
    align-self: flex-start;
    margin-left: calc(var(--azure-spacing-xs) * -1);
    padding: var(--azure-spacing-xs);
    color: var(--colours-text-muted);
  }

  .customise:hover {
    color: var(--colours-text-strong);
  }

  .customise :global(.chevron) {
    transition: rotate 340ms var(--azure-ease-fluid);
  }

  .customise :global(.chevron.open) {
    rotate: 90deg;
  }

  .access {
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-background);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    transition:
      opacity 340ms var(--azure-ease-fluid),
      filter 340ms var(--azure-ease-fluid);
  }

  .access.shut {
    opacity: 0;
    filter: blur(6px);
  }

  .access-row {
    padding: var(--azure-spacing-md);
  }

  .access-row + .access-row {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .field {
    height: 42px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-background);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    cursor: text;
  }

  .field input {
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    outline: none;
  }

  .field input::placeholder {
    color: var(--colours-text-faint);
  }

  .danger {
    color: var(--colours-danger);
  }

  .head :global(.close) {
    margin: -4px -8px 0 0;
  }

  .actions {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--azure-spacing-md);
    padding: var(--azure-spacing-lg) calc(var(--azure-spacing-xl) + 4px) var(--azure-spacing-xl);
  }

  .dialog :focus-visible {
    outline: none;
  }

  @media (max-width: 767px) {
    .layer {
      justify-content: flex-end;
      padding: 0;
    }

    .dialog {
      width: 100%;
      max-height: 92dvh;
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }

    .actions {
      padding-bottom: calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
    }

  }
</style>
