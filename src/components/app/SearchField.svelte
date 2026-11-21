<script lang="ts">
  import { fly } from "svelte/transition";
  import { tick } from "svelte";
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { HAS_TYPES, localpart, type HasType, type SearchQuery } from "../../scripts/matrix/search";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { SETTINGS_ICONS } from "../settings/icons";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { tooltip } from "../../scripts/misc/tooltip";
  import type { MenuItem } from "./MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  export type SearchMember = { id: string; name: string; avatar?: string };

  let {
    roomName,
    members,
    query = $bindable(),
    input = $bindable(),
    onsubmit,
    onfilters,
    onclear,
  }: {
    roomName: string;
    members: SearchMember[];
    query: SearchQuery;
    input?: HTMLInputElement;
    onsubmit: () => void;
    onfilters: () => void;
    onclear: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const ease = (t: number) => cubicOut(t);

  type Option = { id: string; group?: string; icon?: string; avatar?: SearchMember; title: string; hint?: string; run: () => void };

  let focused = $state(false);
  let active = $state(0);
  let navigated = $state(false);
  let waking = false;
  let row: HTMLElement | undefined = $state();
  const chipAt = (index: number) => row?.querySelectorAll<HTMLButtonElement>(".chip")[index];
  const reveal = (node?: HTMLElement | null) => {
    if (!node || !row) return;
    node.focus({ preventScroll: true });
    const left = node.offsetLeft - row.offsetLeft;
    const target = left < row.scrollLeft + 18 ? left - 18 : left + node.offsetWidth > row.scrollLeft + row.clientWidth - 26 ? left + node.offsetWidth - row.clientWidth + 26 : row.scrollLeft;
    row.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  };
  const chipKey = (event: KeyboardEvent, index: number) => {
    const go = (to: number) => (event.preventDefault(), to < 0 ? reveal(chipAt(0)) : to >= chips.length ? (input?.focus(), follow()) : reveal(chipAt(to)));
    event.key === "ArrowLeft" && go(index - 1);
    event.key === "ArrowRight" && go(index + 1);
    (event.key === "Backspace" || event.key === "Delete") && (event.preventDefault(), chips[index].remove(), tick().then(() => (index > 0 && event.key === "Backspace" ? reveal(chipAt(index - 1)) : input?.focus())));
    event.key === "Escape" && (event.preventDefault(), input?.focus());
  };
  let edges = $state({ start: false, end: false });
  const measure = () => row && (edges = { start: row.scrollLeft > 1, end: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
  const follow = () => row && ((row.scrollLeft = row.scrollWidth), measure());
  $effect(() => {
    void chips.length;
    const open = focused;
    tick().then(() => requestAnimationFrame(() => (!open && row && (row.scrollLeft = 0), measure())));
  });

  $effect(() => {
    if (!row) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  });
  let root: HTMLElement | undefined = $state();

  let caret = $state(0);
  const before = $derived(query.term.slice(0, Math.min(caret, query.term.length)));
  const token = $derived(before.match(/(?:^|\s)(from|mentions|has):\s*(\S*)$/i));
  const tail = $derived((token?.[2] ?? before.split(/\s+/).at(-1) ?? "").toLowerCase());
  const track = () => input && (caret = input.selectionStart ?? query.term.length);
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const hasLabel = (type: HasType) => text("chat", `search_has_${type}`);
  const HAS_ICON: Record<HasType, string> = { link: MENU_ICONS.link, embed: MENU_ICONS.open, image: MENU_ICONS.image, video: SETTINGS_ICONS.image, file: MENU_ICONS.save };

  const strip = () => {
    if (!token) return;
    const head = before.replace(token ? /(?:^|\s)(from|mentions|has):\s*\S*$/i : /\S*$/, "").trimEnd();
    const rest = query.term.slice(before.length).trimStart();
    query.term = [head, rest].filter(Boolean).join(" ");
    caret = head.length;
    tick().then(() => input?.setSelectionRange(caret, caret));
  };
  const pickMember = (kind: "senders" | "mentions", id: string) => (strip(), (query[kind] = [...new Set([...query[kind], id])]), input?.focus());
  const pickHas = (type: HasType) => (strip(), (query.has = [...new Set([...query.has, type])]), input?.focus());
  const prime = (word: string) => {
    const head = query.term.slice(0, Math.min(caret, query.term.length)).trimEnd();
    const rest = query.term.slice(Math.min(caret, query.term.length)).trimStart();
    const inserted = `${head}${head ? " " : ""}${word}: `;
    query.term = `${inserted}${rest}`;
    caret = inserted.length;
    input?.focus();
    tick().then(() => input?.setSelectionRange(caret, caret));
  };

  const matching = $derived(members.filter((member) => !tail || member.name.toLowerCase().includes(tail) || member.id.toLowerCase().includes(tail)).slice(0, 5));

  const filtersOptions = (): Option[] => [
    { id: "f-from", icon: SETTINGS_ICONS.profile, title: text("chat", "search_from_title"), hint: text("chat", "search_from_hint"), run: () => prime("from") },
    { id: "f-mentions", icon: MENU_ICONS.mention, title: text("chat", "search_mentions_title"), hint: text("chat", "search_mentions_hint"), run: () => prime("mentions") },
    { id: "f-has", icon: MENU_ICONS.link, title: text("chat", "search_has_title"), hint: text("chat", "search_has_hint"), run: () => prime("has") },
    { id: "f-more", icon: MENU_ICONS.add, title: text("chat", "search_more_title"), hint: text("chat", "search_more_hint"), run: () => (focused = false, onfilters()) },
  ];

  const tokenOptions = (): Option[] =>
    token?.[1].toLowerCase() === "has"
      ? HAS_TYPES.filter((type) => type.startsWith(tail)).map((type) => ({ id: `h-${type}`, group: text("chat", "search_has_group"), icon: HAS_ICON[type], title: hasLabel(type), hint: `has: ${type}`, run: () => pickHas(type) }))
      : matching.map((member) => {
          const kind = token?.[1].toLowerCase() === "mentions" ? "mentions" : "senders";
          return { id: `${kind}-${member.id}`, group: text("chat", kind === "mentions" ? "search_mentions_group" : "search_from_group"), avatar: member, title: member.name, hint: `${kind === "mentions" ? "mentions" : "from"}: ${localpart(member.id)}`, run: () => pickMember(kind, member.id) };
        });

  const typingOptions = (): Option[] => [
    { id: "t-search", icon: SETTINGS_ICONS.search, title: text("chat", "search_for").replace("{text}", query.term.trim()), run: () => submit() },
    { id: "t-filters", icon: MENU_ICONS.add, title: text("chat", "search_add_filters"), run: () => (focused = false, onfilters()) },
    ...matching.map((member) => ({ id: `s-${member.id}`, group: text("chat", "search_from_group"), avatar: member, title: member.name, hint: `from: ${localpart(member.id)}`, run: () => pickMember("senders", member.id) })),
    ...matching.map((member) => ({ id: `m-${member.id}`, group: text("chat", "search_mentions_group"), avatar: member, title: member.name, hint: `mentions: ${localpart(member.id)}`, run: () => pickMember("mentions", member.id) })),
  ];

  const options = $derived(token ? tokenOptions() : query.term.trim() ? typingOptions() : filtersOptions());
  const chips = $derived([
    ...query.senders.map((id) => ({ key: `from-${id}`, label: "from:", value: nameOf(id), remove: () => (query.senders = query.senders.filter((value) => value !== id)) })),
    ...query.mentions.map((id) => ({ key: `mentions-${id}`, label: "mentions:", value: nameOf(id), remove: () => (query.mentions = query.mentions.filter((value) => value !== id)) })),
    ...query.has.map((type) => ({ key: `has-${type}`, label: "has:", value: type, remove: () => (query.has = query.has.filter((value) => value !== type)) })),
  ]);
  const filled = $derived(!!query.term.trim() || chips.length > 0);
  const armed = $derived(!!token || navigated);

  $effect(() => {
    options;
    active = 0;
    navigated = false;
  });

  const submit = () => {
    if (!filled) return;
    focused = false;
    input?.blur();
    onsubmit();
  };

  const clear = () => {
    query.term = "";
    query.senders = [];
    query.mentions = [];
    query.has = [];
    onclear();
    input?.focus();
  };

  const onkeydown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    step && (event.preventDefault(), (focused = true), (active = armed ? (active + step + options.length) % Math.max(1, options.length) : step > 0 ? 0 : options.length - 1), (navigated = true));
    event.key === "Enter" && (event.preventDefault(), focused && options[active] && armed ? options[active].run() : submit(), (navigated = false));
    event.key === "Escape" && (event.preventDefault(), event.stopPropagation(), focused ? (focused = false) : input?.blur());
    event.key === "Backspace" && !query.term && chips.length && chips.at(-1)!.remove();
  };

  const onfocusout = (event: FocusEvent) => !root?.contains(event.relatedTarget as Node) && (focused = false);

  const chipItems = (chip: (typeof chips)[number]): MenuItem[] => [{ id: "chip-remove", label: text("chat", "search_remove_filter"), icon: MENU_ICONS.close, danger: true, run: chip.remove }];
  const optionItems = (option: Option): MenuItem[] => [{ id: "option-use", label: option.title, icon: MENU_ICONS.add, run: option.run }];
  const fieldItems = (): MenuItem[] => [
    { id: "search-run", label: text("chat", "search"), icon: SETTINGS_ICONS.search, disabled: !filled, run: submit },
    { id: "search-filters", label: text("chat", "search_add_filters"), icon: MENU_ICONS.add, run: onfilters },
    { id: "search-clear", label: text("chat", "search_clear"), icon: MENU_ICONS.close, disabled: !filled, separated: true, run: clear },
  ];
</script>

<div class="search" class:open={focused} bind:this={root} {onfocusout} use:menu={fieldItems}>
  <div class="field row-nw align-centre" class:filled onpointerdown={(event) => ((waking = !focused), waking && (event.preventDefault(), input?.focus()))}>
    <span class="chips row-nw align-centre min-0 flex-max" class:some={chips.length > 0} bind:this={row} class:fade-start={edges.start} class:fade-end={edges.end} onscroll={measure}>
    {#each chips as chip, index (chip.key)}
      <button type="button" class="ghost chip xs row-nw align-centre" animate:flip={{ duration: 260, easing: ease }} transition:fly={{ x: -4, duration: 180, easing: ease, opacity: 0 }} aria-label={`${text("chat", "search_remove_filter")}: ${chip.label} ${chip.value}`} tabindex="-1" onkeydown={(event) => chipKey(event, index)} onclick={() => (waking ? (waking = false) : chip.remove())} use:menu={() => chipItems(chip)}>
        <span class="faint">{chip.label}</span><span class="bold truncate"><EmojiText text={chip.value} /></span>
        <span class="chip-x" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M7 7l10 10M17 7 7 17" /></svg></span>
      </button>
    {/each}
    <input
      bind:this={input}
      bind:value={query.term}
      class="flex-max min-0"
      type="search"
      role="combobox"
      aria-expanded={focused}
      aria-controls="search-options"
      aria-autocomplete="list"
      aria-activedescendant={focused && options[active] ? `search-option-${options[active].id}` : undefined}
      placeholder={chips.length ? "" : text("chat", "search_placeholder").replace("{room}", roomName)}
      aria-label={text("chat", "search_placeholder").replace("{room}", roomName)}
      onfocus={() => ((focused = true), tick().then(track))}
      oninput={() => ((focused = true), (navigated = false), track(), follow())}
      onkeyup={track}
      onclick={track}
      onselect={track}
      onfocusin={follow}
      onkeydown={(event) => (event.key === "ArrowLeft" && input?.selectionStart === 0 && input.selectionEnd === 0 && chips.length ? (event.preventDefault(), reveal(chipAt(chips.length - 1))) : onkeydown(event))}
    />
    </span>
    <button type="button" class="end ghost press row centre" tabindex={filled ? 0 : -1} aria-label={text("chat", filled ? "search_clear" : "search")} use:tooltip={filled ? text("chat", "search_clear") : ""} onclick={() => (filled ? clear() : input?.focus())}>
      {#key filled}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" in:fly={{ y: 2, duration: 200, easing: ease, opacity: 0 }}>{#if filled}<path fill="currentColor" d={MENU_ICONS.close} />{:else}<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.6" /><path d="m15 15 5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />{/if}</svg>
      {/key}
    </button>
  </div>

  {#if focused}
    <div class="pop col" id="search-options" role="listbox" tabindex="-1" in:fly={{ y: -6, duration: 260, easing: ease, opacity: 0 }} out:fly={{ y: -4, duration: 160, easing: ease, opacity: 0 }}>
      {#if !token && !query.term.trim()}<p class="heading xs bold faint">{text("chat", "search_filters")}</p>{/if}
      {#each options as option, index (option.id)}
        {#if option.group && option.group !== options[index - 1]?.group}<p class="heading xs bold faint">{option.group}</p>{/if}
        <button
          type="button"
          id="search-option-{option.id}"
          class="option ghost row-nw align-centre gap-md"
          class:active={armed && index === active}
          role="option"
          aria-selected={armed && index === active}
          tabindex="-1"
          onpointerenter={() => ((active = index), (navigated = true))}
          onmousedown={(event) => event.preventDefault()}
          onclick={option.run}
          use:menu={() => optionItems(option)}
        >
          {#if option.avatar}
            <Avatar name={option.avatar.name} url={option.avatar.avatar} size="22px" radius="50%" />
          {:else if option.icon}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={option.icon} /></svg>
          {/if}
          <span class="col min-0 flex-max">
            <span class="sm truncate title"><EmojiText text={option.title} /></span>
            {#if option.hint}<span class="xs faint truncate">{option.hint}</span>{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: 220px;
    min-width: 140px;
    flex: 0 1 220px;
    transition:
      width var(--azure-duration-slow) var(--azure-ease-fluid),
      flex-basis var(--azure-duration-slow) var(--azure-ease-fluid);
  }

  .search.open {
    width: min(360px, var(--search-room, 360px));
    flex-basis: min(360px, var(--search-room, 360px));
  }

  .field {
    height: 34px;
    padding: 0 6px;
    gap: 5px;
    border-radius: 12px;
    background-color: var(--colours-surface);
    border: 1px solid transparent;
    overflow: hidden;
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out), background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .open .field {
    background-color: var(--colours-surface-hover);
  }

  input {
    height: 100%;
    font: inherit;
    font-size: var(--text-md, 15px);
    border: 0;
    outline: none;
    background: none;
    color: var(--colours-text-strong);
  }

  input::-webkit-search-cancel-button {
    display: none;
  }

  .chips {
    flex: 1 1 auto;
    height: 100%;
    gap: 5px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    overscroll-behavior: contain;
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .chips input {
    flex: 1 0 96px;
    width: 96px;
    min-width: 96px;
  }

  .search:not(.open) .chips.some {
    overflow: hidden;
  }

  .chips.fade-end {
    mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
  }

  .chips.fade-start {
    mask-image: linear-gradient(to right, transparent, black 16px);
  }

  .chips.fade-start.fade-end {
    mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 24px), transparent);
  }

  .search:not(.open) .chips.some input:placeholder-shown {
    flex: 0 0 0;
    width: 0;
    min-width: 0;
    padding: 0;
  }

  .chip {
    flex: none;
    max-width: 120px;
    gap: 3px;
    height: 22px;
    padding: 0 6px;
    border-radius: 7px;
    color: var(--colours-text-strong);
    background-color: var(--colours-accent-soft);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .chip-x {
    display: grid;
    place-items: center;
    width: 0;
    overflow: hidden;
    opacity: 0;
    translate: 4px 0;
    color: var(--colours-danger);
    transition:
      width 220ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 220ms cubic-bezier(0.32, 0.72, 0, 1),
      translate 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .search.open .chip:hover {
    background-color: var(--colours-danger-soft);
  }

  .search.open .chip:hover .chip-x {
    width: 12px;
    opacity: 1;
    translate: 0 0;
  }

  .end {
    width: 24px;
    height: 24px;
    margin-left: auto;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--colours-text-muted);
    transition:
      background-color 180ms cubic-bezier(0.32, 0.72, 0, 1),
      color 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .end > svg {
    grid-area: 1 / 1;
  }

  .filled .end:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .filled .chips.some {
    margin-right: 4px;
  }

  .pop {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: max(100%, min(340px, calc(100vw - 16px)));
    max-width: calc(100vw - 16px);
    max-height: min(420px, 70dvh);
    overflow-y: auto;
    padding: var(--azure-spacing-sm);
    z-index: var(--azure-z-popover);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 12px 28px -12px rgb(0 0 0 / 0.6);
    transform-origin: top right;
  }

  .heading {
    margin: var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .heading:first-child {
    margin-top: var(--azure-spacing-xs);
  }

  .option {
    width: 100%;
    min-height: 44px;
    padding: 6px var(--azure-spacing-sm);
    border: 0;
    background: none;
    border-radius: var(--azure-radius-sm);
    text-align: left;
    color: var(--colours-text);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .option > svg {
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--colours-text-faint);
  }

  .option.active {
    background-color: var(--colours-surface-hover);
    color: var(--colours-text-strong);
  }

  .title {
    color: var(--colours-text-strong);
    font-weight: 600;
  }

  @media (max-width: 767px) {
    .search,
    .search.open {
      width: 36px;
      min-width: 36px;
      flex: none;
    }

    .search:not(.open) .field {
      padding: 0;
      justify-content: center;
      background: none;
      border-color: transparent;
    }

    .search:not(.open) input,
    .search:not(.open) .chip {
      width: 0;
      min-width: 0;
      flex: 0 0 0;
      padding: 0;
      opacity: 0;
    }

    .search:not(.open) .end {
      width: 36px;
      height: 36px;
      color: var(--colours-text-muted);
    }

    .search:not(.open) .end svg {
      width: 20px;
      height: 20px;
    }

    :global(header:has(> .search.open) > :not(.search)) {
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms cubic-bezier(0.32, 0.72, 0, 1);
    }

    :global(header:has(> .search) > :not(.search)) {
      transition: opacity 240ms cubic-bezier(0.32, 0.72, 0, 1);
    }

    .search.open {
      position: absolute;
      left: 8px;
      right: 8px;
      width: auto;
      z-index: 2;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .search {
      transition: none;
    }
  }
</style>
