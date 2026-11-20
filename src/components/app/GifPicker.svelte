<script lang="ts" module>
  import { acquireMediaLink, getWideMediaLink, isMxc, remoteVideo } from "../../scripts/matrix/utilities/media";
  import type { GifFavourite } from "../../scripts/settings/gifs";

  export const onscreen = (node: HTMLVideoElement) => {
    const observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? node.play().catch(() => undefined) : node.pause()), { root: node.closest(".gif-scroll"), rootMargin: "120px 0px" });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  };

  const settle = (node: Element, failed = false) => {
    const tile = node.closest(".tile");
    tile?.setAttribute("data-ready", "");
    failed ? tile?.setAttribute("data-failed", "") : tile?.removeAttribute("data-failed");
  };

  export const ready = (event: Event) => settle(event.currentTarget as Element);

  export const broken = (event: Event) => settle(event.currentTarget as Element, true);

  export const isVideoGif = (gif: GifFavourite) => gif.kind === "mxc" && (gif.msgtype === "m.video" || String(gif.info?.mimetype ?? "").startsWith("video/"));

  export const gifSource = (node: HTMLImageElement | HTMLVideoElement, gif: GifFavourite) => {
    let release = () => {};
    const apply = (value?: string) => (value ? node.isConnected && (node.src = value) : settle(node, true));
    const load = (next: GifFavourite) => {
      release();
      release = () => {};
      if (next.kind === "mxc") {
        const handle = acquireMediaLink({ url: next.url, file: next.file }, String(next.info?.mimetype ?? "image/gif").split(";")[0].trim() || "image/gif");
        release = handle.release;
        return void handle.link.then(apply).catch(() => settle(node, true));
      }
      const still = next.media ?? next.image;
      still && isMxc(still) ? getWideMediaLink(still, 320, 320).then(apply) : apply(still);
    };
    const keyOf = (next: GifFavourite) => (next.kind === "mxc" ? (next.url ?? next.file?.url) : (next.media ?? next.image));
    let shown = keyOf(gif);
    load(gif);
    return { update: (next: GifFavourite) => keyOf(next) !== shown && ((shown = keyOf(next)), load(next)), destroy: () => release() };
  };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { flip } from "svelte/animate";
  import { cubicOut, quartOut } from "svelte/easing";
  import { reducedMotion, spring } from "../../scripts/misc/spring";
  import { starburst } from "../../scripts/misc/starburst";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { favouriteGifs, gifboxCategories, gifboxReady, searchGifbox, toggleFavouriteGif, type GifCategory } from "../../scripts/settings/gifs";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { mediaSettings, setGifsAsLinks } from "../../scripts/settings/media";
  import { longpress } from "../../scripts/misc/longpress";
  import { copied } from "../../scripts/stores/toast";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";

  let { anchor, onpick, onclose }: { anchor: HTMLElement; onpick: (gif: GifFavourite) => void; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "gifs", ...path) as string;
  const MARGIN = 12;

  const exit = dismissible(() => onclose());
  export const dismiss = exit.close;

  let card: HTMLDivElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  let position: { x: number; y: number } | null = $state(null);
  let favourites: GifFavourite[] = $state.raw([]);
  let query = $state("");
  let view = $state.raw<"favourites" | "featured" | GifCategory | null>(gifboxReady ? null : "favourites");
  let categories: GifCategory[] = $state.raw([]);
  let results: GifFavourite[] = $state.raw([]);
  let next = $state("");
  let more = $state(true);
  let loading = $state(false);
  let failed = $state(false);
  let painted = $state(false);
  let drawn = $state(12);
  let sentinel: HTMLDivElement | undefined = $state();
  let gifMenu: { gif: GifFavourite; x: number; y: number } | null = $state.raw(null);

  $effect(() => favouriteGifs.subscribe((value) => (favourites = value)));

  let snapshot: DOMRect | null = anchor.isConnected ? anchor.getBoundingClientRect() : null;

  const place = async () => {
    await tick();
    if (!card) return;
    if (anchor.isConnected) snapshot = anchor.getBoundingClientRect();
    const rect = snapshot;
    if (!rect) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    position = {
      x: Math.min(Math.max(rect.right - width, MARGIN), innerWidth - width - MARGIN),
      y: rect.top - 8 - height >= MARGIN || rect.top > innerHeight - rect.bottom
        ? Math.max(rect.top - 8 - height, MARGIN)
        : Math.min(rect.bottom + 8, innerHeight - height - MARGIN),
    };
  };

  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const grow = (): unknown => drawn < favourites.length && requestAnimationFrame(() => ((drawn += 12), grow()));

  $effect(() => {
    let alive = true;
    place().then(() => tick()).then(() => !matchMedia("(pointer: coarse)").matches && search?.focus());
    frame().then(() => alive && ((painted = true), grow()));
    gifboxCategories().then((value) => alive && (categories = value));
    return () => (alive = false);
  });

  let controller: AbortController | null = null;

  const load = async (reset: boolean) => {
    if (!gifboxReady || (!reset && (loading || !more))) return;
    controller?.abort();
    const current = (controller = new AbortController());
    loading = true;
    failed = false;
    try {
      const batch = await searchGifbox(term, reset ? "" : next, current.signal);
      if (current.signal.aborted) return;
      const seen = new Set(reset ? [] : results.map((item) => item.id));
      results = [...(reset ? [] : results), ...batch.results.filter((item) => !seen.has(item.id))];
      next = batch.next;
      more = !!batch.next && !!batch.results.length;
    } catch {
      failed = !current.signal.aborted;
    } finally {
      if (controller === current) loading = false;
    }
  };

  let typing: ReturnType<typeof setTimeout> | undefined;
  let searched: string | null = null;

  const term = $derived(query.trim() || (view && typeof view === "object" ? view.term : ""));
  const remote = $derived(!!query.trim() || (!!view && view !== "favourites"));

  $effect(() => {
    const value = term;
    if (!painted || !remote || value === searched) return;
    clearTimeout(typing);
    results = value === searched ? results : [];
    typing = setTimeout(() => ((searched = value), load(true)), query.trim() ? 280 : 0);
    return () => clearTimeout(typing);
  });

  $effect(() => () => controller?.abort());

  $effect(() => {
    if (!sentinel || !painted) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && remote && load(false), { root: sentinel.closest(".gif-scroll"), rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  $effect(() => {
    const onpointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card?.contains(target) || anchor.contains(target) || gifMenu) return;
      exit.close();
    };
    const onresize = () => place();
    document.addEventListener("pointerdown", onpointer, true);
    addEventListener("resize", onresize);
    return () => {
      document.removeEventListener("pointerdown", onpointer, true);
      removeEventListener("resize", onresize);
    };
  });

  const home = $derived(!remote && !view);
  const shown = $derived(remote ? results : view === "favourites" ? favourites.slice(0, drawn) : []);
  const title = $derived(query.trim() ? "" : view === "favourites" ? text("favourites") : view === "featured" ? text("trending") : (view?.name ?? ""));
  const open = (next: typeof view) => ((view = next), (searched = null), card?.querySelector(".gif-scroll")?.scrollTo({ top: 0 }));
  const columns = $derived([0, 1].map((column) => shown.filter((_, at) => at % 2 === column)));

  const choose = (gif: GifFavourite) => (onpick(gif), exit.close());

  const gifItems = (gif: GifFavourite): MenuItem[] => {
    const saved = favourites.some((item) => item.id === gif.id);
    return [
      { id: "gif-send", label: text("send"), icon: MENU_ICONS.reply, run: () => choose(gif) },
      { id: "gif-favourite", label: text(saved ? "unfavourite" : "favourite"), icon: saved ? MENU_ICONS.unstar : MENU_ICONS.star, run: () => toggleFavouriteGif(gif) },
      ...(gif.kind === "link" ? [{ id: "gif-link", label: text("copy_link"), icon: MENU_ICONS.link, separated: true, run: () => copied(gif.url, "link_copied", "link") }] : []),
    ];
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && event.target === search && shown[0]) return void (event.preventDefault(), choose(shown[0]));
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (gifMenu) return;
    if (query) return void (query = "");
    view && gifboxReady ? open(null) : exit.close();
  };

  const settle = spring(0.45, 0.7);
  const leave = (_: Element) => ({ duration: reducedMotion() ? 0 : 350, css: (t: number) => `opacity: ${cubicOut(t)}; transform: scale(${0.8 + quartOut(t) * 0.2}); filter: blur(${(1 - quartOut(t)) * 6}px)` });
  const swap = (_: Element) => ({ duration: reducedMotion() ? 0 : 320, css: (t: number) => `opacity: ${t}; transform: scale(${0.6 + quartOut(t) * 0.4}) rotate(${(1 - quartOut(t)) * -30}deg)` });

  const ratio = (gif: GifFavourite) => (gif.kind === "mxc" ? `${Number(gif.info.w) || 1} / ${Number(gif.info.h) || 1}` : `${gif.w ?? 1} / ${gif.h ?? 1}`);
