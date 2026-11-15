<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import EmojiText from "../ui/EmojiText.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { longpress } from "../../scripts/misc/longpress";
  import { toMatrixTo } from "../../scripts/matrix/utilities/links";
  import { describeMembershipError, leaveRoom, type MembershipError } from "../../scripts/matrix/utilities/membership";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { formatAgo } from "../../scripts/misc/time";
  import { getHierarchy, joinRoom, knockRoom, type HierarchyRoom } from "../../scripts/matrix/utilities/hierarchy";
  import { serverNameFromUserId } from "../../scripts/matrix/discovery";
  import type { RoomSummary, Session } from "../../scripts/matrix/types";
  import { browseSettings, dismissBrowseIntro, type BrowseSettings } from "../../scripts/settings/browse";
  import { hiddenRooms, isRoomHidden, setRoomsHidden } from "../../scripts/stores/hidden";
  import { markRoomRead, rooms, session } from "../../scripts/stores/matrix";
  import { navigation, openRoom } from "../../scripts/stores/navigation.svelte";
  import { toEntity } from "../../scripts/stores/entities";

  let { onchannels }: { onchannels?: () => void } = $props();

  type Status = "loading" | "ready" | "fallback";

  type Item = {
    roomId: string;
    name: string;
    topic?: string;
    avatarUrl?: string;
    memberCount: number;
    joinRule: string;
    via: string[];
    allowedRooms: string[];
  };

  type Section = {
    id: string;
    name: string;
    depth: number;
    subspace?: Item;
    items: Item[];
  };

  const SKELETON_SECTIONS = [4, 3];

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let activeSession: Session | null = $state.raw(null);
  let roomMap: Record<string, RoomSummary> = $state.raw({});
  let hidden: Record<string, string[]> = $state.raw({});
  let settings: BrowseSettings = $state.raw({ introDismissed: false });

  $effect(() => session.subscribe((value) => (activeSession = value)));
  $effect(() => rooms.subscribe((value) => (roomMap = value)));
  $effect(() => hiddenRooms.subscribe((value) => (hidden = value)));
  $effect(() => browseSettings.subscribe((value) => (settings = value)));

  let hierarchy: HierarchyRoom[] = $state.raw([]);
  let status: Status = $state("loading");
  let query = $state("");
  let pending: Record<string, "join" | "knock"> = $state({});
  let requested: Record<string, boolean> = $state({});
  let failed: Record<string, boolean> = $state({});

  const spaceId = $derived(navigation.spaceId);

  const load = async (target: string, current: Session, refresh = false) => {
    status = "loading";
    try {
      const result = await getHierarchy(current, target, refresh);
      if (navigation.spaceId !== target) return;
      hierarchy = result;
      status = result.length ? "ready" : "fallback";
    } catch (error) {
      if (navigation.spaceId !== target) return;
      console.warn("Skye could not load the space hierarchy", error);
      hierarchy = [];
      status = "fallback";
    }
  };

  $effect(() => {
    const target = spaceId;
    const current = activeSession;
    if (!current) return;
    queueMicrotask(() => load(target, current));
  });

  const isJoined = (roomId: string) => roomMap[roomId]?.membership === "join";

  const fromSummary = (room: RoomSummary): Item => {
    const entity = toEntity(room, activeSession?.userId);
    return {
      roomId: room.roomId,
      name: entity.name,
      topic: room.topic,
      avatarUrl: room.avatarUrl,
      memberCount: room.joinedMemberCount ?? 0,
      joinRule: "public",
      via: [],
      allowedRooms: [],
    };
  };

  const aliasName = (alias?: string) => alias?.slice(1).split(":")[0];

  const fromHierarchy = (room: HierarchyRoom, via: string[]): Item => ({
    roomId: room.roomId,
    name: room.name ?? aliasName(room.alias) ?? room.roomId,
    topic: room.topic,
    avatarUrl: room.avatarUrl,
    memberCount: room.memberCount,
    joinRule: room.joinRule,
    via,
    allowedRooms: room.allowedRooms,
  });

  const sections = $derived.by((): Section[] => {
    if (status === "fallback") {
      const space = roomMap[spaceId];
      if (!space) return [];

      const walk = (parent: RoomSummary, depth: number, seen: Set<string>): Section[] => {
        const children = parent.children
          .map((childId) => roomMap[childId])
          .filter((child): child is RoomSummary => !!child && !seen.has(child.roomId));
        children.forEach((child) => seen.add(child.roomId));

        return [
          {
            id: parent.roomId,
            name: depth ? toEntity(parent, activeSession?.userId).name : text("browse", "uncategorised"),
            depth,
            subspace: depth ? fromSummary(parent) : undefined,
            items: children.filter((child) => !child.isSpace && !child.isDirect).map(fromSummary),
          },
          ...children.filter((child) => child.isSpace).flatMap((child) => walk(child, depth + 1, seen)),
        ];
      };

      return walk(space, 0, new Set([spaceId]));
    }

    const byId = new Map(hierarchy.map((room) => [room.roomId, room]));
    const root = byId.get(spaceId);
    if (!root) return [];

    const walk = (parent: HierarchyRoom, depth: number, via: string[], seen: Set<string>): Section[] => {
      const children = parent.children
        .filter((child) => byId.has(child.roomId) && !seen.has(child.roomId))
        .map((child) => ({ room: byId.get(child.roomId)!, via: child.via }));
      children.forEach(({ room }) => seen.add(room.roomId));

      return [
        {
          id: parent.roomId,
          name: depth ? (parent.name ?? aliasName(parent.alias) ?? parent.roomId) : text("browse", "uncategorised"),
          depth,
          subspace: depth ? fromHierarchy(parent, via) : undefined,
          items: children.filter(({ room }) => !room.isSpace).map(({ room, via }) => fromHierarchy(room, via)),
        },
        ...children
          .filter(({ room }) => room.isSpace)
          .flatMap(({ room, via }) => walk(room, depth + 1, via, seen)),
      ];
    };

    return walk(root, 0, [], new Set([spaceId]));
  });

  const needle = $derived(query.trim().toLowerCase());

  const matches = (item: Item) =>
    !needle || item.name.toLowerCase().includes(needle) || !!item.topic?.toLowerCase().includes(needle);

  const visibleSections = $derived(
    sections
      .map((section) => ({
        ...section,
        items: section.items.filter(matches),
        subspaceMatch: !!section.subspace && matches(section.subspace),
      }))
      .filter((section) => section.items.length || (section.subspace && (!needle || section.subspaceMatch))),
  );

  const joinedIn = (section: Section) => section.items.filter((item) => isJoined(item.roomId)).map((item) => item.roomId);

  const isFollowed = (section: Section) => {
    const joined = joinedIn(section);
    return joined.length > 0 && joined.every((roomId) => !isRoomHidden(hidden, spaceId, roomId));
  };

  const follow = (section: Section, value: boolean) => {
    const full = sections.find((candidate) => candidate.id === section.id) ?? section;
    setRoomsHidden(spaceId, joinedIn(full), !value);
  };

  const canJoin = (item: Item) => {
    if (item.joinRule === "public") return true;
    if (item.joinRule === "restricted" || item.joinRule === "knock_restricted")
      return item.allowedRooms.some(isJoined);
    return false;
  };

  const canKnock = (item: Item) => item.joinRule === "knock" || item.joinRule === "knock_restricted";

  const blockedReason = (item: Item) =>
    item.joinRule === "invite" || item.joinRule === "private"
      ? text("browse", "invite_only")
      : text("browse", "restricted");

  const viaFor = (item: Item) =>
    item.via.length ? item.via : activeSession ? [serverNameFromUserId(activeSession.userId)] : [];

  const act = async (item: Item, kind: "join" | "knock") => {
    if (!activeSession || pending[item.roomId]) return;

    pending[item.roomId] = kind;
    delete failed[item.roomId];

    try {
      if (kind === "join") {
        await joinRoom(activeSession, item.roomId, viaFor(item));
        setRoomsHidden(spaceId, [item.roomId], false);
      } else {
        await knockRoom(activeSession, item.roomId, viaFor(item));
        requested[item.roomId] = true;
        delete pending[item.roomId];
      }
    } catch (error) {
      console.warn("Skye could not join the room", error);
      failed[item.roomId] = true;
      delete pending[item.roomId];
    }
  };

  const joining = (roomId: string) => pending[roomId] === "join" && !isJoined(roomId);

  const memberLabel = (count: number) =>
    count === 1 ? text("browse", "member") : text("browse", "members").replace("{count}", count.toLocaleString());

  const activity = (roomId: string) => {
    const timestamp = roomMap[roomId]?.lastActivity;
    if (!timestamp || !isJoined(roomId)) return undefined;
    return text("browse", "active").replace("{time}", formatAgo(Math.max(0, Date.now() - timestamp)));
  };

  const open = (roomId: string) => openRoom(spaceId, roomId);

  let leaving: Item | null = $state(null);
  let leavingBusy = $state(false);
  let confirmDialog: ConfirmDialog | undefined = $state();
  let leaveError: MembershipError | null = $state(null);

  const leave = async (item: Item) => {
    if (!activeSession) return;
    leavingBusy = true;
    leaveError = null;
    try {
      await leaveRoom(activeSession, item.roomId);
      confirmDialog?.dismiss();
    } catch (error) {
      leaveError = describeMembershipError(error);
    } finally {
      leavingBusy = false;
    }
  };

  let menu: { item: Item; x: number; y: number } | null = $state.raw(null);

  const openMenu = (item: Item, x: number, y: number) => {
    if (!menu) menu = { item, x, y };
  };

  const copy = (value: string) => navigator.clipboard?.writeText(value).catch(() => undefined);

  const menuItems = (item: Item): MenuItem[] => {
    const joined = isJoined(item.roomId);
    const shared = [
      { id: "link", label: text("room_menu", "copy_link"), icon: MENU_ICONS.link, run: () => copy(toMatrixTo(item.roomId, viaFor(item))) },
      { id: "id", label: text("room_menu", "copy_id"), icon: MENU_ICONS.id, run: () => copy(item.roomId) },
    ];
    if (!joined) {
      const entry: MenuItem[] = canJoin(item)
        ? [{ id: "join", label: text("browse", "join"), icon: MENU_ICONS.add, run: () => act(item, "join") }]
        : canKnock(item) && !requested[item.roomId]
          ? [{ id: "knock", label: text("browse", "knock"), icon: MENU_ICONS.add, run: () => act(item, "knock") }]
          : [];
      return [...entry, ...shared];
    }
    const shown = !isRoomHidden(hidden, spaceId, item.roomId);
    return [
      { id: "open", label: text("room_menu", "open"), icon: MENU_ICONS.open, run: () => open(item.roomId) },
      { id: "read", label: text("room_menu", "mark_read"), icon: MENU_ICONS.read, run: () => markRoomRead(item.roomId) },
      { id: "hide", label: text("room_menu", shown ? "hide" : "show"), icon: MENU_ICONS.hide, run: () => setRoomsHidden(spaceId, [item.roomId], shown) },
      ...shared,
      { id: "leave", label: text("room_menu", "leave"), icon: MENU_ICONS.leave, danger: true, run: (event) => (event instanceof MouseEvent && event.shiftKey ? void leave(item) : ((leaveError = null), (leaving = item))) },
    ];
  };

  const askLeave = (item: Item, event: MouseEvent) => {
    if (event.shiftKey) return void leave(item);
    leaveError = null;
    leaving = item;
  };
