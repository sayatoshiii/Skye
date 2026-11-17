<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ownProfile } from "../../scripts/stores/matrix";
  import { settingsOpen } from "../../scripts/stores/settings";
  import { ownStatus, profileFields, serverPresence, setOwnStatus, statusMessage, type StatusMode } from "../../scripts/stores/presence";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import StatusDialog from "./StatusDialog.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import PresenceDot from "../ui/PresenceDot.svelte";

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  const MODE_COLOURS = {
    online: "var(--colours-success)",
    idle: "var(--colours-warning)",
    dnd: "var(--colours-danger)",
    invisible: "#80848e",
  };

  const ICONS = {
    online: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z",
    idle: "M12.38 4.01A8 8 0 1 1 4.01 12.38 6 6 0 0 0 12.38 4.01Z",
    dnd: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM8 10.75h8v2.5H8Z",
    invisible: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    custom: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0",
    clear: "M6 6l12 12M18 6 6 18",
  };

  const name = $derived($ownProfile?.displayName ?? $ownProfile?.userId ?? text("profile", "placeholder", "display_name"));
  const userId = $derived($ownProfile?.userId ?? text("profile", "placeholder", "user_id"));
  const message = $derived(statusMessage($ownStatus));
  const subtitle = $derived(message ?? text("status", $ownStatus.mode));

  let menu: { x: number; y: number } | null = $state(null);
  let editing = $state(false);
  const setMode = (mode: StatusMode) => setOwnStatus({ ...$ownStatus, mode });

  const openEditor = () => (editing = true);

  const lacking = $derived($serverPresence === "unsupported" && !$profileFields);

  const items = $derived<MenuItem[]>([
    ...(lacking ? [{ id: "note", label: text("status", "unsupported"), icon: MENU_ICONS.info, disabled: true, run: () => undefined }] : []),
    ...(["online", "idle", "dnd", "invisible"] as const).map((mode) => ({
      id: mode,
      label: text("status", mode),
      selected: $ownStatus.mode === mode,
      icon: ICONS[mode],
      filled: true,
      colour: MODE_COLOURS[mode],
      run: () => setMode(mode),
    })),
    { id: "custom", label: text("status", message ? "edit_custom" : "custom"), icon: MENU_ICONS.status, run: openEditor },
    ...(message
      ? [{ id: "clear", label: text("status", "clear_custom"), icon: MENU_ICONS.close, run: () => setOwnStatus({ mode: $ownStatus.mode }) }]
      : []),
    { id: "settings", label: getLocalisedText(undefined, "settings", "open") as string, icon: MENU_ICONS.settings, run: () => settingsOpen.set(true) },
  ]);

  const open = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left, y: rect.top - 8 };
  };

  const oncontextmenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!menu) menu = { x: event.clientX, y: event.clientY };
  };
</script>

<section class="profile row-nw min-0">
  <button
    type="button"
    class="trigger ghost press row-nw gap-md align-centre min-0 flex-max"
    aria-haspopup="menu"
    aria-label={text("status", "open")}
    use:tooltip={$serverPresence === "unsupported" ? text("status", "unsupported") : undefined}
    onclick={open}
    {oncontextmenu}
  >
    <PresenceDot userId={$ownProfile?.userId} size={32} hint={$serverPresence === "unsupported" ? text("status", "unsupported") : undefined}>
      <Avatar name={name} url={$ownProfile?.avatarUrl} size="32px" radius="50%" />
    </PresenceDot>
    <span class="who col min-0">
      <span class="name bold sm truncate">{name}</span>
      <span class="roll xs">
        <span class="roll-track col">
          <span class="muted truncate"><EmojiText text={subtitle} /></span>
          <span class="faint truncate">{userId}</span>
        </span>
      </span>
    </span>
  </button>
</section>

{#if menu}
  <MessageMenu {items} x={menu.x} y={menu.y} label={text("status", "menu")} minWidth={220} onclose={() => (menu = null)} />
{/if}

{#if editing}
  <StatusDialog onclose={() => (editing = false)} />
{/if}

<style>
  .profile {
    flex: 1 1 auto;
  }

  .trigger {
    gap: 8px;
    padding: 4px 6px 4px 4px;
    border-radius: 8px;
    text-align: left;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .trigger:hover {
    background-color: var(--colours-surface-hover);
  }

  .who {
    gap: 1px;
  }

  .name {
    line-height: 18px;
    color: var(--colours-text-strong);
  }

  .roll {
    height: 15px;
    line-height: 15px;
    overflow: hidden;
  }

  .roll-track {
    transition: translate 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .trigger:hover .roll-track,
  .trigger:focus-visible .roll-track {
    translate: 0 -15px;
  }

</style>
