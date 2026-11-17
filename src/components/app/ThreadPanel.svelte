<script lang="ts">
  import { tick } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { bundledThread, threadRootOf } from "../../scripts/matrix/timeline";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { formatBytes, getUploadLimit, isInline, prepareAttachment, sanitiseFilename, uploadAttachment } from "../../scripts/matrix/utilities/attachments";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { stripReplyFallback, toPreviewLine } from "../../scripts/misc/formatting";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { trimPills, type Pill } from "../../scripts/misc/mentions";
  import { usermenu } from "../../scripts/misc/usermenu";
  import { setKeepImageMetadata } from "../../scripts/settings/media";
  import { mediaSettings } from "../../scripts/settings/media";
  import { fetchPinnedEvent, fetchThread, fetchThreads, isRedacted, sendMessage, sendRoomMessage, session, type ReplyTarget } from "../../scripts/stores/matrix";
  import { copied } from "../../scripts/stores/toast";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import Composer, { type Pending } from "./Composer.svelte";
  import MessageBody from "./media/MessageBody.svelte";
  import MessageMedia from "./media/MessageMedia.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";
  import ThreadSummary from "./ThreadSummary.svelte";

  let {
    roomId,
    rootId,
    events,
    encrypted,
    ownUserId,
    keepImageMetadata,
    getSender,
    mayRedact,
    onopen,
    onlist,
    onjump,
    onremove,
    onclose,
    closing = $bindable(false),
  }: {
    roomId: string;
    rootId: string | null;
    events: TimelineEvent[];
    encrypted: boolean;
    ownUserId?: string;
    keepImageMetadata?: boolean;
    getSender: (userId: string) => { name: string; avatar?: string };
    mayRedact: (event: TimelineEvent) => boolean;
    onopen: (rootId: string) => void;
    onlist: () => void;
    onjump: (eventId: string) => void;
    onremove: (eventId: string, event?: MouseEvent | KeyboardEvent) => void;
    onclose: () => void;
    closing?: boolean;
  } = $props();

  const SHOWN_TYPES = ["m.room.message", "m.room.encrypted", "m.sticker"];
  const MEDIA_TYPES = ["m.image", "m.video", "m.audio", "m.file"];
  const STICK = 120;

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const resolveName = (userId: string) => getSender(userId).name;
  const exit = dismissible(() => onclose());

  $effect(() => {
    closing = exit.closing;
  });

  let list: HTMLElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();
  let draft = $state("");
  let pills: Pill[] = $state([]);
  let pending: Pending[] = $state([]);
  let pendingCounter = 0;
  let replying: (ReplyTarget & { name: string }) | null = $state(null);
  let root: TimelineEvent | null | undefined = $state.raw(undefined);
  let older: TimelineEvent[] = $state.raw([]);
  let next: string | null = $state(null);
  let loading = $state(false);
  let failed = $state(false);
  let roots: TimelineEvent[] = $state.raw([]);
  let stuck = true;
  let dockHeight = $state(60);

  const liveRoot = $derived.by(() => { const found = rootId ? events.find((event) => event.event_id === rootId) : undefined; return found && { ...found }; });
  const shownRoot = $derived(liveRoot ?? root);

  const replies = $derived.by(() => {
    const merged = new Map<string, TimelineEvent>();
    const live = events.filter((event) => !!rootId && threadRootOf(event) === rootId);
    const gone = (event: TimelineEvent) => !event.redacted && isRedacted(event.event_id, roomId);
    [...older.map((event) => (gone(event) ? { ...event, redacted: true, content: { "m.relates_to": event.content["m.relates_to"] } } : event)), ...live].forEach((event) => merged.set(event.txnId ?? event.event_id, event));
    live.forEach((event) => event.txnId && merged.delete(event.event_id));
    return [...merged.values()]
      .filter((event) => SHOWN_TYPES.includes(event.type) && !($mediaSettings.hideRedacted && event.redacted))
      .map((event) => ({ ...event }))
      .sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  });

  const latestId = $derived(replies.findLast((event) => !event.event_id.startsWith("~"))?.event_id ?? rootId ?? "");

  const settle = async (force = false) => {
    await tick();
    if (list && (force || stuck)) list.scrollTop = list.scrollHeight;
  };

  const loadThread = async (id: string, from: string | null, base: TimelineEvent[]) => {
    loading = true;
    try {
      const page = await fetchThread(id, base, from, roomId);
      if (id !== rootId) return;
      older = page.events;
      next = page.next;
    } catch {
      failed = !base.length;
    } finally {
      loading = false;
    }
  };

  const loadRoots = async (from: string | null, base: TimelineEvent[]) => {
    loading = true;
    try {
      const page = await fetchThreads(from, roomId);
      roots = [...base, ...page.events.filter((event) => !base.some((known) => known.event_id === event.event_id))];
      next = page.next;
    } catch {
      failed = !base.length;
    } finally {
      loading = false;
    }
  };

  $effect(() => {
    const id = rootId;
    older = [];
    roots = [];
    next = null;
    failed = false;
    replying = null;
    root = undefined;
    stuck = true;

    if (!id) return void loadRoots(null, []);

    let alive = true;
    fetchPinnedEvent(roomId, id).then((event) => alive && (root = event));
    loadThread(id, null, []).then(() => settle(true));
    tick().then(() => field?.focus({ preventScroll: true }));
    return () => (alive = false);
  });

  $effect(() => {
    replies.length;
    settle();
  });

  const onscroll = () => {
    if (!list) return;
    stuck = list.scrollHeight - list.scrollTop - list.clientHeight < STICK;
  };

  const loadOlder = async () => {
    if (!list || !rootId) return;
    const before = list.scrollHeight - list.scrollTop;
    stuck = false;
    await loadThread(rootId, next, older);
    await tick();
    list.scrollTop = list.scrollHeight - before;
  };

  const startReply = (event: TimelineEvent) => {
    replying = { eventId: event.event_id, sender: event.sender, name: resolveName(event.sender) };
    field?.focus();
  };

  const isMedia = (event: TimelineEvent) => MEDIA_TYPES.includes(event.content.msgtype);
  const plainText = (event: TimelineEvent) =>
    !event.redacted && typeof event.content.body === "string" && !isMedia(event) ? toPreviewLine(event.content) : "";
  const linkOf = (eventId: string) => `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;
  const quoted = (event: TimelineEvent) => {
    const relation = event.content["m.relates_to"];
    return relation?.is_falling_back ? undefined : (relation?.["m.in_reply_to"]?.event_id as string | undefined);
  };
  const findReply = (eventId: string) => (eventId === rootId ? shownRoot : replies.find((event) => event.event_id === eventId)) ?? null;

  const itemsFor = (event: TimelineEvent, isRoot: boolean): MenuItem[] => [
    ...(!isRoot && !event.redacted && !event.event_id.startsWith("~") ? [{ id: "thread-reply", label: text("chat", "reply"), icon: MENU_ICONS.reply, run: () => startReply(event) }] : []),
    ...(isRoot ? [{ id: "thread-jump", label: text("chat", "jump_to_root"), icon: MENU_ICONS.jump, run: () => onjump(event.event_id) }] : []),
    ...(plainText(event) ? [{ id: "thread-copy", label: text("chat", "copy_text"), icon: MENU_ICONS.copy, run: () => copied(stripReplyFallback(String(event.content.body))) }] : []),
    ...(event.event_id.startsWith("~")
      ? []
      : [
          { id: "thread-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copied(linkOf(event.event_id), "link_copied", "link") },
          { id: "thread-id", label: text("chat", "copy_id"), icon: MENU_ICONS.id, run: () => copied(event.event_id, "message_id_copied", "id") },
        ]),
    ...(!event.redacted && !event.event_id.startsWith("~") && mayRedact(event)
      ? [{ id: "thread-delete", label: text("chat", "delete"), icon: MENU_ICONS.delete, danger: true, separated: true, run: (click: MouseEvent | KeyboardEvent) => onremove(event.event_id, click) }]
      : []),
  ];

  const rootItems = (event: TimelineEvent): MenuItem[] => [
    { id: "threads-open", label: text("chat", "open_thread"), icon: MENU_ICONS.thread, run: () => onopen(event.event_id) },
    { id: "threads-jump", label: text("chat", "jump_to_root"), icon: MENU_ICONS.jump, run: () => onjump(event.event_id) },
    { id: "threads-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copied(linkOf(event.event_id), "link_copied", "link") },
  ];

  const headItems = (): MenuItem[] => [
    ...(rootId ? [{ id: "thread-all", label: text("chat", "all_threads"), icon: MENU_ICONS.thread, run: onlist }] : []),
    ...(rootId ? [{ id: "thread-head-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copied(linkOf(rootId), "link_copied", "link") }] : []),
    { id: "thread-close", label: text("chat", "close"), icon: MENU_ICONS.close, separated: !!rootId, run: exit.close },
  ];

  const addFiles = async (files: Iterable<File>) => {
    const active = $session;
    if (!active) return;
    const limit = await getUploadLimit(active);

    for (const file of files)
      pending.push({
        id: ++pendingCounter,
        file,
        progress: null,
        preview: isInline(file.type, "image") ? URL.createObjectURL(file) : undefined,
        error: file.size > limit ? text("media", "too_big").replace("{name}", sanitiseFilename(file.name)).replace("{limit}", formatBytes(limit)) : undefined,
      });
  };

  const removePending = (id: number) => {
    const item = pending.find((entry) => entry.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    pending = pending.filter((entry) => entry.id !== id);
  };

  $effect(() => () => pending.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)));

  const upload = async (items: Pending[], reply: ReplyTarget | undefined, thread: { rootId: string; latestId: string }) => {
    const active = $session;
    if (!active) return;

    for (const item of items) {
      item.progress = 0;
      item.error = undefined;
      try {
        const prepared = await prepareAttachment(item.file, !keepImageMetadata);
        const content = await uploadAttachment(active, prepared, encrypted, (value) => (item.progress = value));
        await sendRoomMessage(content, reply, roomId, thread);
        removePending(item.id);
      } catch {
        item.progress = null;
        item.error = text("media", "upload_failed");
      }
    }
  };

  const send = () => {
    const body = draft.trim();
    const items = pending.filter((item) => !item.error && item.progress === null);
    if ((!body && !items.length) || !rootId) return;

    const reply = replying ? { eventId: replying.eventId, sender: replying.sender } : undefined;
    const thread = { rootId, latestId };
    stuck = true;
    replying = null;

    if (body) sendMessage(body, reply, trimPills(draft, pills).pills, thread).catch(() => undefined);
    if (items.length) upload(items, body ? undefined : reply, thread);
    draft = "";
  };

  const formatStamp = (ts: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ts);

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || replying || document.querySelector("[role=menu]")) return;
    event.preventDefault();
    event.stopPropagation();
    exit.close();
  };
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="thread col" class:closing={exit.closing} aria-label={text("chat", rootId ? "thread" : "threads")} inert={exit.closing} onanimationend={exit.onanimationend} {onkeydown}>
  <header class="head row-nw align-centre gap-sm" use:menu={headItems}>
    {#if rootId}
      <button type="button" class="icon-button ghost press" aria-label={text("chat", "all_threads")} onclick={onlist}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42a.996.996 0 0 0-1.41 0l-6.59 6.59a.996.996 0 0 0 0 1.41l6.59 6.59a.996.996 0 1 0 1.41-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1Z" /></svg>
      </button>
    {:else}
      <svg class="head-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.thread} /></svg>
    {/if}
    <h3 class="title md bold flex-max truncate">
      {#if rootId}
        {text("chat", "thread")}{#if shownRoot && !shownRoot.redacted}<span class="faint">&nbsp;·&nbsp;<EmojiText text={plainText(shownRoot) || resolveName(shownRoot.sender)} /></span>{/if}
      {:else}
        {text("chat", "threads")}
      {/if}
    </h3>
    <button type="button" class="icon-button ghost press" aria-label={text("chat", "close")} onclick={exit.close}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.close} /></svg>
    </button>
  </header>

  {#if rootId}
    <ol class="list col flex-max min-0" style:padding-bottom="{dockHeight + 32}px" bind:this={list} {onscroll}>
      {#if shownRoot}
        {@render entry(shownRoot, true)}
      {:else if root === null}
        <li class="note sm faint">{text("chat", "thread_unavailable")}</li>
      {:else}
        <li class="note row centre"><span class="dots row-nw gap-sm"><span></span><span></span><span></span></span></li>
      {/if}
      <li class="divider row-nw align-centre gap-sm xs faint" role="separator">
        <span>{text("chat", replies.length === 1 ? "thread_reply_count" : "thread_replies_count").replace("{count}", String(replies.length))}</span>
        <span class="rule flex-max"></span>
      </li>
      {#if next}
        <li class="row centre"><button type="button" class="more ghost press xs bold" disabled={loading} onclick={loadOlder}>{text("chat", "thread_older")}</button></li>
      {/if}
      {#each replies as event (event.txnId ?? event.event_id)}
        {@render entry(event, false)}
      {:else}
        {#if loading}
          <li class="note row centre"><span class="dots row-nw gap-sm" aria-label={text("chat", "loading_history")}><span></span><span></span><span></span></span></li>
        {:else if failed}
          <li class="note sm faint">{text("chat", "thread_unavailable")}</li>
        {:else}
          <li class="empty col centre gap-xs"><p class="md bold">{text("chat", "thread_empty")}</p><p class="sm muted">{text("chat", "thread_empty_hint")}</p></li>
        {/if}
      {/each}
    </ol>

    <Composer
        bind:dockHeight
        bind:draft
        bind:pills
        bind:field
        label={text("chat", "thread_composer")}
        {replying}
        {pending}
        {keepImageMetadata}
        onsend={send}
        oncancelreply={() => (replying = null)}
        onfiles={addFiles}
        onremove={removePending}
        oneditlast={() => false}
        onmetadata={setKeepImageMetadata}
      />
  {:else}
    <ol class="list col flex-max min-0">
      {#each roots as event (event.event_id)}
        {@const sender = getSender(event.sender)}
        {@const summary = bundledThread(event)}
        <li class="root col gap-xs" use:menu={() => rootItems(event)}>
          <button type="button" class="root-open row-nw gap-md ghost press" onclick={() => onopen(event.event_id)}>
            <Avatar name={sender.name} url={sender.avatar} size="32px" radius="50%" />
            <span class="col min-0 flex-max gap-xs">
              <span class="meta row-nw align-baseline gap-sm min-0">
                <span class="name sm bold truncate"><EmojiText text={sender.name} /></span>
                <time class="xs faint truncate" datetime={new Date(event.origin_server_ts).toISOString()}>{formatStamp(event.origin_server_ts)}</time>
              </span>
              <span class="preview sm truncate muted">{event.redacted ? text("chat", "redacted") : event.decryptionFailed || event.type === "m.room.encrypted" ? text("chat", "encrypted") : toPreviewLine(event.content)}</span>
            </span>
          </button>
          {#if summary}<ThreadSummary {summary} {getSender} items={() => rootItems(event)} onopen={() => onopen(event.event_id)} />{/if}
        </li>
      {:else}
        {#if loading}
          <li class="note row centre"><span class="dots row-nw gap-sm" aria-label={text("chat", "loading_history")}><span></span><span></span><span></span></span></li>
        {:else if failed}
          <li class="note sm faint">{text("chat", "thread_unavailable")}</li>
        {:else}
          <li class="empty col centre gap-xs"><p class="md bold">{text("chat", "threads_empty")}</p><p class="sm muted">{text("chat", "threads_empty_hint")}</p></li>
        {/if}
      {/each}
      {#if next && roots.length}
        <li class="row centre"><button type="button" class="more ghost press xs bold" disabled={loading} onclick={() => loadRoots(next, roots)}>{text("chat", "threads_more")}</button></li>
      {/if}
    </ol>
  {/if}
</aside>

{#snippet entry(event: TimelineEvent, isRoot: boolean)}
  {@const sender = getSender(event.sender)}
  {@const replyTo = quoted(event)}
  <li class="entry row-nw gap-md" class:root-entry={isRoot} class:sending={event.localStatus === "sending"} class:failed={event.localStatus === "failed"} data-event-id={event.event_id} use:menu={() => itemsFor(event, isRoot)}>
    <button type="button" class="avatar ghost press" data-profile-trigger use:usermenu={{ userId: event.sender, roomId }} aria-label={text("user_profile", "open").replace("{name}", sender.name)}>
      <Avatar name={sender.name} url={sender.avatar} size="32px" radius="50%" />
    </button>
    <div class="col min-0 flex-max gap-xs">
      {#if replyTo}
        {@const original = findReply(replyTo)}
        <span class="quote row-nw align-centre gap-xs xs muted min-0">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.reply} /></svg>
          {#if original}
            <span class="bold truncate"><EmojiText text={text("chat", "thread_replying").replace("{name}", resolveName(original.sender))} /></span>
            <span class="truncate faint">{original.redacted ? text("chat", "redacted") : toPreviewLine(original.content)}</span>
          {:else}
            <span class="truncate faint">{text("chat", "reply_unavailable")}</span>
          {/if}
        </span>
      {/if}
      <div class="meta row-nw align-baseline gap-sm min-0">
        <span class="name sm bold truncate"><EmojiText text={sender.name} /></span>
        <time class="xs faint truncate" datetime={new Date(event.origin_server_ts).toISOString()}>{formatStamp(event.origin_server_ts)}</time>
      </div>
      <div class="body sm selectable">
        {#if event.redacted}
          <p class="faint">{text("chat", "redacted")}</p>
        {:else if event.decryptionFailed || event.type === "m.room.encrypted"}
          <p class="faint">{text("chat", "encrypted")}</p>
        {:else if event.type === "m.sticker"}
          <MessageMedia content={event.content} sticker />
        {:else if isMedia(event)}
          <MessageMedia content={event.content} sender={sender.name} ts={event.origin_server_ts} />
        {:else if typeof event.content.body === "string"}
          <p><MessageBody content={event.content} {ownUserId} {resolveName} />{#if event.edited}<span class="xs faint"> {text("chat", "edited")}</span>{/if}</p>
        {:else}
          <p class="faint">{text("chat", "unsupported").replace("{type}", String(event.content.msgtype ?? event.type))}</p>
        {/if}
        {#if event.localStatus === "failed"}<p class="xs danger">{text("chat", "failed")}</p>{/if}
      </div>
    </div>
  </li>
{/snippet}

<style>
  .thread {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--azure-z-sticky);
    width: var(--thread-width);
    border-left: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    animation: thread-in var(--azure-duration-glide) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .thread.closing {
    pointer-events: none;
    animation: thread-out var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1) forwards;
  }

  @keyframes thread-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  @keyframes thread-out {
    to {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  .head {
    flex: none;
    min-height: 48px;
    padding: 0 var(--azure-spacing-md);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .title {
    margin: 0;
    line-height: 1.2;
    color: var(--colours-text-strong);
  }

  .head-icon {
    flex: none;
    color: var(--colours-accent);
  }

  .icon-button {
    width: 30px;
    height: 30px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .icon-button:hover,
  .icon-button:focus-visible {
    outline: none;
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: var(--azure-spacing-sm) 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .entry {
    align-items: flex-start;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
    animation: entry-in var(--azure-duration-md) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .entry:hover {
    background-color: var(--colours-surface-hover);
  }

  .entry.sending {
    opacity: 0.6;
  }

  .entry.failed .body {
    color: var(--colours-danger);
  }

  .danger {
    color: var(--colours-danger);
  }

  @keyframes entry-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .avatar {
    flex: none;
    border-radius: 50%;
  }

  .name {
    color: var(--colours-text-strong);
  }

  .body {
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  .body p {
    margin: 0;
  }

  .quote svg {
    flex: none;
  }

  .divider {
    padding: var(--azure-spacing-xs) var(--azure-spacing-md);
  }

  .rule {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .note,
  .empty {
    padding: var(--azure-spacing-lg) var(--azure-spacing-md);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  .more {
    margin: var(--azure-spacing-xs) 0;
    padding: var(--azure-spacing-xs) var(--azure-spacing-md);
    border-radius: var(--azure-radius-pill);
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  .root {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
  }

  .root + .root {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .root-open {
    align-items: flex-start;
    text-align: left;
    color: var(--colours-text);
  }

  .preview {
    display: block;
  }

  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    animation: dot 1s cubic-bezier(0.32, 0.72, 0, 1) infinite alternate;
  }

  .dots span:nth-child(2) {
    animation-delay: 160ms;
  }

  .dots span:nth-child(3) {
    animation-delay: 320ms;
  }

  @keyframes dot {
    to {
      opacity: 0.3;
      transform: translateY(-3px);
    }
  }

  @media (max-width: 767px) {
    .thread {
      width: 100%;
      border-left: none;
      z-index: var(--azure-z-popover);
    }

    @keyframes thread-in {
      from {
        transform: translateX(100%);
      }
    }

    @keyframes thread-out {
      to {
        transform: translateX(100%);
      }
    }
  }
</style>
