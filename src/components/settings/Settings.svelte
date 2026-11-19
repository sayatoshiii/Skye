<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { get } from "svelte/store";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { portal } from "../../scripts/misc/portal";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { ROUTES } from "../../scripts/settings/config";
  import { reducesMotion } from "../../scripts/settings/motion";
  import { ownProfile, signOut, type Profile } from "../../scripts/stores/matrix";
  import { guardUnsaved, settingsOpen, settingsSection, type SettingsSection } from "../../scripts/stores/settings";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import AccountSection from "./AccountSection.svelte";
  import AppearanceSection from "./AppearanceSection.svelte";
  import DevicesSection from "./DevicesSection.svelte";
  import Icon from "./Icon.svelte";
  import type { SettingsIcon } from "./icons";
  import NotificationsSection from "./NotificationsSection.svelte";
  import PrivacySection from "./PrivacySection.svelte";
  import ProfileSection from "./ProfileSection.svelte";
  import VoiceSection from "./VoiceSection.svelte";

  type Group = "user" | "app";
  type Entry = { id: SettingsSection; group: Group; icon: SettingsIcon; parts: string[]; view: Component<{ go: (id: SettingsSection) => void }> };

  const SECTIONS: Entry[] = [
    { id: "profile", group: "user", icon: "profile", parts: ["name", "avatar", "banner", "status"], view: ProfileSection },
    { id: "account", group: "user", icon: "account", parts: ["info", "password", "removal"], view: AccountSection },
    { id: "devices", group: "user", icon: "laptop", parts: ["current", "others"], view: DevicesSection },
    { id: "privacy", group: "user", icon: "privacy", parts: ["encryption", "backup", "ignored"], view: PrivacySection },
    { id: "appearance", group: "app", icon: "appearance", parts: ["theme", "accent", "motion"], view: AppearanceSection },
    { id: "notifications", group: "app", icon: "notifications", parts: ["browser", "synced"], view: NotificationsSection },
    { id: "voice", group: "app", icon: "mic", parts: ["input", "output", "camera", "talk"], view: VoiceSection },
  ];
  const GROUPS: Group[] = ["user", "app"];
  const BY_ID = Object.fromEntries(SECTIONS.map((entry) => [entry.id, entry])) as Record<SettingsSection, Entry>;

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const signOutLabel = getLocalisedText(undefined, "profile", "sign_out") as string;

  const requested = get(settingsSection);
  let section = $state<SettingsSection>(requested ?? "profile");
  let paged = $state(!!requested);
  let confirming = $state(false);
  let leaving = $state(false);
  let query = $state("");
  let modal: HTMLElement | undefined = $state();
  let pane: HTMLElement | undefined = $state();
  let part = $state("");
  let pinned = 0;
  let profile = $state.raw<Profile | null>(null);

  $effect(() => ownProfile.subscribe((value) => (profile = value)));
  $effect(() =>
    settingsSection.subscribe((value) => {
      value && ((section = value), (paged = true), settingsSection.set(null));
    }),
  );

  const exit = dismissible(() => settingsOpen.set(false));

  const needle = $derived(query.trim().toLowerCase());
  const groups = $derived(
    GROUPS.map((group) => ({ group, entries: SECTIONS.filter((entry) => entry.group === group && text("sections", entry.id).toLowerCase().includes(needle)) })).filter(
      (group) => group.entries.length,
    ),
  );
  const current = $derived(BY_ID[section]);
  const name = $derived(profile?.displayName || profile?.userId || "");

  const partIndex = $derived(Math.max(0, current.parts.indexOf(part)));

  $effect(() => {
    const root = pane;
    const parts = current.parts;
    part = parts[0];
    if (!root) return;
    let frame = 0;
    const spy = () => {
      frame = 0;
      const anchors = parts.map((id) => root.querySelector<HTMLElement>(`[data-part="${id}"]`));
      const range = root.scrollHeight - root.clientHeight;
      const progress = range > 4 ? Math.min(1, root.scrollTop / range) : 0;
      const line = root.getBoundingClientRect().top + root.clientHeight * (0.3 + 0.7 * progress ** 2);
      const passed = anchors.reduce((last, node, index) => (node && node.getBoundingClientRect().top <= line ? index : last), 0);
      Date.now() > pinned && (part = parts[progress >= 0.99 ? parts.length - 1 : passed]);
    };
    const onscroll = () => (frame ||= requestAnimationFrame(spy));
    const settle = () => (pinned = 0);
    root.addEventListener("scroll", onscroll, { passive: true });
    root.addEventListener("scrollend", settle);
    return () => (cancelAnimationFrame(frame), root.removeEventListener("scroll", onscroll), root.removeEventListener("scrollend", settle));
  });

  const jump = (id: string) => {
    part = id;
    pinned = Date.now() + 600;
    pane?.querySelector(`[data-part="${id}"]`)?.scrollIntoView({ behavior: reducesMotion() ? "auto" : "smooth", block: "start" });
  };

  const go = (id: SettingsSection) => {
    (id === section || !guardUnsaved()) && ((section = id), (paged = true), pane?.scrollTo({ top: 0 }));
  };

  const close = () => !guardUnsaved() && ((document.activeElement as HTMLElement | null)?.blur(), exit.close());
  const back = () => !guardUnsaved() && (paged = false);

  const leave = async () => {
    leaving = true;
    await signOut();
    location.replace(ROUTES.login);
  };

  const meItems = (): MenuItem[] => [
    { id: "me-edit", label: text("edit_profile"), icon: MENU_ICONS.edit, run: () => go("profile") },
    { id: "me-name", label: getLocalisedText(undefined, "entity_menu", "copy_name") as string, icon: MENU_ICONS.copy, run: () => copied(name) },
    { id: "me-id", label: text("account", "copy_id"), icon: MENU_ICONS.id, run: () => copied(profile?.userId ?? "", "user_id_copied", "id") },
  ];

  onMount(() => {
    const escape = (event: KeyboardEvent) => {
      const owner = (event.target as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]');
      event.key === "Escape" && !confirming && (!owner || owner === modal) && close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
</script>

<div class="settings-layer" class:closing={exit.closing} class:paged role="presentation" use:portal>
  <button type="button" class="settings-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="settings-card row-nw" role="dialog" aria-modal="true" aria-label={text("title")} tabindex="-1" bind:this={modal} inert={exit.closing} onanimationend={exit.onanimationend}>
    <nav class="settings-nav col" aria-label={text("title")}>
      <div class="nav-top row-nw align-centre gap-xs">
        <button type="button" class="me ghost press row-nw align-centre gap-sm flex-max min-0" onclick={() => go("profile")} use:menu={meItems}>
          <Avatar {name} url={profile?.avatarUrl} size="48px" radius="50%" />
          <span class="col min-0">
            <span class="md truncate me-name">{name}</span>
            <span class="sm row-nw align-centre gap-xs me-edit">{text("edit_profile")}<Icon name="edit" size={12} /></span>
          </span>
        </button>
        <button type="button" class="round nav-close ghost press" aria-label={text("close")} onclick={close}><Icon name="close" /></button>
      </div>

      <label class="search row-nw align-centre gap-sm">
        <span class="faint row-nw"><Icon name="search" size={16} /></span>
        <input class="flex-max min-0" type="search" placeholder={text("search")} aria-label={text("search")} bind:value={query} />
      </label>

      <div class="groups col">
        {#each groups as { group, entries } (group)}
          <div class="group col">
            <h2 class="group-title">{text("groups", group)}</h2>
            {#each entries as entry (entry.id)}
              {@const selected = section === entry.id}
              <button type="button" class="nav-item ghost press row-nw align-centre gap-sm md" aria-current={selected ? "page" : undefined} onclick={() => go(entry.id)}>
                <Icon name={entry.icon} size={20} />
                <span class="flex-max truncate">{text("sections", entry.id)}</span>
                <span class="chevron row-nw"><Icon name="next" size={16} /></span>
              </button>
              {#if selected}
                <div class="subnav col" style:--index={partIndex}>
                  <span class="subnav-mark" aria-hidden="true"></span>
                  {#each entry.parts as id (id)}
                    <button type="button" class="sub-item ghost sm truncate" aria-current={part === id ? "location" : undefined} onclick={() => jump(id)}>{text("parts", id)}</button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="xs faint empty">{text("no_results")}</p>
        {/each}
      </div>

      <div class="nav-foot">
        <button type="button" class="nav-item danger-item ghost press row-nw align-centre gap-sm md" onclick={() => (confirming = true)}>
          <Icon name="signout" size={20} />
          <span>{signOutLabel}</span>
        </button>
      </div>
    </nav>

    <main class="settings-pane col flex-max min-0" bind:this={pane}>
      <header class="pane-head row-nw align-centre gap-sm">
        <button type="button" class="round pane-back ghost press" aria-label={text("back")} onclick={back}><Icon name="back" size={20} /></button>
        <h2 class="md flex-max truncate pane-title">{text("sections", section)}</h2>
        <button type="button" class="round pane-close ghost press" aria-label={text("close")} use:tooltip={{ text: "Esc", placement: "bottom" }} onclick={close}><Icon name="close" /></button>
      </header>
      {#key section}
        <div class="pane-body col">
          <current.view {go} />
        </div>
      {/key}
    </main>
  </div>
</div>

{#if confirming}
  <ConfirmDialog title={text("sign_out_title")} body={text("sign_out_body")} cancelLabel={text("cancel")} confirmLabel={signOutLabel} busy={leaving} onconfirm={leave} onclose={() => (confirming = false)} />
{/if}

<style>
  .settings-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    display: grid;
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
    overflow: hidden;
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

  .me {
    min-height: 56px;
    padding: 4px 8px;
    border-radius: 8px;
    gap: 12px;
    text-align: left;
  }

  .me:hover {
    background-color: var(--colours-surface-hover);
  }

  .me-name {
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .me-edit {
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-fast) var(--sheet);
  }

  .me:hover .me-edit {
    color: var(--colours-accent);
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
    .settings-pane {
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
    .paged .settings-pane {
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
  }
</style>
