<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { identityOf } from "../../scripts/matrix/utilities/rtc";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { userMenuItems } from "../../scripts/misc/usermenu";
  import { mediaSettings, setShowCallEvents } from "../../scripts/settings/media";
  import { leaveCall, placeCall, ringAgain, ringing, stopRinging } from "../../scripts/stores/calls";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { settingsOpen, settingsSection } from "../../scripts/stores/settings";
  import { callMembers, deafened, joinable, ringingRooms, joinVoice, muted, speaking, toggleDeafen, toggleMute, voice } from "../../scripts/stores/voice";
  import { fluid, readDuration } from "../auth/motion";
  import Icon from "../settings/Icon.svelte";
  import { SETTINGS_ICONS } from "../settings/icons";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";

  let {
    roomId,
    staged = $bindable(false),
    chatOpen = $bindable(false),
    active = $bindable(false),
  }: { roomId: string; staged?: boolean; chatOpen?: boolean; active?: boolean } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  const summary = $derived($rooms[roomId]);
  const direct = $derived(!!summary?.isDirect);
  const members = $derived($callMembers[roomId] ?? []);
  const here = $derived($voice?.roomId === roomId);
  const legacy = $derived(here && $voice?.kind === "legacy");
  const open = $derived(members.length > 0 || $joinable.has(roomId) || here);
  const other = $derived(summary?.directUserId ?? "");
  const present = $derived(new Set(members.map((member) => member.userId)));
  const waiting = $derived(here && direct && (legacy ? $ringing === "out" : !present.has(other)));
  const calling = $derived(waiting && (legacy || !!$ringingRooms[roomId]));

  $effect(() => void (active = open));

  const ids = $derived(
    direct && here
      ? [$session?.userId ?? "", other].filter(Boolean)
      : [...present],
  );

  const tiles = $derived(
    ids.map((userId) => ({
      userId,
      pending: direct && here && userId === other && calling,
      identities: members.filter((member) => member.userId === userId).map((member) => identityOf(member.userId, member.deviceId)),
    })),
  );

  let width = $state(0);
  let height = $state(0);

  const columns = $derived(
    Array.from({ length: Math.max(tiles.length, 1) }, (_, index) => index + 1).reduce(
      (best, count) => {
        const rows = Math.ceil(tiles.length / count);
        const score = Math.min(width / count, (height / Math.max(rows, 1)) * 1.6);
        return score > best.score ? { count, score } : best;
      },
      { count: 1, score: -1 },
    ).count,
  );
  const rows = $derived(Math.max(1, Math.ceil(tiles.length / columns)));

  const place = (index: number) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, tiles.length - row * columns);
    const offset = (columns - inRow) / 2;
    return { x: ((index % columns) + offset) * (100 / columns), y: row * (100 / rows) };
  };

  const leaveTile = (_node: Element) => ({ duration: readDuration("--azure-duration-slow", 420), easing: fluid, css: (t: number) => `opacity: ${t}; scale: ${0.9 + t * 0.1};` });

  const join = () => (direct ? placeCall(roomId) : joinVoice(roomId));
  const label = $derived(text(members.length ? "join" : direct ? "call" : "start"));

  const openVoiceSettings = () => (settingsSection.set("voice"), settingsOpen.set(true));
  const toggleStage = () => ((staged = !staged), (chatOpen = false));
  const toggleEvents = () => setShowCallEvents(!$mediaSettings.showCallEvents);

  const stageItems = (): MenuItem[] => [
    { id: "stage-size", label: text(staged ? "collapse" : "expand"), icon: staged ? SETTINGS_ICONS.collapse : SETTINGS_ICONS.expand, run: toggleStage },
    { id: "stage-events", label: text($mediaSettings.showCallEvents ? "events_hide" : "events_show"), icon: $mediaSettings.showCallEvents ? MENU_ICONS.hide : MENU_ICONS.show, separated: true, run: toggleEvents },
  ];
  const joinItems = (): MenuItem[] => [{ id: "stage-join", label, icon: direct ? SETTINGS_ICONS.call : SETTINGS_ICONS.headphones, run: join }, ...stageItems()];
  const muteItems = (): MenuItem[] => [{ id: "stage-mute", label: text($muted ? "unmute" : "mute"), icon: $muted ? SETTINGS_ICONS.mic : SETTINGS_ICONS.micOff, run: toggleMute }];
  const deafenItems = (): MenuItem[] => [{ id: "stage-deafen", label: text($deafened ? "undeafen" : "deafen"), icon: $deafened ? SETTINGS_ICONS.headphones : SETTINGS_ICONS.headphonesOff, run: toggleDeafen }];
  const leaveItems = (): MenuItem[] => [{ id: "stage-leave", label: text(direct ? "hang_up" : "leave"), icon: SETTINGS_ICONS.hangup, danger: true, run: leaveCall }];
  const stopItems = (): MenuItem[] => [{ id: "stage-stop-ring", label: text("stop_ringing"), icon: SETTINGS_ICONS.hangup, run: () => stopRinging(roomId) }, ...leaveItems()];
  const ringItems = (): MenuItem[] => [{ id: "stage-ring", label: text("ring_again"), icon: SETTINGS_ICONS.call, run: () => ringAgain(roomId) }, ...leaveItems()];
