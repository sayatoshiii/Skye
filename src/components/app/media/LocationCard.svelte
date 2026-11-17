<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatCoordinates, geoUri, osmLink, type GeoLocation } from "../../../scripts/matrix/utilities/content";
  import { entityText, menu } from "../../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { copied } from "../../../scripts/stores/toast";

  let { location, live, label }: { location: GeoLocation | null; live?: boolean; label?: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const title = $derived(location?.description ?? label ?? text("location", "shared"));

  const open = (geo: GeoLocation) => window.open(osmLink(geo), "_blank", "noopener,noreferrer");

  const items = () =>
    location
      ? [
          { id: "location-open", label: text("location", "open_osm"), icon: MENU_ICONS.open, run: () => open(location!) },
          { id: "location-coordinates", label: text("chat", "copy_coordinates"), icon: MENU_ICONS.copy, run: () => copied(formatCoordinates(location!, 6), "coordinates_copied") },
          { id: "location-geo", label: text("location", "copy_geo"), icon: MENU_ICONS.location, run: () => copied(geoUri(location!)) },
          { id: "location-link", label: entityText("copy_link"), icon: MENU_ICONS.link, separated: true, run: () => copied(osmLink(location!), "link_copied", "link") },
        ]
      : [];
</script>

<div class="location col">
  <div class="row-nw align-centre gap-md">
    <span class="glyph row centre" class:pulse={live}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.location} /></svg>
    </span>
    <span class="col min-0 flex-max">
      <span class="row-nw align-centre gap-sm">
        <span class="md bold truncate name">{title}</span>
        {#if live}<span class="badge xs bold">{text("location", "live")}</span>{/if}
      </span>
      {#if location}
        <span class="xs faint selectable" use:menu={items}>{formatCoordinates(location)}{location.uncertainty ? ` · ${text("location", "accuracy").replace("{metres}", String(Math.round(location.uncertainty)))}` : ""}</span>
      {:else}
        <span class="xs faint">{text("location", "waiting")}</span>
      {/if}
    </span>
  </div>
  {#if location}
    <div class="actions row-nw align-centre gap-md xs">
      <a class="bold row-nw align-centre gap-xs" href={osmLink(location)} target="_blank" rel="noopener noreferrer" use:menu={items}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.open} /></svg>
        {text("location", "open_osm")}
      </a>
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

  .actions a {
    flex: none;
    color: var(--colours-accent);
  }

  .actions a:hover {
    text-decoration: underline;
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
