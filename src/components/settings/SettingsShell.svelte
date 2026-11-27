<script lang="ts" module>
  export type ShellEntry<Key extends string> = { id: Key; label: string; icon: string; parts?: { id: string; label: string }[] };
  export type ShellGroup<Key extends string> = { id: string; title?: string; entries: ShellEntry<Key>[] };
  export type ShellAction = { id: string; label: string; icon: string; run: () => void };
</script>

<script lang="ts" generics="Id extends string">
  import { flushSync, onMount, setContext, tick, type Snippet } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { reducesMotion } from "../../scripts/settings/motion";
  import Icon from "../ui/Icon.svelte";
  import { SETTINGS_ICONS } from "./icons";

  let {
    label,
    groups,
    section = $bindable(),
    paged = $bindable(false),
    searchable = false,
    footnote,
    wide = false,
    guard = () => false,
    onclose,
    top,
    actions = [],
    aside,
    children,
  }: {
    label: string;
    groups: ShellGroup<Id>[];
    section: Id;
    paged?: boolean;
    searchable?: boolean;
    footnote?: Snippet;
    wide?: boolean;
    guard?: () => boolean;
    onclose: () => void;
    top: Snippet<[(id: Id) => void]>;
    actions?: ShellAction[];
    aside?: Snippet;
    children: Snippet<[(id: Id) => void]>;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;

  let query = $state("");
  let modal: HTMLElement | undefined = $state();
  let pane: HTMLElement | undefined = $state();
  let stacked = $state(false);

  const STACK_AT = 760;
  const UNSTACK_AT = 800;

  const glide = (change: () => void) => {
    const nodes = [...(pane?.querySelectorAll<HTMLElement>(".split > .pane-content, .split > .pane-aside, [data-glide]") ?? [])];
    const before = nodes.map((node) => node.getBoundingClientRect());
    change();
    nodes.forEach((node, index) => {
      const after = node.getBoundingClientRect();
      node.animate([{ translate: `${before[index].left - after.left}px ${before[index].top - after.top}px` }, { translate: "0 0" }], { duration: 520, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
    });
  };

  $effect(() => {
    if (!pane) return;
    let settled = false;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width <= (stacked ? UNSTACK_AT : STACK_AT);
      const apply = () => flushSync(() => (stacked = next));
      next !== stacked && (settled && !reducesMotion() ? glide(apply) : apply());
      settled = true;
    });
    observer.observe(pane);
    return () => observer.disconnect();
  });
  let part = $state("");
  let pinned = 0;

  const exit = dismissible(() => onclose());

  const dock = $state<{ element?: HTMLElement }>({});
  setContext("settings-dock", dock);

  const needle = $derived(query.trim().toLowerCase());
  const matches = (label: string) => label.toLowerCase().includes(needle);
  const shown = $derived(
    groups
      .map((group) => ({
        ...group,
        entries: group.entries
          .map((entry) => ({ ...entry, hits: needle ? (entry.parts ?? []).filter((item) => matches(item.label)) : [] }))
          .filter((entry) => matches(entry.label) || entry.hits.length),
      }))
      .filter((group) => group.entries.length),
  );
  const current = $derived(groups.flatMap((group) => group.entries).find((entry) => entry.id === section));
  const parts = $derived(current?.parts ?? []);
  const partIndex = $derived(Math.max(0, parts.findIndex((entry) => entry.id === part)));

  $effect(() => {
    const root = pane;
    const ids = parts.map((entry) => entry.id);
    part = ids[0] ?? "";
    if (!root || !ids.length) return;
    let frame = 0;
    const spy = () => {
      frame = 0;
      const anchors = ids.map((id) => root.querySelector<HTMLElement>(`[data-part="${id}"]`));
      const range = root.scrollHeight - root.clientHeight;
      const progress = range > 4 ? Math.min(1, root.scrollTop / range) : 0;
      const line = root.getBoundingClientRect().top + root.clientHeight * (0.3 + 0.7 * progress ** 2);
      const passed = anchors.reduce((last, node, index) => (node && node.getBoundingClientRect().top <= line ? index : last), 0);
      Date.now() > pinned && (part = ids[progress >= 0.99 ? ids.length - 1 : passed]);
    };
    const onscroll = () => (frame ||= requestAnimationFrame(spy));
    const settle = () => (pinned = 0);
    root.addEventListener("scroll", onscroll, { passive: true });
    root.addEventListener("scrollend", settle);
    return () => (cancelAnimationFrame(frame), root.removeEventListener("scroll", onscroll), root.removeEventListener("scrollend", settle));
  });

  const reveal = async (entryId: Id, partId: string) => {
    go(entryId);
    await tick();
    section === entryId && jump(partId);
  };

  const jump = (id: string) => {
    part = id;
    pinned = Date.now() + 600;
    const target = pane?.querySelector<HTMLElement>(`[data-part="${id}"]`);
    pane && target && pane.scrollTo({ top: pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - parseFloat(getComputedStyle(target).scrollMarginTop), behavior: reducesMotion() ? "auto" : "smooth" });
  };

  const go = (id: Id) => {
    (id === section || !guard()) && ((section = id), (paged = true), pane?.scrollTo({ top: 0 }));
  };

  export const close = () => !guard() && ((document.activeElement as HTMLElement | null)?.blur(), exit.close());
  const back = () => !guard() && (paged = false);

  onMount(() => {
    const escape = (event: KeyboardEvent) => {
      const owner = (event.target as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]');
      event.key === "Escape" && (!owner || owner === modal) && close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
</script>

<span class="portal-anchor" hidden></span>
<div class="settings-layer" class:closing={exit.closing} class:paged role="presentation" use:portal>
  <button type="button" class="settings-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="settings-card row-nw" role="dialog" aria-modal="true" aria-label={label} tabindex="-1" bind:this={modal} inert={exit.closing} onanimationend={exit.onanimationend}>
    <nav class="settings-nav col" aria-label={label}>
      <div class="nav-top row-nw align-centre gap-xs">
        <div class="flex-max min-0">{@render top(go)}</div>
        <button type="button" class="round nav-close ghost press" aria-label={text("close")} onclick={close}><Icon d={SETTINGS_ICONS.close} size={18} /></button>
      </div>

      {#if searchable}
        <label class="search row-nw align-centre gap-sm">
          <span class="faint row-nw"><Icon d={SETTINGS_ICONS.search} size={16} /></span>
          <input class="flex-max min-0" type="search" placeholder={text("search")} aria-label={text("search")} bind:value={query} />
        </label>
      {/if}

      <div class="groups col">
        {#each shown as group (group.id)}
          <div class="group col">
            {#if group.title}<h2 class="group-title">{group.title}</h2>{/if}
            {#each group.entries as entry (entry.id)}
              {@const selected = section === entry.id}
              <button type="button" class="nav-item ghost press row-nw align-centre gap-sm md" aria-current={selected ? "page" : undefined} onclick={() => go(entry.id)}>
                <Icon d={entry.icon} size={20} />
                <span class="flex-max truncate">{entry.label}</span>
                <span class="chevron row-nw"><Icon d={SETTINGS_ICONS.next} size={16} /></span>
              </button>
              {#if entry.hits.length}
                <div class="subnav col hits">
                  {#each entry.hits as item (item.id)}
                    <button type="button" class="sub-item ghost sm truncate" onclick={() => reveal(entry.id, item.id)}>{item.label}</button>
                  {/each}
                </div>
              {:else if selected && entry.parts?.length}
                <div class="subnav col" style:--index={partIndex}>
                  <span class="subnav-mark" aria-hidden="true"></span>
                  {#each entry.parts as item (item.id)}
                    <button type="button" class="sub-item ghost sm truncate" aria-current={part === item.id ? "location" : undefined} onclick={() => jump(item.id)}>{item.label}</button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="xs faint empty">{text("no_results")}</p>
        {/each}
      </div>

      {#if actions.length}
        <div class="nav-foot col">
          {#each actions as action (action.id)}
            <button type="button" class="nav-item danger-item ghost press row-nw align-centre gap-sm md" onclick={action.run}>
              <Icon d={action.icon} size={20} />
              <span>{action.label}</span>
            </button>
          {/each}
          {#if footnote}<p class="nav-footnote xs faint">{@render footnote()}</p>{/if}
        </div>
      {/if}
    </nav>

    <div class="pane-frame col flex-max min-0">
      <main class="settings-pane col flex-max min-0" bind:this={pane}>
        <header class="pane-head row-nw align-centre gap-sm">
          <button type="button" class="round pane-back ghost press" aria-label={text("back")} onclick={back}><Icon d={SETTINGS_ICONS.back} size={20} /></button>
          <h2 class="md flex-max truncate pane-title">{current?.label ?? ""}</h2>
          <button type="button" class="round pane-close ghost press" aria-label={text("close")} use:tooltip={{ text: "Esc", placement: "bottom" }} onclick={close}><Icon d={SETTINGS_ICONS.close} size={18} /></button>
        </header>
        {#key section}
          <div class="pane-body" class:col={!aside} class:split={!!aside} class:wide class:stacked>
            <div class="pane-content col">{@render children(go)}</div>
            {#if aside}<aside class="pane-aside">{@render aside()}</aside>{/if}
          </div>
        {/key}
      </main>
      <div class="pane-dock" bind:this={dock.element}></div>
    </div>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .settings-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
  }

  .settings-scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(6px);
    animation: settings-fade var(--azure-duration-slow) var(--sheet);
  }

  .settings-card {
    position: relative;
    width: min(1400px, calc(100vw - 72px));
    height: min(900px, calc(100dvh - 28px));
    overflow: clip;
    border-radius: 10px;
    border: 1px solid var(--line);
    background-color: var(--card);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    animation: settings-pop var(--azure-duration-slow) var(--sheet);
  }

  .closing {
    pointer-events: none;
  }

  .closing .settings-scrim {
    animation: exit-fade var(--azure-duration-md) var(--sheet) forwards;
  }

  .closing .settings-card {
    animation: settings-out var(--azure-duration-md) var(--sheet) forwards;
  }

  .settings-nav {
    flex: none;
    width: 252px;
    gap: 12px;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 20px 16px 16px;
    border-right: 1px solid var(--line);
  }

  .search {
    padding: 0 12px;
    min-height: 40px;
    gap: 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    transition: border-color var(--azure-duration-fast) var(--sheet);
  }

  .search:focus-within {
    border-color: var(--colours-outline-strong, var(--line));
  }

  .search input {
    font: inherit;
    font-size: max(16px, var(--text-sm));
    color: var(--colours-text-strong);
    background: none;
    border: 0;
    outline: none;
    padding: 6px 0;
  }

  .groups {
    flex: 1;
  }

  .group {
    gap: 0;
    padding: 12px 0;
  }

  .group + .group {
    border-top: 1px solid var(--line);
  }

  .group:first-child {
    padding-top: 0;
  }

  .group:first-child .group-title {
    display: none;
  }

  .group-title {
    margin: 4px 0 6px;
    padding: 0 8px;
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.2;
    color: var(--colours-text-muted);
  }

  .empty {
    margin: 0;
    padding: 0 var(--azure-spacing-sm);
  }

  .nav-item {
    width: 100%;
    min-height: 40px;
    gap: 12px;
    padding: 0 8px;
    border-radius: 8px;
    text-align: left;
    font-weight: 500;
    color: var(--colours-text-muted);
  }

  .nav-item:hover {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
  }

  .nav-item[aria-current="page"] {
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, white 13%, var(--card));
  }

  .subnav {
    --row: 36px;
    position: relative;
    margin: 0 0 4px 17px;
    padding-left: 19px;
    animation: subnav-in var(--azure-duration-slow) var(--sheet);
  }

  .subnav::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: var(--line);
  }

  .subnav-mark {
    position: absolute;
    left: -0.5px;
    top: 8px;
    width: 2px;
    height: calc(var(--row) - 16px);
    border-radius: 2px;
    background-color: var(--colours-text-strong);
    transform: translateY(calc(var(--index) * var(--row)));
    transition: transform var(--azure-duration-glide) var(--sheet);
  }

  .sub-item {
    height: var(--row);
    padding: 0;
    text-align: left;
    font-size: var(--text-md);
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-md) var(--sheet);
  }

  .sub-item:hover {
    color: var(--colours-text);
  }

  .sub-item[aria-current="location"] {
    color: var(--colours-text-strong);
  }

  .chevron {
    display: none;
  }

  .nav-foot {
    padding-top: var(--azure-spacing-sm);
    border-top: 1px solid var(--line);
  }

  .nav-footnote {
    margin: var(--azure-spacing-sm) 0 0;
    padding: 0 var(--azure-spacing-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }

  .nav-item.danger-item,
  .nav-item.danger-item:hover {
    color: var(--colours-danger);
  }

  .nav-item.danger-item:hover {
    background-color: var(--colours-danger-soft);
  }

  .settings-pane {
    position: relative;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in oklab, white 22%, transparent) transparent;
  }

  .pane-head {
    position: sticky;
    top: 0;
    z-index: 3;
    min-height: 48px;
    padding: 0 12px 0 16px;
    background-color: var(--card);
    border-bottom: 1px solid var(--line);
  }

  .pane-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .round {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--colours-text-faint);
  }

  .round:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .pane-back,
  .nav-close {
    display: none;
  }

  .pane-body {
    width: 100%;
    max-width: 744px;
    margin: 0 auto;
    flex: 1 0 auto;
    padding: 64px 24px 48px;
    animation: pane-in var(--azure-duration-slow) var(--sheet);
  }

  .pane-content {
    flex: 1 0 auto;
    min-width: 0;
  }

  .pane-body.wide {
    max-width: 1120px;
    flex: 1 1 0;
    min-height: 0;
    padding-block: var(--azure-spacing-md);
  }

  .pane-body.wide > .pane-content {
    flex: 1 1 0;
    min-height: 0;
  }

  .pane-body.split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    align-items: start;
    gap: var(--azure-spacing-xl);
  }

  .pane-aside {
    position: sticky;
    top: 72px;
  }

  .pane-body.split.stacked {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--azure-spacing-lg);
  }

  .stacked .pane-aside {
    position: static;
    order: -1;
  }



  .pane-frame {
    min-height: 0;
  }

  .pane-dock {
    position: absolute;
    inset: auto 0 var(--azure-spacing-lg);
    z-index: 4;
    pointer-events: none;
  }

  .pane-dock > :global(*) {
    pointer-events: auto;
  }

  .settings-layer :global(:is(input, button, label, select, textarea):focus),
  .settings-layer :global(:is(input, button, label, select, textarea):focus-visible) {
    outline: none;
  }

  .settings-layer :global([data-part]) {
    scroll-margin-top: 72px;
  }

  .settings-layer :global(.pill) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: var(--azure-radius-pill);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--colours-text-muted);
    background-color: var(--colours-surface-hover);
    white-space: nowrap;
  }

  .settings-layer :global(.pill::before) {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: currentColor;
  }

  .settings-layer :global(.pill.good) {
    color: var(--colours-success);
    background-color: color-mix(in oklab, var(--colours-success) 14%, transparent);
  }

  .settings-layer :global(.pill.bad) {
    color: var(--colours-danger);
    background-color: var(--colours-danger-soft);
  }

  @keyframes settings-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes settings-pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes settings-out {
    to {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  @keyframes pane-in {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
  }

  @keyframes subnav-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @media (max-width: 767px) {
    .settings-card {
      width: 100%;
      height: 100dvh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .settings-nav,
    .pane-frame {
      flex: 1 0 100%;
      width: 100%;
      transition: transform var(--azure-duration-slow) var(--sheet);
    }

    .settings-nav {
      border-right: 0;
      padding: calc(var(--azure-spacing-md) + env(safe-area-inset-top)) var(--azure-spacing-sm) calc(var(--azure-spacing-md) + env(safe-area-inset-bottom));
    }

    .nav-item {
      min-height: var(--azure-touch);
    }

    .nav-item[aria-current="page"] {
      background: none;
    }

    .subnav {
      display: none;
    }

    .chevron {
      display: flex;
      color: var(--colours-text-faint);
    }

    .paged .settings-nav,
    .paged .pane-frame {
      transform: translateX(-100%);
    }

    .pane-head {
      min-height: 52px;
      padding: env(safe-area-inset-top) var(--azure-spacing-sm) 0;
    }

    .pane-back,
    .nav-close {
      display: grid;
    }

    .pane-close {
      display: none;
    }

    .round {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .pane-body {
      padding: var(--azure-spacing-lg) var(--azure-spacing-md) calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
      animation: none;
    }

    .pane-body.wide {
      max-width: 1120px;
    }

    .pane-dock {
      bottom: calc(var(--azure-spacing-md) + env(safe-area-inset-bottom));
    }
  }
</style>
