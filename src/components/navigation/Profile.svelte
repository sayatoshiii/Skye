<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ownProfile, presenceDetails } from "../../scripts/stores/matrix";
  import { ownStatus, profileFields, serverPresence, setOwnStatus, statusMessage, type StatusMode } from "../../scripts/stores/presence";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import StatusDialog from "./StatusDialog.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import PresenceDot from "../ui/PresenceDot.svelte";
  import { selfSpeaking } from "../../scripts/stores/voice";
  import { blur, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  let settled = $state(false);
  $effect(() => {
    const timer = setTimeout(() => (settled = true), 4000);
    return () => clearTimeout(timer);
  });

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
  const message = $derived(statusMessage($ownStatus) || ($ownProfile?.userId ? $presenceDetails[$ownProfile.userId]?.statusMessage : undefined) || undefined);
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
  {#if !$ownProfile?.displayName && !$ownProfile?.avatarUrl && !settled}
    <div class="ghost-row row-nw gap-md align-centre flex-max" aria-hidden="true" out:fade={{ duration: 180 }}>
      <span class="bone circle"></span>
      <span class="col gap-xs flex-max"><span class="bone line" style:width="58%"></span><span class="bone line" style:width="38%"></span></span>
    </div>
  {:else}
  <button
    in:blur={{ amount: 6, duration: 360, easing: cubicOut }}
    type="button"
    class="trigger ghost press row-nw gap-md align-centre min-0 flex-max"
    aria-haspopup="menu"
    aria-label={text("status", "open")}
    use:tooltip={$serverPresence === "unsupported" ? text("status", "unsupported") : undefined}
    onclick={open}
    {oncontextmenu}
  >
    <PresenceDot userId={$ownProfile?.userId} size={32} hint={$serverPresence === "unsupported" ? text("status", "unsupported") : undefined}>
      <span class="ring" class:talking={$selfSpeaking}><Avatar name={name} url={$ownProfile?.avatarUrl} size="32px" radius="50%" /></span>
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
  {/if}
</section>

{#if menu}
  <MessageMenu {items} x={menu.x} y={menu.y} label={text("status", "menu")} minWidth={220} onclose={() => (menu = null)} />
{/if}

{#if editing}
  <StatusDialog onclose={() => (editing = false)} />
{/if}

<style>
  .ghost-row {
    padding: 4px 6px;
    min-height: 44px;
  }

  .bone {
    display: block;
    flex: none;
    border-radius: var(--azure-radius-pill);
    background: linear-gradient(90deg, var(--colours-surface-hover) 20%, color-mix(in oklab, var(--colours-text-faint) 22%, transparent) 50%, var(--colours-surface-hover) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.6s linear infinite;
  }

  .bone.circle {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }

  .bone.line {
    height: 9px;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  .ring {
    display: grid;
    border-radius: 50%;
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .ring.talking {
    box-shadow: 0 0 0 2px var(--colours-success);
  }

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
