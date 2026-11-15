<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatBytes, isInline, sanitiseFilename, type MediaKind } from "../../../scripts/matrix/utilities/attachments";
  import { downloadMedia } from "../../../scripts/matrix/utilities/download";
  import { acquireMediaLink, isMxc, type MediaSource } from "../../../scripts/matrix/utilities/media";
  import { nearViewport } from "../../../scripts/misc/lazy";
  import { MEDIA } from "../../../scripts/settings/config";
  import { lightbox } from "../../../scripts/stores/lightbox";
  import { getWaveform } from "../../../scripts/matrix/utilities/content";
  import VoicePlayer from "./VoicePlayer.svelte";
  import VideoPlayer from "./VideoPlayer.svelte";

  let { content, sticker = false, sender, ts }: { content: Record<string, any>; sticker?: boolean; sender?: string; ts?: number } = $props();

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
  const inline = $derived(kind !== "file" && !unplayable && isInline(mimetype, kind) && !!(source.url || source.file));
  const playType = $derived(kind === "video" ? (MEDIA.videoPlaybackTypes[mimetype] ?? mimetype) : mimetype);
  const framePreview = $derived(kind === "video" && !thumbnail && Number(info.size) > 0 && Number(info.size) <= MEDIA.framePreviewLimit);
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
  const waveform = $derived(kind === "audio" ? getWaveform(content) : null);

  const onvisible = () => {
    if (kind === "image") return useThumbnail && thumbnail ? acquire(thumbnail, thumbnailType, (value) => (link = value)) : acquire(source, mimetype, (value) => (link = value));
    if (kind === "audio") return acquire(source, mimetype, (value) => (link = value));
    if (looping || framePreview) return acquire(source, playType, (value) => (link = value));
    if (kind === "video" && thumbnail) acquire(thumbnail, thumbnailType, (value) => (poster = value));
  };

  const play = () => {
    playing = true;
    if (!link) acquire(source, playType, (value) => (link = value));
  };

  const open = () => lightbox.set({ source, mimetype, name, w: info.w, h: info.h });

  const download = async () => {
    downloading = true;
    await downloadMedia(source, name).catch(() => (failed = true));
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
      <button type="button" class="play ghost press" aria-label={text("media", "play_video")} onclick={play} disabled={playing}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
      </button>
    {/if}
  </div>
{:else if inline && kind === "audio" && waveform}
  <VoicePlayer {source} {mimetype} samples={waveform.samples} duration={waveform.duration} {name} />
{:else if inline && kind === "audio"}
  <div class="audio" use:nearViewport={onvisible}>
    {#if link}<audio src={link} controls preload="metadata"></audio>{:else if failed}<span class="xs faint">{text("media", "load_failed")}</span>{/if}
  </div>
{:else}
  <div class="card row-nw align-centre gap-md">
    <span class="glyph row centre">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 3h8l4 4v14H6zM14 3v4h4" /></svg>
    </span>
    <span class="col min-0 flex-max">
      <span class="md bold truncate file-name">{name}</span>
      <span class="xs faint">{formatBytes(info.size)}{kind !== "file" && !inline ? ` · ${text("media", "unsafe_type")}` : ""}</span>
    </span>
    <button type="button" class="download ghost press" aria-label={text("media", "download").replace("{name}", name)} onclick={download} disabled={downloading || !(source.url || source.file)}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
    </button>
  </div>
{/if}

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
</style>
