<script lang="ts">
  import EmojiText from "../ui/EmojiText.svelte";
  import { tick, untrack } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { toEntity } from "../../scripts/stores/entities";
  import {
    canLoadOlder,
    currentRoom,
    currentTimeline,
    joinedMembers,
    loadOlderMessages,
    markRoomRead,
    restoreOpen,
    retryMessage,
    sendMessage,
    session,
    undecryptable,
  } from "../../scripts/stores/matrix";
  import Avatar from "../ui/Avatar.svelte";

  let {
    onchannels,
    onmembers,
  }: { onchannels?: () => void; onmembers?: () => void } = $props();

  const GROUP_WINDOW = 5 * 60 * 1000;
  const LOAD_THRESHOLD = 240;
  const STICK_THRESHOLD = 120;
  const VISIBLE_TYPES = ["m.room.message", "m.room.encrypted", "m.sticker"];

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  let draft = $state("");
  let timeline: HTMLElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let loadingOlder = $state(false);
  let stuck = true;
  let renderedRoomId: string | undefined;
  let lockedOut = $state(false);
  let dismissedRoom: string | undefined = $state();

  $effect(() => undecryptable.subscribe((value) => (lockedOut = value)));

  const room = $derived($currentRoom && toEntity($currentRoom, $session?.userId));

  const getSender = (userId: string) => {
    const member = $currentRoom?.members[userId] ?? $joinedMembers[$currentRoom?.roomId ?? ""]?.[userId];

    return {
      name: member?.displayName ?? userId,
      avatar: member?.avatarUrl,
      powerLevel: $currentRoom ? getPowerLevel($currentRoom, userId) : 0,
    };
  };

  const isChained = (previous?: { sender: string; ts: number }, message?: { sender: string; ts: number }) =>
    !!previous && !!message && previous.sender === message.sender && message.ts - previous.ts < GROUP_WINDOW;

  const describe = (event: TimelineEvent) => {
    if (event.redacted) return { kind: "redacted", body: text("chat", "redacted") };
    if (event.decryptionFailed || event.type === "m.room.encrypted")
      return { kind: "fallback", body: text("chat", "encrypted") };
    if (event.type === "m.sticker") return { kind: "fallback", body: text("chat", "unsupported").replace("{type}", event.type) };

    const { msgtype, body } = event.content;
    if (typeof body !== "string") return { kind: "fallback", body: text("chat", "unsupported").replace("{type}", String(msgtype ?? event.type)) };
    if (msgtype === "m.text") return { kind: "text", body };
    if (msgtype === "m.notice") return { kind: "notice", body };
    if (msgtype === "m.emote") return { kind: "emote", body };

    return { kind: "fallback", body: text("chat", "unsupported").replace("{type}", String(msgtype)) };
  };

  const timelineMessages = $derived(
    $currentTimeline
      .filter((event) => VISIBLE_TYPES.includes(event.type))
      .map((event) => ({
        id: event.txnId ?? event.event_id,
        sender: event.sender,
        ts: event.origin_server_ts,
        edited: event.edited && !event.redacted,
        status: event.localStatus,
        txnId: event.txnId,
        ...describe(event),
      }))
      .map((message, index, all) => ({
        ...message,
        grouped: isChained(all[index - 1], message),
        last: !isChained(message, all[index + 1]),
      })),
  );

  const formatTime = (ts: number) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ts);

  const scrollToBottom = async () => {
    await tick();
    timeline?.scrollTo({ top: timeline.scrollHeight });
  };

  const fillViewport = async () => {
    await tick();
    if (timeline && $canLoadOlder && timeline.scrollHeight <= timeline.clientHeight) loadOlder();
  };

  const loadOlder = async () => {
    if (!timeline || loadingOlder || !$canLoadOlder) return;

    loadingOlder = true;
    const fromBottom = timeline.scrollHeight - timeline.scrollTop;

    const loaded = await loadOlderMessages();
    await tick();

    if (timeline) timeline.scrollTop = timeline.scrollHeight - fromBottom;
    loadingOlder = false;
    if (loaded) fillViewport();
  };

  const onscroll = () => {
    if (!timeline) return;

    stuck = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < STICK_THRESHOLD;
    if (timeline.scrollTop < LOAD_THRESHOLD) loadOlder();
    if (stuck && document.visibilityState === "visible") markRoomRead();
  };

  $effect(() => {
    const roomId = $currentRoom?.roomId;
    const latest = timelineMessages.at(-1)?.id;
    if (!roomId || !latest) return;

    if (renderedRoomId !== roomId) {
      renderedRoomId = roomId;
      stuck = true;
    }

    if (loadingOlder || !stuck) return;

    scrollToBottom().then(fillViewport);
    if (document.visibilityState === "visible") queueMicrotask(() => markRoomRead(roomId));
  });

  $effect(() => {
    const read = () => document.visibilityState === "visible" && stuck && markRoomRead();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  });

  const resize = () => {
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${composer.scrollHeight}px`;
  };

  const send = () => {
    const body = draft.trim();
    if (!body || !room) return;

    stuck = true;
    sendMessage(body).catch(() => undefined);

    draft = "";
    tick().then(resize);
  };

  const retry = (txnId?: string) => {
    if (txnId) retryMessage(txnId)?.catch(() => undefined);
  };

  const onkeydown = (event: KeyboardEvent) => {
    const touch = matchMedia("(pointer: coarse)").matches;
    if (event.key !== "Enter" || event.shiftKey || touch) return;

    event.preventDefault();
    send();
  };

  const roomLabel = $derived(room ? `${room.isDirect ? "" : "#"}${room.name}` : "");
</script>

<section class="chat col min-0">
  <header class="header row-nw align-centre gap-sm hairline-b">
    <button class="icon ghost press mobile-only" aria-label={text("navigation", "open_channels")} onclick={onchannels}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
    {#if room}
      <h2 class="name md bold truncate">
        <span class="faint">{room.isDirect ? "@" : "#"}</span><EmojiText text={room.name} />
      </h2>
      {#if room.topic}
        <span class="topic sm muted truncate">{room.topic}</span>
      {/if}
    {/if}
    <span class="flex-max"></span>
    <button class="icon ghost press" aria-label={text("navigation", "open_members")} onclick={onmembers}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-3.3 3.1-6 7-6s7 2.7 7 6v1H2v-1Zm15.5 1H22v-1c0-2.6-2.2-4.6-5-5 1.2 1.3 1.9 3 2 4.9V20h-1.5Z" />
      </svg>
    </button>
  </header>

  {#if room}
    {#if lockedOut && dismissedRoom !== room.roomId}
      <div class="decrypt-banner row-nw align-centre gap-sm sm" role="status">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
        </svg>
        <span class="flex-max min-0 muted">{text("encryption", "banner")}</span>
        <button type="button" class="banner-action ghost press bold" onclick={() => restoreOpen.set(true)}>{text("encryption", "banner_action")}</button>
        <button type="button" class="banner-close ghost press" aria-label={text("encryption", "dismiss")} onclick={() => (dismissedRoom = room.roomId)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    {/if}
    {#key room.roomId}
    <ol class="timeline col flex-max min-0" bind:this={timeline} {onscroll}>
      {#if $canLoadOlder}
        <li class="history row centre" aria-busy="true">
          <span class="dots row-nw gap-sm" aria-label={text("chat", "loading_history")}><span></span><span></span><span></span></span>
        </li>
      {:else}
        <li class="beginning">
          <span class="hero row centre glow"><Avatar name={room.name} url={room.avatar} size="56px" radius="30%" /></span>
          <p class="lg bold">{text("chat", "beginning").replace("{room}", roomLabel)}</p>
          {#if room.topic}<p class="sm muted">{room.topic}</p>{/if}
          {#if !timelineMessages.length}<p class="sm faint">{text("chat", "no_messages")}</p>{/if}
        </li>
      {/if}
      {#each timelineMessages as message (message.id)}
        {@const sender = getSender(message.sender)}
        <li
          class="message row-nw"
          class:grouped={message.grouped}
          class:last={message.last}
          class:sending={message.status === "sending"}
          class:failed={message.status === "failed"}
        >
          <div class="gutter">
            {#if message.grouped}
              <time class="hover-time xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
            {:else}
              <Avatar name={sender.name} url={sender.avatar} size="38px" radius="50%" />
            {/if}
          </div>
          <div class="content col min-0">
            {#if !message.grouped}
              <div class="meta row-nw align-centre gap-sm">
                <span class="sender md bold" class:admin={sender.powerLevel >= 100}><EmojiText text={sender.name} /></span>
                <time class="xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
              </div>
            {/if}
            <p class="body selectable {message.kind}">{#if message.kind === "emote"}<span class="emote-sender">* <EmojiText text={sender.name} /></span> {/if}<EmojiText text={message.body} />{#if message.edited}<span class="edited xs faint"> {text("chat", "edited")}</span>{/if}</p>
            {#if message.status === "failed"}
              <p class="failure xs row-nw align-centre gap-sm">
                <span>{text("chat", "failed")}</span>
                <button type="button" class="retry ghost press xs bold" onclick={() => retry(message.txnId)}>{text("chat", "retry")}</button>
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
    {/key}

    <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
      <div class="field row-nw align-centre gap-sm">
        <button type="button" class="icon attach ghost press" aria-label={text("chat", "attach")}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <textarea
          class="flex-max"
          rows="1"
          enterkeyhint="send"
          placeholder={text("chat", "composer").replace("{room}", roomLabel)}
          aria-label={text("chat", "composer").replace("{room}", roomLabel)}
          bind:value={draft}
          bind:this={composer}
          oninput={resize}
          {onkeydown}
        ></textarea>
        <button type="submit" class="icon send ghost press" class:ready={draft.trim()} aria-label={text("chat", "send")}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z" />
          </svg>
        </button>
      </div>
    </form>
  {:else}
    <div class="empty col centre flex-max glow">
      <p class="muted md">{text("chat", "empty")}</p>
    </div>
  {/if}
</section>

<style>
  .chat {
    --composer-space: 84px;

    height: 100%;
    position: relative;
    background-color: var(--colours-background);
  }

  .decrypt-banner {
    flex: none;
    margin: var(--azure-spacing-sm) var(--azure-spacing-md) 0;
    padding: var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-md);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    border: 1px solid color-mix(in oklab, var(--colours-accent) 22%, transparent);
    border-radius: var(--azure-radius-md);
    box-shadow: 0 0 24px -12px var(--colours-accent-glow);
    animation: banner-in var(--azure-duration-md) var(--azure-ease-out);
  }

  .banner-action {
    flex: none;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    color: var(--colours-accent);
    border-radius: var(--azure-radius-pill);
    background-color: color-mix(in oklab, var(--colours-accent) 10%, transparent);
  }

  .banner-action:hover {
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, var(--colours-accent) 18%, transparent);
  }

  .banner-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--colours-text-muted);
    border-radius: var(--azure-radius-sm);
  }

  .banner-close:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @media (max-width: 767px) {
    .banner-action,
    .banner-close {
      min-height: var(--azure-touch);
    }

    .banner-close {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }

  .header {
    height: 52px;
    flex: none;
    box-sizing: content-box;
    padding: 0 var(--azure-spacing-md);
    padding-top: env(safe-area-inset-top);
  }

  .name {
    margin: 0;
    color: var(--colours-text-strong);
    flex: none;
    max-width: 50%;
  }

  .topic {
    padding-left: var(--azure-spacing-md);
    border-left: 1px solid var(--colours-outline-hairline);
  }

  .icon {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .icon:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: var(--azure-spacing-lg) 0 calc(var(--composer-space) + env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    --fade-end: calc(var(--composer-space) * 0.55 + env(safe-area-inset-bottom));
    --fade-start: calc(var(--fade-end) + 48px);
    mask-image: linear-gradient(
      to top,
      transparent var(--fade-end),
      black var(--fade-start)
    );
  }

  .beginning {
    margin-top: auto;
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg) var(--azure-spacing-lg);
  }

  .hero {
    display: inline-flex;
  }

  .beginning p {
    margin: var(--azure-spacing-sm) 0 0;
  }

  .beginning .lg {
    color: var(--colours-text-strong);
  }

  .message {
    padding: var(--azure-spacing-sm) var(--azure-spacing-lg) 2px 0;
    margin: var(--azure-spacing-sm) var(--azure-spacing-sm) 0;
    border-radius: var(--azure-radius-md);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .message.grouped {
    padding-top: 2px;
    margin-top: 0;
  }

  .message.last {
    padding-bottom: var(--azure-spacing-sm);
  }

  .message:hover {
    background-color: var(--colours-surface-hover);
  }

  .gutter {
    width: 64px;
    flex: none;
    display: flex;
    justify-content: center;
    padding-top: 2px;
  }

  .hover-time {
    opacity: 0;
    line-height: 22px;
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .message:hover .hover-time {
    opacity: 1;
  }

  .sender {
    color: var(--colours-text-strong);
  }

  .sender.admin {
    color: var(--colours-accent-strong);
  }

  .body {
    margin: 0;
    font-size: var(--text-md);
    line-height: 22px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .history {
    margin-top: auto;
    padding: var(--azure-spacing-xl);
  }

  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    animation: pulse var(--azure-duration-glide) var(--azure-ease-in-out) infinite alternate;
  }

  .dots span:nth-child(2) {
    animation-delay: var(--azure-duration-fast);
  }

  .dots span:nth-child(3) {
    animation-delay: calc(var(--azure-duration-fast) * 2);
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }

  .message.sending .content {
    opacity: 0.5;
  }

  .notice {
    color: var(--colours-text-muted);
  }

  .emote {
    font-style: italic;
  }

  .emote-sender {
    font-weight: 600;
    color: var(--colours-text-strong);
  }

  .redacted,
  .fallback {
    font-style: italic;
    color: var(--colours-text-faint);
  }

  .failure {
    margin: 0;
    color: var(--colours-danger);
  }

  .retry {
    color: var(--colours-danger);
    text-decoration: underline;
  }

  .retry:hover {
    color: var(--colours-text-strong);
  }

  .composer {
    position: absolute;
    inset: auto 0 0;
    z-index: var(--azure-z-raised);
    pointer-events: none;
    padding: 0 var(--azure-spacing-lg) var(--azure-spacing-lg);
    padding-bottom: max(var(--azure-spacing-lg), env(safe-area-inset-bottom));
  }

  .field {
    pointer-events: auto;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    transition:
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-out);
  }

  .field:focus-within {
    border-color: color-mix(in oklab, var(--colours-accent) 45%, transparent);
    box-shadow: 0 0 24px -8px var(--colours-accent-glow);
  }

  textarea {
    min-width: 0;
    width: 0;
    max-height: 40vh;
    padding: 9px 0;
    resize: none;
    border: 0;
    outline: none;
    background: none;
    font: inherit;
    font-size: var(--text-md);
    line-height: 20px;
    color: var(--colours-text-strong);
  }

  textarea::placeholder {
    color: var(--colours-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .send,
  .send:hover,
  .attach,
  .attach:hover {
    color: var(--colours-text-faint);
    background: none;
  }

  .attach:hover {
    color: var(--colours-accent);
  }

  .attach svg {
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .attach:hover svg {
    transform: rotate(90deg);
  }

  .attach:active svg {
    transform: rotate(90deg) scale(0.85);
    transition-duration: var(--azure-duration-instant);
  }

  .send svg {
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      filter var(--azure-duration-md) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .send.ready {
    color: var(--colours-accent);
  }

  .send.ready svg {
    filter: drop-shadow(0 0 6px var(--colours-accent-glow));
  }

  .send.ready:hover svg {
    transform: translateX(2px);
  }

  .send:active svg {
    transform: scale(0.85);
    transition-duration: var(--azure-duration-instant);
  }

  .empty {
    padding: var(--azure-spacing-xl);
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 767px) {
    .mobile-only {
      display: grid;
    }

    .topic {
      display: none;
    }

    .icon {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    textarea {
      font-size: 16px;
    }

    .gutter {
      width: 56px;
    }
  }
</style>
