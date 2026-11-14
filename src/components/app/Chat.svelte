<script lang="ts">
  import { tick } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import {
    getMember,
    getRoom,
    getRoomMessages,
    members,
    type PlaceholderMessage,
  } from "../../scripts/stores/placeholder";
  import { navigation } from "../../scripts/stores/navigation.svelte";
  import Avatar from "../ui/Avatar.svelte";

  let {
    onchannels,
    onmembers,
  }: { onchannels?: () => void; onmembers?: () => void } = $props();

  const GROUP_WINDOW = 5 * 60 * 1000;

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  let sent = $state<PlaceholderMessage[]>([]);
  let draft = $state("");
  let timeline: HTMLElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();

  const room = $derived(getRoom(navigation.roomId));

  const isChained = (previous?: { sender: string; ts: number }, message?: { sender: string; ts: number }) =>
    !!previous && !!message && previous.sender === message.sender && message.ts - previous.ts < GROUP_WINDOW;

  const timelineMessages = $derived(
    [...getRoomMessages(navigation.roomId), ...sent.filter(({ roomId }) => roomId === navigation.roomId)].map(
      (message, index, all) => ({
        ...message,
        grouped: isChained(all[index - 1], message),
        last: !isChained(message, all[index + 1]),
      }),
    ),
  );

  const formatTime = (ts: number) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ts);

  const scrollToBottom = async () => {
    await tick();
    timeline?.scrollTo({ top: timeline.scrollHeight });
  };

  $effect(() => {
    navigation.roomId;
    timelineMessages.length;
    scrollToBottom();
  });

  const resize = () => {
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${composer.scrollHeight}px`;
  };

  const send = () => {
    const body = draft.trim();
    if (!body || !navigation.roomId) return;

    sent.push({
      id: `local-${Date.now()}`,
      roomId: navigation.roomId,
      sender: members[0].userId,
      body,
      ts: Date.now(),
    });

    draft = "";
    tick().then(resize);
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
        <span class="faint">{room.isDirect ? "@" : "#"}</span>{room.name}
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
    <ol class="timeline col flex-max min-0" bind:this={timeline}>
      <li class="beginning">
        <span class="hero row centre glow"><Avatar name={room.name} url={room.avatar} size="56px" radius="30%" /></span>
        <p class="lg bold">{text("chat", "beginning").replace("{room}", roomLabel)}</p>
        {#if room.topic}<p class="sm muted">{room.topic}</p>{/if}
      </li>
      {#each timelineMessages as message (message.id)}
        {@const sender = getMember(message.sender)}
        <li class="message row-nw" class:grouped={message.grouped} class:last={message.last}>
          <div class="gutter">
            {#if message.grouped}
              <time class="hover-time xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
            {:else}
              <Avatar name={sender?.displayName ?? message.sender} url={sender?.avatar} size="38px" radius="50%" />
            {/if}
          </div>
          <div class="content col min-0">
            {#if !message.grouped}
              <div class="meta row-nw align-centre gap-sm">
                <span class="sender md bold" class:admin={(sender?.powerLevel ?? 0) >= 100}>{sender?.displayName ?? message.sender}</span>
                <time class="xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
              </div>
            {/if}
            <p class="body selectable">{message.body}</p>
          </div>
        </li>
      {/each}
    </ol>

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
