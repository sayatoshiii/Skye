<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatCoordinates, osmLink, tilePosition, type GeoLocation } from "../../../scripts/matrix/utilities/content";

  let { location, live, label }: { location: GeoLocation | null; live?: boolean; label?: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const ZOOM = 15;
  const TILE = 256;
  const PIN = "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z";

  let showMap = $state(false);

  const title = $derived(location?.description ?? label ?? text("location", "shared"));

  const tiles = $derived.by(() => {
    if (!location || !showMap) return [];
    const { x, y } = tilePosition(location, ZOOM);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const max = 2 ** ZOOM;
    const list: { src: string; left: number; top: number }[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const ty = cy + dy;
        if (ty < 0 || ty >= max) continue;
        list.push({
          src: `https://tile.openstreetmap.org/${ZOOM}/${(((cx + dx) % max) + max) % max}/${ty}.png`,
          left: (cx + dx - x) * TILE,
          top: (ty - y) * TILE,
        });
      }
    return list;
  });
</script>

<div class="location col">
  {#if location && showMap}
    <div class="map" role="img" aria-label={text("location", "map").replace("{place}", title)}>
      {#each tiles as tile (tile.src)}
        <img src={tile.src} alt="" draggable="false" referrerpolicy="origin" loading="lazy" style:left={`calc(50% + ${tile.left}px)`} style:top={`calc(50% + ${tile.top}px)`} />
      {/each}
      <svg class="marker" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path fill="currentColor" stroke="var(--colours-background)" stroke-width="1.2" d={PIN} /></svg>
      <span class="credit xs">{text("location", "attribution")}</span>
    </div>
  {/if}
  <div class="row-nw align-centre gap-md">
    <span class="glyph row centre" class:pulse={live}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d={PIN} /></svg>
    </span>
    <span class="col min-0 flex-max">
      <span class="row-nw align-centre gap-sm">
        <span class="md bold truncate name">{title}</span>
        {#if live}<span class="badge xs bold">{text("location", "live")}</span>{/if}
      </span>
      {#if location}
        <span class="xs faint selectable">{formatCoordinates(location)}{location.uncertainty ? ` · ${text("location", "accuracy").replace("{metres}", String(Math.round(location.uncertainty)))}` : ""}</span>
      {:else}
        <span class="xs faint">{text("location", "waiting")}</span>
      {/if}
    </span>
  </div>
  {#if location}
    <div class="actions row-nw align-centre gap-md xs">
      <a class="bold" href={osmLink(location)} target="_blank" rel="noopener noreferrer">{text("location", "open_osm")}</a>
      {#if !showMap}
        <button type="button" class="ghost press bold" title={text("location", "map_note")} onclick={() => (showMap = true)}>{text("location", "load_map")}</button>
        <span class="faint truncate">{text("location", "map_note")}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .location {
    width: min(100%, 380px);
    margin-top: var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    gap: var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .map {
    position: relative;
    height: 160px;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-background);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .map img {
    position: absolute;
    width: 256px;
    height: 256px;
    max-width: none;
    filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6);
  }

  .marker {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -100%;
    color: var(--colours-accent);
  }

  .credit {
    position: absolute;
    right: 4px;
    bottom: 2px;
    padding: 0 4px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    background-color: color-mix(in oklab, var(--colours-background) 75%, transparent);
  }

  .glyph {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .glyph.pulse {
    animation: pulse 1.8s var(--azure-ease-out) infinite;
  }

  .name {
    color: var(--colours-text-strong);
  }

  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    color: var(--colours-background);
    background-color: var(--colours-accent);
    text-transform: uppercase;
  }

  .actions a,
  .actions button {
    flex: none;
    color: var(--colours-accent);
  }

  .actions a:hover,
  .actions button:hover {
    text-decoration: underline;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 6px transparent, 0 0 16px -4px var(--colours-accent-glow);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .glyph.pulse {
      animation: none;
    }
  }
</style>
