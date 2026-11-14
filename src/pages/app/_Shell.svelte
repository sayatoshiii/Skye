<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import Chat from "../../components/app/Chat.svelte";
  import Loading from "../../components/app/Loading.svelte";
  import ChannelList from "../../components/navigation/ChannelList.svelte";
  import MemberList from "../../components/navigation/MemberList.svelte";
  import SpaceRail from "../../components/navigation/SpaceRail.svelte";
  import { ROUTES } from "../../scripts/settings/config";
  import { selectRoom, sessionExpired, startMatrix, synced } from "../../scripts/stores/matrix";
  import {
    navigation,
    syncFromLocation,
    type Pane,
  } from "../../scripts/stores/navigation.svelte";

  let { footer }: { footer?: Snippet } = $props();

  const MOBILE_QUERY = "(max-width: 767px)";
  const AXIS_LOCK = 10;
  const COMMIT_RATIO = 0.35;
  const COMMIT_VELOCITY = 0.4;
  const EDGE_GUARD = 20;

  const panes: Pane[] = ["channels", "chat", "members"];

  let mobile = $state(false);
  let membersOpen = $state(true);
  let width = $state(0);
  let offset = $state(0);
  let dragging = $state(false);

  let start = { x: 0, y: 0, t: 0 };
  let axis: "x" | "y" | undefined;
  let pointerId: number | undefined;
  let routed = $state(false);

  $effect(() => {
    if (!$synced || routed) return;
    syncFromLocation();
    routed = true;
  });

  $effect(() => {
    if (!routed) return;
    const roomId = navigation.roomId ?? null;
    queueMicrotask(() => selectRoom(roomId));
  });

  $effect(() => {
    if ($sessionExpired) location.replace(ROUTES.login);
  });

  const index = $derived(panes.indexOf(navigation.pane));

  const go = (pane: Pane) => (navigation.pane = pane);

  const toggleMembers = () =>
    mobile ? go(navigation.pane === "members" ? "chat" : "members") : (membersOpen = !membersOpen);

  const onpointerdown = (event: PointerEvent) => {
    if (!mobile || event.pointerType === "mouse") return;
    if (event.clientX < EDGE_GUARD || event.clientX > width - EDGE_GUARD) return;

    start = { x: event.clientX, y: event.clientY, t: performance.now() };
    axis = undefined;
    pointerId = event.pointerId;
  };

  const onpointermove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") {
        dragging = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }
    }

    if (axis !== "x") return;

    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === panes.length - 1);
    offset = atEdge ? dx * 0.25 : dx;
  };

  const onpointerup = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;

    if (axis === "x") {
      const velocity = offset / Math.max(1, performance.now() - start.t);
      const passed = Math.abs(offset) > width * COMMIT_RATIO || Math.abs(velocity) > COMMIT_VELOCITY;
      const direction = offset < 0 ? 1 : -1;
      const next = panes[index + direction];

      if (passed && next) go(next);
    }

    dragging = false;
    offset = 0;
    axis = undefined;
  };

  onMount(() => {
    const query = matchMedia(MOBILE_QUERY);
    const update = () => (mobile = query.matches);

    update();
    if (!startMatrix()) location.replace(ROUTES.login);

    const onpopstate = () => routed && syncFromLocation();

    query.addEventListener("change", update);
    addEventListener("popstate", onpopstate);

    return () => {
      query.removeEventListener("change", update);
      removeEventListener("popstate", onpopstate);
    };
  });
</script>

<Loading visible={!routed} />

<div
  class="shell"
  class:mobile
  class:dragging
  class:members-hidden={!membersOpen}
  bind:clientWidth={width}
  style:--offset={`${offset}px`}
  style:--index={index}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
>
  <div class="track">
    <div class="pane left col" inert={mobile && navigation.pane !== "channels"}>
      <div class="row-nw flex-max min-0">
        <SpaceRail />
        <div class="flex-max min-0">
          <ChannelList onpick={() => go("chat")} />
        </div>
      </div>
      {#if footer}
        <footer class="account hairline-t">
          {@render footer()}
        </footer>
      {/if}
    </div>

    <div class="pane centre-pane min-0" inert={mobile && navigation.pane !== "chat"}>
      <Chat onchannels={() => go("channels")} onmembers={toggleMembers} />
      {#if mobile && navigation.pane !== "chat"}
        <button class="scrim ghost" aria-label="chat" tabindex="-1" onclick={() => go("chat")}></button>
      {/if}
    </div>

    <div class="pane right" inert={mobile && navigation.pane !== "members"}>
      <MemberList onclose={mobile ? () => go("chat") : undefined} />
    </div>
  </div>
</div>

<style>
  .shell {
    --left: 308px;
    --right: 240px;

    width: 100%;
    height: 100dvh;
    overflow: hidden;
    background-color: var(--colours-background);
  }

  .track {
    height: 100%;
    display: grid;
    grid-template-columns: var(--left) minmax(0, 1fr) var(--right);
    transition: grid-template-columns var(--azure-duration-glide) var(--azure-ease-fluid);
  }

  .members-hidden .track {
    grid-template-columns: var(--left) minmax(0, 1fr) 0;
  }

  .pane {
    height: 100%;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  .account {
    flex: none;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    padding-bottom: max(var(--azure-spacing-sm), env(safe-area-inset-bottom));
    padding-left: max(var(--azure-spacing-md), env(safe-area-inset-left));
    background-color: color-mix(in oklab, var(--colours-foreground) 70%, black);
    border-right: 1px solid var(--colours-outline-hairline);
  }

  .right {
    display: flex;
    justify-content: flex-end;
  }

  .shell:not(.mobile) .right > :global(*) {
    width: var(--right);
    flex: none;
  }

  .mobile .right > :global(*) {
    width: 100%;
  }

  .mobile :global(*) {
    touch-action: pan-y;
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: var(--azure-z-overlay);
    background-color: var(--colours-scrim);
  }

  .mobile {
    touch-action: pan-y;
  }

  .mobile .track {
    width: 300%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    transform: translate3d(calc(var(--index) * -100% / 3 + var(--offset)), 0, 0);
    transition: transform var(--azure-duration-glide) var(--azure-ease-fluid);
    will-change: transform;
  }

  .mobile.dragging .track {
    transition: none;
  }

  .mobile.dragging {
    user-select: none;
  }
</style>
