<script lang="ts">
  import { untrack } from "svelte";
  import { reducedMotion, spring } from "../../scripts/misc/spring";

  type Point = { lat: number; long: number };

  let {
    centre,
    pin = null,
    zoom = 15,
    interactive = false,
    onpick,
  }: { centre: Point; pin?: Point | null; zoom?: number; interactive?: boolean; onpick?: (point: Point) => void } = $props();

  const TILE = 256;
  const MIN_ZOOM = 2;
  const MAX_ZOOM = 19;
  const DRAG_SLOP = 4;
  const FRICTION = 0.0045;

  let width = $state(0);
  let height = $state(0);
  let cx = $state(0.5);
  let cy = $state(0.5);
  let z = $state(untrack(() => zoom));
  let dragging = $state(false);
  let frame = 0;

  const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  const size = (level: number) => TILE * 2 ** level;
  const normal = ({ lat, long }: Point) => {
    const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
    return { u: (long + 180) / 360, v: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
  };
  const point = (u: number, v: number): Point => ({
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI,
    long: ((((u * 360) % 360) + 360) % 360) - 180,
  });
  const at = (px: number, py: number) => ({ u: cx + (px - width / 2) / size(z), v: cy + (py - height / 2) / size(z) });
  const screen = (u: number, v: number) => ({ x: (u - cx) * size(z) + width / 2, y: (v - cy) * size(z) + height / 2 });

  const stop = () => cancelAnimationFrame(frame);

  const glide = (to: { u?: number; v?: number; z?: number }, anchor?: { px: number; py: number }) => {
    stop();
    const from = { u: cx, v: cy, z };
    const fixed = anchor && at(anchor.px, anchor.py);
    const target = { u: to.u ?? cx, v: to.v ?? cy, z: clampZoom(to.z ?? z) };
    const { duration, ease } = spring(0.42, 0.9);
    const start = performance.now();
    const step = (now: number) => {
      const t = reducedMotion() ? 1 : Math.min(1, (now - start) / duration);
      const k = ease(t);
      z = from.z + (target.z - from.z) * k;
      fixed && anchor
        ? ((cx = fixed.u - (anchor.px - width / 2) / size(z)), (cy = fixed.v - (anchor.py - height / 2) / size(z)))
        : ((cx = from.u + (target.u - from.u) * k), (cy = from.v + (target.v - from.v) * k));
      t < 1 && (frame = requestAnimationFrame(step));
    };
    frame = requestAnimationFrame(step);
  };

  $effect(() => {
    const target = normal(centre);
    untrack(() => (width ? glide({ ...target, z: Math.max(z, zoom) }) : ((cx = target.u), (cy = target.v))));
  });

  $effect(() => stop);

  const level = $derived(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z))));

  const layer = (depth: number) => {
    const count = 2 ** depth;
    const span = TILE * 2 ** (z - depth);
    const left = cx * size(z) - width / 2;
    const top = cy * size(z) - height / 2;
    const list: { key: string; src: string; x: number; y: number; span: number }[] = [];
    for (let ty = Math.floor(top / span); ty <= Math.floor((top + height) / span); ty++)
      for (let tx = Math.floor(left / span); tx <= Math.floor((left + width) / span); tx++)
        ty >= 0 && ty < count && list.push({ key: `${depth}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${depth}/${((tx % count) + count) % count}/${ty}.png`, x: tx * span - left, y: ty * span - top, span });
    return list;
  };

  const layers = $derived(width && height ? [Math.max(MIN_ZOOM, level - 1), level].filter((depth, index, all) => all.indexOf(depth) === index).map((depth) => ({ depth, tiles: layer(depth) })) : []);
  const marker = $derived(pin && width ? (({ u, v }) => screen(u + Math.round(cx - u), v))(normal(pin)) : null);

  let origin: { x: number; y: number; u: number; v: number; moved: boolean; last: number; vx: number; vy: number; px: number; py: number } | null = null;

  const onpointerdown = (event: PointerEvent) => {
    if (!interactive || event.button !== 0) return;
    stop();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    origin = { x: event.clientX, y: event.clientY, u: cx, v: cy, moved: false, last: performance.now(), vx: 0, vy: 0, px: event.clientX, py: event.clientY };
  };

  const onpointermove = (event: PointerEvent) => {
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    origin.moved ||= Math.hypot(dx, dy) > DRAG_SLOP;
    dragging = origin.moved;
    if (!origin.moved) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - origin.last);
    origin.vx = origin.vx * 0.2 + ((event.clientX - origin.px) / elapsed) * 0.8;
    origin.vy = origin.vy * 0.2 + ((event.clientY - origin.py) / elapsed) * 0.8;
    Object.assign(origin, { last: now, px: event.clientX, py: event.clientY });
    cx = origin.u - dx / size(z);
    cy = Math.max(0, Math.min(1, origin.v - dy / size(z)));
  };

  const coast = (vx: number, vy: number) => {
    let previous = performance.now();
    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      const decay = Math.exp(-FRICTION * elapsed);
      vx *= decay;
      vy *= decay;
      cx -= (vx * elapsed) / size(z);
      cy = Math.max(0, Math.min(1, cy - (vy * elapsed) / size(z)));
      Math.hypot(vx, vy) > 0.02 && (frame = requestAnimationFrame(step));
    };
    !reducedMotion() && (frame = requestAnimationFrame(step));
  };

  const onpointerup = (event: PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const was = origin;
    origin = null;
    dragging = false;
    if (!was) return;
    if (!was.moved) return void (({ u, v }) => onpick?.(point(u, v)))(at(event.clientX - rect.left, event.clientY - rect.top));
    performance.now() - was.last < 80 && coast(was.vx, was.vy);
  };

  const onwheel = (event: WheelEvent) => {
    if (!interactive) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const anchor = { px: event.clientX - rect.left, py: event.clientY - rect.top };
    const fine = event.deltaMode === 0 && Math.abs(event.deltaY) < 40;
    if (!fine) return glide({ z: Math.round(z) + (event.deltaY < 0 ? 1 : -1) }, anchor);
    stop();
    const fixed = at(anchor.px, anchor.py);
    z = clampZoom(z - event.deltaY * 0.01);
    cx = fixed.u - (anchor.px - width / 2) / size(z);
    cy = fixed.v - (anchor.py - height / 2) / size(z);
  };

  const step = (delta: number) => glide({ z: Math.round(z) + delta });