</script>

{#snippet tile(gif: GifFavourite)}
  {@const saved = favourites.some((item) => item.id === gif.id)}
  <button
    type="button"
    class="pick ghost"
    aria-label={text("send")}
    onclick={() => choose(gif)}
    oncontextmenu={(event) => (event.preventDefault(), (gifMenu = { gif, x: event.clientX, y: event.clientY }))}
    use:longpress={(x, y) => (gifMenu = { gif, x, y })}
  >
    {#if gif.kind === "link" && gif.video}
      <span class="still" style:background-image={gif.image ? `url("${gif.image}")` : undefined}>
        <video use:remoteVideo={gif.video} poster={gif.image} onplaying={(event) => event.currentTarget.removeAttribute("poster")} muted loop playsinline disablepictureinpicture preload="auto" aria-hidden="true" use:onscreen onloadeddata={ready} onerror={broken}></video>
      </span>
    {:else if isVideoGif(gif)}
      <video muted loop playsinline disablepictureinpicture preload="auto" aria-hidden="true" use:gifSource={gif} use:onscreen onloadeddata={ready} onerror={broken}></video>
    {:else}
      <img alt="" decoding="async" draggable="false" use:gifSource={gif} onload={ready} onerror={broken} />
    {/if}
    <svg class="missing" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M3 3l18 18" /></svg>
  </button>
  <button type="button" class="star ghost press" class:on={saved} aria-label={text(saved ? "unfavourite" : "favourite")} aria-pressed={saved} use:starburst={saved} onclick={() => toggleFavouriteGif(gif)}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.star} /></svg>
  </button>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="gif-picker col"
  class:placed={!!position}
  class:closing={exit.closing}
  inert={exit.closing}
  onanimationend={exit.onanimationend}
  role="dialog"
  aria-label={text("picker")}
  tabindex="-1"
  bind:this={card}
  style:left="{position?.x ?? 0}px"
  style:top="{position?.y ?? 0}px"
  use:portal
  {onkeydown}
>
  <div class="top col gap-sm">
    <label class="search-box row-nw align-centre gap-sm">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.6-4.6" /></svg>
      <input class="search flex-max" type="search" placeholder={text("search")} aria-label={text("search")} bind:this={search} bind:value={query} />
      <button type="button" class="as-links ghost press" class:on={$mediaSettings.gifLinks} aria-pressed={$mediaSettings.gifLinks} aria-label={text($mediaSettings.gifLinks ? "as_links" : "as_files")} use:tooltip={text($mediaSettings.gifLinks ? "as_links" : "as_files")} onclick={() => setGifsAsLinks(!$mediaSettings.gifLinks)}>
        {#key $mediaSettings.gifLinks}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" in:swap>
            {#if $mediaSettings.gifLinks}
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
            {:else}
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 18v-6M9.5 14.5 12 12l2.5 2.5" />
            {/if}
          </svg>
        {/key}
      </button>
    </label>
    {#if title}
      <div class="crumb row-nw align-centre gap-xs">
        {#if gifboxReady}
          <button type="button" class="back ghost press" aria-label={text("back")} onclick={() => open(null)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m14 6-6 6 6 6" /></svg>
          </button>
        {/if}
        <span class="sm bold">{title}</span>
      </div>
    {/if}
  </div>

  <div class="gif-scroll flex-max">
    {#if home}
      {#if painted}
        <div class="categories">
          <button type="button" class="category favourites ghost press" onclick={() => open("favourites")}>
            {#if favourites[0]}{@const cover = favourites[0]}{#if cover.kind === "link" && cover.image}<img src={cover.image} alt="" draggable="false" />{:else if cover.kind === "link" && !cover.media && cover.video}<video use:remoteVideo={cover.video} autoplay muted loop playsinline disablepictureinpicture></video>{:else if isVideoGif(cover)}<video autoplay muted loop playsinline disablepictureinpicture use:gifSource={cover}></video>{:else}<img alt="" draggable="false" use:gifSource={cover} />{/if}{/if}
            <span class="label row-nw align-centre gap-xs sm bold"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.star} /></svg>{text("favourites")}</span>
          </button>
          <button type="button" class="category ghost press" onclick={() => open("featured")}>
            {#if categories[0]?.image}<img src={categories[0].image} alt="" loading="lazy" draggable="false" />{/if}
            <span class="label row-nw align-centre gap-xs sm bold"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m3 17 6-6 4 4 8-8M15 7h6v6" /></svg>{text("trending")}</span>
          </button>
          {#each categories as category (category.term)}
            <button type="button" class="category ghost press" onclick={() => open(category)}>
              {#if category.image}<img src={category.image} alt="" loading="lazy" decoding="async" draggable="false" />{/if}
              <span class="label sm bold">{category.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    {:else if remote && failed}
      <div class="empty col gap-sm">
        <p class="sm faint">{text("load_failed")}</p>
        <button type="button" class="retry press xs bold" onclick={() => load(true)}>{text("retry")}</button>
      </div>
    {:else if !shown.length && painted && !(remote && loading)}
      <div class="empty col gap-xs">
        <p class="sm bold">{text(remote ? "no_results" : "empty_title")}</p>
        {#if !remote}<p class="xs faint">{text("empty_body")}</p>{/if}
      </div>
    {/if}
    {#if painted && !home}
      {#if remote}
        <div class="masonry row-nw gap-xs">
          {#each columns as column, at (at)}
            <div class="column col gap-xs">
              {#each column as gif (gif.id)}
                <div class="tile" style:aspect-ratio={ratio(gif)}>{@render tile(gif)}</div>
              {/each}
            </div>
          {/each}
        </div>
      {:else}
        <div class="saved-grid">
          {#each shown as gif (gif.id)}
            <div class="tile square" animate:flip={{ duration: reducedMotion() ? 0 : settle.duration, easing: settle.ease }} out:leave>{@render tile(gif)}</div>
          {/each}
        </div>
      {/if}
    {/if}
    {#if remote && !failed}<div class="sentinel" class:busy={loading} bind:this={sentinel}></div>{/if}
  </div>
  {#if gifMenu}
    <MessageMenu items={gifItems(gifMenu.gif)} x={gifMenu.x} y={gifMenu.y} label={text("actions")} onclose={() => (gifMenu = null)} />
  {/if}
</div>

<style>
  .gif-picker {
    position: fixed;
    z-index: var(--azure-z-popover);
    width: min(424px, calc(100vw - 24px));
    height: min(480px, calc(100dvh - 120px));
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 16px 40px -12px rgb(0 0 0 / 0.7),
      0 0 32px -16px var(--colours-accent-glow);
    overflow: hidden;
    visibility: hidden;
    transform-origin: 100% 100%;
  }

  .gif-picker.placed {
    visibility: visible;
    animation: picker-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .gif-picker.closing {
    pointer-events: none;
    animation: picker-out var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes picker-in {
    from {
      opacity: 0;
      scale: 0.95;
      translate: 0 6px;
    }
  }

  @keyframes picker-out {
    to {
      opacity: 0;
      scale: 0.95;
      translate: 0 6px;
    }
  }

  .top {
    padding: var(--azure-spacing-sm);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .search-box {
    height: 40px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    color: var(--colours-text-faint);
    background-color: var(--colours-surface-hover);
    cursor: text;
  }

  .search-box svg {
    flex: none;
  }

  .as-links {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: calc(var(--azure-spacing-xs) * -1);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-md) var(--azure-ease-fluid), background-color var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .as-links:hover,
  .as-links:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-active, var(--colours-surface-hover));
  }

  .as-links.on {
    color: color-mix(in srgb, var(--colours-accent) 70%, var(--colours-text-strong));
  }

  .crumb {
    animation: crumb-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  @keyframes crumb-in {
    from {
      opacity: 0;
      translate: -4px 0;
    }
  }

  .back {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    background-color: transparent;
  }

  .back:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .categories {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--azure-spacing-xs);
  }

  .category {
    position: relative;
    display: grid;
    place-items: center;
    height: 96px;
    padding: 0;
    border: 0;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    color: white;
    background-color: var(--colours-surface-hover);
    animation: tile-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .category :is(img, video) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: brightness(0.45);
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .category:is(:hover, :focus-visible) img {
    filter: brightness(0.6);
    transform: scale(1.05);
  }

  .category.favourites {
    background-color: color-mix(in oklab, var(--colours-accent) 28%, var(--colours-surface-raised));
  }

  .category.favourites img {
    filter: brightness(0.5);
    mix-blend-mode: luminosity;
    opacity: 0.6;
  }

  .category .label {
    position: relative;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
  }

  .search {
    min-width: 0;
    height: 100%;
    padding: 0;
    border-radius: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--text-md);
    color: var(--colours-text-strong);
    outline: none;
  }

  .search:focus,
  .search:focus-visible {
    outline: none;
    box-shadow: none;
  }







  .retry {
    align-self: center;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    border: 0;
    border-radius: var(--azure-radius-md);
    color: var(--colours-text-strong);
    background-color: var(--colours-accent-faint);
  }


  .gif-scroll {
    position: relative;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--azure-spacing-sm);
  }

  .saved-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--azure-spacing-xs);
  }

  .tile.square {
    aspect-ratio: 1;
  }

  .column {
    flex: 1;
    min-width: 0;
  }

  .tile {
    position: relative;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-surface-hover);
    animation: tile-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  @keyframes tile-in {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }

  .pick {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
  }

  .tile::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background:
      linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.06) 50%, transparent 70%) 0 0 / 250% 100%,
      var(--colours-surface-hover);
    animation: shimmer 1.4s var(--azure-ease-fluid) infinite;
    transition: opacity var(--azure-duration-slow) var(--azure-ease-out);
  }

  .tile:global([data-ready])::after {
    opacity: 0;
    animation-play-state: paused;
  }

  .tile :is(video, img) {
    opacity: 0;
    outline: none;
    border: 0;
    transition: opacity var(--azure-duration-slow) var(--azure-ease-out);
  }

  .tile:global([data-ready]) :is(video, img) {
    opacity: 1;
  }

  .missing {
    position: absolute;
    inset: 0;
    margin: auto;
    color: var(--colours-text-faint);
    opacity: 0;
    transition: opacity var(--azure-duration-slow) var(--azure-ease-out);
  }

  .tile:global([data-failed]) .missing {
    opacity: 1;
  }

  .tile:not(:global([data-ready])) .still {
    background-image: none !important;
  }

  @keyframes shimmer {
    from {
      background-position: 125% 0, 0 0;
    }
    to {
      background-position: -125% 0, 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tile::after {
      animation: none;
    }
  }

  .still {
    display: block;
    width: 100%;
    height: 100%;
    background: center / cover no-repeat;
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .pick:is(:hover, :focus-visible) .still {
    transform: scale(1.04);
  }

  .still video {
    transform: translateZ(0);
    backface-visibility: hidden;
  }

  .pick :is(img, video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .pick:is(:hover, :focus-visible) > img {
    transform: scale(1.04);
  }

  .pick:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--colours-accent);
  }

  .star {
    position: absolute;
    z-index: 2;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
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

  .tile:is(:hover, :focus-within) .star,
  .star.on {
    opacity: 1;
    scale: 1;
  }

  .star.on {
    color: #ffc83d;
    filter: drop-shadow(0 0 6px rgb(255 200 61 / 0.3));
  }





  .empty {
    padding: var(--azure-spacing-xl, 32px) var(--azure-spacing-lg);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  .sentinel {
    height: 1px;
  }

  .sentinel.busy {
    height: 40px;
    background: radial-gradient(circle, var(--colours-text-faint) 2px, transparent 3px) center / 12px 12px no-repeat;
    animation: pulse 900ms ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }


  @media (hover: none) {
    .star {
      opacity: 1;
      scale: 1;
    }
  }

  @media (max-width: 767px) {
    .gif-picker.gif-picker {
      inset: auto 0 0 0 !important;
      width: 100%;
      height: 70dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }

    .gif-picker.placed {
      animation: picker-sheet-in var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .gif-picker.closing {
      animation: picker-sheet-out var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    @keyframes picker-sheet-in {
      from {
        translate: 0 100%;
      }
    }

    @keyframes picker-sheet-out {
      to {
        translate: 0 100%;
      }
    }
  }

  .star path {
    fill: transparent;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
    transition:
      fill var(--azure-duration-slow) var(--azure-ease-out),
      stroke var(--azure-duration-slow) var(--azure-ease-out);
  }

  .star.on path {
    fill: currentColor;
  }

  @media (pointer: coarse) {
    .search {
      font-size: max(16px, var(--text-md));
    }
  }
</style>
