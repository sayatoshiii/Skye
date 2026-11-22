<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { tick } from "svelte";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { fetchPinnedEvent } from "../../scripts/stores/matrix";
  import EmojiText from "../ui/EmojiText.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import MessageBody from "./media/MessageBody.svelte";
  import MessageMedia from "./media/MessageMedia.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { copied } from "../../scripts/stores/toast";

  let {
    roomId,
    pinned,
    anchor,
    canUnpin,
    ownUserId,
    getSender,
    onjump,
    onunpin,
    onclose,
  }: {
    roomId: string;
    pinned: string[];
    anchor?: HTMLElement;
    canUnpin: boolean;
    ownUserId?: string;
    getSender: (userId: string) => { name: string; avatar?: string };
    onjump: (eventId: string) => void;
    onunpin: (eventId: string, event?: MouseEvent) => void;
    onclose: () => void;
  } = $props();

  const MEDIA_TYPES = ["m.image", "m.video", "m.audio", "m.file"];

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const exit = dismissible(() => onclose());

  let panel: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let right = $state(16);
  let top = $state(56);
  let loaded: Record<string, TimelineEvent | null> = $state.raw({});

  const ordered = $derived([...pinned].reverse());
  const resolveName = (userId: string) => getSender(userId).name;

  $effect(() => {
    const ids = ordered;
    const room = roomId;
    let alive = true;

    ids.forEach((eventId) =>
      fetchPinnedEvent(room, eventId).then((event) => {
        if (alive) loaded = { ...loaded, [eventId]: event };
      }),
    );

    return () => (alive = false);
  });

  $effect(() => {
    const target = anchor;
    tick().then(() => {
      if (target) {
        const rect = target.getBoundingClientRect();
        right = Math.max(8, innerWidth - rect.right);
        top = rect.bottom + 8;
      }
      (panel ?? list)?.focus({ preventScroll: true });
    });
  });

  const pinItems = (eventId: string, event: TimelineEvent | null): MenuItem[] => [
    ...(event ? [{ id: "pin-jump", label: text("chat", "jump"), icon: MENU_ICONS.jump, run: () => (exit.close(), onjump(eventId)) }] : []),
    ...(event && !event.redacted && typeof event.content.body === "string" && !MEDIA_TYPES.includes(event.content.msgtype) ? [{ id: "pin-copy", label: text("chat", "copy_text"), icon: MENU_ICONS.copy, run: () => copied(event.content.body) }] : []),
    { id: "pin-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copied(`https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`, "link_copied", "link") },
    { id: "pin-id", label: text("chat", "copy_id"), icon: MENU_ICONS.id, run: () => copied(eventId, "message_id_copied", "id") },
    ...(canUnpin ? [{ id: "pin-unpin", label: text("chat", "unpin"), icon: MENU_ICONS.unpin, danger: true, separated: true, run: (click: MouseEvent | KeyboardEvent) => onunpin(eventId, click as MouseEvent) }] : []),
  ];

  const formatStamp = (ts: number) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ts);

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    exit.close();
    anchor?.focus();
  };
</script>