</script>

<div
  class="map"
  class:interactive
  class:dragging
  bind:clientWidth={width}
  bind:clientHeight={height}
  role={interactive ? "application" : "img"}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={() => ((origin = null), (dragging = false))}
  {onwheel}
  ondblclick={(event) => {
    if (!interactive) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    glide({ z: Math.round(z) + 1 }, { px: event.clientX - rect.left, py: event.clientY - rect.top });
  }}
>
  {#each layers as { depth, tiles } (depth)}
    <div class="layer">
      {#each tiles as tile (tile.key)}
        <img class="tile" src={tile.src} alt="" draggable="false" decoding="async" style:width="{tile.span + 0.5}px" style:height="{tile.span + 0.5}px" style:translate="{tile.x}px {tile.y}px" onload={(event) => event.currentTarget.classList.add("ready")} />
      {/each}
    </div>
  {/each}
  {#if marker}
    {#key pin}
      <span class="pin-spot" style:translate="{marker.x}px {marker.y}px">
        <svg class="pin" viewBox="0 0 24 32" width="30" height="40" aria-hidden="true">
          <path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0Z" fill="var(--colours-accent)" />
          <circle cx="12" cy="12" r="4.5" fill="white" />
        </svg>
        <span class="shadow"></span>
      </span>
    {/key}
  {/if}
  {#if interactive}
    <div class="zoom col" role="group">
      <button type="button" class="ghost press" aria-label="Zoom in" onclick={() => step(1)} onpointerdown={(event) => event.stopPropagation()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
      </button>
      <button type="button" class="ghost press" aria-label="Zoom out" onclick={() => step(-1)} onpointerdown={(event) => event.stopPropagation()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 12h14" /></svg>
      </button>
    </div>
  {/if}
  <span class="credit">© OpenStreetMap</span>
</div>

<style>
  .map {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    background-color: #1b1d22;
    user-select: none;
    touch-action: none;
    contain: strict;
  }

  .map.interactive {
    cursor: grab;
  }

  .map.dragging {
    cursor: grabbing;
  }

  .layer {
    position: absolute;
    inset: 0;
    filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88) saturate(0.7);
  }

  .tile {
    position: absolute;
    top: 0;
    left: 0;
    max-width: none;
    opacity: 0;
    transition: opacity 320ms cubic-bezier(0.32, 0.72, 0, 1);
    pointer-events: none;
  }

  .tile:global(.ready) {
    opacity: 1;
  }

  .pin-spot {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .pin {
    position: absolute;
    left: -15px;
    bottom: -2px;
    transform-origin: 50% 100%;
    filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.35));
    animation: drop 560ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .shadow {
    position: absolute;
    left: -7px;
    top: -3px;
    width: 14px;
    height: 6px;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.35);
    filter: blur(1.5px);
    animation: shadow 560ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes drop {
    from {
      transform: translateY(-22px) scale(0.85);
      opacity: 0;
    }
  }

  @keyframes shadow {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }

  .zoom {
    position: absolute;
    top: 10px;
    right: 10px;
    overflow: hidden;
    border-radius: 12px;
    background: rgb(20 22 27 / 0.55);
    backdrop-filter: blur(20px) saturate(1.6);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
  }

  .zoom button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    color: white;
    transition: background-color 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .zoom button + button {
    border-top: 1px solid rgb(255 255 255 / 0.08);
  }

  .zoom button:hover {
    background: rgb(255 255 255 / 0.1);
  }

  .credit {
    position: absolute;
    right: 8px;
    bottom: 5px;
    font-size: 10px;
    color: rgb(255 255 255 / 0.5);
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .pin,
    .shadow {
      animation: none;
    }
  }
</style>
