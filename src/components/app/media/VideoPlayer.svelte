<script lang="ts">
  import { tooltip } from "../../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatDuration } from "../../../scripts/matrix/utilities/content";
  import { formatBytes } from "../../../scripts/matrix/utilities/attachments";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { entityText, menu } from "../../../scripts/misc/entitymenu.svelte";
  import type { MenuItem } from "../MessageMenu.svelte";

  let {
    link,
    name,
    onerror,
    ondownload,
    size,
    width,
    height,
    sender,
    ts,
  }: { link: string; name: string; onerror: () => void; ondownload?: () => void; size?: number; width?: number; height?: number; sender?: string; ts?: number } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const VOLUME_KEY = "skye.video.volume";
  const IDLE_MS = 2000;

  const storedVolume = () => {
    try {
      const value = Number(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(value) && localStorage.getItem(VOLUME_KEY) !== null ? Math.max(0, Math.min(1, value)) : 1;
    } catch {
      return 1;
    }
  };

  let wrapper: HTMLDivElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let paused = $state(true);
  let waiting = $state(true);
  let current = $state(0);
  let total = $state(0);
  let buffered = $state(0);
  let volume = $state(storedVolume());
  let muted = $state(false);
  let fullscreen = $state(false);
  let idle = $state(false);
  let scrubbing = $state(false);
  let ended = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  let frame = 1 / 30;
  let lastMedia = -1;

  const sampleFrame = (_now: number, meta: { mediaTime: number }) => {
    const delta = meta.mediaTime - lastMedia;
    if (lastMedia >= 0 && delta > 0.004 && delta < 0.2) frame = delta;
    lastMedia = meta.mediaTime;
    if (video && !video.paused) (video as any).requestVideoFrameCallback?.(sampleFrame);
  };

  const stepFrame = (direction: number) => {
    if (!video) return;
    if (!video.paused) video.pause();
    seekBy(direction * frame);
  };

  let hover: number | null = $state(null);
  let near = $state(false);
  const NEAR_PX = 14;

  const meta = $derived(
    [
      size ? formatBytes(size) : "",
      width && height ? `${width}×${height}` : "",
      total ? formatDuration(total * 1000) : "",
      sender ?? "",
      ts ? new Date(ts).toLocaleDateString() : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const played = $derived(total ? Math.min(1, current / total) : 0);
  const shown = $derived(paused || !idle || scrubbing);
  const level = $derived(muted ? 0 : volume);

  $effect(() => () => clearTimeout(timer));

  $effect(() => {
    if (video) video.volume = volume;
  });

  const wake = () => {
    idle = false;
    clearTimeout(timer);
    timer = setTimeout(() => (idle = true), IDLE_MS);
  };

  const toggle = () => {
    if (!video) return;
    if (ended) {
      ended = false;
      video.currentTime = 0;
      return void video.play().catch(() => undefined);
    }
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  const seekBy = (seconds: number) => {
    if (!video || !total) return;
    video.currentTime = Math.max(0, Math.min(total, video.currentTime + seconds));
    ended = video.ended;
    current = video.currentTime;
    wake();
  };

  const toggleMute = () => {
    muted = !muted;
    if (!muted && volume === 0) setVolume(1);
  };

  const setVolume = (value: number) => {
    volume = Math.max(0, Math.min(1, value));
    muted = volume === 0;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => undefined);
    if (wrapper?.requestFullscreen) return void wrapper.requestFullscreen().catch(() => undefined);
    (video as any)?.webkitEnterFullscreen?.();
  };

  const menuItems = (): MenuItem[] =>
    fullscreen
      ? []
      : [
          { id: "video-play", label: entityText(paused || ended ? "play" : "pause"), icon: paused || ended ? MENU_ICONS.play : MENU_ICONS.pause, run: toggle },
          { id: "video-mute", label: entityText(muted ? "unmute" : "mute"), icon: muted ? MENU_ICONS.volume : MENU_ICONS.mute, run: toggleMute },
          { id: "video-fullscreen", label: entityText("fullscreen"), icon: MENU_ICONS.fullscreen, run: toggleFullscreen },
          ...(ondownload ? [{ id: "video-save", label: entityText("save"), icon: MENU_ICONS.save, separated: true, run: ondownload }] : []),
        ];

  const onbuffer = () => {
    if (!video || !video.buffered.length || !total) return;
    buffered = Math.min(1, video.buffered.end(video.buffered.length - 1) / total);
  };

  const scrubTo = (event: PointerEvent, bar: HTMLElement) => {
    if (!video || !total) return;
    const rect = bar.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total;
    ended = false;
    current = video.currentTime;
  };

  const onscrubstart = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const bar = event.currentTarget as HTMLElement;
    bar.setPointerCapture(event.pointerId);
    scrubbing = true;
    if (!near) scrubTo(event, bar);
  };

  const onscrubmove = (event: PointerEvent) => {
    const bar = event.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    if (event.pointerType === "mouse" || scrubbing) hover = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (!scrubbing) near = Math.abs(event.clientX - (rect.left + played * rect.width)) <= NEAR_PX;
    if (scrubbing) scrubTo(event, bar);
  };

  const onscrubend = (event: PointerEvent) => {
    scrubbing = false;
    if (event.pointerType !== "mouse") hover = null;
    wake();
  };

  const onvolume = (event: PointerEvent) => {
    if (event.type === "pointermove" && !(event.buttons & 1)) return;
    const bar = event.currentTarget as HTMLElement;
    if (event.type === "pointerdown") bar.setPointerCapture(event.pointerId);
    const rect = bar.getBoundingClientRect();
    setVolume((event.clientX - rect.left) / rect.width);
  };

  const onseekkey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(event.key === "ArrowRight" ? 10 : -10);
    }
  };

  const onvolumekey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 0.1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    setVolume(level + step);
  };

  const onkey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const isButton = (event.target as HTMLElement).tagName === "BUTTON";
    const actions: Record<string, () => void> = {
      k: toggle,
      j: () => seekBy(-10),
      l: () => seekBy(10),
      arrowleft: () => seekBy(-10),
      arrowright: () => seekBy(10),
      m: toggleMute,
      f: toggleFullscreen,
      ",": () => stepFrame(-1),
      ".": () => stepFrame(1),
    };
    if (key === " " && !isButton) actions[" "] = toggle;
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
    wake();
  };

  const onsurface = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && !shown) return wake();
    toggle();
  };

  const onpointermove = (event: PointerEvent) => {
    if (event.pointerType === "mouse") wake();
  };
