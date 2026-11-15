<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";

  let {
    file,
    aspect = 1,
    shape = "circle",
    output = 512,
    onapply,
    oncancel,
  }: {
    file: File;
    aspect?: number;
    shape?: "circle" | "squircle" | "rect";
    output?: number;
    onapply: (blob: Blob) => void;
    oncancel: () => void;
  } = $props();

  const MAX_ZOOM = 4;
  const WHEEL_STEP = 0.0015;
  const MAX_ANGLE = 45;
  const SNAP = 2;
  const HOLD = 450;

  const text = (...path: string[]) => getLocalisedText(undefined, "create", "crop", ...path) as string;

  const source = $derived(URL.createObjectURL(file));
  $effect(() => {
    const url = source;
    return () => URL.revokeObjectURL(url);
  });

  let image: HTMLImageElement | undefined = $state();
  let natural = $state.raw({ width: 0, height: 0 });
  let frameWidth = $state(0);
  let zoom = $state(1);
  let x = $state(0);
  let y = $state(0);
  let turns = $state(0);
  let angle = $state(0);
  let turning = $state(false);
  let fine = $state(false);
  let dragging = $state(false);
  let busy = $state(false);

  const frameHeight = $derived(frameWidth / aspect);
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const theta = $derived(radians(turns * 90 + angle));

  const extents = (rotation: number) => {
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    return { x: (frameWidth * cos + frameHeight * sin) / 2, y: (frameWidth * sin + frameHeight * cos) / 2 };
  };

  const coverFor = (rotation: number) => {
    if (!natural.width) return 1;
    const extent = extents(rotation);
    return Math.max((extent.x * 2) / natural.width, (extent.y * 2) / natural.height);
  };

  const scale = $derived(coverFor(theta) * zoom);

  const clamp = (value: number, limit: number) => Math.min(Math.max(value, -limit), Math.max(0, limit));

  const place = (nextX: number, nextY: number, nextZoom = zoom, rotation = theta) => {
    zoom = Math.min(Math.max(nextZoom, 1), MAX_ZOOM);
    const size = coverFor(rotation) * zoom;
    const extent = extents(rotation);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = clamp(nextX * cos + nextY * sin, (natural.width * size) / 2 - extent.x);
    const localY = clamp(-nextX * sin + nextY * cos, (natural.height * size) / 2 - extent.y);
    x = localX * cos - localY * sin;
    y = localX * sin + localY * cos;
  };

  const rezoom = (nextZoom: number, pointX = 0, pointY = 0) => {
    const ratio = Math.min(Math.max(nextZoom, 1), MAX_ZOOM) / zoom;
    place(pointX - (pointX - x) * ratio, pointY - (pointY - y) * ratio, nextZoom);
  };

  const onload = () => {
    if (image) natural = { width: image.naturalWidth, height: image.naturalHeight };
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const ondown = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragging = true;
    if (pointers.size === 2) pinch = distance();
  };

  const onmove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const next = distance();
      if (pinch) rezoom(zoom * (next / pinch));
      pinch = next;
    } else if (pointers.size === 1) place(x + dx, y + dy);
  };

  const onup = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    pinch = 0;
    dragging = pointers.size > 0;
  };

  const onwheel = (event: WheelEvent & { currentTarget: HTMLElement }) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    rezoom(zoom * Math.exp(-event.deltaY * WHEEL_STEP), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
  };

  const turn = () => {
    if (held) return (held = false);
    turning = true;
    turns += 1;
    place(-y, x, zoom, radians(turns * 90 + angle));
  };

  const straighten = (value: number) => {
    angle = Math.abs(value) <= SNAP ? 0 : value;
    place(x, y, zoom, radians(turns * 90 + angle));
  };

  let hold: ReturnType<typeof setTimeout> | undefined;
  let held = false;

  const onholdstart = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    held = false;
    hold = setTimeout(() => {
      held = true;
      fine = true;
    }, HOLD);
  };

  const onholdend = () => clearTimeout(hold);

  $effect(() => () => clearTimeout(hold));

  const reset = () => {
    turns = 0;
    angle = 0;
    turning = true;
    place(0, 0, 1, 0);
  };

  let result: Blob | null = null;
  const exit = dismissible(() => (result ? onapply(result) : oncancel()));

  const encode = (canvas: HTMLCanvasElement, type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));

  const apply = async () => {
    if (!image || !natural.width || busy) return;
    busy = true;
    const width = output;
    const height = Math.round(output / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return (busy = false);
    const ratio = width / frameWidth;
    context.imageSmoothingQuality = "high";
    context.translate(width / 2, height / 2);
    context.scale(ratio, ratio);
    context.translate(x, y);
    context.rotate(theta);
    context.scale(scale, scale);
    context.drawImage(image, -natural.width / 2, -natural.height / 2);
    let blob = await encode(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encode(canvas, file.type === "image/jpeg" ? "image/jpeg" : "image/png");
    busy = false;
    if (!blob) return;
    result = blob;
    exit.close();
  };

  const cancel = () => exit.close();
</script>

<div class="layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={cancel}></button>
  <div class="dialog col" onanimationend={exit.onanimationend} inert={exit.closing} role="dialog" aria-modal="true" aria-labelledby="crop-title" tabindex="-1" onkeydown={(event) => event.key === "Escape" && (event.stopPropagation(), cancel())}>
    <header class="row-nw align-centre">
      <h2 id="crop-title" class="lg bold flex-max">{text("title")}</h2>
      <button type="button" class="close ghost press row centre" aria-label={text("close")} onclick={cancel}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div class="stage" onwheel={onwheel} onpointerdown={ondown} onpointermove={onmove} onpointerup={onup} onpointercancel={onup} role="presentation">
      <img
        bind:this={image}
        class:turning
        class:dragging
        src={source}
        alt=""
        draggable="false"
        {onload}
        ontransitionend={() => (turning = false)}
        style:width="{natural.width}px"
        style:height="{natural.height}px"
        style:transform="translate(-50%, -50%) translate({x}px, {y}px) rotate({turns * 90 + angle}deg) scale({scale})"
      />
      <div class="window {shape}" style:aspect-ratio={aspect} style:--aspect={aspect} bind:clientWidth={frameWidth}></div>
    </div>
    <div class="controls row-nw align-centre">
      <span class="side"></span>
      <div class="zoom row-nw align-centre gap-sm">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4" fill="currentColor" opacity="0.35" /><circle cx="15.5" cy="9" r="1.8" fill="currentColor" /><path fill="currentColor" d="M3 16.5 8.2 11.3a1.6 1.6 0 0 1 2.3 0L14 14.8l1.6-1.6a1.6 1.6 0 0 1 2.3 0L21 16.3V16a4 4 0 0 1-4 4H7a4 4 0 0 1-4-3.5Z" /></svg>
        <input type="range" min="1" max={MAX_ZOOM} step="0.01" aria-label={text("zoom")} value={zoom} style:--p={`${((zoom - 1) / (MAX_ZOOM - 1)) * 100}%`} oninput={(event) => rezoom(Number(event.currentTarget.value))} />
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4" fill="currentColor" opacity="0.35" /><circle cx="15.5" cy="9" r="1.8" fill="currentColor" /><path fill="currentColor" d="M3 16.5 8.2 11.3a1.6 1.6 0 0 1 2.3 0L14 14.8l1.6-1.6a1.6 1.6 0 0 1 2.3 0L21 16.3V16a4 4 0 0 1-4 4H7a4 4 0 0 1-4-3.5Z" /></svg>
      </div>
      <div class="side rotate row-nw">
        <div class="popover col gap-xs" class:open={fine}>
          <span class="xs bold">{angle}°</span>
          <input
            type="range"
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step="1"
            aria-label={text("angle")}
            value={angle}
            style:--p={`${((angle + MAX_ANGLE) / (MAX_ANGLE * 2)) * 100}%`}
            oninput={(event) => straighten(Number(event.currentTarget.value))}
            ondblclick={() => straighten(0)}
            onblur={() => (fine = false)}
          />
        </div>
        <button type="button" class="turn ghost press row centre" aria-label={text("rotate")} onclick={turn} onpointerdown={onholdstart} onpointerup={onholdend} onpointercancel={onholdend} oncontextmenu={(event) => event.preventDefault()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="9" width="12" height="12" rx="3.5" fill="currentColor" opacity="0.35" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 5.5h4.5a5 5 0 0 1 5 5V14" /><path fill="currentColor" d="M16.6 12.6h5.8l-2.9 3.6Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" /></svg>
        </button>
      </div>
    </div>
    <footer class="foot row-nw align-centre gap-sm">
      <button type="button" class="link ghost press md bold" onclick={reset}>{text("reset")}</button>
      <span class="flex-max"></span>
      <button type="button" class="button secondary ghost press md bold" onclick={cancel}>{text("cancel")}</button>
      <button type="button" class="button primary ghost press md bold" onclick={apply} disabled={!natural.width || busy} aria-busy={busy}>{text("apply")}</button>
    </footer>
  </div>
</div>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: var(--azure-spacing-lg);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .dialog {
    position: relative;
    width: min(100%, 520px);
    max-height: 100%;
    padding: var(--azure-spacing-xl);
    gap: var(--azure-spacing-lg);
    overflow: hidden;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    color: var(--colours-text-faint);
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  h2 {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .close,
  .turn {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .close:hover,
  .turn:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .stage {
    position: relative;
    isolation: isolate;
    padding: var(--azure-spacing-xl);
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    user-select: none;
    border-radius: var(--azure-radius-md);
    background-color: black;
  }

  .stage:active {
    cursor: grabbing;
  }

  .stage img {
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: none;
    z-index: 1;
    transform-origin: center;
    pointer-events: none;
  }

  .stage img {
    transition: transform 150ms var(--azure-ease-fluid);
  }

  .stage img.dragging {
    transition: none;
  }

  .stage img.turning {
    transition: transform var(--azure-duration-md) var(--azure-ease-out);
  }

  .window {
    position: relative;
    z-index: 2;
    width: min(100%, 320px, calc(50dvh * var(--aspect, 1)));
    margin: 0 auto;
    pointer-events: none;
    border-radius: var(--azure-radius-md);
    box-shadow:
      0 0 0 3px white,
      0 0 0 100vmax rgb(0 0 0 / 0.6);
  }

  .window.circle {
    border-radius: 50%;
  }

  .window.squircle {
    border-radius: 30%;
  }

  .side {
    flex: 1;
  }

  .rotate {
    position: relative;
    justify-content: flex-end;
  }

  .zoom input {
    width: 120px;
  }

  input[type="range"] {
    appearance: none;
    height: 16px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }

  input[type="range"]:focus-visible {
    outline: none;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--colours-accent) var(--p, 0%), rgb(255 255 255 / 0.18) var(--p, 0%));
  }

  input[type="range"]::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.18);
  }

  input[type="range"]::-moz-range-progress {
    height: 3px;
    border-radius: 999px;
    background: var(--colours-accent);
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5.5px;
    border: none;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: scale var(--azure-duration-fast) var(--azure-ease-out);
  }

  input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: scale var(--azure-duration-fast) var(--azure-ease-out);
  }

  input[type="range"]:hover::-webkit-slider-thumb,
  input[type="range"]:focus-visible::-webkit-slider-thumb {
    scale: 1.15;
  }

  input[type="range"]:hover::-moz-range-thumb,
  input[type="range"]:focus-visible::-moz-range-thumb {
    scale: 1.15;
  }

  .popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--azure-spacing-xs));
    z-index: 3;
    align-items: center;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 8px 24px -8px black;
    color: var(--colours-text-strong);
    opacity: 0;
    visibility: hidden;
    transform: translateY(4px);
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-fast) var(--azure-ease-out),
      visibility var(--azure-duration-fast);
  }

  .popover input {
    width: 140px;
  }

  .rotate:hover .popover,
  .rotate:focus-within .popover,
  .popover.open {
    opacity: 1;
    visibility: visible;
    transform: none;
  }

  .foot {
    margin: 0 calc(var(--azure-spacing-xl) * -1) calc(var(--azure-spacing-xl) * -1);
    padding: var(--azure-spacing-lg) var(--azure-spacing-xl);
    background-color: var(--colours-surface-hover);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .link {
    padding: 0;
    color: var(--colours-accent);
  }

  .link {
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .link:hover {
    opacity: 0.75;
  }

  .button {
    min-height: 42px;
    padding: 0 var(--azure-spacing-xl);
    border-radius: var(--azure-radius-md);
    color: var(--colours-text);
  }

  .button.secondary {
    background-color: var(--colours-surface-active);
  }

  .button.secondary:hover {
    background-color: var(--colours-surface-pressed);
  }

  .button.primary {
    color: var(--colours-on-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 78%, var(--colours-surface-raised));
  }

  .button.primary:hover:not(:disabled) {
    background-color: var(--colours-accent);
  }

  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .closing .scrim {
    animation: fade-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .dialog {
    animation: pop-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes pop-out {
    to {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }

  @keyframes slide {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes sink {
    to {
      transform: translateY(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage img,
    .stage img.turning {
      transition: none;
    }
  }

  @media (max-width: 767px) {
    .layer {
      justify-content: flex-end;
      padding: 0;
    }

    .dialog {
      width: 100%;
      max-height: 100dvh;
      padding: var(--azure-spacing-lg);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      animation: slide var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .closing .dialog {
      animation: sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .foot {
      margin: 0 calc(var(--azure-spacing-lg) * -1) calc(var(--azure-spacing-lg) * -1);
      padding: var(--azure-spacing-lg) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
    }

    .button,
    .close,
    .turn {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }
  }
</style>
