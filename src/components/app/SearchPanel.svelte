<script lang="ts">
  import { blur, fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { tick, untrack } from "svelte";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { canSearchOlder, filterCount, matchesQuery, olderWalker, searchLoaded, searchServer, type SearchQuery } from "../../scripts/matrix/search";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { SETTINGS_ICONS } from "../settings/icons";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "./MessageMenu.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import LoadingDots from "../ui/LoadingDots.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import MessageBody from "./media/MessageBody.svelte";
  import MessageMedia from "./media/MessageMedia.svelte";

  let {
    roomId,
    encrypted,
    query,
    pinned,
    anchor,
    ownUserId,
    getSender,
    onjump,
    onfilters,
    onclose,
  }: {
    roomId: string;
    encrypted: boolean;
    query: SearchQuery;
    pinned: string[];
    anchor?: HTMLElement;
    ownUserId?: string;
    getSender: (userId: string) => { name: string; avatar?: string };
    onjump: (eventId: string) => void;
    onfilters: () => void;
    onclose: () => void;
  } = $props();

  const MEDIA_TYPES = ["m.image", "m.video", "m.audio", "m.file"];
  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const ease = (t: number) => cubicOut(t);
  const resolveName = (userId: string) => getSender(userId).name;

  let found: Record<string, TimelineEvent> = $state.raw({});
  let next: string | null = $state(null);
  let total: number | undefined = $state();
  let status: "loading" | "ready" | "error" | "more" = $state("loading");
  let older = $state(false);
  let newest = $state(true);
  let top = $state(56);
  let sentinel: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let controller: AbortController | undefined;
  let walker: ReturnType<typeof olderWalker> | null = null;
  let walked = 0;
  let walking = $state(false);
  const WALK_LIMIT = 25;

  const pinnedSet = $derived(new Set(pinned));
  const server = $derived(!encrypted && !!query.term.trim());
  const terms = $derived(query.term.toLowerCase().split(/\s+/).filter(Boolean));
  const results = $derived(Object.values(found).sort((a, b) => (newest ? b.origin_server_ts - a.origin_server_ts : a.origin_server_ts - b.origin_server_ts)));
  const count = $derived(server && total !== undefined && !filterCount({ ...query, senders: [] }) ? total : results.length);
  const keep = (events: TimelineEvent[]) => (found = { ...found, ...Object.fromEntries(events.filter((event) => matchesQuery(event, query, pinnedSet)).map((event) => [event.event_id, event])) });

  const run = async () => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    found = {};
    next = null;
    total = undefined;
    status = "loading";
    try {
      const page = server ? await searchServer(roomId, query, null, signal) : { events: searchLoaded(roomId, query, pinnedSet), next: null, count: undefined };
      if (signal.aborted) return;
      keep(page.events);
      next = page.next;
      total = page.count;
      older = !server && canSearchOlder(roomId);
      walker = older ? olderWalker(roomId) : null;
      walked = 0;
      status = "ready";
      older && void walk(signal);
    } catch (error) {
      signal.aborted || (console.warn("Skye could not search", error), (status = "error"));
    }
  };

  const more = async () => {
    if (status !== "ready" || (server ? !next : !older)) return;
    status = "more";
    const signal = controller?.signal;
    try {
      const page = server ? await searchServer(roomId, query, next, signal) : await walker!.step().then((result) => ({ events: result.events, next: null, more: result.more }));
      if (signal?.aborted) return;
      keep(page.events);
      server ? (next = page.next) : (older = "more" in page && !!page.more);
      status = "ready";
      !server && older && (walked = 0) === 0 && void walk(signal);
    } catch (error) {
      signal?.aborted || (console.warn("Skye could not load more results", error), (status = "error"));
    }
  };

  const walk = async (signal?: AbortSignal) => {
    if (walking) return;
    walking = true;
    while (!signal?.aborted && older && walker && walked < WALK_LIMIT && (status === "ready" || status === "more")) {
      status = "more";
      try {
        const page = await walker.step();
        if (signal?.aborted) return;
        keep(page.events);
        older = page.more;
        walked++;
      } catch {
        older = false;
      }
      status = "ready";
      await new Promise((done) => setTimeout(done, 120));
    }
    walking = false;
  };

  $effect(() => {
    $state.snapshot(query);
    roomId;
    untrack(run);
    return () => controller?.abort();
  });

  $effect(() => {
    const target = anchor;
    tick().then(() => target && (top = target.offsetTop + target.offsetHeight));
  });

  $effect(() => {
    const target = sentinel;
    if (!target || !server) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && more(), { root: list, rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  });

  const HIGHLIGHT = "skye-search";
  const ranges = new Map<HTMLElement, Range[]>();
  const repaint = () => (globalThis as any).CSS?.highlights?.set(HIGHLIGHT, new (globalThis as any).Highlight(...[...ranges.values()].flat()));

  const mark = (node: HTMLElement, words: string[]) => {
    const paint = (list: string[]) => {
      const found: Range[] = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        const value = current.textContent?.toLowerCase() ?? "";
        list.forEach((word) => {
          for (let at = value.indexOf(word); at !== -1; at = value.indexOf(word, at + word.length)) {
            const range = document.createRange();
            range.setStart(current!, at);
            range.setEnd(current!, at + word.length);
            found.push(range);
          }
        });
      }
      ranges.set(node, found);
      repaint();
    };
    requestAnimationFrame(() => paint(words));
    return {
      update: (list: string[]) => requestAnimationFrame(() => paint(list)),
      destroy: () => (ranges.delete(node), repaint()),
    };
  };

  const formatStamp = (ts: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ts);

  const jump = (eventId: string) => (onclose(), onjump(eventId));

  const resultItems = (event: TimelineEvent): MenuItem[] => [
    { id: "search-jump", label: text("chat", "jump"), icon: MENU_ICONS.jump, run: () => jump(event.event_id) },
    ...(typeof event.content.body === "string" && !MEDIA_TYPES.includes(event.content.msgtype) ? [{ id: "search-copy", label: text("chat", "copy_text"), icon: MENU_ICONS.copy, run: () => copied(event.content.body) }] : []),
    { id: "search-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copied(`https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(event.event_id)}`, "link_copied", "link") },
    { id: "search-id", label: text("chat", "copy_id"), icon: MENU_ICONS.id, run: () => copied(event.event_id, "message_id_copied", "id") },
  ];

  const headItems = (): MenuItem[] => [
    { id: "search-filters", label: text("chat", "search_filters"), icon: MENU_ICONS.add, run: onfilters },
    { id: "search-sort", label: text("chat", newest ? "search_sort_oldest" : "search_sort_newest"), icon: MENU_ICONS.expand, run: () => (newest = !newest) },
    { id: "search-close", label: text("chat", "close"), icon: MENU_ICONS.close, separated: true, run: onclose },
  ];

  const onkeydown = (event: KeyboardEvent) => event.key === "Escape" && (event.preventDefault(), event.stopPropagation(), onclose());
</script>

<aside
  class="panel col"
  role="region"
  aria-label={text("chat", "search_results")}
  style:top="{top}px"
  in:fly={{ x: 24, duration: 420, easing: ease, opacity: 0 }}
  out:blur={{ duration: 220, amount: 6 }}
  {onkeydown}
>
  <header class="head row-nw align-centre gap-md" use:menu={headItems}>
    <h3 class="md bold flex-max truncate" aria-live="polite">
      {#key status === "loading" ? "loading" : count}
        <span in:blur={{ duration: 200, amount: 3 }}>{status === "loading" ? text("chat", "search_searching") : text("chat", count === 1 ? "search_result_one" : "search_result_many").replace("{count}", count.toLocaleString())}</span>
      {/key}
    </h3>
    <button type="button" class="ghost pill sm bold press" class:on={filterCount(query) > 0} onclick={onfilters} use:tooltip={text("chat", "search_filters")}>
      {text("chat", "search_filters")}{#if filterCount(query)}&nbsp;·&nbsp;{filterCount(query)}{/if}
    </button>
    <button type="button" class="ghost pill sm bold press" onclick={() => (newest = !newest)} use:tooltip={text("chat", "search_sort")}>
      {text("chat", newest ? "search_sort_newest" : "search_sort_oldest")}
    </button>
    <button type="button" class="icon-button ghost press" aria-label={text("chat", "close")} onclick={onclose}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </header>

  {#if encrypted}
    <p class="note xs muted row-nw align-centre gap-xs">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.info} /></svg>
      {text("chat", "search_encrypted_note")}
    </p>
  {/if}

  <div class="list col" bind:this={list}>
    {#if status === "loading"}
      <div class="col" in:blur={{ duration: 260, amount: 6 }} out:blur={{ duration: 160, amount: 4 }} aria-busy="true">
        {#each [0, 1, 2, 3] as index (index)}
          <div class="card row-nw gap-md">
            <span class="skeleton avatar"></span>
            <span class="col gap-sm flex-max skeleton-lines">
              <span class="skeleton line short"></span>
              <span class="skeleton line"></span>
              <span class="skeleton line mid"></span>
            </span>
          </div>
        {/each}
      </div>
    {:else if status === "error"}
      <div class="empty col centre gap-sm" in:blur={{ duration: 260, amount: 6 }}>
        <p class="md bold">{text("chat", "search_error")}</p>
        <button type="button" class="ghost pill xs bold press" onclick={run} use:menu={() => [{ id: "search-retry", label: text("chat", "search_retry"), icon: MENU_ICONS.retry, run }]}>{text("chat", "search_retry")}</button>
      </div>
    {:else if !results.length && status === "ready" && !walking}
      <div class="empty col centre gap-sm" in:blur={{ duration: 260, amount: 6 }}>
        <span class="badge row centre" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d={SETTINGS_ICONS.search} /></svg></span>
        <p class="md bold">{text("chat", "search_none")}</p>
        <p class="sm muted">{text("chat", encrypted ? "search_none_encrypted" : "search_none_hint")}</p>
      </div>
    {:else}
      <ul class="col gap-sm">
        {#each results as event (event.event_id)}
          {@const sender = getSender(event.sender)}
          <li animate:flip={{ duration: 320, easing: ease }} in:blur={{ duration: 240, amount: 5 }} out:blur={{ duration: 160, amount: 4 }}>
            <button type="button" class="ghost card row-nw gap-md" onclick={() => jump(event.event_id)} use:menu={() => resultItems(event)} aria-label={`${text("chat", "jump")}: ${sender.name}`}>
              <Avatar name={sender.name} url={sender.avatar} size="32px" radius="50%" />
              <span class="col min-0 flex-max gap-xs">
                <span class="meta row-nw align-baseline gap-sm min-0">
                  <span class="name sm bold truncate"><EmojiText text={sender.name} /></span>
                  <time class="xs faint truncate" datetime={new Date(event.origin_server_ts).toISOString()}>{formatStamp(event.origin_server_ts)}</time>
                </span>
                <span class="body sm" use:mark={terms}>
                  {#if MEDIA_TYPES.includes(event.content.msgtype)}
                    <span class="media"><MessageMedia content={event.content} /></span>
                  {:else}
                    <MessageBody content={event.content} {ownUserId} {resolveName} highlight={false} interactive={false} />
                  {/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if server && next}
        <div class="more row centre" bind:this={sentinel}>{#if status === "more"}<span in:blur={{ duration: 200 }}><LoadingDots /></span>{/if}</div>
      {/if}
    {/if}
    {#if walking}
      <p class="walking xs muted col align-centre gap-sm" in:fly={{ y: 4, duration: 220, easing: ease, opacity: 0 }}><LoadingDots label={text("chat", "search_older_loading")} />{text("chat", "search_older_loading")}</p>
    {:else if !server && older && status !== "loading" && status !== "error"}
      <button type="button" class="ghost older sm bold press" disabled={status === "more"} onclick={more} in:blur={{ duration: 220 }} use:menu={() => [{ id: "search-older", label: text("chat", "search_older"), icon: MENU_ICONS.retry, run: more }]}>
        {text("chat", status === "more" ? "search_older_loading" : "search_older")}
      </button>
    {/if}
  </div>
</aside>

<style>
  :global(::highlight(skye-search)) {
    background-color: color-mix(in oklab, #f5b301 38%, transparent);
    color: inherit;
  }

  .panel {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--thread-width, min(420px, 45%));
    z-index: 5;
    border-left: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
  }

  @media (max-width: 767px) {
    .panel {
      width: 100%;
      border-left: 0;
    }
  }

  .head {
    flex: none;
    min-height: 48px;
    padding: 0 var(--azure-spacing-md) 0 var(--azure-spacing-lg);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  h3,
  p {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .muted {
    color: var(--colours-text-muted);
  }

  .pill {
    height: 30px;
    padding: 0 14px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
    transition: color var(--azure-duration-fast) var(--azure-ease-out), background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .pill.on,
  .pill:hover {
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .icon-button {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .icon-button:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .note {
    flex: none;
    padding: var(--azure-spacing-sm) var(--azure-spacing-lg);
    border-bottom: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-muted);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--azure-spacing-sm);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .card {
    width: 100%;
    align-items: flex-start;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
    text-align: left;
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out), border-color var(--azure-duration-fast) var(--azure-ease-out), scale var(--azure-duration-md) var(--azure-ease-spring);
  }

  .card + .card {
    margin-top: var(--azure-spacing-sm);
  }

  button.card:hover,
  button.card:focus-visible {
    background-color: var(--colours-surface-hover);
    border-color: var(--colours-outline-strong);
  }

  button.card:active {
    scale: 0.99;
  }

  .card > :global(:first-child) {
    flex: none;
    margin-top: 2px;
  }

  .name {
    color: var(--colours-text-strong);
  }

  .body {
    display: block;
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  .body :global(*) {
    margin-block: 0 !important;
  }

  .media {
    display: block;
    width: fit-content;
    max-width: 260px;
    max-height: 180px;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
  }

  .empty {
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg);
    text-align: center;
  }

  .empty .muted {
    max-width: 32ch;
  }

  .badge {
    width: 48px;
    height: 48px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .walking {
    justify-content: center;
    margin: 0;
    padding: var(--azure-spacing-md);
  }

  .older {
    align-self: center;
    margin: var(--azure-spacing-md) 0;
    height: 32px;
    padding: 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-pill);
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .older:disabled {
    opacity: 0.6;
  }

  .more {
    height: 48px;
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

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
</style>
