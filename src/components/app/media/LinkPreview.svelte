<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { getWideMediaLink } from "../../../scripts/matrix/utilities/media";
  import { getLinkPreview, type LinkPreview } from "../../../scripts/matrix/utilities/previews";
  import { EMBED_ALLOW, EMBED_SANDBOX, findEmbed } from "../../../scripts/misc/embeds";
  import { nearViewport } from "../../../scripts/misc/lazy";
  import { mediaSettings, setAlwaysAllowEmbed, type MediaSettings } from "../../../scripts/settings/media";
  import { session } from "../../../scripts/stores/matrix";

  let { url, ts, previews }: { url: string; ts: number; previews: boolean } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const embed = $derived(findEmbed(url));
  const host = $derived.by(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  });

  let settings: MediaSettings | null = $state.raw(null);
  let preview: LinkPreview | null = $state.raw(null);
  let image: string | undefined = $state();
  let playing = $state(false);

  $effect(() => mediaSettings.subscribe((value) => (settings = value)));

  const alwaysAllowed = $derived(!!embed && !!settings?.alwaysAllowEmbeds[embed.provider]);
  const active = $derived(playing || alwaysAllowed);
  const source = $derived(
    embed && !playing ? embed.src.replace(/([?&]autoplay=)(1|true)/, (_, key, value) => key + (value === "true" ? "false" : "0")) : embed?.src,
  );

  const onvisible = () => {
    const current = $session;
    if (!previews || !current) return;
    getLinkPreview(current, url, ts).then(async (value) => {
      preview = value;
      if (value?.image) image = await getWideMediaLink(value.image, 640, 360);
    });
  };
</script>

{#if embed || previews}
  <div class="preview" class:portrait={embed?.portrait} class:hidden={!embed && !preview} use:nearViewport={onvisible}>
    {#if embed && active}
      <div class="player">
        <iframe
          src={source}
          title={preview?.title ?? embed.name}
          sandbox={EMBED_SANDBOX}
          allow={playing ? EMBED_ALLOW : EMBED_ALLOW.replace("; autoplay", "")}
          referrerpolicy={embed.referrerPolicy}
          loading="lazy"
          allowfullscreen
        ></iframe>
      </div>
      <label class="allow under row-nw align-centre gap-sm xs muted">
        <input type="checkbox" checked={alwaysAllowed} onchange={(event) => setAlwaysAllowEmbed(embed.provider, event.currentTarget.checked)} />
        {text("media", "always_allow").replace("{provider}", embed.name)}
      </label>
    {:else if embed || preview}
      <div class="card col">
        {#if embed && image}
          <div class="stage">
            <img src={image} alt="" draggable="false" />
            <button type="button" class="play ghost press" aria-label={`${text("media", "play_embed")} · ${embed.name}`} onclick={() => (playing = true)}>
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
            </button>
          </div>
        {:else if embed && !preview}
          <div class="slim row-nw align-centre gap-md">
            <button type="button" class="play inline ghost press" aria-label={`${text("media", "play_embed")} · ${embed.name}`} onclick={() => (playing = true)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
            </button>
            <span class="col min-0 flex-max">
              <span class="xs bold site truncate">{embed.name}</span>
              <a class="sm truncate slim-link" href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>
            </span>
          </div>
        {:else if embed}
          <button type="button" class="play-row row-nw align-centre gap-sm ghost press sm bold" onclick={() => (playing = true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
            {text("media", "play_embed")} · {embed.name}
          </button>
        {/if}
        <div class="text col gap-xs">
          {#if preview}<span class="xs bold site truncate">{preview.siteName ?? embed?.name ?? host}</span>{/if}
          {#if preview?.title}<a class="title md bold" href={url} target="_blank" rel="noopener noreferrer nofollow">{preview.title}</a>{/if}
          {#if preview?.description}<p class="description sm muted">{preview.description}</p>{/if}
          {#if embed}
            <p class="note xs faint">{text("media", "embed_note").replace("{provider}", embed.name)}</p>
            <label class="allow row-nw align-centre gap-sm xs muted">
              <input type="checkbox" checked={alwaysAllowed} onchange={(event) => setAlwaysAllowEmbed(embed.provider, event.currentTarget.checked)} />
              {text("media", "always_allow").replace("{provider}", embed.name)}
            </label>
          {/if}
        </div>
        {#if image && !embed}
          <img class="thumb" src={image} alt="" draggable="false" />
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .allow.under {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
  }

  .preview {
    width: min(100%, 440px);
    margin-top: var(--azure-spacing-sm);
  }

  .preview.hidden {
    min-height: 1px;
    margin: 0;
  }

  .preview.portrait:has(.player) {
    width: min(100%, 300px);
  }

  .slim {
    padding: var(--azure-spacing-md) var(--azure-spacing-md) 0;
  }

  .slim-link {
    color: var(--colours-text-muted);
    text-decoration: none;
  }

  .slim-link:hover {
    color: var(--colours-accent);
    text-decoration: underline;
  }

  .play.inline {
    position: static;
    translate: none;
    flex: none;
    width: var(--azure-touch);
    height: var(--azure-touch);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    border-color: color-mix(in oklab, var(--colours-accent) 30%, transparent);
    backdrop-filter: none;
  }

  .play-row {
    margin: var(--azure-spacing-md) var(--azure-spacing-md) 0;
    min-height: 36px;
    padding: 0 var(--azure-spacing-md);
    align-self: flex-start;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .play-row:hover {
    background-color: var(--colours-accent-soft);
    box-shadow: 0 0 18px -6px var(--colours-accent-glow);
  }

  .card {
    overflow: hidden;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    border-left: 3px solid var(--colours-accent);
    background-color: var(--colours-surface);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .text {
    padding: var(--azure-spacing-md);
  }

  .site {
    color: var(--colours-accent);
  }

  .title {
    color: var(--colours-text-strong);
    text-decoration: none;
  }

  .title:hover {
    text-decoration: underline;
  }

  .description {
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .note {
    margin: var(--azure-spacing-xs) 0 0;
  }

  .allow {
    min-height: 28px;
    cursor: pointer;
  }

  .allow input {
    accent-color: var(--colours-accent);
  }

  .thumb {
    display: block;
    width: 100%;
    max-height: 220px;
    object-fit: cover;
  }

  .stage,
  .player {
    position: relative;
    aspect-ratio: 16 / 9;
    background-color: var(--colours-foreground);
  }

  .portrait .player {
    aspect-ratio: 9 / 16;
  }

  .player {
    overflow: hidden;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
  }

  .stage img,
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    object-fit: cover;
  }

  .play {
    position: absolute;
    inset: 50% auto auto 50%;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, var(--colours-background) 65%, transparent);
    border: 1px solid var(--colours-outline-light);
    backdrop-filter: blur(8px);
  }

  .play:hover {
    color: var(--colours-accent);
    box-shadow: 0 0 28px -6px var(--colours-accent-glow);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 767px) {
    .allow {
      min-height: var(--azure-touch);
    }
  }
</style>
