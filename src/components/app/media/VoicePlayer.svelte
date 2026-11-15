<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatDuration, resample } from "../../../scripts/matrix/utilities/content";
  import { acquireMediaLink, type MediaSource } from "../../../scripts/matrix/utilities/media";

  let { source, mimetype, samples, duration, name }: { source: MediaSource; mimetype: string; samples: number[]; duration: number; name: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const BARS = 40;

  let audio: HTMLAudioElement | undefined = $state();
  let link: string | undefined = $state();
  let playing = $state(false);
  let loading = $state(false);
  let failed = $state(false);
  let current = $state(0);
  let total = $state(0);
  let pendingSeek: number | null = null;
  let release: (() => void) | undefined;

  $effect(() => () => release?.());

  const bars = $derived(resample(samples, BARS));
  const length = $derived(total || duration / 1000);
  const progress = $derived(length ? Math.min(1, current / length) : 0);

  const load = () => {
    if (link || loading) return;
    loading = true;
    const handle = acquireMediaLink(source, mimetype);
    release = handle.release;
    handle.link
      .then((value) => (link = value))
      .catch(() => (failed = true))
      .finally(() => (loading = false));
  };

  const toggle = () => {
    if (!link) {
      pendingSeek ??= 0;
      return load();
    }
    if (audio?.paused) audio.play().catch(() => undefined);
    else audio?.pause();
  };

  const onready = () => {
    if (!audio) return;
    if (Number.isFinite(audio.duration)) total = audio.duration;
    if (pendingSeek !== null) {
      audio.currentTime = pendingSeek * (total || duration / 1000);
      pendingSeek = null;
      audio.play().catch(() => undefined);
    }
  };

  const seekTo = (fraction: number) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    if (!link || !audio) {
      pendingSeek = clamped;
      return load();
    }
    audio.currentTime = clamped * length;
    current = audio.currentTime;
  };

  const onseek = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width);
  };

  const onkey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 0.05 : event.key === "ArrowLeft" ? -0.05 : 0;
    if (!step) return;
    event.preventDefault();
    seekTo(progress + step);
  };
</script>

<div class="voice row-nw align-centre gap-sm" class:failed>
  <button type="button" class="toggle ghost press row centre" aria-label={`${playing ? text("audio", "pause") : text("audio", "play")} · ${name}`} onclick={toggle} disabled={failed}>
    {#if loading}
      <span class="spinner" aria-hidden="true"></span>
    {:else if playing}
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
    {/if}
  </button>
  <div
    class="wave row-nw align-centre flex-max"
    role="slider"
    tabindex="0"
    aria-label={text("audio", "seek")}
    aria-valuemin={0}
    aria-valuemax={Math.round(length)}
    aria-valuenow={Math.round(current)}
    aria-valuetext={formatDuration(current * 1000)}
    onclick={onseek}
    onkeydown={onkey}
    style:--progress={progress}
  >
    {#each bars as bar, index (index)}
      <span class="bar" class:played={(index + 0.5) / BARS <= progress} style:height={`${Math.max(12, bar * 100)}%`}></span>
    {/each}
  </div>
  <span class="time xs faint">{failed ? text("media", "load_failed") : `${formatDuration(current * 1000)} / ${formatDuration(length * 1000)}`}</span>
  {#if link}
    <audio
      bind:this={audio}
      src={link}
      preload="metadata"
      onloadedmetadata={onready}
      ontimeupdate={() => audio && (current = audio.currentTime)}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      onended={() => {
        playing = false;
        current = 0;
      }}
      onerror={() => (failed = true)}
    ></audio>
  {/if}
</div>

<style>
  .voice {
    width: min(100%, 360px);
    margin-top: var(--azure-spacing-sm);
    padding: var(--azure-spacing-xs) var(--azure-spacing-md) var(--azure-spacing-xs) var(--azure-spacing-xs);
    border-radius: 999px;
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .toggle {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    color: var(--colours-background);
    background-color: var(--colours-accent);
  }

  .toggle:hover {
    box-shadow: 0 0 18px -4px var(--colours-accent-glow);
  }

  .wave {
    height: 28px;
    gap: 2px;
    cursor: pointer;
    border-radius: var(--azure-radius-sm);
  }

  .bar {
    flex: 1;
    min-width: 2px;
    border-radius: 2px;
    background-color: var(--colours-outline-light);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .bar.played {
    background-color: var(--colours-accent);
  }

  .time {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }

  audio {
    display: none;
  }

  @keyframes spin {
    to {
      rotate: 1turn;
    }
  }

  @media (max-width: 767px) {
    .toggle {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }
</style>
