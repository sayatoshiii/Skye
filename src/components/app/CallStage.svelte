<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { identityOf } from "../../scripts/matrix/utilities/rtc";
  import { fetchProfile } from "../../scripts/matrix/utilities/profile";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { zoomable } from "../../scripts/misc/zoom";
  import { idle, pictureInPicture, pipSupported } from "../../scripts/misc/screen";
  import { userMenuItems } from "../../scripts/misc/usermenu";
  import { mediaSettings, setShowCallEvents } from "../../scripts/settings/media";
  import { leaveCall, placeCall, ringAgain, ringing, stopRinging } from "../../scripts/stores/calls";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { settingsOpen, settingsSection } from "../../scripts/stores/settings";
  import type { Track } from "livekit-client";
  import { volumeItems } from "../../scripts/misc/voicemenu";
  import {
    callMedia,
    callMembers,
    cameraOn,
    deafened,
    joinable,
    joinVoice,
    memberIdentities,
    muted,
    ringingRooms,
    screenOn,
    screenSupported,
    speaking,
    userOfIdentity,
    userVolumes,
    setStreamVolume,
    toggleCamera,
    toggleDeafen,
    toggleMute,
    toggleScreen,
    voice,
    type CallMedia,
  } from "../../scripts/stores/voice";
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

  const identitiesOf = (userId: string) =>
    members.filter((member) => member.userId === userId).flatMap((member) => $memberIdentities[identityOf(member.userId, member.deviceId)] ?? [identityOf(member.userId, member.deviceId)]);

  const mediaFor = (userId: string, identities: string[]) =>
    [...new Map($callMedia.map((media) => [media.id, media])).values()].filter((media) => here && media.track.mediaStreamTrack?.readyState !== "ended" && (identities.includes(media.identity) || (media.local && userId === $session?.userId)));

  type Tile = { id: string; userId: string; screen: boolean; pending: boolean; identities: string[]; video?: CallMedia };

  const tiles: Tile[] = $derived(
    [...new Set(ids)].flatMap((userId) => {
      const identities = identitiesOf(userId);
      const media = mediaFor(userId, identities);
      return [
        { id: userId, userId, screen: false, pending: direct && here && userId === other && calling, identities, video: media.find((entry) => entry.source === "camera") },
        ...media.filter((entry) => entry.source === "screen").map((entry) => ({ id: `screen:${entry.id}`, userId, screen: true, pending: false, identities: [], video: entry })),
      ];
    }),
  );

  let fetched = $state<Record<string, { displayName?: string; avatarUrl?: string } | null>>({});
  $effect(() => {
    ids.filter((userId) => !summary?.members[userId]?.avatarUrl && !(userId in fetched)).forEach((userId) => ((fetched[userId] = null), fetchProfile(userId).then((profile) => (fetched[userId] = profile))));
  });
  let spotlight = $state<string | null>(null);
  const focused = $derived(tiles.some((tile) => tile.id === spotlight) ? spotlight : null);
  const strip = $derived(focused ? tiles.filter((tile) => tile.id !== focused) : tiles);

  let width = $state(0);
  let height = $state(0);

  const columns = $derived(
    Array.from({ length: Math.max(strip.length, 1) }, (_, index) => index + 1).reduce(
      (best, count) => {
        const rows = Math.ceil(strip.length / count);
        const score = Math.min(width / count, (height / Math.max(rows, 1)) * 1.6);
        return score > best.score ? { count, score } : best;
      },
      { count: 1, score: -1 },
    ).count,
  );
  const rows = $derived(Math.max(1, Math.ceil(strip.length / columns)));

  const STAGE = 76;

  const placeGrid = (index: number) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, strip.length - row * columns);
    return { x: (index - row * columns) * (100 / inRow), y: row * (100 / rows), w: 100 / inRow, h: 100 / rows };
  };

  const placeStrip = (index: number) => {
    const size = Math.min(100 / Math.max(strip.length, 1), 25);
    return { x: (100 - strip.length * size) / 2 + index * size, y: STAGE, w: size, h: 100 - STAGE };
  };

  const place = (tile: Tile) => {
    const index = Math.max(0, strip.findIndex((entry) => entry.id === tile.id));
    return tile.id === focused ? { x: 0, y: 0, w: 100, h: strip.length ? STAGE : 100 } : focused ? placeStrip(index) : placeGrid(index);
  };

  const toggleSpot = (id: string) => (spotlight = focused === id ? null : id);
  const focusTile = (id: string) => ((spotlight = id), (staged = true), (chatOpen = false));

  const attach = (node: HTMLVideoElement, track?: Track) => {
    let current = track;
    current?.attach(node);
    return {
      update: (next?: Track) => (current?.detach(node), (current = next), next?.attach(node)),
      destroy: () => void current?.detach(node),
    };
  };

  const feed = (_node: Element) => ({ duration: readDuration("--azure-duration-slow", 420), easing: fluid, css: (t: number) => `opacity: ${t};` });

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
  let fullTile = $state<string | null>(null);
  $effect(() => {
    const sync = () => (fullTile = (document.fullscreenElement as HTMLElement | null)?.dataset.tile ?? null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  });
  const tileNode = (id: string) => document.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`);
  const fullscreen = (id: string) => void (fullTile === id ? document.exitFullscreen() : tileNode(id)?.requestFullscreen())?.catch(() => undefined);
  const pip = (id: string) => pictureInPicture(tileNode(id)?.querySelector("video"));
  const tileItems = (tile: Tile): MenuItem[] => [
    ...(tile.screen ? [{ id: "tile-fullscreen", label: text(fullTile === tile.id ? "fullscreen_exit" : "fullscreen"), icon: fullTile === tile.id ? MENU_ICONS.fullscreenExit : MENU_ICONS.fullscreen, run: () => fullscreen(tile.id) }] : []),
    ...(tile.screen && pipSupported ? [{ id: "tile-pip", label: text("pip"), icon: MENU_ICONS.pip, run: () => pip(tile.id) }] : []),
    { id: "tile-spot", label: text(focused === tile.id ? "unspotlight" : "spotlight"), icon: focused === tile.id ? SETTINGS_ICONS.collapse : SETTINGS_ICONS.expand, run: () => toggleSpot(tile.id) },
    ...(tile.screen ? volumeItems(tile.userId).filter((item) => item.id === "voice-stream-volume").map((item) => ({ ...item, separated: true })) : [...userMenuItems(tile.userId, roomId).map((item, index) => (index ? item : { ...item, separated: true })), ...volumeItems(tile.userId)]),
  ];
  const cameraItems = (): MenuItem[] => [
    { id: "stage-camera", label: text($cameraOn ? "camera_off" : "camera_on"), icon: $cameraOn ? SETTINGS_ICONS.cameraOff : SETTINGS_ICONS.camera, run: toggleCamera },
    { id: "stage-camera-settings", label: text("settings"), icon: MENU_ICONS.settings, separated: true, run: openVoiceSettings },
  ];
  const screenItems = (): MenuItem[] => [{ id: "stage-screen", label: text($screenOn ? "screen_stop" : "screen_start"), icon: $screenOn ? SETTINGS_ICONS.screenOff : SETTINGS_ICONS.screen, run: toggleScreen }];
  const muteItems = (): MenuItem[] => [{ id: "stage-mute", label: text($muted ? "unmute" : "mute"), icon: $muted ? SETTINGS_ICONS.mic : SETTINGS_ICONS.micOff, run: toggleMute }];
  const deafenItems = (): MenuItem[] => [{ id: "stage-deafen", label: text($deafened ? "undeafen" : "deafen"), icon: $deafened ? SETTINGS_ICONS.headphones : SETTINGS_ICONS.headphonesOff, run: toggleDeafen }];
  const leaveItems = (): MenuItem[] => [{ id: "stage-leave", label: text(direct ? "hang_up" : "leave"), icon: SETTINGS_ICONS.hangup, danger: true, run: leaveCall }];
  const stopItems = (): MenuItem[] => [{ id: "stage-stop-ring", label: text("stop_ringing"), icon: SETTINGS_ICONS.hangup, run: () => stopRinging(roomId) }, ...leaveItems()];
  const ringItems = (): MenuItem[] => [{ id: "stage-ring", label: text("ring_again"), icon: SETTINGS_ICONS.call, run: () => ringAgain(roomId) }, ...leaveItems()];
</script>

<div class="stage-slot" class:open class:staged={staged && open} inert={!open}>
  <section class="stage col" class:direct aria-label={text("in_voice").replace("{count}", String(tiles.length))} use:menu={stageItems}>
    <div class="tiles" bind:clientWidth={width} bind:clientHeight={height}>
      {#each tiles as tile (tile.id)}
        {@const profile = summary?.members[tile.userId]?.avatarUrl ? summary?.members[tile.userId] : { ...summary?.members[tile.userId], ...fetched[tile.userId] }}
        {@const name = profile?.displayName || tile.userId.slice(1).split(":")[0]}
        {@const self = tile.userId === $session?.userId}
        {@const talking = here && !tile.screen && (tile.identities.some((identity) => $speaking.has(identity)) || [...$speaking].some((identity) => userOfIdentity(identity) === tile.userId))}
        {@const spot = place(tile)}
        <div class="tile-cell" out:leaveTile style:--x="{spot.x}%" style:--y="{spot.y}%" style:--w="{spot.w}%" style:--h="{spot.h}%">
          <div
            class="tile col align-centre justify-centre gap-md"
            class:talking
            class:pending={tile.pending}
            class:video={!!tile.video}
            class:spot={tile.id === focused}
            data-tile={tile.id}
            role="button"
            tabindex="0"
            aria-label={tile.screen ? text("screen_of").replace("{name}", name) : name}
            aria-pressed={tile.id === focused}
            onclick={() => toggleSpot(tile.id)}
            ondblclick={() => (tile.screen ? fullscreen(tile.id) : focusTile(tile.id))}
            onkeydown={(event) => event.key === "Enter" && toggleSpot(tile.id)}
            use:menu={() => tileItems(tile)}
            use:zoomable={tile.screen && !!tile.video}
            use:idle
          >
            {#if tile.video}
              <video class="feed" class:contain={tile.screen} class:mirror={tile.video.local && !tile.screen} use:attach={tile.video?.track} transition:feed muted playsinline></video>
            {/if}
            <span class="ring"><Avatar {name} url={profile?.avatarUrl} size="var(--avatar)" radius="50%" /></span>
            <span class="tile-name row-nw align-centre sm bold">
              <span class="truncate"><EmojiText text={tile.screen ? text("screen_of").replace("{name}", name) : name} /></span>
              <span class="bars" class:shown={talking} aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="flag" class:shown={tile.pending || (!tile.screen && self && here && ($muted || $deafened))} class:calling={tile.pending}><Icon name={tile.pending ? "call" : $deafened ? "headphonesOff" : "micOff"} size={14} /></span>
            </span>
            <span class="ringing-label xs muted" class:shown={tile.pending}>{text("ringing")}</span>
            {#if tile.screen}
              <div class="screen-ui" onclick={(event) => event.stopPropagation()} ondblclick={(event) => event.stopPropagation()} role="presentation">
                <span class="screen-top row-nw align-centre md bold"><span class="truncate"><EmojiText text={text("screen_of").replace("{name}", name)} /></span></span>
                <div class="screen-bar row-nw align-centre gap-sm">
                  {#if !self}
                    <label class="screen-volume row-nw align-centre gap-xs" use:menu={() => volumeItems(tile.userId).filter((item) => item.id === "voice-stream-volume")}>
                      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.volume} /></svg>
                      <input type="range" min="0" max="200" step="5" aria-label={text("stream_volume")} value={Math.round(($userVolumes[tile.userId]?.stream ?? 1) * 100)} oninput={(event) => setStreamVolume(tile.userId, Number(event.currentTarget.value) / 100)} />
                    </label>
                  {/if}
                  {#if pipSupported}
                    <button type="button" class="ghost round screen-control press" aria-label={text("pip")} use:tooltip={text("pip")} onclick={() => pip(tile.id)} use:menu={() => tileItems(tile)}>
                      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.pip} /></svg>
                    </button>
                  {/if}
                  <button type="button" class="ghost round screen-control press" aria-label={text("fullscreen_exit")} use:tooltip={text("fullscreen_exit")} onclick={() => fullscreen(tile.id)} use:menu={() => tileItems(tile)}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.fullscreenExit} /></svg>
                  </button>
                </div>
              </div>
              {#if pipSupported}
                <button type="button" class="ghost round full-button pip-button press" aria-label={text("pip")} use:tooltip={text("pip")} onclick={(event) => (event.stopPropagation(), pip(tile.id))} ondblclick={(event) => event.stopPropagation()} use:menu={() => tileItems(tile)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.pip} /></svg>
                </button>
              {/if}
              <button type="button" class="ghost round full-button press" aria-label={text("fullscreen")} use:tooltip={text("fullscreen")} onclick={(event) => (event.stopPropagation(), fullscreen(tile.id))} ondblclick={(event) => event.stopPropagation()} use:menu={() => tileItems(tile)}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.fullscreen} /></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
      <p class="empty col align-centre justify-centre gap-xs" class:shown={!tiles.length}>
        <span class="md bold">{text("stage_empty")}</span>
        <span class="sm muted">{text("stage_join_hint")}</span>
      </p>
    </div>

    <div class="bar">
      <div class="side start row-nw align-centre">
        <span class="lock xs muted row-nw align-centre gap-xs">
          <Icon name={summary?.encryption ? "privacy" : "shield"} size={12} />
          <span class="truncate">{text(summary?.encryption ? "encrypted" : "not_encrypted")}</span>
        </span>
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
        <div class="slide" class:open={here && !legacy}>
          <button type="button" class="ghost round control press" class:on={$cameraOn} inert={!here || legacy} aria-pressed={$cameraOn} aria-label={text($cameraOn ? "camera_off" : "camera_on")} use:tooltip={text($cameraOn ? "camera_off" : "camera_on")} onclick={toggleCamera} use:menu={cameraItems}>
              <Icon name={$cameraOn ? "camera" : "cameraOff"} size={20} />
            </button>
        </div>
      </div>
      <div class="centre row-nw align-centre">
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
      </div>
      <div class="side end row-nw align-centre">
        <div class="slide" class:open={here && !legacy && screenSupported}>
          <button type="button" class="ghost round control press" class:on={$screenOn} inert={!here || legacy || !screenSupported} aria-pressed={$screenOn} aria-label={text($screenOn ? "screen_stop" : "screen_start")} use:tooltip={text($screenOn ? "screen_stop" : "screen_start")} onclick={toggleScreen} use:menu={screenItems}>
            <Icon name={$screenOn ? "screenOff" : "screen"} size={20} />
          </button>
        </div>
        <div class="slide phone-chat" class:open={staged}>
          <button type="button" class="ghost round control press" inert={!staged} aria-label={text("chat_show")} use:tooltip={text("chat_show")} onclick={() => (staged = false)} use:menu={() => [{ id: "stage-chat", label: text("chat_show"), icon: MENU_ICONS.thread, run: () => (staged = false) }]}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.thread} /></svg>
          </button>
        </div>
        <button type="button" class="ghost round control press" aria-label={text(staged ? "collapse" : "expand")} use:tooltip={text(staged ? "collapse" : "expand")} onclick={toggleStage} use:menu={stageItems}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={staged ? SETTINGS_ICONS.collapse : SETTINGS_ICONS.expand} /></svg>
        </button>
        <div class="slide desk-only" class:open={here}>
          <button type="button" class="ghost round control press" inert={!here} aria-label={text("settings")} use:tooltip={text("settings")} onclick={openVoiceSettings} use:menu={() => [{ id: "stage-settings", label: text("settings"), icon: MENU_ICONS.settings, run: openVoiceSettings }]}>
            <Icon name="gear" size={20} />
          </button>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .full-button {
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    color: white;
    opacity: 0;
    scale: 0.85;
    transition:
      opacity 280ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 280ms cubic-bezier(0.32, 0.72, 0, 1),
      background-color 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .pip-button {
    right: 50px;
  }

  .screen-ui {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: none;
    pointer-events: none;
    color: white;
  }

  .tile:fullscreen {
    border-radius: 0;
    background: black;
  }

  .tile:fullscreen .screen-ui {
    display: block;
  }

  .tile:fullscreen > :not(.feed, .screen-ui) {
    display: none;
  }

  .screen-top,
  .screen-bar {
    position: absolute;
    left: 0;
    right: 0;
    padding: 20px 24px;
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      translate 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .screen-top {
    top: 0;
    background: linear-gradient(rgb(0 0 0 / 0.6), transparent);
  }

  .screen-bar {
    bottom: 0;
    justify-content: flex-end;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.6));
  }

  .screen-bar > * {
    pointer-events: auto;
  }

  .tile:fullscreen:global(.idle) {
    cursor: none;
  }

  .tile:fullscreen:global(.idle) .screen-top {
    opacity: 0;
    translate: 0 -12px;
  }

  .tile:fullscreen:global(.idle) .screen-bar {
    opacity: 0;
    translate: 0 12px;
  }

  .screen-control {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
    color: white;
    transition: background-color 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .screen-control:hover {
    background: rgb(255 255 255 / 0.26);
  }

  .screen-volume {
    padding: 0 14px;
    height: 40px;
    border-radius: 20px;
    background: rgb(255 255 255 / 0.14);
  }

  .screen-volume input {
    width: 120px;
    accent-color: white;
  }

  .full-button svg {
    display: block;
  }

  .tile:hover .full-button {
    opacity: 1;
    scale: 1;
  }

  .full-button:hover {
    background: rgb(0 0 0 / 0.75);
  }

  .stage-slot {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    interpolate-size: allow-keywords;
    flex: none;
    height: 0;
    overflow: hidden;
    opacity: 0;
    max-height: calc(100% - var(--header-space, 57px));
    transition:
      height 520ms var(--ease),
      max-height 520ms var(--ease),
      opacity 420ms var(--ease);
  }

  .stage-slot.open {
    height: auto;
    opacity: 1;
  }

  .stage-slot.open:not(.staged) {
    max-height: min(max(45%, 220px), calc(100% - var(--header-space, 57px) - var(--composer-space, 95px) - env(safe-area-inset-bottom)));
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
    width: var(--w);
    height: var(--h);
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
    position: relative;
    overflow: hidden;
    container-type: size;
    height: 100%;
    cursor: pointer;
    padding: var(--azure-spacing-sm);
    box-sizing: border-box;
    border-radius: 16px;
    background: color-mix(in oklab, white 4%, color-mix(in oklab, var(--colours-foreground) 60%, black));
    min-width: 0;
    transition: background-color 320ms var(--ease);
  }

  .tile::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: 2px solid transparent;
    pointer-events: none;
    transition: border-color 240ms var(--ease);
  }

  .tile-cell:has(.spot) {
    z-index: 1;
  }

  .direct .tile {
    background: color-mix(in oklab, var(--colours-foreground) 60%, black);
  }

  .direct .tile.video,
  .tile.video {
    background: black;
  }

  .feed {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .feed.contain {
    object-fit: contain;
  }

  .tile .feed.contain {
    translate: var(--pan-x, 0) var(--pan-y, 0);
    scale: var(--zoom, 1);
    transition:
      translate 220ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .tile:global(.dragging) .feed.contain {
    transition: none;
  }

  .tile:global(.zoomed) {
    cursor: grab;
  }

  .tile:global(.dragging) {
    cursor: grabbing;
  }

  .feed.mirror {
    scale: -1 1;
  }

  .tile > :not(.feed, .full-button, .screen-ui) {
    position: relative;
  }

  .tile .ring {
    transition:
      opacity 420ms var(--ease),
      scale 420ms var(--ease);
  }

  .tile.video .ring {
    opacity: 0;
    scale: 0.8;
  }

  .tile.video .tile-name {
    position: absolute;
    left: 8px;
    bottom: 8px;
    max-width: calc(100% - 16px);
    padding: 3px 8px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.55);
  }

  .tile .tile-name {
    transition:
      background-color 420ms var(--ease),
      padding 420ms var(--ease);
  }


  .tile.spot::after {
    border-color: color-mix(in oklab, white 14%, transparent);
  }

  .tile.talking::after {
    border-color: var(--colours-success);
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    width: 0;
    height: 12px;
    margin-inline-start: 0;
    overflow: hidden;
    opacity: 0;
    scale: 0.6;
    transition:
      width 320ms var(--ease),
      margin-inline-start 320ms var(--ease),
      opacity 240ms var(--ease),
      scale 240ms var(--ease);
  }

  .bars.shown {
    width: 12px;
    margin-inline-start: 6px;
    opacity: 1;
    scale: 1;
  }

  .bars i {
    flex: none;
    width: 2.5px;
    height: 100%;
    border-radius: 2px;
    background: var(--colours-success);
    transform-origin: bottom;
    animation: bar 900ms var(--ease) infinite alternate;
  }

  .bars i:nth-child(2) {
    animation-delay: -300ms;
  }

  .bars i:nth-child(3) {
    animation-delay: -600ms;
  }

  @keyframes bar {
    from {
      scale: 1 0.3;
    }
  }

  .tile:focus-visible {
    outline: none;
  }

  .direct .tile.talking::after {
    border-color: transparent;
  }

  .ring {
    display: grid;
    border-radius: 50%;
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    min-width: 0;
  }

  .side {
    min-width: 0;
  }

  .side.start {
    justify-content: flex-end;
  }

  .side.end {
    justify-content: flex-start;
  }

  .side > *,
  .centre > * {
    margin-inline: 4px;
  }

  .side > .slide,
  .centre > .slide {
    margin-inline: 0;
    overflow: hidden;
  }

  .lock {
    flex: 1 1 0;
    min-width: 0;
  }

  @media (min-width: 768px) {
    .phone-chat {
      display: none;
    }
  }

  @media (max-width: 767px) {
    .desk-only {
      display: none;
    }
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

  .control.on {
    background: color-mix(in oklab, white 88%, transparent);
    color: black;
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
    .lock {
      display: none;
    }

    .control {
      width: 40px;
      height: 40px;
    }

    .control.leave {
      width: 52px;
    }

    .side > *,
    .centre > *,
    .slide > * {
      margin-inline: 3px;
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
