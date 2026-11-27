<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { formatCoordinates, geoUri, osmLink, type GeoLocation } from "../../../scripts/matrix/utilities/content";
  import { entityText, menu } from "../../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { copied } from "../../../scripts/stores/toast";
  import { nearViewport } from "../../../scripts/misc/lazy";
  import MapView from "../../ui/MapView.svelte";
  import ConfirmDialog from "../../ui/ConfirmDialog.svelte";
  import { placeAt } from "../../../scripts/misc/geocode";

  let { location, live, label }: { location: GeoLocation | null; live?: boolean; label?: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let seen = $state(false);
  let viewing = $state(false);
  let viewer: ConfirmDialog | undefined = $state();

  let guess = $state<string | null>(null);
  const vague = $derived(!location?.description || /^(pinned location|location|shared location|geo:)|^-?\d+(\.\d+)?,\s*-?\d/i.test(location.description.trim()));

  $effect(() => {
    const spot = location;
    guess = null;
    seen && spot && vague && placeAt(spot.lat, spot.long).then((name) => location === spot && (guess = name));
  });

  const title = $derived(guess ?? location?.description ?? label ?? text("location", "shared"));

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
  {#if location}
    <button type="button" class="preview ghost" aria-label={text("location", "view")} onclick={() => (viewing = true)} use:menu={items} use:nearViewport={() => (seen = true)}>
      {#if seen}<MapView centre={location} pin={location} zoom={15} />{/if}
    </button>
  {/if}
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

{#if viewing && location}
  <ConfirmDialog bind:this={viewer} title={title} cancelLabel={text("status", "close")} tone="primary" onclose={() => (viewing = false)}>
    <div class="viewer col gap-sm">
      <div class="big"><MapView centre={location} pin={location} zoom={16} interactive /></div>
      <span class="xs faint selectable" use:menu={items}>{formatCoordinates(location)}{location.uncertainty ? ` · ${text("location", "accuracy").replace("{metres}", String(Math.round(location.uncertainty)))}` : ""}</span>
    </div>
    {#snippet actions()}
      <button type="button" class="button primary" onclick={() => open(location!)} use:menu={items}>{text("location", "open_osm")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

<style>
  :global(.confirm-layer .confirm:has(.viewer)) {
    width: min(100%, 880px);
  }

  .big {
    height: min(62vh, 560px);
    overflow: hidden;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
  }

  .location {
    width: min(100%, 380px);
    margin-top: var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    gap: var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .preview {
    display: block;
    height: 170px;
    margin: calc(var(--azure-spacing-md) * -1) calc(var(--azure-spacing-md) * -1) var(--azure-spacing-xs);
    padding: 0;
    overflow: hidden;
    border-radius: var(--azure-radius-md) var(--azure-radius-md) 0 0;
    background-color: #1b1d22;
    cursor: pointer;
  }

  .preview :global(.map) {
    transition: filter 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .preview:hover :global(.map) {
    filter: brightness(1.08);
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
