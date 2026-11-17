<script lang="ts">
  import { tick } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { pictureInPicture, pipSupported } from "../../scripts/misc/screen";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { navigation, openJoined } from "../../scripts/stores/navigation.svelte";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { callMedia, userOfIdentity, voice } from "../../scripts/stores/voice";
  import type { Track } from "livekit-client";
  import { fluid, readDuration } from "../auth/motion";
  import EmojiText from "../ui/EmojiText.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  const screens = $derived($callMedia.filter((media) => media.source === "screen" && media.track.mediaStreamTrack?.readyState !== "ended"));
  const media = $derived(screens.findLast((entry) => !entry.local) ?? screens.find((entry) => entry.local));
  const roomId = $derived($voice?.roomId);
  const viewing = $derived(!!roomId && navigation.roomId === roomId && !navigation.browsing);
  let closed = $state<string | null>(null);
  $effect(() => void (viewing && (closed = null)));
  const shown = $derived(!!roomId && !!media && !viewing && closed !== media.id);
  const userId = $derived(media ? (media.local ? ($session?.userId ?? "") : userOfIdentity(media.identity)) : "");
  const name = $derived($rooms[roomId ?? ""]?.members[userId]?.displayName || userId.slice(1).split(":")[0]);

  let corner = $state({ x: 1, y: 1 });
  let offset = $state({ x: 0, y: 0 });
  let gliding = $state(false);
  let glide = $state(420);
  let dragging = $state(false);
  const SIZE_KEY = "skye:mini_width";
  const DEFAULT_WIDTH = 320;
  const readWidth = () => {
    try {
      return Number(localStorage.getItem(SIZE_KEY)) || DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  };
  let width = $state(readWidth());
  let ratio = $state(16 / 9);
  const measure = () => video?.videoWidth && video.videoHeight && (ratio = video.videoWidth / video.videoHeight);
  let resizing = $state(false);
  const fit = (value: number) => Math.round(Math.min(Math.max(value, 200), Math.min(innerWidth - 32, 760)));
  const resize = (value: number) => {
    width = fit(value);
    try {
      localStorage.setItem(SIZE_KEY, String(width));
    } catch {}
  };
  let grab: { x: number; y: number; width: number } | null = null;
  const gripDown = (event: PointerEvent) => (event.stopPropagation(), event.preventDefault(), (event.currentTarget as Element).setPointerCapture(event.pointerId), (grab = { x: event.clientX, y: event.clientY, width }), (resizing = true));
  const gripMove = (event: PointerEvent) => {
    if (!grab) return;
    event.stopPropagation();
    const across = (event.clientX - grab.x) * (corner.x ? -1 : 1);
    const down = (event.clientY - grab.y) * (corner.y ? -1 : 1) * (16 / 9);
    width = fit(grab.width + (Math.abs(across) > Math.abs(down) ? across : down));
  };
  const gripUp = (event: PointerEvent) => grab && (event.stopPropagation(), (grab = null), (resizing = false), resize(width));
  let node = $state<HTMLElement>();
  let video = $state<HTMLVideoElement>();

  const back = () => roomId && openJoined(roomId);
  const pip = () => pictureInPicture(video);
  const close = () => (closed = media?.id ?? null);
  const items = (): MenuItem[] => [
    { id: "mini-back", label: text("back_to_call"), icon: MENU_ICONS.open, run: back },
    ...(pipSupported ? [{ id: "mini-pip", label: text("pip"), icon: MENU_ICONS.pip, run: pip }] : []),
    { id: "mini-bigger", label: text("mini_bigger"), icon: MENU_ICONS.fullscreen, separated: true, run: () => resize(width * 1.25) },
    { id: "mini-smaller", label: text("mini_smaller"), icon: MENU_ICONS.fullscreenExit, run: () => resize(width / 1.25) },
    ...(width !== DEFAULT_WIDTH ? [{ id: "mini-reset", label: text("mini_reset"), icon: MENU_ICONS.read, run: () => resize(DEFAULT_WIDTH) }] : []),
    { id: "mini-close", label: text("hide_player"), icon: MENU_ICONS.close, separated: true, run: close },
  ];

  let start: { x: number; y: number; ox: number; oy: number } | null = null;
  let samples: { x: number; y: number; t: number }[] = [];
  let moved = false;

  const down = (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    start = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    samples = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    moved = false;
    gliding = false;
  };
  const move = (event: PointerEvent) => {
    if (!start) return;
    event.stopPropagation();
    moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
    if (!moved) return;
    node?.hasPointerCapture(event.pointerId) || node?.setPointerCapture(event.pointerId);
    dragging = true;
    offset = { x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y };
    samples = [...samples, { x: event.clientX, y: event.clientY, t: event.timeStamp }].filter((sample) => event.timeStamp - sample.t < 100);
  };
  const up = async (event: PointerEvent) => {
    if (!start || !node) return;
    event.stopPropagation();
    start = null;
    dragging = false;
    if (!moved) return void ((event.target as Element).closest("button") || back());
    const first = samples[0];
    const last = samples.at(-1) ?? first;
    const span = Math.max(last.t - first.t, 1);
    const velocity = { x: (last.x - first.x) / span, y: (last.y - first.y) / span };
    const rect = node.getBoundingClientRect();
    const aimX = rect.left + rect.width / 2 + velocity.x * 220;
    const aimY = rect.top + rect.height / 2 + velocity.y * 220;
    const before = { x: node.offsetLeft + offset.x, y: node.offsetTop + offset.y };
    corner = { x: Number(aimX > innerWidth / 2), y: Number(aimY > innerHeight / 2) };
    await tick();
    offset = { x: before.x - node.offsetLeft, y: before.y - node.offsetTop };
    await tick();
    glide = Math.round(Math.min(640, Math.max(320, 320 + Math.hypot(offset.x, offset.y) * 0.35 - Math.hypot(velocity.x, velocity.y) * 60)));
    void node.offsetWidth;
    gliding = true;
    offset = { x: 0, y: 0 };
  };

  const attach = (element: HTMLVideoElement, track?: Track) => {
    let current = track;
    current?.attach(element);
    return {
      update: (next?: Track) => (current?.detach(element), (current = next), next?.attach(element)),
      destroy: () => void current?.detach(element),
    };
  };
  const pop = (_node: Element) => ({ duration: readDuration("--azure-duration-slow", 420), easing: fluid, css: (t: number) => `opacity: ${t}; scale: ${0.8 + t * 0.2};` });
</script>

{#if shown && media}
  <div
    class="mini"
    class:right={corner.x === 1}
    class:bottom={corner.y === 1}
    class:gliding
    class:dragging
    class:resizing
    style:width="{width}px"
    style:aspect-ratio={ratio}
    style:--dx="{offset.x}px"
    style:--dy="{offset.y}px"
    style:--glide="{glide}ms"
    role="button"
    tabindex="0"
    aria-label={text("back_to_call")}
    bind:this={node}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={(event) => event.key === "Enter" && back()}
    ontransitionend={(event) => event.target === node && event.propertyName === "translate" && (gliding = false)}
    use:menu={items}
    transition:pop
  >
    <video bind:this={video} use:attach={media.track} muted playsinline onloadedmetadata={measure} onresize={measure}></video>
    <span class="grip" role="separator" aria-label={text("mini_resize")} onpointerdown={gripDown} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp} use:menu={items}></span>
    <span class="name xs bold truncate"><EmojiText text={text("screen_of").replace("{name}", name)} /></span>
    <div class="controls row-nw align-centre gap-xs">
      <button type="button" class="ghost round control press" aria-label={text("back_to_call")} use:tooltip={text("back_to_call")} onclick={back} use:menu={items}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.open} /></svg>
      </button>
      {#if pipSupported}
        <button type="button" class="ghost round control press" aria-label={text("pip")} use:tooltip={text("pip")} onclick={pip} use:menu={items}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.pip} /></svg>
        </button>
      {/if}
      <button type="button" class="ghost round control press" aria-label={text("hide_player")} use:tooltip={text("hide_player")} onclick={close} use:menu={items}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .mini {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    --gap: 16px;
    position: fixed;
    z-index: 900;
    top: calc(var(--gap) + env(safe-area-inset-top));
    left: calc(var(--gap) + env(safe-area-inset-left));
    width: 320px;
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    overflow: hidden;
    background: black;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.28), 0 2px 8px rgb(0 0 0 / 0.18);
    transform-origin: top left;
    translate: var(--dx) var(--dy);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    transition:
      width 420ms var(--ease),
      aspect-ratio 420ms var(--ease);
  }

  .mini.right {
    left: auto;
    right: calc(var(--gap) + env(safe-area-inset-right));
  }

  .mini.bottom {
    top: auto;
    bottom: calc(var(--gap) + env(safe-area-inset-bottom));
  }

  .mini.right {
    transform-origin: top right;
  }

  .mini.bottom {
    transform-origin: bottom left;
  }

  .mini.right.bottom {
    transform-origin: bottom right;
  }

  .mini.gliding {
    transition:
      translate var(--glide) var(--ease),
      width 420ms var(--ease);
  }

  .mini.resizing {
    transition: none;
  }

  .grip {
    position: absolute;
    z-index: 2;
    top: 0;
    left: 0;
    width: 22px;
    height: 22px;
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 240ms var(--ease);
  }

  .grip::after {
    content: "";
    position: absolute;
    inset: 6px;
    border-top: 2px solid rgb(255 255 255 / 0.85);
    border-left: 2px solid rgb(255 255 255 / 0.85);
    border-top-left-radius: 6px;
  }

  .mini:not(.right):not(.bottom) .grip {
    left: auto;
    right: 0;
    top: auto;
    bottom: 0;
    rotate: 180deg;
  }

  .mini.right:not(.bottom) .grip {
    top: auto;
    bottom: 0;
    rotate: 270deg;
  }

  .mini.bottom:not(.right) .grip {
    left: auto;
    right: 0;
    top: 0;
    rotate: 90deg;
    cursor: nesw-resize;
  }

  .mini.right:not(.bottom) .grip {
    cursor: nesw-resize;
  }

  .mini:hover .grip,
  .mini.resizing .grip {
    opacity: 1;
  }

  .mini.dragging {
    cursor: grabbing;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .name,
  .controls {
    position: absolute;
    opacity: 0;
    transition:
      opacity 280ms var(--ease),
      translate 280ms var(--ease);
  }

  .name {
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 10px 8px;
    color: white;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.6));
    translate: 0 6px;
  }

  .controls {
    top: 8px;
    right: 8px;
    translate: 0 -6px;
  }

  .mini:hover:not(.dragging) .name,
  .mini:hover:not(.dragging) .controls {
    opacity: 1;
    translate: 0 0;
  }

  .control {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    color: white;
    transition: background-color 280ms var(--ease);
  }

  .control:hover {
    background: rgb(0 0 0 / 0.75);
  }

  @media (max-width: 768px) {
    .mini {
      width: 220px;
    }
  }

  @media (hover: none) {
    .name,
    .controls {
      opacity: 1;
      translate: 0 0;
    }
  }
</style>
