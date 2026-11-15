<script lang="ts">
  import { tooltip } from "../../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { downloadMedia } from "../../../scripts/matrix/utilities/download";
  import { acquireMediaLink } from "../../../scripts/matrix/utilities/media";
  import { dismissible } from "../../../scripts/misc/dismiss.svelte";
  import { canCopyMedia, copyMedia } from "../../../scripts/misc/clipboard";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import MessageMenu, { type MenuItem } from "../MessageMenu.svelte";
  import { lightbox, type LightboxItem } from "../../../scripts/stores/lightbox";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let item: LightboxItem | null = $state.raw(null);
  let link: string | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => lightbox.subscribe((value) => (item = value)));

  $effect(() => {
    const current = item;
    link = undefined;
    if (!current) return;

    const handle = acquireMediaLink(current.source, current.mimetype);
    handle.link.then((value) => item === current && (link = value)).catch(() => undefined);
    queueMicrotask(() => closeButton?.focus());
    return handle.release;
  });

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const STEP_ZOOM = 2.5;

  let zoom = $state(1);
  let x = $state(0);
  let y = $state(0);
  let gesturing = $state(false);
  let image: HTMLImageElement | undefined = $state();
  let stage: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!stage) return;
    stage.addEventListener("wheel", onwheel, { passive: false });
    return () => stage?.removeEventListener("wheel", onwheel);
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number } | null = null;
  let moved = false;

  const reset = () => {
    zoom = 1;
    x = 0;
    y = 0;
  };

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  const zoomAt = (next: number, clientX: number, clientY: number) => {
    if (!image) return;
    const target = clampZoom(next);
    if (target === MIN_ZOOM) return reset();

    const rect = image.getBoundingClientRect();
    const originX = rect.left + rect.width / 2 - x;
    const originY = rect.top + rect.height / 2 - y;
    const ratio = target / zoom;

    x = clientX - originX - (clientX - originX - x) * ratio;
    y = clientY - originY - (clientY - originY - y) * ratio;
    zoom = target;
  };

  const onwheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  };

  const ondblclick = (event: MouseEvent) =>
    zoom > MIN_ZOOM ? reset() : zoomAt(STEP_ZOOM, event.clientX, event.clientY);

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onpointerdown = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesturing = true;
    moved = false;
    if (pointers.size === 2) pinch = { distance: spread(), zoom };
  };

  const onpointermove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;

    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.zoom * (spread() / pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = true;
      return;
    }

    if (zoom > MIN_ZOOM) {
      x += next.x - last.x;
      y += next.y - last.y;
      moved ||= Math.hypot(next.x - last.x, next.y - last.y) > 2;
    }
  };

  const onpointerup = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) gesturing = false;
  };

  const exit = dismissible(() => lightbox.set(null));
  const close = exit.close;

  let menu: { x: number; y: number } | null = $state.raw(null);

  const menuItems = (current: LightboxItem): MenuItem[] => [
    ...(canCopyMedia(current.mimetype)
      ? [{ id: "copy", label: text("chat", "copy_image"), icon: MENU_ICONS.copy, run: () => void copyMedia(current.source, current.mimetype).catch(() => undefined) }]
      : []),
    { id: "save", label: text("chat", "save"), icon: MENU_ICONS.save, run: () => void downloadMedia(current.source, current.name).catch(() => undefined) },
  ];

  const oncontextmenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!menu) menu = { x: event.clientX, y: event.clientY };
  };

  const onclick = (event: MouseEvent) => {
    if (moved || zoom > MIN_ZOOM || event.target === image) return;
    close();
  };

  $effect(() => {
    item;
    reset();
  });

  const onkeydown = (event: KeyboardEvent) => {
    if (!item) return;
    if (event.key === "Escape") return close();
    const centreX = innerWidth / 2;
    const centreY = innerHeight / 2;
    if (event.key === "+" || event.key === "=") zoomAt(zoom * 1.5, centreX, centreY);
    if (event.key === "-") zoomAt(zoom / 1.5, centreX, centreY);
    if (event.key === "0") reset();
  };
