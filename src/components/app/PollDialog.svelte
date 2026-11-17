<script lang="ts">
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import { quintOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";

  let { onsubmit, onclose }: { onsubmit: (question: string, answers: string[], disclosed: boolean, multiple: boolean) => Promise<unknown>; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "poll", ...path) as string;
  const MAX = 20;

  let dialog: ConfirmDialog | undefined = $state();
  let question = $state("");
  let options = $state([{ id: 1, value: "" }, { id: 2, value: "" }]);
  let disclosed = $state(true);
  let multiple = $state(false);
  let busy = $state(false);
  let next = 3;

  const filled = $derived(options.map((option) => option.value.trim()).filter(Boolean));
  const ready = $derived(!!question.trim() && filled.length >= 2 && !busy);

  const grow = (_: Element) => ({ duration: 420, css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t};`, easing: quintOut });

  const add = () => options.length < MAX && (options = [...options, { id: next++, value: "" }]);
  const remove = (id: number) => options.length > 2 && (options = options.filter((option) => option.id !== id));

  const create = () => {
    if (!ready) return;
    busy = true;
    onsubmit(question.trim(), filled, disclosed, multiple)
      .then(() => ((busy = false), dialog?.dismiss()))
      .catch(() => (busy = false));
  };

  const optionItems = (id: number, value: string) => [
    { id: "poll-option-copy", label: entityText("copy"), icon: MENU_ICONS.copy, disabled: !value.trim(), run: () => copied(value) },
    { id: "poll-option-add", label: text("add_option"), icon: MENU_ICONS.add, disabled: options.length >= MAX, run: add },
    { id: "poll-option-remove", label: text("remove_option"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: options.length <= 2, run: () => remove(id) },
  ];

  const kindItems = () => [
    { id: "poll-kind-open", label: text("kind_open"), icon: MENU_ICONS.show, run: () => (disclosed = true) },
    { id: "poll-kind-hidden", label: text("kind_hidden"), icon: MENU_ICONS.hide, run: () => (disclosed = false) },
  ];
</script>

<ConfirmDialog bind:this={dialog} title={text("create")} cancelLabel={text("cancel")} tone="primary" {busy} {onclose}>
  <form class="poll-form set-surface col" onsubmit={(event) => (event.preventDefault(), create())}>
    <div class="col gap-sm">
      <span class="set-label">{text("question")}</span>
      <span class="set-input" use:menu={() => [{ id: "poll-question-copy", label: entityText("copy_question"), icon: MENU_ICONS.copy, disabled: !question.trim(), run: () => copied(question) }]}>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" maxlength="300" autofocus aria-label={text("question")} placeholder={text("question_hint")} bind:value={question} />
      </span>
    </div>
    <div class="col gap-sm">
      <span class="set-label">{text("options")}</span>
      <ul class="options col">
        {#each options as option, index (option.id)}
          <li class="option" transition:grow use:menu={() => optionItems(option.id, option.value)}>
            <div class="clip">
              <span class="set-input min-0">
              <input type="text" maxlength="200" placeholder={text("option_hint").replace("{number}", String(index + 1))} aria-label={text("option_hint").replace("{number}", String(index + 1))} bind:value={option.value} />
              <button type="button" class="remove ghost press" class:hidden={options.length <= 2} aria-label={text("remove_option")} disabled={options.length <= 2} onclick={() => remove(option.id)}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
              </button>
            </span>
            </div>
          </li>
        {/each}
      </ul>
      <button type="button" class="set-button ghost press add" disabled={options.length >= MAX} onclick={add} use:menu={() => [{ id: "poll-add", label: text("add_option"), icon: MENU_ICONS.add, disabled: options.length >= MAX, run: add }]}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.add} /></svg>
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
        <div class="set-choice row-nw" role="radiogroup" aria-label={text("kind")} style:--index={disclosed ? 0 : 1}>
          <span class="set-thumb" aria-hidden="true"></span>
          <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={disclosed} onclick={() => (disclosed = true)}>{text("kind_open")}</button>
          <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={!disclosed} onclick={() => (disclosed = false)}>{text("kind_hidden")}</button>
        </div>
      </div>
      <div class="set-row" use:menu={() => [{ id: "poll-multiple", label: text(multiple ? "single" : "multiple"), icon: MENU_ICONS.select, run: () => (multiple = !multiple) }]}>
        <span class="set-title">{text("multiple")}</span>
        <Toggle checked={multiple} label={text("multiple")} onchange={(value) => (multiple = value)} />
      </div>
    </div>
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
  {#snippet actions()}
    <button type="button" class="dialog-button ghost press sm bold primary" disabled={!ready} onclick={create}>{text(busy ? "creating" : "create_action")}</button>
  {/snippet}
</ConfirmDialog>

<style>
  .poll-form {
    gap: var(--azure-spacing-xl);
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

  .clip {
    min-height: 0;
    overflow: hidden;
  }

  .clip > .set-input {
    margin-bottom: var(--azure-spacing-sm);
  }

  .remove {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    margin-right: -6px;
    border-radius: 6px;
    color: var(--colours-text-faint);
    transition: opacity 320ms cubic-bezier(0.32, 0.72, 0, 1);
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
    background-color: color-mix(in oklab, white 5%, transparent);
  }

</style>