<span class="portal-anchor" hidden></span>
<div class="layer" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={exit.close}></button>
  <div
    class="panel col"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pins-title"
    tabindex="-1"
    bind:this={panel}
    inert={exit.closing}
    onanimationend={exit.onanimationend}
    style:right="{right}px"
    style:top="{top}px"
    {onkeydown}
  >
    <span class="handle" aria-hidden="true"></span>
    <header class="head row-nw align-centre gap-sm">
      <svg class="head-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6" /></svg>
      <h3 id="pins-title" class="title md bold flex-max truncate">
        {text("chat", "pins")}{#if ordered.length}<span class="count faint">&nbsp;·&nbsp;{ordered.length}</span>{/if}
      </h3>
      <button type="button" class="icon-button close ghost press" aria-label={text("chat", "close")} onclick={exit.close}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    {#if !ordered.length}
      <div class="empty col centre gap-sm">
        <span class="empty-badge row centre" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6" /></svg>
        </span>
        <p class="md bold">{text("chat", "pins_empty")}</p>
        <p class="sm muted">{text("chat", "pins_empty_hint")}</p>
      </div>
    {:else}
      <ul class="list col" bind:this={list} tabindex="-1" aria-label={text("chat", "pins")}>
        {#each ordered as eventId (eventId)}
          {@const event = loaded[eventId]}
          <li class="pin row-nw gap-md" aria-busy={event === undefined} use:menu={event === undefined ? undefined : () => pinItems(eventId, event)}>
            {#if event === undefined}
              <span class="skeleton avatar" aria-label={text("chat", "pins_loading")} role="img"></span>
              <span class="col gap-sm flex-max min-0 skeleton-lines">
                <span class="skeleton line short"></span>
                <span class="skeleton line"></span>
                <span class="skeleton line mid"></span>
              </span>
            {:else}
              {@const sender = event ? getSender(event.sender) : null}
              {#if sender}
                <Avatar name={sender.name} url={sender.avatar} size="32px" radius="50%" />
              {:else}
                <span class="missing row centre" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8v5m0 3v.01" /></svg>
                </span>
              {/if}
              <div class="col min-0 flex-max gap-xs">
                {#if event && sender}
                  <div class="meta row-nw align-baseline gap-sm min-0">
                    <span class="name sm bold truncate"><EmojiText text={sender.name} /></span>
                    <time class="xs faint truncate" datetime={new Date(event.origin_server_ts).toISOString()}>{formatStamp(event.origin_server_ts)}</time>
                  </div>
                {/if}
                <div class="pin-body sm">
                  {#if !event}
                    <p class="faint">{text("chat", "pin_unavailable")}</p>
                  {:else if event.redacted}
                    <p class="faint">{text("chat", "redacted")}</p>
                  {:else if event.decryptionFailed || event.type === "m.room.encrypted"}
                    <p class="faint">{text("chat", "encrypted")}</p>
                  {:else if MEDIA_TYPES.includes(event.content.msgtype)}
                    <div class="media"><MessageMedia content={event.content} /></div>
                  {:else if typeof event.content.body === "string"}
                    <p class="body"><MessageBody content={event.content} {ownUserId} {resolveName} highlight={false} /></p>
                  {:else}
                    <p class="faint">{text("chat", "unsupported").replace("{type}", String(event.content.msgtype ?? event.type))}</p>
                  {/if}
                </div>
              </div>
              <span class="actions row-nw gap-xs">
                {#if event}
                  <button type="button" class="jump ghost press xs bold" aria-label={`${text("chat", "jump")}: ${sender?.name ?? ""}`} onclick={() => {
                    exit.close();
                    onjump(eventId);
                  }}>{text("chat", "jump")}</button>
                {/if}
                {#if canUnpin}
                  <button type="button" class="icon-button unpin ghost press" aria-label={text("chat", "unpin")} use:tooltip={text("chat", "unpin")} onclick={(event) => onunpin(eventId, event)}>
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                {/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .head .close {
    margin-right: -6px;
  }

  .panel:focus {
    outline: none;
  }

  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
  }

  .panel {
    position: fixed;
    width: min(440px, calc(100vw - 16px));
    max-height: min(560px, calc(100dvh - 96px));
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 20px 56px -16px black,
      0 0 40px -18px var(--colours-accent-glow);
    outline: none;
    overflow: hidden;
    transform-origin: top right;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .handle {
    display: none;
  }

  .layer.closing {
    pointer-events: none;
  }

  .closing .panel {
    animation: pin-out var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes pin-out {
    to {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }

  .head {
    flex: none;
    min-height: 48px;
    padding: 0 var(--azure-spacing-lg);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .title {
    margin: 0;
    line-height: 1;
    color: var(--colours-text-strong);
  }

  .count {
    font-weight: 500;
  }

  .head-icon {
    flex: none;
    display: block;
    color: var(--colours-accent);
    rotate: 30deg;
  }

  .icon-button {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .close:hover,
  .close:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .unpin:hover,
  .unpin:focus-visible {
    color: var(--colours-danger);
    background-color: var(--colours-danger-soft);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  .pin {
    position: relative;
    align-items: flex-start;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .pin + .pin {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .pin:hover,
  .pin:focus-within {
    background-color: var(--colours-surface-hover);
  }

  .pin > :global(:first-child) {
    flex: none;
    margin-top: 2px;
  }

  .missing {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--colours-text-faint);
    border: 1px dashed var(--colours-outline-strong);
  }

  .meta {
    padding-right: 84px;
  }

  .name {
    color: var(--colours-text-strong);
  }

  .actions {
    position: absolute;
    top: var(--azure-spacing-xs);
    right: var(--azure-spacing-sm);
    padding: 2px;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    opacity: 0;
    translate: 0 2px;
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      translate var(--azure-duration-fast) var(--azure-ease-fluid);
  }

  .actions:empty {
    display: none;
  }

  .pin:hover .actions,
  .pin:focus-within .actions {
    opacity: 1;
    translate: 0 0;
  }

  .jump {
    height: 28px;
    padding: 0 var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .jump:hover,
  .jump:focus-visible {
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .pin-body {
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  .pin-body p {
    margin: 0;
  }

  .body {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body :global(*) {
    margin-block: 0 !important;
  }

  .media {
    display: block;
    width: fit-content;
    max-width: 220px;
    max-height: 140px;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
  }

  .media :global(.frame) {
    flex: none;
    width: auto !important;
    height: 140px;
    min-width: 60px;
    max-width: 220px;
    margin: 0;
    border: 0;
    border-radius: 0;
  }

  .media :global(.frame :is(img, video)) {
    max-height: 140px;
    object-fit: cover;
  }

  .empty {
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  .empty .muted {
    max-width: 30ch;
  }

  .empty-badge {
    width: 48px;
    height: 48px;
    margin-bottom: var(--azure-spacing-xs);
    border-radius: var(--azure-radius-pill);
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
    box-shadow: 0 0 28px -6px var(--colours-accent-glow);
  }

  .empty-badge svg {
    rotate: 30deg;
  }

  .skeleton {
    display: block;
    height: 10px;
    border-radius: var(--azure-radius-pill);
    background: linear-gradient(90deg, var(--colours-surface-hover) 20%, color-mix(in oklab, var(--colours-text-faint) 22%, transparent) 50%, var(--colours-surface-hover) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  .skeleton.avatar {
    width: 32px;
    height: 32px;
    flex: none;
  }

  .skeleton-lines {
    padding-top: 4px;
  }

  .skeleton.short {
    width: 36%;
  }

  .skeleton.mid {
    width: 62%;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel,
    .pin,
    .skeleton {
      animation: none;
    }
  }

  @media (hover: none), (max-width: 767px) {
    .actions {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (max-width: 767px) {
    .scrim {
      background-color: var(--colours-scrim);
      animation: fade var(--azure-duration-md) var(--azure-ease-out);
    }

    .panel {
      inset: auto 0 0 0 !important;
      width: auto;
      max-height: 70dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      border-bottom: none;
      animation: rise var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .closing .scrim {
      animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .closing .panel {
      animation: exit-sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .handle {
      display: block;
      position: absolute;
      top: var(--azure-spacing-sm);
      left: 50%;
      translate: -50% 0;
      width: 36px;
      height: 4px;
      margin: 0;
      border-radius: var(--azure-radius-pill);
      background-color: var(--colours-outline-strong);
    }

    .head {
      min-height: 56px;
    }

    .pin {
      padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    }

    .actions {
      top: var(--azure-spacing-sm);
      right: var(--azure-spacing-md);
    }

    .jump,
    .icon-button {
      height: 32px;
      min-width: 32px;
    }
  }
</style>