</script>

{#snippet joinControl(item: Item, compact: boolean)}
  {#if isJoined(item.roomId)}
    {#if compact}
      <span class="joined xs bold">{text("browse", "joined")}</span>
    {:else}
      <label class="check row-nw align-centre gap-sm sm" use:tooltip={text("browse", "show")}>
        <span class="sr-only">{text("browse", "show")}</span>
        <input
          type="checkbox"
          checked={!isRoomHidden(hidden, spaceId, item.roomId)}
          onchange={(event) => setRoomsHidden(spaceId, [item.roomId], !event.currentTarget.checked)}
        />
      </label>
      <button type="button" class="leave-action ghost press sm" onclick={(event) => askLeave(item, event)}>{text("room_menu", "leave")}</button>
    {/if}
  {:else if joining(item.roomId)}
    <button type="button" class="action press sm bold row-nw align-centre gap-sm" disabled aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      {text("browse", "joining")}
    </button>
  {:else if canJoin(item)}
    <button type="button" class="action primary press sm bold" class:failed={failed[item.roomId]} use:tooltip={failed[item.roomId] ? text("browse", "join_failed") : undefined} onclick={() => act(item, "join")}>
      {text("browse", "join")}
    </button>
  {:else if canKnock(item)}
    <button
      type="button"
      class="action press sm bold row-nw align-centre gap-sm"
      disabled={requested[item.roomId] || pending[item.roomId] === "knock"}
      onclick={() => act(item, "knock")}
    >
      {#if pending[item.roomId] === "knock"}<span class="spinner" aria-hidden="true"></span>{/if}
      {text("browse", requested[item.roomId] ? "requested" : "knock")}
    </button>
  {:else}
    <span class="blocked" use:tooltip={blockedReason(item)}>
      <button type="button" class="action press sm bold" disabled aria-label={`${text("browse", "join")}: ${blockedReason(item)}`}>
        {text("browse", "join")}
      </button>
    </span>
  {/if}
{/snippet}

<section class="browse col min-0">
  <header class="header row-nw align-centre gap-sm hairline-b">
    <button class="icon ghost press mobile-only" aria-label={text("navigation", "open_channels")} onclick={onchannels}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
    <svg class="faint header-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 6h10M4 12h7M4 18h10" />
      <circle cx="17" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="2" />
      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m19.4 15.4 2 2" />
    </svg>
    <h2 class="md bold truncate title">{text("browse", "title")}</h2>
  </header>

  <div class="scroll flex-max min-0">
    <div class="content col gap-lg">
      <label class="search row-nw align-centre gap-sm">
        <svg class="faint" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m16 16 4 4" />
        </svg>
        <span class="sr-only">{text("browse", "search")}</span>
        <input class="search-input flex-max min-0" type="search" placeholder={text("browse", "search")} bind:value={query} />
      </label>

      {#if !settings.introDismissed}
        <aside class="intro row-nw gap-md">
          <span class="intro-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 10 17l9-10" />
            </svg>
          </span>
          <div class="col gap-xs flex-max min-0">
            <h3 class="md bold intro-title">{text("browse", "intro_title")}</h3>
            <p class="sm muted intro-body">{text("browse", "intro_body")}</p>
          </div>
          <button class="close icon ghost press" aria-label={text("browse", "dismiss")} onclick={dismissBrowseIntro}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </aside>
      {/if}

      {#if status === "fallback"}
        <p class="notice row-nw align-centre gap-md sm muted">
          <span class="flex-max">{text("browse", "fallback")}</span>
          {#if activeSession}
            {@const current = activeSession}
            <button type="button" class="action press sm bold" onclick={() => load(spaceId, current, true)}>{text("browse", "retry")}</button>
          {/if}
        </p>
      {/if}

      {#if status === "loading"}
        <div class="col gap-lg" role="status" aria-label={text("browse", "loading")}>
          {#each SKELETON_SECTIONS as count, index (index)}
            <div class="section col">
              <span class="skeleton heading"></span>
              {#each { length: count } as _, row (row)}
                <div class="row-skeleton row-nw align-centre gap-md">
                  <span class="skeleton avatar"></span>
                  <span class="col gap-sm flex-max">
                    <span class="skeleton line short"></span>
                    <span class="skeleton line mid"></span>
                  </span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {:else if !visibleSections.length}
        <p class="empty sm faint">
          {needle ? text("browse", "no_results").replace("{query}", query.trim()) : text("browse", "empty")}
        </p>
      {:else}
        {#each visibleSections as section (section.id)}
          {@const joined = joinedIn(section)}
          <section class="section col" style:--depth={section.depth}>
            <header class="section-header row-nw align-centre gap-md">
              <div class="col min-0 flex-max">
                <h3 class="section-title xs bold truncate"><EmojiText text={section.name} /></h3>
                {#if section.subspace?.topic}
                  <p class="xs faint truncate section-topic"><EmojiText text={section.subspace.topic} /></p>
                {/if}
              </div>
              {#if section.subspace && !isJoined(section.subspace.roomId)}
                {@render joinControl(section.subspace, true)}
              {:else if joined.length}
                <span class="follow row-nw align-centre gap-sm xs muted">
                  <span class="follow-label">{text("browse", "follow")}</span>
                  <Toggle label={`${text("browse", "follow")}: ${section.name}`} checked={isFollowed(section)} onchange={(value) => follow(section, value)} />
                </span>
              {/if}
            </header>

            {#if section.items.length}
              <ul class="items col">
                {#each section.items as item (item.roomId)}
                  {@const active = activity(item.roomId)}
                  <li
                    class="item-row row-nw align-centre gap-md"
                    class:dim={isJoined(item.roomId) && isRoomHidden(hidden, spaceId, item.roomId)}
                    oncontextmenu={(event) => {
                      event.preventDefault();
                      openMenu(item, event.clientX, event.clientY);
                    }}
                    use:longpress={(x, y) => openMenu(item, x, y)}
                  >
                    <button type="button" class="room-main ghost row-nw align-centre gap-md flex-max min-0" disabled={!isJoined(item.roomId)} onclick={() => open(item.roomId)}>
                      {#if item.avatarUrl}
                        <Avatar name={item.name} url={item.avatarUrl} size="36px" radius="var(--azure-radius-md)" />
                      {:else}
                        <span class="hash md faint" aria-hidden="true">#</span>
                      {/if}
                      <span class="col min-0 flex-max gap-xs">
                        <span class="name md bold truncate"><EmojiText text={item.name} /></span>
                        <span class="meta xs faint truncate">
                          {#if active}<span>{active}</span><span aria-hidden="true">·</span>{/if}
                          <span>{memberLabel(item.memberCount)}</span>
                        </span>
                        {#if item.topic}
                          <span class="topic sm muted truncate"><EmojiText text={item.topic} /></span>
                        {/if}
                      </span>
                    </button>
                    {@render joinControl(item, false)}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      {/if}
    </div>
  </div>
</section>

{#if menu}
  <MessageMenu items={menuItems(menu.item)} x={menu.x} y={menu.y} label={text("room_menu", "actions")} onclose={() => (menu = null)} />
{/if}

{#if leaving}
  {@const target = leaving}
  <ConfirmDialog
    bind:this={confirmDialog}
    title={text("room_menu", "leave_title").replace("{name}", target.name)}
    body={text("room_menu", "leave_body")}
    cancelLabel={text("room_menu", "cancel")}
    confirmLabel={leavingBusy ? text("room_menu", "leaving") : text("room_menu", "leave")}
    busy={leavingBusy}
    onconfirm={() => leave(target)}
    onclose={() => (leaving = null)}
  >
    {#if leaveError}
      <p class="leave-error sm" role="alert">{text("room_menu", "errors", leaveError)}</p>
    {/if}
  </ConfirmDialog>
{/if}

<style>
  .leave-action {
    flex: none;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .leave-action:hover,
  .leave-action:focus-visible {
    color: var(--colours-danger);
  }

  .leave-error {
    margin: 0;
    color: var(--colours-danger);
  }

  .browse {
    height: 100%;
    background-color: var(--colours-background);
  }

  .header {
    height: 52px;
    flex: none;
    box-sizing: content-box;
    padding: 0 var(--azure-spacing-lg);
    padding-top: env(safe-area-inset-top);
  }

  .title {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .header-icon {
    flex: none;
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
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
  }

  .mobile-only {
    display: none;
  }

  .scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .content {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg) calc(var(--azure-spacing-xl) * 2 + env(safe-area-inset-bottom));
  }

  .search {
    padding: 0 var(--azure-spacing-md);
    min-height: 40px;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-hairline);
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .search:focus-within {
    border-color: color-mix(in oklab, var(--colours-accent) 55%, transparent);
  }

  .search-input {
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background: none;
    border: none;
    outline: none;
    padding: var(--azure-spacing-sm) 0;
  }

  .intro {
    padding: var(--azure-spacing-lg);
    border-radius: var(--azure-radius-lg);
    background: linear-gradient(135deg, var(--colours-accent-soft), var(--colours-accent-faint));
    border: 1px solid color-mix(in oklab, var(--colours-accent) 22%, transparent);
    animation: rise var(--azure-duration-slow) var(--azure-ease-out);
  }

  .intro-icon {
    width: 40px;
    height: 40px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
    box-shadow: 0 0 20px -6px var(--colours-accent-glow);
  }

  .intro-title,
  .intro-body {
    margin: 0;
  }

  .intro-title {
    color: var(--colours-text-strong);
  }

  .close {
    align-self: flex-start;
  }

  .notice {
    margin: 0;
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface);
    border: 1px solid var(--colours-outline-hairline);
  }

  .section {
    gap: var(--azure-spacing-sm);
    padding-left: calc(max(var(--depth, 0) - 1, 0) * var(--azure-spacing-lg));
    animation: rise var(--azure-duration-slow) var(--azure-ease-out) backwards;
  }

  .section-header {
    padding: 0 var(--azure-spacing-sm);
    min-height: 32px;
  }

  .section-title {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--colours-text-faint);
  }

  .section-topic {
    margin: 0;
  }

  .follow {
    flex: none;
  }

  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--azure-radius-lg);
    background-color: var(--colours-surface);
    border: 1px solid var(--colours-outline-hairline);
    overflow: hidden;
  }

  .item-row {
    padding-right: var(--azure-spacing-lg);
    transition: opacity var(--azure-duration-md) var(--azure-ease-out);
  }

  .item-row + .item-row {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .item-row.dim .room-main {
    opacity: 0.55;
  }

  .room-main {
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    text-align: left;
    color: inherit;
    border-radius: 0;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-md) var(--azure-ease-out);
  }

  .item-row {
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .item-row:hover,
  .item-row:focus-within {
    background-color: var(--colours-surface-hover);
  }

  .room-main:disabled {
    cursor: default;
    opacity: 1;
  }

  .hash {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface-raised);
    font-size: var(--text-lg);
  }

  .name {
    color: var(--colours-text-strong);
  }

  .meta {
    display: flex;
    gap: var(--azure-spacing-sm);
  }

  .check {
    flex: none;
    padding: var(--azure-spacing-sm);
    cursor: pointer;
  }

  .check input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--colours-accent);
    cursor: pointer;
  }

  .action {
    flex: none;
    min-height: 32px;
    padding: 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-hairline);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-fast) var(--azure-ease-out);
  }

  .action:not(:disabled):hover {
    background-color: var(--colours-surface-active);
  }

  .action.primary {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
    border-color: transparent;
  }

  .action.primary:hover {
    background-color: color-mix(in oklab, var(--colours-accent) 85%, white);
    box-shadow: 0 0 20px -6px var(--colours-accent-glow);
  }

  .action.failed {
    background-color: var(--colours-danger);
    color: white;
  }

  .action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .blocked {
    flex: none;
    cursor: not-allowed;
  }

  .joined {
    flex: none;
    color: var(--colours-success);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }

  .empty {
    margin: 0;
    padding: var(--azure-spacing-xl) 0;
    text-align: center;
  }

  .row-skeleton {
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
  }

  .skeleton {
    display: block;
    height: 10px;
    border-radius: var(--azure-radius-pill);
    background: linear-gradient(90deg, var(--colours-surface-hover) 20%, color-mix(in oklab, var(--colours-text-faint) 22%, transparent) 50%, var(--colours-surface-hover) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  .skeleton.heading {
    width: 120px;
    margin: var(--azure-spacing-sm);
  }

  .skeleton.avatar {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: var(--azure-radius-md);
  }

  .skeleton.short {
    width: 30%;
  }

  .skeleton.mid {
    width: 65%;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton,
    .spinner {
      animation-duration: 3s;
    }
  }

  @media (max-width: 767px) {
    .mobile-only {
      display: grid;
    }

    .icon {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .content {
      padding-inline: var(--azure-spacing-md);
    }

    .room-main {
      padding: var(--azure-spacing-md);
    }

    .item-row {
      padding-right: var(--azure-spacing-md);
    }

    .action {
      min-height: 36px;
    }

    .check {
      min-width: var(--azure-touch);
      min-height: var(--azure-touch);
      justify-content: center;
    }

    .follow-label {
      display: none;
    }
  }
</style>
