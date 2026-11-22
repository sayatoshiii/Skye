<script lang="ts" module>
  export type PeopleRow = { userId: string; name: string; avatar?: string; detail?: string; removable?: boolean };
  export type PeopleGroup = { key: string; count: number; label?: string };
</script>

<script lang="ts">
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { usermenu } from "../../scripts/misc/usermenu";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { openFullProfile } from "../../scripts/stores/profile";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import ReactionKey from "../ui/ReactionKey.svelte";

  let {
    title,
    rows,
    roomId,
    groups,
    selected = $bindable(),
    onremove,
    onclose,
  }: {
    title: string;
    rows: PeopleRow[];
    roomId?: string;
    groups?: PeopleGroup[];
    selected?: string;
    onremove?: (row: PeopleRow) => void;
    onclose: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "people", ...path) as string;
  const exit = dismissible(() => onclose());
  const close = () => exit.close();

  const view = (userId: string) => {
    close();
    openFullProfile(userId, roomId);
  };
</script>

<span class="portal-anchor" hidden></span>
<div class="people-layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="people-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="people-dialog col" class:split={!!groups} onanimationend={exit.onanimationend} inert={exit.closing} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={(event) => event.key === "Escape" && close()}>
    <span class="people-handle" aria-hidden="true"></span>
    <header class="people-head row-nw align-centre justify-between gap-md">
      <h2 class="lg bold truncate">{title}</h2>
      <button type="button" class="people-close ghost press row centre" aria-label={text("close")} onclick={close}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
      </button>
    </header>
    <div class="people-body row-nw min-0">
      {#if groups}
        <div class="people-keys col gap-xs" role="tablist" aria-orientation="vertical">
          {#each groups as group (group.key)}
            <button type="button" role="tab" class="people-key item ghost press row-nw align-centre gap-sm" aria-selected={selected === group.key} onclick={() => (selected = group.key)}>
              <span class="people-emoji"><ReactionKey key={group.key} label={group.label} /></span>
              <span class="sm bold">{group.count}</span>
            </button>
          {/each}
        </div>
      {/if}
      <ul class="people-list col gap-xs flex-max min-0" role={groups ? "tabpanel" : undefined}>
        {#each rows as row (row.userId)}
          <li class="people-row row-nw align-centre">
            <button type="button" class="people-person item ghost press row-nw align-centre gap-md flex-max min-0" data-profile-trigger use:usermenu={{ userId: row.userId, roomId }} onclick={() => view(row.userId)}>
              <Avatar name={row.name} url={row.avatar} size="32px" radius="50%" />
              <span class="col min-0 flex-max">
                <span class="md truncate people-name"><EmojiText text={row.name} /></span>
                <span class="xs faint truncate">{row.detail ?? row.userId}</span>
              </span>
            </button>
            {#if row.removable && onremove}
              <button type="button" class="people-remove ghost press row centre" aria-label={text("remove")} onclick={() => onremove(row)}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .people-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: var(--azure-spacing-lg);
  }

  .people-scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .people-dialog {
    position: relative;
    width: min(100%, 420px);
    height: min(100%, 480px);
    padding: var(--azure-spacing-lg);
    gap: var(--azure-spacing-md);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 24px 64px -16px black,
      0 0 40px -20px var(--colours-accent-glow);
    outline: none;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .people-dialog.split {
    width: min(100%, 520px);
  }

  .people-handle {
    display: none;
  }

  h2 {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .people-close {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .people-close:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .people-body {
    flex: 1;
    gap: var(--azure-spacing-md);
    min-height: 0;
  }

  .people-keys {
    flex: none;
    width: 96px;
    overflow-y: auto;
    padding-right: var(--azure-spacing-md);
    border-right: 1px solid var(--colours-outline-hairline);
  }

  .people-key {
    height: 40px;
    padding: 0 var(--azure-spacing-sm);
  }

  .people-emoji :global(img.emoji) {
    width: 20px;
    height: 20px;
  }

  .people-list {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  .people-person {
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    text-align: left;
  }

  .people-name {
    color: var(--colours-text-strong);
  }

  .people-remove {
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 50%;
    color: var(--colours-text-faint);
  }

  .people-remove:hover {
    color: var(--colours-danger);
    background-color: var(--colours-danger-soft);
  }

  .closing .people-scrim {
    animation: fade-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .people-dialog {
    animation: pop-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  @media (max-width: 767px) {
    .people-layer {
      justify-content: flex-end;
      padding: 0;
    }

    .people-dialog,
    .people-dialog.split {
      width: 100%;
      height: auto;
      max-height: 80dvh;
      padding: var(--azure-spacing-sm) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      animation: slide var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .closing .people-dialog {
      animation: sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .people-handle {
      display: block;
      width: 36px;
      height: 4px;
      margin: 0 auto;
      border-radius: var(--azure-radius-pill);
      background-color: var(--colours-outline-strong);
    }

    .people-body {
      flex-direction: column;
    }

    .people-keys {
      flex-direction: row;
      width: auto;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0 0 var(--azure-spacing-sm);
      border-right: none;
      border-bottom: 1px solid var(--colours-outline-hairline);
    }

    .people-key {
      flex: none;
      min-height: var(--azure-touch);
    }

    .people-close,
    .people-remove {
      min-width: var(--azure-touch);
      min-height: var(--azure-touch);
    }
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes slide {
    from {
      transform: translateY(100%);
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

  @keyframes pop-out {
    to {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes sink {
    to {
      transform: translateY(100%);
    }
  }
</style>
