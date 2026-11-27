<script lang="ts">
  import { haze } from "../../scripts/misc/haze";
  import { fly, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { tick, untrack } from "svelte";
  import { portal } from "../../scripts/misc/portal";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { HAS_TYPES, emptyFilters, type DateRule, type SearchFilters } from "../../scripts/matrix/search";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { SETTINGS_ICONS } from "../settings/icons";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "./MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import type { SearchMember } from "./SearchField.svelte";

  let {
    filters,
    members,
    onapply,
    onclose,
  }: {
    filters: SearchFilters;
    members: SearchMember[];
    onapply: (filters: SearchFilters) => void;
    onclose: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const ease = (t: number) => cubicOut(t);
  const exit = dismissible(() => onclose());

  type Kind = "senders" | "has" | "mentions";
  type Choice = { id: string; label: string; sub?: string; avatar?: SearchMember; icon?: string };

  let draft: SearchFilters = $state(untrack(() => structuredClone($state.snapshot(filters)) as SearchFilters));
  let opened: Kind | null = $state(null);
  let filter = $state("");
  let upward = $state(false);
  let body: HTMLElement | undefined = $state();
  let spot = $state({ left: 0, width: 0, top: 0, bottom: 0, room: 240 });
  const place = (node: HTMLElement) => {
    const box = (node.closest(".combo-head") ?? node).getBoundingClientRect();
    const below = innerHeight - box.bottom - 12;
    const above = box.top - 12;
    upward = below < 220 && above > below;
    spot = { left: box.left, width: box.width, top: box.bottom + 6, bottom: innerHeight - box.top + 6, room: Math.max(120, Math.min(280, (upward ? above : below) - 14)) };
  };
  let panel: HTMLElement | undefined = $state();

  const HAS_ICON: Record<string, string> = { link: MENU_ICONS.link, embed: MENU_ICONS.open, image: MENU_ICONS.image, video: SETTINGS_ICONS.image, file: MENU_ICONS.save };
  const memberChoices = $derived(members.map((member) => ({ id: member.id, label: member.name, sub: member.id, avatar: member })));
  const hasChoices: Choice[] = HAS_TYPES.map((type) => ({ id: type, label: text("chat", `search_has_${type}`), icon: HAS_ICON[type] }));
  const choicesOf = (kind: Kind): Choice[] => (kind === "has" ? hasChoices : memberChoices);
  const visible = (kind: Kind) => choicesOf(kind).filter((choice) => `${choice.label} ${choice.sub ?? ""}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);
  const picked = (kind: Kind) => draft[kind] as string[];
  const toggle = (kind: Kind, id: string) => ((draft[kind] as string[]) = picked(kind).includes(id) ? picked(kind).filter((value) => value !== id) : [...picked(kind), id]);
  const summary = (kind: Kind) => picked(kind).map((id) => choicesOf(kind).find((choice) => choice.id === id)?.label ?? id).join(", ");
  const toggleOpen = (kind: Kind) => ((filter = ""), (opened = opened === kind ? null : kind));

  const SECTIONS: { kind: Kind; title: string; description: string }[] = [
    { kind: "senders", title: text("chat", "search_section_from"), description: text("chat", "search_section_from_hint") },
    { kind: "has", title: text("chat", "search_section_has"), description: text("chat", "search_section_has_hint") },
    { kind: "mentions", title: text("chat", "search_section_mentions"), description: text("chat", "search_section_mentions_hint") },
  ];

  const today = () => new Date().toISOString().slice(0, 10);
  const addDate = () => (draft.dates = [...draft.dates, { kind: "after", date: today() }]);
  const removeDate = (index: number) => (draft.dates = draft.dates.filter((_, at) => at !== index));

  const close = () => exit.close();
  const commit = () => (onapply($state.snapshot(draft) as SearchFilters), close());
  const reset = () => (draft = emptyFilters());

  $effect(() => {
    tick().then(() => panel?.focus({ preventScroll: true }));
  });

  const onkeydown = (event: KeyboardEvent) => event.key === "Escape" && (event.preventDefault(), event.stopPropagation(), opened ? (opened = null) : close());

  const choiceItems = (kind: Kind, choice: Choice): MenuItem[] => [
    { id: "choice-toggle", label: text("chat", picked(kind).includes(choice.id) ? "search_deselect" : "search_select"), icon: MENU_ICONS.read, run: () => toggle(kind, choice.id) },
    ...(choice.sub ? [{ id: "choice-copy", label: text("chat", "search_copy_user"), icon: MENU_ICONS.id, run: () => copied(choice.sub!) }] : []),
  ];
  const dateItems = (index: number): MenuItem[] => [{ id: "date-remove", label: text("chat", "search_remove_filter"), icon: MENU_ICONS.close, danger: true, run: () => removeDate(index) }];
  const footerItems = (): MenuItem[] => [
    { id: "filters-apply", label: text("chat", "search_apply"), icon: MENU_ICONS.read, run: commit },
    { id: "filters-clear", label: text("chat", "search_clear_filters"), icon: MENU_ICONS.close, danger: true, separated: true, run: reset },
  ];
</script>

<span class="portal-anchor" hidden></span>
<div class="layer row centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="modal col" role="dialog" aria-modal="true" aria-labelledby="search-filters-title" tabindex="-1" bind:this={panel} inert={exit.closing} onanimationend={exit.onanimationend} {onkeydown}>
    <header class="head row-nw align-centre">
      <h3 id="search-filters-title" class="lg bold flex-max">{text("chat", "search_filters")}</h3>
      <button type="button" class="icon-button ghost press" aria-label={text("chat", "close")} onclick={close}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="body col gap-lg" bind:this={body} onscroll={() => (opened = null)}>
      {#each SECTIONS as section (section.kind)}
        <section class="col gap-xs">
          <h4 class="md bold">{section.title}</h4>
          <p class="sm muted">{section.description}</p>
          <div class="combo" class:open={opened === section.kind} onfocusout={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && opened === section.kind && (opened = null)}>
            <div class="combo-head row-nw align-centre gap-sm sm">
              <input
                class="combo-input flex-max min-0"
                type="text"
                value={opened === section.kind ? filter : ""}
                placeholder={picked(section.kind).length ? summary(section.kind) : text("chat", "search_choose")}
                class:chosen={picked(section.kind).length > 0}
                aria-label={section.title}
                aria-expanded={opened === section.kind}
                onclick={(event) => (place(event.currentTarget), toggleOpen(section.kind))}
                oninput={(event) => (opened !== section.kind && (place(event.currentTarget), (opened = section.kind), (filter = "")), (filter = event.currentTarget.value))}
                onkeydown={(event) => event.key === "Escape" && opened === section.kind && (event.stopPropagation(), (opened = null))}
              />
              <button type="button" class="ghost chevron-button" tabindex="-1" aria-hidden="true" onmousedown={(event) => event.preventDefault()} onclick={(event) => (place(event.currentTarget), toggleOpen(section.kind), event.currentTarget.parentElement?.querySelector("input")?.focus())}>
                <svg class="chevron" class:flipped={opened === section.kind} viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d={MENU_ICONS.expand} /></svg>
              </button>
            </div>
            {#if opened === section.kind}
              <div class="combo-list col" class:upward style:left="{spot.left}px" style:width="{spot.width}px" style:top={upward ? "auto" : `${spot.top}px`} style:bottom={upward ? `${spot.bottom}px` : "auto"} style:--room="{spot.room}px" in:fly={{ y: upward ? 4 : -4, duration: 200, easing: ease, opacity: 0 }} out:fly={{ y: upward ? 4 : -4, duration: 140, easing: ease, opacity: 0 }}>
                <ul class="col" role="listbox" aria-multiselectable="true">
                  {#each visible(section.kind) as choice (choice.id)}
                    {@const on = picked(section.kind).includes(choice.id)}
                    <li animate:flip={{ duration: 240, easing: ease }} in:haze={{ duration: 160, blur: 3, scale: 1 }}>
                      <button type="button" class="ghost choice row-nw align-centre gap-sm" role="option" aria-selected={on} onmousedown={(event) => event.preventDefault()} onclick={() => toggle(section.kind, choice.id)} use:menu={() => choiceItems(section.kind, choice)}>
                        <span class="check row centre" class:on aria-hidden="true">{#if on}<svg viewBox="0 0 24 24" width="12" height="12" in:haze={{ blur: 5, duration: 140, scale: 1 }}><path fill="currentColor" d={MENU_ICONS.read} /></svg>{/if}</span>
                        {#if choice.avatar}<Avatar name={choice.avatar.name} url={choice.avatar.avatar} size="22px" radius="50%" />{:else if choice.icon}<svg class="faint" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={choice.icon} /></svg>{/if}
                        <span class="sm truncate"><EmojiText text={choice.label} /></span>
                        {#if choice.sub}<span class="xs faint truncate">{choice.sub}</span>{/if}
                      </button>
                    </li>
                  {:else}
                    <li class="sm faint none">{text("chat", "search_no_matches")}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </section>
      {/each}

      <section class="col gap-xs">
        <h4 class="md bold">{text("chat", "search_section_date")}</h4>
        <p class="sm muted">{text("chat", "search_section_date_hint")}</p>
        {#each draft.dates as rule, index (index)}
          <div class="date row-nw align-centre gap-sm" transition:slide={{ duration: 260, easing: ease }} use:menu={() => dateItems(index)}>
            <select class="sm" bind:value={rule.kind} aria-label={text("chat", "search_section_date")}>
              {#each ["before", "on", "after"] as kind (kind)}<option value={kind}>{text("chat", `search_date_${kind}`)}</option>{/each}
            </select>
            <input class="sm flex-max" type="date" bind:value={rule.date} aria-label={text("chat", "search_section_date")} />
            <button type="button" class="icon-button ghost press" aria-label={text("chat", "search_remove_filter")} onclick={() => removeDate(index)}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
            </button>
          </div>
        {/each}
        <button type="button" class="add sm bold ghost press" onclick={addDate} use:menu={() => [{ id: "date-add", label: text("chat", "search_add_date"), icon: MENU_ICONS.add, run: addDate }]}>+ {text("chat", "search_add_date")}</button>
      </section>

      <section class="col gap-xs">
        <h4 class="md bold">{text("chat", "search_section_pinned")}</h4>
        <p class="sm muted">{text("chat", "search_section_pinned_hint")}</p>
        <div class="segments row-nw gap-xs" role="radiogroup" aria-label={text("chat", "search_section_pinned")}>
          {#each [[null, "search_any"], [true, "search_yes"], [false, "search_no"]] as const as [value, key] (key)}
            <button type="button" class="ghost segment sm" role="radio" aria-checked={draft.pinned === value} class:on={draft.pinned === value} onclick={() => (draft.pinned = value)}>{text("chat", key)}</button>
          {/each}
        </div>
      </section>
    </div>

    <footer class="foot row-nw align-centre gap-sm" use:menu={footerItems}>
      <button type="button" class="link sm bold ghost press flex-max" onclick={reset}>{text("chat", "search_clear_filters")}</button>
      <button type="button" class="ghost secondary sm bold press" onclick={close}>{text("chat", "cancel")}</button>
      <button type="button" class="ghost primary sm bold press" onclick={commit}>{text("chat", "search_apply")}</button>
    </footer>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-modal, var(--azure-z-popover));
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .modal {
    position: relative;
    width: min(520px, calc(100vw - 32px));
    max-height: min(720px, calc(100dvh - 64px));
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 24px 56px -20px black;
    outline: none;
    overflow: hidden;
    animation: enter var(--azure-duration-slow) var(--azure-ease-fluid);
  }

  .closing {
    pointer-events: none;
  }

  .closing .scrim {
    animation: fade-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .modal {
    animation: leave var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .head {
    padding: var(--azure-spacing-lg) var(--azure-spacing-lg) var(--azure-spacing-sm);
  }

  h3,
  h4,
  p {
    margin: 0;
    color: var(--colours-text-strong);
  }

  p.muted {
    color: var(--colours-text-muted);
  }

  .body {
    padding: var(--azure-spacing-sm) var(--azure-spacing-lg) var(--azure-spacing-lg);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .icon-button {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .icon-button:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .combo {
    position: relative;
    margin-top: var(--azure-spacing-xs);
  }

  .combo-head {
    width: 100%;
    height: 40px;
    padding: 0 6px 0 var(--azure-spacing-md);
    border-radius: 10px;
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    color: var(--colours-text-strong);
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .combo.open .combo-head {
    border-color: var(--colours-outline-strong);
  }

  .combo-input.chosen::placeholder {
    color: var(--colours-text-strong);
  }

  .combo-input {
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .chevron-button {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 6px;
  }

  .chevron {
    flex: none;
    color: var(--colours-text-faint);
    transition: rotate var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .chevron.flipped {
    rotate: 180deg;
  }

  .combo-list {
    position: fixed;
    z-index: 10;
    padding: 4px;
    border-radius: 10px;
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    box-shadow: 0 14px 32px -10px rgb(0 0 0 / 0.7);
  }

  .date select,
  .date input {
    height: 36px;
    padding: 0 var(--azure-spacing-sm);
    border-radius: 10px;
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    color-scheme: dark;
    color: var(--colours-text-strong);
    outline: none;
  }

  .combo-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: var(--room, 240px);
    overflow-y: auto;
  }

  .choice {
    width: 100%;
    min-height: 34px;
    padding: 0 var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    text-align: left;
    color: var(--colours-text);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .choice:hover,
  .choice:focus-visible {
    background-color: var(--colours-surface-hover);
  }

  .check {
    width: 16px;
    height: 16px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 4px;
    border: 1.5px solid var(--colours-outline-strong);
    color: white;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out), border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .check.on {
    border-color: var(--colours-accent);
    background-color: var(--colours-accent);
  }

  .none {
    padding: var(--azure-spacing-sm);
  }

  .add,
  .link {
    align-self: flex-start;
    height: 30px;
    padding: 0 var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    text-align: left;
  }

  .add:hover,
  .link:hover {
    background-color: var(--colours-accent-soft);
  }

  .segment {
    height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out), color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .segment.on {
    color: var(--colours-accent);
    border-color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .foot {
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .secondary,
  .primary {
    height: 34px;
    padding: 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-sm);
  }

  .secondary {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .primary {
    color: white;
    background-color: var(--colours-accent);
  }

  @keyframes enter {
    from {
      opacity: 0;
      filter: blur(6px);
      transform: translateY(8px) scale(0.97);
    }
  }

  @keyframes leave {
    to {
      opacity: 0;
      filter: blur(6px);
      transform: translateY(6px) scale(0.97);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal,
    .scrim {
      animation: none;
    }
  }
</style>