</script>

<svelte:window {onkeydown} />

{#if item}
  <div class="lightbox col centre" class:closing={exit.closing} inert={exit.closing} onanimationend={exit.onanimationend} role="dialog" aria-modal="true" aria-label={item.name}>
    <button type="button" class="scrim ghost" aria-label={text("media", "close")} onclick={close}></button>
    <div class="bar row-nw align-centre gap-sm">
      <span class="sm truncate flex-max min-0">{item.name}</span>
      <button type="button" class="tool ghost press" aria-label={text("media", "download").replace("{name}", item.name)} use:tooltip={text("media", "download").replace("{name}", item.name)} onclick={() => item && downloadMedia(item.source, item.name).catch(() => undefined)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
      </button>
      <button type="button" class="tool ghost press" aria-label={text("media", "close")} use:tooltip={text("media", "close")} onclick={close} bind:this={closeButton}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    {#if link}
      <div
        class="stage centre"
        class:zoomed={zoom > MIN_ZOOM}
        class:gesturing
        role="presentation"
        bind:this={stage}
        {ondblclick}
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
        {onclick}
        {oncontextmenu}
      >
        <img
          bind:this={image}
          src={link}
          alt={item.name}
          draggable="false"
          style:aspect-ratio={item.w && item.h ? `${item.w} / ${item.h}` : undefined}
          style:transform={`translate3d(${x}px, ${y}px, 0) scale(${zoom})`}
        />
      </div>
    {:else}
      <span class="spinner" aria-hidden="true"></span>
    {/if}
  </div>
{/if}

{#if menu && item}
  <MessageMenu items={menuItems(item)} x={menu.x} y={menu.y} label={item.name} onclose={() => (menu = null)} />
{/if}

<style>
  .lightbox {
    --bar: calc(var(--azure-touch) + var(--azure-spacing-sm) * 2 + env(safe-area-inset-top));
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: calc(64px + env(safe-area-inset-top)) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
  }

  .lightbox.closing {
    animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .bar {
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: zoom-out;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(14px);
    animation: veil var(--azure-duration-slow) var(--azure-ease-fluid);
  }

  .bar {
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    padding: calc(var(--azure-spacing-sm) + env(safe-area-inset-top)) var(--azure-spacing-md) var(--azure-spacing-sm) var(--azure-spacing-lg);
    color: var(--colours-text-strong);
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.6);
    pointer-events: none;
  }

  .bar::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    z-index: -1;
    height: calc(108px + env(safe-area-inset-top));
    background: linear-gradient(to bottom, rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.18) 55%, transparent);
    pointer-events: none;
  }

  .bar > * {
    pointer-events: auto;
  }

  .tool svg {
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.6));
  }

  .tool {
    display: grid;
    place-items: center;
    width: var(--azure-touch);
    height: var(--azure-touch);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .tool:hover {
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  .stage {
    position: absolute;
    inset: calc(var(--bar) + var(--azure-spacing-xs)) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
    display: flex;
    touch-action: none;
    cursor: zoom-in;
  }

  .stage.zoomed {
    cursor: grab;
  }

  .stage.zoomed.gesturing {
    cursor: grabbing;
  }

  .stage img {
    transition: transform var(--azure-duration-md) var(--azure-ease-fluid);
    will-change: transform;
    user-select: none;
    -webkit-user-select: none;
  }

  .stage.gesturing img {
    transition: none;
  }

  img {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--azure-radius-md);
    box-shadow: 0 24px 80px -24px black;
    animation: zoom var(--azure-duration-slow) var(--azure-ease-fluid);
  }

  .spinner {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--colours-outline-light);
    border-top-color: var(--colours-accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes veil {
    from {
      background-color: transparent;
      backdrop-filter: blur(0);
    }
  }

  @keyframes zoom {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
</style>
