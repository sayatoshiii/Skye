<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ownProfile } from "../../scripts/stores/matrix";
  import { ownStatus, profileFields, serverPresence, setOwnStatus, statusMessage, type StatusMode } from "../../scripts/stores/presence";
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
    ...(lacking ? [{ id: "note", label: text("status", "unsupported"), icon: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", disabled: true, run: () => undefined }] : []),
    ...(["online", "idle", "dnd", "invisible"] as const).map((mode) => ({
      id: mode,
      label: `${text("status", mode)}${$ownStatus.mode === mode ? " ✓" : ""}`,
      icon: ICONS[mode],
      filled: true,
      colour: MODE_COLOURS[mode],
      run: () => setMode(mode),
    })),
    { id: "custom", label: text("status", message ? "edit_custom" : "custom"), icon: ICONS.custom, run: openEditor },
    ...(message
      ? [{ id: "clear", label: text("status", "clear_custom"), icon: ICONS.clear, run: () => setOwnStatus({ mode: $ownStatus.mode }) }]
      : []),
  ]);

  const open = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left, y: rect.top - 8 };
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
  >
    <PresenceDot userId={$ownProfile?.userId} size={40} hint={$serverPresence === "unsupported" ? text("status", "unsupported") : undefined}>
      <Avatar name={name} url={$ownProfile?.avatarUrl} size="40px" radius="50%" />
    </PresenceDot>
    <span class="col min-0">
      <span class="name bold md truncate">{name}</span>
      <span class="sm muted truncate"><EmojiText text={subtitle} /></span>
      <span class="id xs faint truncate">{userId}</span>
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
    margin: calc(var(--azure-spacing-xs) * -1);
    padding: var(--azure-spacing-xs);
    border-radius: var(--azure-radius-sm);
    text-align: left;
  }

  .trigger:hover {
    background-color: var(--colours-surface-hover);
  }

  .name {
    color: var(--colours-text-strong);
  }

</style>
