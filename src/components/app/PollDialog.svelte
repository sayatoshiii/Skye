<script lang="ts">
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import EmojiPicker from "./EmojiPicker.svelte";
  import { tick } from "svelte";
  import { quintOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { useEmoji } from "../../scripts/settings/emoji";
  import { getEmojiURL } from "../../scripts/misc/emoji";
  import { twemojiFile } from "../../scripts/misc/emoji-data";
  import { copied } from "../../scripts/stores/toast";
  import { pollStartContent } from "../../scripts/matrix/utilities/content";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import Poll from "./media/Poll.svelte";

  let { onsubmit, onclose }: { onsubmit: (question: string, answers: string[], disclosed: boolean, multiple: boolean, duration: number) => Promise<unknown>; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "poll", ...path) as string;
  const MAX = 20;
  const HOUR = 3600000;
  const DURATIONS = [
    { key: "never", ms: 0 },
    { key: "hour", ms: HOUR },
    { key: "day", ms: 24 * HOUR },
    { key: "days", ms: 72 * HOUR },
    { key: "week", ms: 168 * HOUR },
  ];
  const SMILE = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 17.5c-2.3 0-4.3-1.4-5.1-3.5h10.2c-.8 2.1-2.8 3.5-5.1 3.5Z";

  let dialog: ConfirmDialog | undefined = $state();
  let question = $state("");
  let options = $state([{ id: 1, value: "" }, { id: 2, value: "" }]);
  let disclosed = $state(true);
  let multiple = $state(false);
  let duration = $state(0);
  let busy = $state(false);
  let picking: { anchor: HTMLElement; field: HTMLInputElement; set: (value: string) => void } | null = $state(null);
  let next = 3;
  const FACES = ["😀", "😄", "😁", "😆", "😊", "😉", "😎", "🤩", "🥳", "😺", "🙂", "🤗"];
  let face = $state(FACES[0]);
  const shuffle = () => (face = FACES[Math.floor(Math.random() * FACES.length)]);

  const filled = $derived(options.map((option) => option.value.trim()).filter(Boolean));
  const ready = $derived(!!question.trim() && filled.length >= 2 && !busy);
  const durationIndex = $derived(DURATIONS.findIndex((item) => item.ms === duration));

  const grow = (_: Element) => ({ duration: 420, css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t};`, easing: quintOut });

  const add = () => options.length < MAX && (options = [...options, { id: next++, value: "" }]);
  const remove = (id: number) => options.length > 2 && (options = options.filter((option) => option.id !== id));

  const create = () => {
    if (!ready) return;
    busy = true;
    onsubmit(question.trim(), filled, disclosed, multiple, duration)
      .then(() => ((busy = false), dialog?.dismiss()))
      .catch(() => (busy = false));
  };

  const pick = (event: MouseEvent, set: (value: string) => void) => {
    const anchor = event.currentTarget as HTMLElement;
    const field = anchor.closest(".field-row")?.querySelector("input");
    picking = field && picking?.anchor !== anchor ? { anchor, field, set } : null;
  };

  const insert = async (unicode: string) => {
    if (!picking) return;
    const { field, set } = picking;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    set(field.value.slice(0, start) + unicode + field.value.slice(end));
    useEmoji(unicode);
    await tick();
    field.focus();
    field.setSelectionRange(start + unicode.length, start + unicode.length);
  };

  const emojiMenu = (node: HTMLElement, set: (value: string) => void) =>
    menu(node, () => [{ id: "poll-emoji", label: text("add_emoji"), icon: SMILE, run: () => pick({ currentTarget: node } as unknown as MouseEvent, set) }]);

  const preview = $derived({
    event_id: "~preview",
    type: "org.matrix.msc3381.poll.start",
    sender: "",
    origin_server_ts: 0,
    content: pollStartContent(question.trim() || text("question_hint"), options.map((option, index) => option.value.trim() || text("option_hint").replace("{number}", String(index + 1))), multiple ? options.length : 1, disclosed, duration ? Date.now() + duration : undefined),
  } as unknown as TimelineEvent);

  const optionItems = (id: number, value: string) => [
    { id: "poll-option-copy", label: entityText("copy"), icon: MENU_ICONS.copy, disabled: !value.trim(), run: () => copied(value) },
    { id: "poll-option-add", label: text("add_option"), icon: MENU_ICONS.add, disabled: options.length >= MAX, run: add },
    { id: "poll-option-remove", label: text("remove_option"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: options.length <= 2, run: () => remove(id) },
  ];

  const kindItems = () => [
    { id: "poll-kind-open", label: text("kind_open"), icon: MENU_ICONS.show, run: () => (disclosed = true) },
    { id: "poll-kind-hidden", label: text("kind_hidden"), icon: MENU_ICONS.hide, run: () => (disclosed = false) },
  ];

  const durationItems = () => DURATIONS.map((item) => ({ id: `poll-duration-${item.key}`, label: text(`duration_${item.key}`), icon: MENU_ICONS.retry, selected: item.ms === duration, run: () => (duration = item.ms) }));
</script>

{#snippet emojiButton(set: (value: string) => void)}
  <button type="button" class="emoji ghost press" class:open={!!picking} aria-label={text("add_emoji")} aria-haspopup="dialog" onmouseenter={shuffle} onclick={(event) => pick(event, set)} use:emojiMenu={set}>
    <img src={getEmojiURL(twemojiFile(face))} alt="" width="20" height="20" draggable="false" />
  </button>
{/snippet}

<ConfirmDialog bind:this={dialog} title={text("create")} cancelLabel={text("cancel")} tone="primary" {busy} {onclose}>
  <div class="layout">
  <form class="poll-form set-surface col" onsubmit={(event) => (event.preventDefault(), create())}>
    <div class="col gap-sm">
      <span class="set-label">{text("question")}</span>
      <span class="field-row row-nw align-centre gap-xs">
      <span class="set-input flex-max min-0" use:menu={() => [{ id: "poll-question-copy", label: entityText("copy_question"), icon: MENU_ICONS.copy, disabled: !question.trim(), run: () => copied(question) }]}>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" maxlength="300" autofocus aria-label={text("question")} placeholder={text("question_hint")} bind:value={question} />
        {@render emojiButton((value) => (question = value))}
      </span>
      <span class="spacer" aria-hidden="true"></span>
      </span>
    </div>
    <div class="col gap-sm">
      <span class="set-label">{text("options")}</span>
      <ul class="options col">
        {#each options as option, index (option.id)}
          <li class="option" transition:grow use:menu={() => optionItems(option.id, option.value)}>
            <div class="clip">
              <span class="field-row row-nw align-centre gap-xs">
              <span class="set-input flex-max min-0">
                <input type="text" maxlength="200" placeholder={text("option_hint").replace("{number}", String(index + 1))} aria-label={text("option_hint").replace("{number}", String(index + 1))} bind:value={option.value} />
                {@render emojiButton((value) => (option.value = value))}
              </span>
                <button type="button" class="remove ghost press" class:hidden={options.length <= 2} aria-label={text("remove_option")} disabled={options.length <= 2} onclick={() => remove(option.id)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
                </button>
              </span>
            </div>
          </li>
        {/each}
      </ul>
      <button type="button" class="add ghost row-nw align-centre gap-xs sm bold" disabled={options.length >= MAX} onclick={add} use:menu={() => [{ id: "poll-add", label: text("add_option"), icon: MENU_ICONS.add, disabled: options.length >= MAX, run: add }]}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.add} /></svg>
        {text("add_option")}
      </button>
    </div>
    <div class="set-rows">
      <div class="set-row" use:menu={kindItems}>
        <div class="col gap-xs min-0">
          <span class="set-title">{text("kind")}</span>
          <span class="hints">
            <p class="set-hint" class:shown={disclosed} aria-hidden={!disclosed}>{text("kind_open_hint")}</p>
            <p class="set-hint" class:shown={!disclosed} aria-hidden={disclosed}>{text("kind_hidden_hint")}</p>
          </span>
        </div>
        <div class="set-choice kinds row-nw" class:hidden-kind={!disclosed} role="radiogroup" aria-label={text("kind")} style:--index={disclosed ? 0 : 1}>
          <span class="set-thumb" aria-hidden="true"></span>
          <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={disclosed} onclick={() => (disclosed = true)}>{text("kind_open")}</button>
          <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={!disclosed} onclick={() => (disclosed = false)}>{text("kind_hidden")}</button>
        </div>
      </div>
      <div class="col gap-sm" use:menu={durationItems}>
        <span class="set-title">{text("duration")}</span>
        <div class="set-choice durations row-nw" role="radiogroup" aria-label={text("duration")} style:--index={durationIndex} style:--count={DURATIONS.length}>
          <span class="set-thumb" aria-hidden="true"></span>
          {#each DURATIONS as item (item.key)}
            <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={item.ms === duration} onclick={() => (duration = item.ms)}>{text(`duration_${item.key}`)}</button>
          {/each}
        </div>
      </div>
      <div class="set-row" use:menu={() => [{ id: "poll-multiple", label: text(multiple ? "single" : "multiple"), icon: MENU_ICONS.select, run: () => (multiple = !multiple) }]}>
        <span class="set-title">{text("multiple")}</span>
        <Toggle checked={multiple} label={text("multiple")} onchange={(value) => (multiple = value)} />
      </div>
    </div>
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
  <div class="preview col gap-sm" inert>
    <span class="set-label">{text("preview")}</span>
    <Poll event={preview} related={[]} mayEnd={() => false} />
  </div>
  </div>
  {#snippet actions()}
    <button type="button" class="dialog-button ghost press sm bold primary" disabled={!ready} onclick={create} use:menu={() => [{ id: "poll-create", label: text("create_action"), icon: MENU_ICONS.poll, disabled: !ready, run: create }]}>{text(busy ? "creating" : "create_action")}</button>
  {/snippet}
</ConfirmDialog>

{#if picking}
  {#key picking.anchor}
    <EmojiPicker anchor={picking.anchor} oninsert={insert} onclose={() => (picking = null)} />
  {/key}
{/if}

<style>
  :global(.confirm:has(.poll-form)) {
    width: min(100%, 820px);
    max-height: calc(100dvh - 2 * var(--azure-spacing-lg));
    overflow-y: auto;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
    gap: var(--azure-spacing-xl);
    align-items: start;
  }

  .poll-form {
    gap: var(--azure-spacing-xl);
  }

  .preview {
    position: sticky;
    top: 0;
    pointer-events: none;
  }

  .options {
    max-height: 40vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .option {
    display: grid;
    grid-template-rows: 1fr;
  }

  .clip {
    min-height: 0;
    overflow: hidden;
  }

  .clip > .field-row {
    margin-bottom: var(--azure-spacing-sm);
  }

  .hints {
    display: grid;
  }

  .hints > p {
    grid-area: 1 / 1;
    opacity: 0;
    filter: blur(2px);
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      filter 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .hints > p.shown {
    opacity: 1;
    filter: none;
  }

  .emoji {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: -6px;
  }

  .emoji img {
    width: 20px;
    height: 20px;
    filter: grayscale(1) brightness(1.6);
    opacity: 0.45;
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .emoji:is(:hover, .open) img {
    filter: none;
    opacity: 1;
    transform: scale(1.14);
  }

  .remove,
  .spacer {
    flex: none;
    width: 32px;
    height: 32px;
  }

  .remove {
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--colours-text-faint);
    transition:
      opacity 320ms cubic-bezier(0.32, 0.72, 0, 1),
      color 320ms cubic-bezier(0.32, 0.72, 0, 1),
      background-color 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .remove:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .remove.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .add {
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--colours-accent);
    transition:
      opacity 320ms cubic-bezier(0.32, 0.72, 0, 1),
      filter 320ms cubic-bezier(0.32, 0.72, 0, 1),
      transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .add:hover:not(:disabled) {
    filter: brightness(1.25);
  }

  .add:active:not(:disabled) {
    opacity: 0.7;
    transform: scale(0.97);
  }

  .add:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .kinds {
    --tone: var(--colours-success);
    flex: none;
  }

  .kinds.hidden-kind {
    --tone: var(--colours-danger);
  }

  .kinds .set-thumb {
    background-color: color-mix(in oklab, var(--tone) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tone) 45%, transparent);
    transition:
      transform var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1),
      background-color var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .kinds .set-choice-option {
    transition: color var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .kinds .set-choice-option[aria-checked="true"] {
    color: var(--tone);
  }

  .durations .set-thumb {
    background-color: color-mix(in oklab, var(--colours-accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--colours-accent) 45%, transparent);
  }

  .durations .set-choice-option {
    transition: color var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .durations .set-choice-option[aria-checked="true"] {
    color: var(--colours-accent);
  }

  @media (max-width: 767px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .preview {
      position: static;
    }

  }
</style>