</script>

<div class="stage-slot" class:open class:staged={staged && open} inert={!open}>
  <section class="stage col" class:direct aria-label={text("in_voice").replace("{count}", String(tiles.length))} use:menu={stageItems}>
    <div class="tiles" bind:clientWidth={width} bind:clientHeight={height} style:--cols={columns} style:--rows={rows}>
      {#each tiles as tile, index (tile.userId)}
        {@const profile = summary?.members[tile.userId]}
        {@const name = profile?.displayName || tile.userId.slice(1).split(":")[0]}
        {@const self = tile.userId === $session?.userId}
        {@const talking = here && tile.identities.some((identity) => $speaking.has(identity))}
        {@const spot = place(index)}
        <div class="tile-cell" out:leaveTile style:--x="{spot.x}%" style:--y="{spot.y}%">
          <div class="tile col align-centre justify-centre gap-sm" class:talking class:pending={tile.pending} use:menu={() => userMenuItems(tile.userId, roomId)}>
            <span class="ring"><Avatar {name} url={profile?.avatarUrl} size="var(--avatar)" radius="50%" /></span>
            <span class="tile-name row-nw align-centre sm bold">
              <span class="truncate"><EmojiText text={name} /></span>
              <span class="flag" class:shown={tile.pending || (self && here && ($muted || $deafened))} class:calling={tile.pending}><Icon name={tile.pending ? "call" : $deafened ? "headphonesOff" : "micOff"} size={14} /></span>
            </span>
            <span class="ringing-label xs muted" class:shown={tile.pending}>{text("ringing")}</span>
          </div>
        </div>
      {/each}
      <p class="empty col align-centre justify-centre gap-xs" class:shown={!tiles.length}>
        <span class="md bold">{text("stage_empty")}</span>
        <span class="sm muted">{text("stage_join_hint")}</span>
      </p>
    </div>

    <div class="bar row-nw align-centre gap-sm">
      <span class="lock xs muted row-nw align-centre gap-xs">
        <Icon name={summary?.encryption ? "privacy" : "shield"} size={12} />
        <span class="truncate">{text(summary?.encryption ? "encrypted" : "not_encrypted")}</span>
      </span>
      <div class="controls row-nw align-centre">
        <div class="slide" class:open={waiting && !calling}>
          <button type="button" class="ghost pill ring-again press sm bold row-nw align-centre gap-xs" inert={!waiting || calling} onclick={() => ringAgain(roomId)} use:menu={ringItems}>
            <Icon name="call" size={16} />
            {text("ring_again")}
          </button>
        </div>
        <div class="slide" class:open={calling && !legacy}>
          <button type="button" class="ghost pill stop-ring press sm bold row-nw align-centre gap-xs" inert={!calling || legacy} onclick={() => stopRinging(roomId)} use:menu={stopItems}>
            <Icon name="hangup" size={16} />
            {text("stop_ringing")}
          </button>
        </div>
        <div class="slide" class:open={!here} aria-hidden="true"><span class="balance"></span></div>
        <div class="slide" class:open={here}>
          <div class="row-nw align-centre gap-sm" inert={!here}>
            <button type="button" class="ghost round control press" class:off={$muted || $deafened} aria-pressed={$muted} aria-label={text($muted ? "unmute" : "mute")} use:tooltip={text($muted ? "unmute" : "mute")} onclick={toggleMute} use:menu={muteItems}>
              <Icon name={$muted || $deafened ? "micOff" : "mic"} size={20} />
            </button>
            <button type="button" class="ghost round control press" class:off={$deafened} aria-pressed={$deafened} aria-label={text($deafened ? "undeafen" : "deafen")} use:tooltip={text($deafened ? "undeafen" : "deafen")} onclick={toggleDeafen} use:menu={deafenItems}>
              <Icon name={$deafened ? "headphonesOff" : "headphones"} size={20} />
            </button>
          </div>
        </div>
        <div class="slide" class:open={!here}>
          <button type="button" class="ghost pill join press sm bold row-nw align-centre gap-xs" inert={here} onclick={join} use:menu={joinItems}>
            <Icon name={direct ? "call" : "headphones"} size={16} />
            {label}
          </button>
        </div>
        <div class="slide" class:open={here}>
          <button type="button" class="ghost round control leave press" inert={!here} aria-label={text(direct ? "hang_up" : "leave")} use:tooltip={text(direct ? "hang_up" : "leave")} onclick={leaveCall} use:menu={leaveItems}>
            <Icon name="hangup" size={22} />
          </button>
        </div>
        <button type="button" class="ghost round control press" aria-label={text(staged ? "collapse" : "expand")} use:tooltip={text(staged ? "collapse" : "expand")} onclick={toggleStage} use:menu={stageItems}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={staged ? SETTINGS_ICONS.collapse : SETTINGS_ICONS.expand} /></svg>
        </button>
        <div class="slide" class:open={here}>
          <button type="button" class="ghost round control press" inert={!here} aria-label={text("settings")} use:tooltip={text("settings")} onclick={openVoiceSettings} use:menu={() => [{ id: "stage-settings", label: text("settings"), icon: MENU_ICONS.settings, run: openVoiceSettings }]}>
            <Icon name="gear" size={20} />
          </button>
        </div>
      </div>
      <span class="lock-spacer"></span>
    </div>
  </section>
</div>

<style>
  .stage-slot {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    interpolate-size: allow-keywords;
    flex: none;
    height: 0;
    overflow: hidden;
    opacity: 0;
    transition:
      height 520ms var(--ease),
      opacity 420ms var(--ease);
  }

  .stage-slot.open {
    height: auto;
    opacity: 1;
  }

  .stage-slot.staged {
    height: calc(100% - var(--header-space, 57px));
  }


  .stage {
    height: calc(100% - 2 * var(--azure-spacing-md));
    box-sizing: border-box;
    margin: var(--azure-spacing-md);
    padding: var(--azure-spacing-md);
    gap: var(--azure-spacing-md);
    border-radius: 18px;
    background: color-mix(in oklab, var(--colours-foreground) 60%, black);
    border: 1px solid var(--colours-outline-hairline);
    transition:
      margin 520ms var(--ease),
      border-radius 520ms var(--ease);
  }

  .staged .stage {
    height: calc(100% - 2 * var(--azure-spacing-sm));
    margin: var(--azure-spacing-sm);
    border-radius: 22px;
  }

  .tiles {
    --avatar: clamp(44px, calc(min(100cqw, 100cqh) * 0.42), 128px);
    position: relative;
    height: 188px;
    min-height: 0;
    transition: height 520ms var(--ease);
  }

  .staged .tiles {
    flex: 1;
    height: auto;
  }

  .tile-cell {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: calc(100% / var(--cols));
    height: calc(100% / var(--rows));
    padding: 4px;
    box-sizing: border-box;
    animation: tile-in 420ms var(--ease) both;
    transition:
      left 520ms var(--ease),
      top 520ms var(--ease),
      width 520ms var(--ease),
      height 520ms var(--ease);
  }

  .tile {
    container-type: size;
    height: 100%;
    padding: var(--azure-spacing-sm);
    box-sizing: border-box;
    border-radius: 16px;
    background: color-mix(in oklab, white 4%, transparent);
    box-shadow: inset 0 0 0 2px transparent;
    min-width: 0;
    transition:
      box-shadow 240ms var(--ease),
      background-color 320ms var(--ease);
  }

  .direct .tile {
    background: transparent;
  }

  .tile.talking {
    box-shadow: inset 0 0 0 2px var(--colours-success);
  }

  .direct .tile.talking {
    box-shadow: inset 0 0 0 2px transparent;
  }

  .ring {
    display: grid;
    border-radius: 50%;
    box-shadow: 0 0 0 0 transparent;
    transition:
      box-shadow 240ms var(--ease),
      opacity 420ms var(--ease);
  }

  .talking .ring {
    box-shadow: 0 0 0 3px var(--colours-success);
  }

  .pending .ring {
    animation: calling 1.6s var(--ease) infinite alternate;
  }

  .tile-name {
    max-width: 100%;
    color: var(--colours-text-strong);
  }

  .ringing-label {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 360ms var(--ease),
      opacity 360ms var(--ease);
  }

  .ringing-label.shown {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .flag {
    display: grid;
    width: 0;
    margin-inline-start: 0;
    overflow: hidden;
    color: var(--colours-danger);
    opacity: 0;
    scale: 0.6;
    transition:
      width 320ms var(--ease),
      margin-inline-start 320ms var(--ease),
      color 240ms var(--ease),
      opacity 240ms var(--ease),
      scale 240ms var(--ease);
  }

  .flag.calling {
    color: var(--colours-success);
  }

  .flag.calling :global(svg) {
    animation: ringing 1.6s var(--ease) infinite;
  }

  @keyframes ringing {
    0%,
    40%,
    100% {
      rotate: 0deg;
    }
    5%,
    15%,
    25% {
      rotate: -14deg;
    }
    10%,
    20%,
    30% {
      rotate: 14deg;
    }
  }

  .flag.shown {
    width: 14px;
    margin-inline-start: 4px;
    opacity: 1;
    scale: 1;
  }

  .empty {
    position: absolute;
    inset: 0;
    margin: 0;
    text-align: center;
    opacity: 0;
    scale: 0.96;
    pointer-events: none;
    transition:
      opacity 360ms var(--ease),
      scale 360ms var(--ease);
  }

  .empty.shown {
    opacity: 1;
    scale: 1;
  }

  .bar {
    flex: none;
    min-width: 0;
  }

  .lock,
  .lock-spacer {
    flex: 1 1 0;
    min-width: 0;
  }

  .controls {
    flex: none;
  }

  .controls > * {
    margin-inline: 4px;
  }

  .controls > .slide {
    margin-inline: 0;
    overflow: hidden;
  }

  .balance {
    display: block;
    width: 44px;
    height: 44px;
  }

  .slide > * {
    min-width: 0;
    margin-inline: 4px;
  }

  .slide {
    display: grid;
    grid-template-columns: minmax(0, 0fr);
    opacity: 0;
    scale: 0.8;
    transition:
      grid-template-columns 360ms var(--ease),
      opacity 360ms var(--ease),
      scale 360ms var(--ease);
  }

  .slide > * {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .slide.open {
    grid-template-columns: minmax(0, 1fr);
    opacity: 1;
    scale: 1;
  }

  .control {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: color-mix(in oklab, white 9%, transparent);
    color: var(--colours-text-strong);
    transition:
      background-color 280ms var(--ease),
      color 280ms var(--ease);
  }

  .control:hover {
    background: color-mix(in oklab, white 15%, transparent);
  }

  .control.off {
    background: color-mix(in oklab, var(--colours-danger) 22%, transparent);
    color: var(--colours-danger);
  }


  .control.leave {
    width: 56px;
    border-radius: 999px;
    background: var(--colours-danger);
    color: white;
  }

  .pill {
    height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    color: white;
  }

  .join {
    background: var(--colours-success);
  }

  .stop-ring {
    background: color-mix(in oklab, white 12%, transparent);
    transition: background-color 280ms var(--ease);
  }

  .stop-ring:hover {
    background: color-mix(in oklab, white 18%, transparent);
  }

  .ring-again {
    background: color-mix(in oklab, white 12%, transparent);
  }


  @media (max-width: 767px) {
    .lock-spacer {
      display: none;
    }

    .lock {
      display: none;
    }

    .bar {
      justify-content: center;
    }
  }

  @keyframes tile-in {
    from {
      opacity: 0;
      scale: 0.9;
    }
  }

  @keyframes calling {
    from {
      opacity: 1;
      scale: 1;
    }
    to {
      opacity: 0.45;
      scale: 0.94;
    }
  }
</style>
