<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { leaveCall } from "../../scripts/stores/calls";
  import { toEntity } from "../../scripts/stores/entities";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { openJoined } from "../../scripts/stores/navigation.svelte";
  import { settingsOpen, settingsSection } from "../../scripts/stores/settings";
  import { deafened, muted, pttHeld, toggleDeafen, toggleMute, voice, voicePrefs } from "../../scripts/stores/voice";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Icon from "../settings/Icon.svelte";
  import { SETTINGS_ICONS } from "../settings/icons";

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  let last = $state.raw($voice);
  $effect(() => void ($voice && (last = $voice)));

  const shown = $derived(last);
  const room = $derived(shown && $rooms[shown.roomId] ? toEntity($rooms[shown.roomId], $session?.userId) : null);
  const status = $derived(shown?.status === "connected" ? "connected" : (shown?.status ?? "connecting"));
  const quality = $derived(shown?.status === "connected" ? shown.quality : "unknown");
  const open = () => shown && openJoined(shown.roomId);
  const settings = () => (settingsSection.set("voice"), settingsOpen.set(true));

  const items = (): MenuItem[] => [
    { id: "voice-open", label: text("open_room"), icon: MENU_ICONS.jump, run: open },
    { id: "voice-mute", label: text($muted ? "unmute" : "mute"), icon: $muted ? SETTINGS_ICONS.mic : SETTINGS_ICONS.micOff, separated: true, run: toggleMute },
    { id: "voice-deafen", label: text($deafened ? "undeafen" : "deafen"), icon: $deafened ? SETTINGS_ICONS.headphones : SETTINGS_ICONS.headphonesOff, run: toggleDeafen },
    { id: "voice-settings", label: text("settings"), icon: MENU_ICONS.settings, separated: true, run: settings },
    { id: "voice-leave", label: text("disconnect"), icon: SETTINGS_ICONS.hangup, danger: true, run: leaveCall },
  ];

  const muteItems = (): MenuItem[] => [items()[1], items()[3]];
  const deafenItems = (): MenuItem[] => [items()[2], items()[3]];
  const leaveItems = (): MenuItem[] => [items()[4]];
</script>

<div class="voice-slot" class:open={!!$voice} inert={!$voice}>
  <div class="voice-inner">
    <section class="voice col gap-sm" aria-label={text("connected")} use:menu={items}>
      <div class="row-nw align-centre gap-sm">
        <button type="button" class="info ghost press col min-0 flex-max" onclick={open}>
          <span class="state row-nw align-centre gap-xs sm bold" data-status={status} data-quality={quality} use:tooltip={text(`quality_${quality}`)}>
            <span class="bars" aria-hidden="true"><Icon name="signal" size={16} /></span>
            <span class="truncate">{text(status)}</span>
          </span>
          <span class="where xs muted truncate">{room?.name ?? ""}{shown?.kind === "legacy" ? ` / ${text("legacy")}` : ""}</span>
        </button>
        <button type="button" class="round action ghost press danger" aria-label={text("disconnect")} use:tooltip={text("disconnect")} onclick={leaveCall} use:menu={leaveItems}>
          <Icon name="hangup" size={20} />
        </button>
      </div>
      <div class="row-nw gap-xs">
        <button type="button" class="action wide ghost press" class:off={$muted || $deafened} class:held={$voicePrefs.pushToTalk && $pttHeld} aria-pressed={$muted} aria-label={text($muted ? "unmute" : "mute")} use:tooltip={text($muted ? "unmute" : "mute")} onclick={toggleMute} use:menu={muteItems}>
          <Icon name={$muted || $deafened ? "micOff" : "mic"} size={18} />
        </button>
        <button type="button" class="action wide ghost press" class:off={$deafened} aria-pressed={$deafened} aria-label={text($deafened ? "undeafen" : "deafen")} use:tooltip={text($deafened ? "undeafen" : "deafen")} onclick={toggleDeafen} use:menu={deafenItems}>
          <Icon name={$deafened ? "headphonesOff" : "headphones"} size={18} />
        </button>
        <button type="button" class="action wide ghost press" aria-label={text("settings")} use:tooltip={text("settings")} onclick={settings} use:menu={() => [items()[3]]}>
          <Icon name="gear" size={18} />
        </button>
      </div>
    </section>
  </div>
</div>

<style>
  .voice-slot {
    display: grid;
    grid-template-rows: 0fr;
    flex: none;
    opacity: 0;
    translate: 0 12px;
    transition:
      grid-template-rows 420ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      translate 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .voice-slot.open {
    grid-template-rows: 1fr;
    opacity: 1;
    translate: 0 0;
  }

  .voice-inner {
    min-height: 0;
    overflow: hidden;
  }

  .voice {
    padding: 8px var(--azure-spacing-sm) 6px;
    padding-left: max(var(--azure-spacing-sm), env(safe-area-inset-left));
    background-color: color-mix(in oklab, var(--colours-foreground) 70%, black);
    border-top: 1px solid var(--colours-outline-hairline);
    border-right: 1px solid var(--colours-outline-hairline);
  }

  .info {
    align-items: flex-start;
    text-align: start;
    padding: 2px 4px;
    border-radius: 8px;
  }

  .state {
    color: var(--colours-success);
    transition: color 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .state[data-status="connecting"],
  .state[data-status="ringing"],
  .state[data-status="reconnecting"],
  .state[data-quality="poor"] {
    color: var(--colours-warning, #f0b232);
  }

  .state[data-quality="lost"] {
    color: var(--colours-danger);
  }

  .state[data-status="connecting"] .bars,
  .state[data-status="ringing"] .bars,
  .state[data-status="reconnecting"] .bars {
    animation: pulse 1.4s cubic-bezier(0.32, 0.72, 0, 1) infinite alternate;
  }

  .bars {
    display: grid;
  }

  .action {
    display: grid;
    place-items: center;
    height: 34px;
    min-width: 34px;
    border-radius: 10px;
    color: var(--colours-text-muted);
    transition:
      background-color 280ms cubic-bezier(0.32, 0.72, 0, 1),
      color 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .action:hover {
    background: color-mix(in oklab, white 7%, transparent);
    color: var(--colours-text-strong);
  }

  .wide {
    flex: 1;
  }

  .action.off {
    color: var(--colours-danger);
    background: color-mix(in oklab, var(--colours-danger) 14%, transparent);
  }

  .action.held {
    color: var(--colours-success);
    background: color-mix(in oklab, var(--colours-success) 16%, transparent);
  }

  .action.danger {
    color: var(--colours-danger);
  }

  .action.danger:hover {
    background: var(--colours-danger);
    color: white;
  }

  @keyframes pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.35;
    }
  }
</style>
