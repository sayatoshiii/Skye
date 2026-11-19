<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatBytes, isInline, sanitiseFilename, type MediaKind } from "../../../scripts/matrix/utilities/attachments";
  import { downloadMedia } from "../../../scripts/matrix/utilities/download";
  import { acquireMediaLink, isMxc, seededLink, type MediaSource } from "../../../scripts/matrix/utilities/media";
  import { nearViewport } from "../../../scripts/misc/lazy";
  import { MEDIA } from "../../../scripts/settings/config";
  import { lightbox } from "../../../scripts/stores/lightbox";
  import { getWaveform } from "../../../scripts/matrix/utilities/content";
  import VoicePlayer from "./VoicePlayer.svelte";
  import VideoPlayer from "./VideoPlayer.svelte";
  import { favouriteGifs, gifFromContent, isGifContent, toggleFavouriteGif } from "../../../scripts/settings/gifs";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { tooltip } from "../../../scripts/misc/tooltip";
  import { starburst } from "../../../scripts/misc/starburst";

  let { content, sticker = false, sender, ts, preview, still, progress, oncancel }: { content: Record<string, any>; sticker?: boolean; sender?: string; ts?: number; preview?: string; still?: string; progress?: number; oncancel?: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const KINDS: Record<string, MediaKind> = { "m.image": "image", "m.video": "video", "m.audio": "audio", "m.file": "file" };

  const info = $derived((content.info ?? {}) as Record<string, any>);
  const kind = $derived(sticker ? "image" : (KINDS[content.msgtype] ?? "file"));
  const mimetype = $derived(String(info.mimetype ?? (sticker ? "image/png" : "")).split(";")[0].trim().toLowerCase());
  const source: MediaSource = $derived({ url: isMxc(content.url) ? content.url : undefined, file: isMxc(content.file?.url) ? content.file : undefined });
  const thumbnail: MediaSource | null = $derived(
    isMxc(info.thumbnail_file?.url) ? { file: info.thumbnail_file } : isMxc(info.thumbnail_url) ? { url: info.thumbnail_url } : null,
  );
  const thumbnailType = $derived(String(info.thumbnail_info?.mimetype ?? "image/jpeg"));
  const name = $derived(sanitiseFilename(content.filename ?? content.body));
  let unplayable = $state(false);
  const inline = $derived(kind !== "file" && !unplayable && (kind === "video" || isInline(mimetype, kind)) && !!(source.url || source.file || preview));
  const playType = $derived(kind === "video" ? (MEDIA.videoPlaybackTypes[mimetype] ?? mimetype) : mimetype);
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const framePreview = $derived(kind === "video" && !touch && !thumbnail && Number(info.size) > 0 && Number(info.size) <= MEDIA.framePreviewLimit);
  const looping = $derived(kind === "video" && !!(info["fi.mau.gif"] || content["fi.mau.gif"] || info["fi.mau.loop"]));

  const size = $derived.by(() => {
    const w = Number(info.w) || 0;
    const h = Number(info.h) || 0;
    if (!w || !h) return null;
    const scale = Math.min(1, (sticker ? MEDIA.stickerSize : MEDIA.display.width) / w, (sticker ? MEDIA.stickerSize : MEDIA.display.height) / h);
    return { w: Math.round(w * scale), h: Math.round(h * scale), ratio: `${w} / ${h}` };
  });

  let link: string | undefined = $state();
  let poster: string | undefined = $state();
  let failed = $state(false);
  let playing = $state(false);
  let downloading = $state(false);
  const releases: (() => void)[] = [];

  const acquire = (from: MediaSource, type: string, apply: (value: string) => void) => {
    const handle = acquireMediaLink(from, type);
    releases.push(handle.release);
    handle.link.then(apply).catch(() => (failed = true));
  };

  $effect(() => () => releases.splice(0).forEach((release) => release()));

  const useThumbnail = $derived(kind === "image" && !sticker && !!thumbnail && mimetype !== "image/gif");
  const gif = $derived(!sticker && isGifContent(content) ? gifFromContent(content) : null);
  const starred = $derived(!!gif && $favouriteGifs.some((item) => item.id === gif.id));
  const waveform = $derived(kind === "audio" ? getWaveform(content) : null);

  link = preview ?? (kind === "image" ? seededLink(useThumbnail ? thumbnail : source) : undefined);
  poster = still ?? (kind === "video" ? seededLink(thumbnail) : undefined);

  const onvisible = () => {
    if (preview || (kind === "image" && link)) return;
    if (kind === "image") return useThumbnail && thumbnail ? acquire(thumbnail, thumbnailType, (value) => (link = value)) : acquire(source, mimetype, (value) => (link = value));
    if (kind === "audio") return acquire(source, mimetype, (value) => (link = value));
    if (looping || framePreview) return acquire(source, playType, (value) => (link = value));
    if (kind === "video" && thumbnail && !poster) acquire(thumbnail, thumbnailType, (value) => (poster = value));
  };

  const play = () => {
    playing = true;
    if (!link) acquire(source, playType, (value) => (link = value));
  };

  const open = () => lightbox.set({ source, mimetype, name, w: info.w, h: info.h });

  const download = async () => {
    downloading = true;
    await downloadMedia(source, name).catch((error) => (failed = (error as Error)?.message !== "cancelled"));
    downloading = false;
  };
</script>

{#if inline && kind !== "audio"}
  <div
    class="frame"
    class:sticker
    class:sized={!!size}
    style:width={size ? `${size.w}px` : undefined}
    style:aspect-ratio={size?.ratio}
    use:nearViewport={onvisible}
  >
    {#if failed}
      <span class="state xs faint">{text("media", "load_failed")}</span>
    {:else if kind === "image"}
      <button type="button" class="open ghost" aria-label={text("media", "open").replace("{name}", name)} onclick={open}>
        {#if link}<img src={link} alt={content.body ?? ""} draggable="false" />{/if}
      </button>
      {#if gif}
        <button type="button" class="gif-star ghost press" class:on={starred} aria-label={text("gifs", starred ? "unfavourite" : "favourite")} aria-pressed={starred} use:starburst={starred} use:tooltip={text("gifs", starred ? "unfavourite" : "favourite")} onclick={() => gif && toggleFavouriteGif(gif)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.star} /></svg>
        </button>
      {/if}
    {:else if looping}
      {#if link}<video src={link} autoplay muted loop playsinline disablepictureinpicture aria-label={name} onerror={() => (unplayable = true)}></video>{/if}
    {:else if playing && link}
      <VideoPlayer {link} {name} size={Number(info.size) || undefined} width={Number(info.w) || undefined} height={Number(info.h) || undefined} {sender} {ts} onerror={() => (unplayable = true)} ondownload={downloading ? undefined : download} />
    {:else}
      {#if poster}
        <img src={poster} alt="" draggable="false" />
      {:else if link}
        <video class="still" src={`${link}#t=0.001`} muted playsinline preload="metadata" disablepictureinpicture aria-hidden="true" tabindex="-1" onerror={() => (unplayable = true)}></video>
      {/if}
      <span class="video-info col" aria-hidden="true">
        <span class="sm bold truncate">{name}</span>
        {#if Number(info.size) > 0}<span class="xs">{formatBytes(info.size)}</span>{/if}
      </span>
      <button type="button" class="play ghost press" aria-label={text("media", "play_video")} onclick={play} disabled={playing}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
      </button>
    {/if}
    {#if oncancel}{@render uploading(true)}{/if}
  </div>
{:else if inline && kind === "audio" && waveform && !preview}
  <VoicePlayer {source} {mimetype} samples={waveform.samples} duration={waveform.duration} {name} />
{:else if inline && kind === "audio"}
  <div class="audio" use:nearViewport={onvisible}>
    {#if link}<audio src={link} controls preload="metadata"></audio>{:else if failed}<span class="xs faint">{text("media", "load_failed")}</span>{/if}
    {#if oncancel}{@render uploading(false)}{/if}
  </div>
{:else}
  <div class="card row-nw align-centre gap-md">
    <span class="glyph row centre">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 3h8l4 4v14H6zM14 3v4h4" /></svg>
    </span>
    <span class="col min-0 flex-max">
      <span class="md bold truncate file-name">{name}</span>
      {#if oncancel}
        {@render track()}
      {:else}
      <span class="xs faint">{formatBytes(info.size)}{kind !== "file" && !inline ? ` · ${text("media", "unsafe_type")}` : ""}</span>
      {/if}
    </span>
    {#if oncancel}
      {@render cancel()}
    {:else}
    <button type="button" class="download ghost press" aria-label={text("media", "download").replace("{name}", name)} onclick={download} disabled={downloading || !(source.url || source.file)}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
    </button>
    {/if}
  </div>
{/if}

{#snippet track()}
  <span class="track" class:idle={progress === undefined} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label={text("media", "uploading").replace("{percent}", String(Math.round((progress ?? 0) * 100)))}><span class="fill" style:--progress={progress ?? 0}></span></span>
{/snippet}

{#snippet cancel()}
  <button type="button" class="download cancel ghost press" aria-label={text("media", "cancel_upload")} use:tooltip={text("media", "cancel_upload")} onclick={oncancel}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
  </button>
{/snippet}

{#snippet uploading(overlay: boolean)}
  <span class="uploading row-nw align-centre gap-sm" class:overlay>
    <span class="col flex-max min-0">{@render track()}</span>
    {@render cancel()}
  </span>
{/snippet}

<style>
  .frame {
    position: relative;
    max-width: 100%;
    min-height: 60px;
    width: min(100%, 320px);
    aspect-ratio: 4 / 3;
    margin-top: var(--azure-spacing-sm);
    overflow: hidden;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .frame.sticker {
    width: min(100%, var(--sticker-size, 160px));
    min-height: 0;
    aspect-ratio: 1;
    border: none;
    background-color: transparent;
  }

  .frame.sticker img {
    object-fit: contain;
  }

  .frame.sized {
    min-height: 0;
  }

  .still {
    pointer-events: none;
  }

  .video-info {
    position: absolute;
    inset: 0 0 auto;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md) var(--azure-spacing-lg);
    min-width: 0;
    color: white;
    background: linear-gradient(rgb(0 0 0 / 0.6), transparent);
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
    pointer-events: none;
  }

  .video-info .xs {
    opacity: 0.8;
  }

  .frame img,
  .frame video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .open {
    display: block;
    width: 100%;
    height: 100%;
    cursor: zoom-in;
  }

  .state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .play {
    position: absolute;
    inset: 50% auto auto 50%;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, var(--colours-background) 70%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--colours-outline-light);
  }

  .play:hover {
    color: var(--colours-accent);
    box-shadow: 0 0 24px -6px var(--colours-accent-glow);
  }

  .audio {
    margin-top: var(--azure-spacing-sm);
    min-height: 54px;
  }

  audio {
    width: min(100%, 360px);
  }

  .card {
    width: min(100%, 380px);
    margin-top: var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .glyph {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .file-name {
    color: var(--colours-text-strong);
  }

  .download {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .download:hover {
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  .download:disabled {
    opacity: 0.5;
  }

  .track {
    display: block;
    height: 4px;
    margin-top: 6px;
    overflow: hidden;
    border-radius: 2px;
    background-color: var(--colours-outline-light);
    transition: opacity var(--azure-duration-md) var(--azure-ease-out);
  }

  .track.idle {
    opacity: 0;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background-color: var(--colours-accent);
    transform-origin: left;
    transform: scaleX(var(--progress));
    transition: transform var(--azure-duration-md) var(--azure-ease-out);
  }

  .uploading {
    width: min(100%, 360px);
  }

  .uploading.overlay {
    position: absolute;
    inset: auto 0 0;
    z-index: 3;
    width: auto;
    padding: var(--azure-spacing-lg) var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-md);
    background: linear-gradient(transparent, rgb(0 0 0 / 0.55));
  }

  .uploading.overlay .track {
    margin: 0;
    background-color: rgb(255 255 255 / 0.25);
  }

  .uploading.overlay .cancel {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: white;
    background-color: rgb(0 0 0 / 0.45);
    backdrop-filter: blur(8px);
  }

  .cancel:hover {
    color: var(--colours-danger, var(--colours-accent));
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 767px) {
    .download,
    .play {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }

  .gif-star {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: white;
    background-color: rgb(0 0 0 / 0.5);
    backdrop-filter: blur(8px);
    opacity: 0;
    scale: 0.85;
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      scale var(--azure-duration-settle) var(--azure-ease-settle),
      color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .frame:is(:hover, :focus-within) > .gif-star,
  .gif-star.on {
    opacity: 1;
    scale: 1;
  }

  .gif-star.on {
    color: #ffc83d;
    filter: drop-shadow(0 0 6px rgb(255 200 61 / 0.3));
  }

  @media (hover: none) {
    .gif-star:not(.on) {
      display: none;
    }
  }

  .gif-star path {
    fill: transparent;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
    transition:
      fill var(--azure-duration-slow) var(--azure-ease-out),
      stroke var(--azure-duration-slow) var(--azure-ease-out);
  }

  .gif-star.on path {
    fill: currentColor;
  }
</style>
