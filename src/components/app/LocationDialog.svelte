<script lang="ts">
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { formatCoordinates, type GeoLocation } from "../../scripts/matrix/utilities/content";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { native } from "../../scripts/misc/native";
  import { placeAt, searchPlaces } from "../../scripts/misc/geocode";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import MapView from "../ui/MapView.svelte";

  let { onsend, onclose }: { onsend: (location: GeoLocation, self: boolean) => void; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "location", ...path) as string;

  type Place = { lat: number; long: number; label: string; name: string };

  let dialog: ConfirmDialog | undefined = $state();
  let centre = $state({ lat: 51.5074, long: -0.1278 });
  let zoom = $state(3);
  let pin = $state<GeoLocation | null>(null);
  let self = $state(false);
  let locating = $state(false);
  let failed = $state<string | null>(null);
  let query = $state("");
  let results = $state<Place[]>([]);
  let searching = $state(false);
  let naming = 0;

  const current = (): Promise<{ lat: number; long: number; accuracy?: number }> =>
    native
      ? import("@tauri-apps/api/core").then(({ invoke }) => invoke<{ lat: number; long: number; accuracy?: number }>("location_current"))
      : new Promise((done, fail) =>
          "geolocation" in navigator
            ? navigator.geolocation.getCurrentPosition(({ coords }) => done({ lat: coords.latitude, long: coords.longitude, accuracy: coords.accuracy }), (error) => fail(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
            : fail("unavailable"),
        );

  const locate = async () => {
    if (locating) return;
    locating = true;
    failed = null;
    try {
      const found = await current();
      centre = { lat: found.lat, long: found.long };
      zoom = 16;
      pin = { lat: found.lat, long: found.long, uncertainty: found.accuracy, description: text("my_location") };
      self = true;
    } catch (error) {
      failed = text(error === "denied" ? "denied" : "unavailable");
    } finally {
      locating = false;
    }
  };

  const search = async (event: SubmitEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term || searching) return;
    searching = true;
    results = await searchPlaces(term);
    searching = false;
    !results.length && (failed = text("no_results"));
  };

  const choose = (place: Place) => {
    centre = { lat: place.lat, long: place.long };
    zoom = 16;
    pin = { lat: place.lat, long: place.long, description: place.name };
    self = false;
    results = [];
    failed = null;
  };

  const drop = async (point: { lat: number; long: number }) => {
    pin = { ...point, description: text("pinned") };
    self = false;
    failed = null;
    const ticket = ++naming;
    const found = await placeAt(point.lat, point.long);
    ticket === naming && pin && found && (pin = { ...pin, description: found });
  };

  const send = () => pin && (onsend(pin, self), dialog?.dismiss());
</script>

<ConfirmDialog bind:this={dialog} title={text("send")} cancelLabel={getLocalisedText(undefined, "settings", "cancel") as string} tone="primary" {onclose}>
  <div class="picker col gap-md">
    <button type="button" class="current row-nw align-centre gap-md ghost press" class:on={self} aria-busy={locating} onclick={locate}>
      <span class="glyph row centre" class:pulse={locating}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.location} /></svg></span>
      <span class="col min-0 flex-max">
        <span class="sm bold">{text("current")}</span>
        <span class="xs faint truncate">{locating ? text("locating") : self && pin ? text("accuracy").replace("{metres}", String(Math.round(pin.uncertainty ?? 0))) : text("current_hint")}</span>
      </span>
    </button>

    <form class="search row-nw align-centre gap-sm" onsubmit={search}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" /></svg>
      <input class="flex-max min-0" type="search" bind:value={query} placeholder={text("search")} aria-label={text("search")} oninput={() => (results = [], (failed = null))} />
      {#if searching}<span class="spinner" aria-hidden="true"></span>{/if}
    </form>

    {#if results.length}
      <ul class="results col" transition:fly={{ y: -6, duration: 260, easing: quintOut }}>
        {#each results as place (place.label)}
          <li><button type="button" class="result ghost press sm truncate" onclick={() => choose(place)}>{place.label}</button></li>
        {/each}
      </ul>
    {/if}

    <div class="frame">
      <MapView {centre} {pin} {zoom} interactive onpick={drop} />
    </div>

    <div class="status row-nw align-centre gap-sm xs">
      {#if failed}
        <span class="failed truncate" in:fly={{ y: 4, duration: 240, easing: quintOut }}>{failed}</span>
      {:else if pin}
        {#key pin.description}
          <span class="truncate" in:fly={{ y: 4, duration: 240, easing: quintOut }}><span class="bold">{pin.description}</span> <span class="faint">· {formatCoordinates(pin)}</span></span>
        {/key}
      {:else}
        <span class="faint">{text("tap_map")}</span>
      {/if}
    </div>
  </div>
  {#snippet actions()}
    <button type="button" class="dialog-button ghost press sm bold primary" disabled={!pin} onclick={send}>{text("share")}</button>
  {/snippet}
</ConfirmDialog>

<style>
  :global(.confirm-layer .confirm:has(.picker)) {
    width: min(100%, 520px);
  }

  .current {
    width: 100%;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    text-align: left;
    transition:
      background-color 280ms cubic-bezier(0.32, 0.72, 0, 1),
      border-color 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .current:hover {
    background-color: var(--colours-surface-hover);
  }

  .current.on {
    border-color: color-mix(in oklab, var(--colours-accent) 45%, transparent);
    background-color: var(--colours-accent-faint);
  }

  .glyph {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .glyph.pulse {
    animation: pulse 1.4s cubic-bezier(0.32, 0.72, 0, 1) infinite;
  }

  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 6px color-mix(in oklab, var(--colours-accent) 18%, transparent);
    }
  }

  .search {
    height: 38px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-border);
    background-color: var(--colours-surface);
    color: var(--colours-text-muted);
    transition: border-color 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .search:focus-within {
    border-color: var(--colours-accent);
  }

  .search input {
    height: 100%;
    border: 0;
    outline: none;
    background: none;
    color: var(--colours-text-strong);
    font: inherit;
    font-size: var(--text-md);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 700ms linear infinite;
  }

  @keyframes spin {
    to {
      rotate: 1turn;
    }
  }

  .results {
    margin: calc(var(--azure-spacing-sm) * -1) 0 0;
    padding: 4px;
    list-style: none;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .result {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    text-align: left;
  }

  .result:hover {
    background-color: var(--colours-surface-hover);
  }

  .frame {
    height: 300px;
    overflow: hidden;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
  }

  .status {
    min-height: 18px;
  }

  .failed {
    color: var(--colours-danger);
  }

  @media (pointer: coarse) {
    .search input {
      font-size: 16px;
    }
  }
</style>