</script>

<svelte:document onfullscreenchange={() => (fullscreen = !!wrapper && document.fullscreenElement === wrapper)} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="vp"
  class:shown
  class:fullscreen
  bind:this={wrapper}
  role="group"
  aria-label={name}
  tabindex="0"
  onkeydown={onkey}
  onpointermove={onpointermove}
  onpointerleave={() => !paused && (idle = true)}
  use:menu={menuItems}
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    src={link}
    autoplay
    preload="metadata"
    playsinline
    disablepictureinpicture
    bind:muted
    onclick={(event) => event.preventDefault()}
    onpointerup={onsurface}
    ondblclick={toggleFullscreen}
    onloadedmetadata={() => video && Number.isFinite(video.duration) && (total = video.duration)}
    ondurationchange={() => video && Number.isFinite(video.duration) && (total = video.duration)}
    ontimeupdate={() => video && (current = video.currentTime)}
    onprogress={onbuffer}
    onplay={() => {
      paused = false;
      ended = false;
      lastMedia = -1;
      (video as any)?.requestVideoFrameCallback?.(sampleFrame);
      wake();
    }}
    onpause={() => (paused = true)}
    onended={() => {
      ended = true;
      paused = true;
    }}
    onwaiting={() => (waiting = true)}
    oncanplay={() => (waiting = false)}
    onplaying={() => (waiting = false)}
    onerror={onerror}
  ></video>

  <span class="vignette" aria-hidden="true"></span>

  {#if waiting && !paused}
    <span class="spinner" aria-hidden="true"></span>
  {/if}

  <div class="vp-cluster row-nw align-centre" role="presentation" onpointermove={wake}>
    <button type="button" class="skip ghost press row centre" aria-label={text("media", "back_10")} onclick={() => seekBy(-10)}>
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v3h3" />
        <text x="12.5" y="15.2" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor">10</text>
      </svg>
    </button>
    <button type="button" class="big ghost press row centre" aria-label={ended ? text("media", "replay_video") : paused ? text("media", "resume_video") : text("media", "pause_video")} onclick={toggle}>
      {#if ended}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12a7 7 0 1 0 2.05-4.95M5 4.5v3.5h3.5" /></svg>
      {:else if paused}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M9 6.5v11l9-5.5-9-5.5Z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M7.5 6h3v12h-3zM13.5 6h3v12h-3z" /></svg>
      {/if}
    </button>
    <button type="button" class="skip ghost press row centre" aria-label={text("media", "forward_10")} onclick={() => seekBy(10)}>
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v3h-3" />
        <text x="11.5" y="15.2" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor">10</text>
      </svg>
    </button>
  </div>

  <div class="bar col" onpointermove={wake} role="presentation">
    <div class="info col min-0">
      <span class="title bold truncate">{name}</span>
      {#if meta}<span class="meta xs truncate">{meta}</span>{/if}
    </div>
    <div class="row-nw align-centre gap-sm">
      <div
        class="seek flex-max"
        class:scrubbing
        class:near
        role="slider"
        tabindex="0"
        aria-label={text("media", "seek_video")}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={formatDuration(current * 1000)}
        style:--played={played}
        style:--buffered={buffered}
        style:--hover={hover ?? 0}
        onpointerdown={onscrubstart}
        onpointermove={onscrubmove}
        onpointerup={onscrubend}
        onpointercancel={onscrubend}
        onpointerleave={(event) => event.pointerType === "mouse" && !scrubbing && ((hover = null), (near = false))}
        onkeydown={onseekkey}
      >
        <span class="track"><span class="loaded"></span><span class="fill"></span></span>
        <span class="thumb"></span>
        {#if hover !== null && total}
          <span class="hairline" aria-hidden="true"></span>
          <span class="bubble xs bold" aria-hidden="true">{formatDuration((near && !scrubbing ? played : hover) * total * 1000)}</span>
        {/if}
      </div>
      <span class="time xs">{formatDuration(current * 1000)} / {formatDuration(total * 1000)}</span>
      <div class="volume row-nw align-centre">
        <div
          class="level"
          role="slider"
          tabindex="0"
          aria-label={text("media", "volume")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          style:--level={level}
          onpointerdown={onvolume}
          onpointermove={onvolume}
          onkeydown={onvolumekey}
        >
          <span class="track"><span class="fill"></span></span>
        </div>
        <button type="button" class="control ghost press row centre" aria-label={muted ? text("media", "unmute") : text("media", "mute")} use:tooltip={muted ? text("media", "unmute") : text("media", "mute")} onclick={toggleMute}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
            {#if level === 0}
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m15.5 9.5 5 5m0-5-5 5" />
            {:else}
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d={level > 0.5 ? "M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" : "M15.5 9a4 4 0 0 1 0 6"} />
            {/if}
          </svg>
        </button>
      </div>
      {#if ondownload}
        <button type="button" class="control ghost press row centre" aria-label={text("media", "download").replace("{name}", name)} use:tooltip={text("media", "download").replace("{name}", name)} onclick={ondownload}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
        </button>
      {/if}
      <button type="button" class="control ghost press row centre" aria-label={fullscreen ? text("media", "exit_fullscreen") : text("media", "fullscreen")} use:tooltip={fullscreen ? text("media", "exit_fullscreen") : text("media", "fullscreen")} onclick={toggleFullscreen}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d={fullscreen ? "M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" : "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"} />
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .vp {
    position: relative;
    width: 100%;
    height: 100%;
    outline: none;
    overflow: hidden;
    container-type: inline-size;
    border-radius: inherit;
    color: #fff;
    background-color: #000;
  }

  .vp::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 3;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 0 0 2px transparent;
    transition: box-shadow var(--azure-duration-fast) var(--azure-ease-out);
  }

  .vp:focus-visible::after {
    box-shadow: inset 0 0 0 2px var(--colours-accent);
  }

  .vp.fullscreen:not(.shown) {
    cursor: none;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .vignette,
  .vp-cluster,
  .bar {
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--azure-duration-md) var(--azure-ease-out),
      translate var(--azure-duration-md) var(--azure-ease-out);
  }

  .vignette {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.25) 45%, transparent 70%),
      linear-gradient(to bottom, rgb(0 0 0 / 0.35), transparent 25%);
  }

  .shown .vignette,
  .vp:focus-within .vignette,
  .shown .vp-cluster,
  .vp:focus-within .vp-cluster {
    opacity: 1;
  }

  .shown .vp-cluster :global(button),
  .vp:focus-within .vp-cluster :global(button),
  .shown .bar,
  .vp:focus-within .bar {
    pointer-events: auto;
  }

  .shown .bar,
  .vp:focus-within .bar {
    opacity: 1;
    translate: 0;
  }

  .vp-cluster {
    position: absolute;
    inset: 50% auto auto 50%;
    translate: -50% -50%;
    gap: var(--azure-spacing-lg);
  }

  .big {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    color: rgb(255 255 255 / 0.7);
    border: 1.5px solid rgb(255 255 255 / 0.45);
    background-color: rgb(0 0 0 / 0.15);
    backdrop-filter: blur(6px);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-fast) var(--azure-ease-out);
  }

  .big:hover {
    color: var(--colours-accent);
    border-color: var(--colours-accent);
    box-shadow: 0 0 28px -6px var(--colours-accent-glow);
  }

  .skip {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: rgb(255 255 255 / 0.65);
  }

  .skip:hover,
  .control:hover {
    color: var(--colours-accent);
  }

  .spinner {
    position: absolute;
    inset: 50% auto auto 50%;
    z-index: 1;
    width: 72px;
    height: 72px;
    margin: -36px 0 0 -36px;
    border-radius: 50%;
    border: 2px solid var(--colours-accent);
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
    pointer-events: none;
  }

  .bar {
    position: absolute;
    inset: auto 0 0 0;
    gap: var(--azure-spacing-xs);
    padding: var(--azure-spacing-md);
    translate: 0 6px;
  }

  .info {
    gap: 2px;
    max-width: 80%;
  }

  .title {
    font-size: 1.1rem;
    color: #fff;
  }

  .meta {
    color: rgb(255 255 255 / 0.65);
  }

  .seek {
    position: relative;
    min-width: 0;
    height: 18px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .track {
    position: relative;
    flex: 1;
    height: 3px;
    overflow: hidden;
    border-radius: 2px;
    background-color: rgb(255 255 255 / 0.2);
    transition: height var(--azure-duration-fast) var(--azure-ease-out);
  }

  .loaded,
  .fill {
    position: absolute;
    inset: 0;
    transform-origin: left;
  }

  .loaded {
    background-color: rgb(255 255 255 / 0.35);
    transform: scaleX(var(--buffered));
  }

  .seek .fill {
    background-color: var(--colours-accent);
    transform: scaleX(var(--played));
  }

  .thumb {
    position: absolute;
    left: calc(var(--played) * 100%);
    width: 13px;
    height: 13px;
    margin-left: -6.5px;
    border-radius: 50%;
    background-color: var(--colours-accent);
    box-shadow: 0 0 12px -2px var(--colours-accent-glow);
    scale: 0;
    transition: scale var(--azure-duration-fast) var(--azure-ease-out);
    pointer-events: none;
  }

  .seek:hover .track,
  .seek.scrubbing .track {
    height: 5px;
  }

  .seek.seek.near .thumb,
  .seek.seek.scrubbing .thumb {
    scale: 1.3;
  }

  .seek.near {
    cursor: grab;
  }

  .seek.scrubbing {
    cursor: grabbing;
  }

  .seek.near:not(.scrubbing) .hairline,
  .seek.near:not(.scrubbing) .bubble {
    left: calc(var(--played) * 100%);
  }

  .seek:hover .thumb,
  .seek:focus-visible .thumb {
    scale: 1;
  }

  .hairline {
    position: absolute;
    left: calc(var(--hover) * 100%);
    top: -4px;
    bottom: -4px;
    width: 1px;
    background-color: rgb(255 255 255 / 0.7);
    pointer-events: none;
  }

  .bubble {
    position: absolute;
    left: calc(var(--hover) * 100%);
    bottom: calc(100% + 8px);
    translate: -50% 0;
    padding: 2px var(--azure-spacing-xs);
    border-radius: var(--azure-radius-sm);
    color: #fff;
    background-color: rgb(0 0 0 / 0.8);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }

  .control {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: var(--azure-radius-sm);
    color: #fff;
  }

  .level {
    display: flex;
    align-items: center;
    width: 0;
    height: 32px;
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
    transition: width var(--azure-duration-md) var(--azure-ease-out);
  }

  .volume:hover .level,
  .volume:focus-within .level {
    width: 64px;
    padding-inline: 4px 6px;
  }

  .level .fill {
    background-color: #fff;
    transform: scaleX(var(--level));
  }

  .time {
    flex: none;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: rgb(255 255 255 / 0.85);
  }

  @keyframes spin {
    to {
      rotate: 1turn;
    }
  }

  @container (max-width: 340px) {
    .time {
      display: none;
    }
  }

  @container (max-width: 420px) {
    .big {
      width: 52px;
      height: 52px;
    }

    .vp-cluster {
      gap: var(--azure-spacing-sm);
    }

    .title {
      font-size: 0.95rem;
    }

    .meta {
      display: none;
    }
  }

  @container (max-width: 260px) {
    .info,
    .skip,
    .time {
      display: none;
    }

    .big {
      width: 44px;
      height: 44px;
    }
  }

  @media (max-width: 767px) {
    .control,
    .skip {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .seek {
      height: 24px;
    }

    .level {
      display: none;
    }
  }
</style>
