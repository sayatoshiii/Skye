<script lang="ts">
  import { ignoredUsers } from "../../scripts/stores/ignored";
  import { copied, toastKey, type ToastIcon } from "../../scripts/stores/toast";
  import { tooltip } from "../../scripts/misc/tooltip";
  import EmojiText from "../ui/EmojiText.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getOrphanRooms } from "../../scripts/matrix/rooms";
  import type { RoomSummary } from "../../scripts/matrix/types";
  import { toEntity } from "../../scripts/stores/entities";
  import { dismissNotificationPrompt, enableNotifications, formatCount, notificationPrompt } from "../../scripts/stores/unread";
  import { directMessages, markAsRead, markUnread, rooms, session, spaces } from "../../scripts/stores/matrix";
  import { HOME, navigateAwayFrom, navigation, openBrowse, openRoom, openRoomMenu, openSpaceMenu, roomMenu } from "../../scripts/stores/navigation.svelte";
  import { hiddenRooms, setRoomsHidden } from "../../scripts/stores/hidden";
  import { serverNameFromUserId } from "../../scripts/matrix/discovery";
  import { toMatrixTo } from "../../scripts/matrix/utilities/links";
  import { joinRoom } from "../../scripts/matrix/utilities/hierarchy";
  import { addDirectRoom, describeMembershipError, forgetRoom, leaveRoom, type MembershipError } from "../../scripts/matrix/utilities/membership";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { SETTINGS_ICONS } from "../settings/icons";
  import { pushRules, roomLevel, setRoomLevel } from "../../scripts/stores/pushrules";
  import { longpress } from "../../scripts/misc/longpress";
  import { entityText, menu as entityMenu } from "../../scripts/misc/entitymenu.svelte";
  import { userMenuItems } from "../../scripts/misc/usermenu";
  import type { RoomEntity } from "../../scripts/stores/entities";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import PresenceDot from "../ui/PresenceDot.svelte";
  import { statusTextOf } from "../../scripts/stores/presence";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  let { onpick }: { onpick?: () => void } = $props();

  const COLLAPSE_STORAGE_KEY = "skye:collapsed";

  const loadCollapsed = (): Record<string, boolean> => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  };

  let collapsed = $state(loadCollapsed());

  const toggle = (id: string) => {
    collapsed[id] = !collapsed[id];
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {}
  };

  const setCollapsed = (ids: string[], value: boolean) => {
    ids.forEach((id) => (collapsed[id] = value));
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {}
  };

  const categoryItems = (category: (typeof categories)[number]): MenuItem[] => {
    const ids = categories.filter((entry) => entry.collapsible).map((entry) => entry.id);
    const shut = !!collapsed[category.id];
    return [
      { id: "category-read", label: entityText("mark_category_read"), icon: MENU_ICONS.read, run: () => (category.rooms.forEach((room) => markAsRead(room.id)), toastKey("marked_read", { icon: "check", tone: "success" })) },
      ...(category.collapsible
        ? [
            { id: "category-toggle", label: entityText(shut ? "expand" : "collapse"), icon: shut ? MENU_ICONS.expand : MENU_ICONS.collapse, separated: true, run: () => toggle(category.id) },
            { id: "category-collapse-all", label: entityText("collapse_all"), icon: MENU_ICONS.collapse, run: () => setCollapsed(ids, true) },
            { id: "category-expand-all", label: entityText("expand_all"), icon: MENU_ICONS.expand, run: () => setCollapsed(ids, false) },
          ]
        : []),
    ];
  };

  const inviteItems = (invite: ReturnType<typeof inviteInfo>): MenuItem[] => [
    { id: "invite-accept", label: text("navigation", "invite_accept"), icon: MENU_ICONS.read, disabled: inviteBusy === invite.entity.id, run: () => respond(invite, true) },
    { id: "invite-decline", label: text("navigation", "invite_decline"), icon: MENU_ICONS.close, danger: true, disabled: inviteBusy === invite.entity.id, run: () => respond(invite, false) },
    { id: "invite-id", label: text("room_menu", "copy_id"), icon: MENU_ICONS.id, separated: true, run: () => copied(invite.entity.id, "id_copied", "id") },
  ];

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  let hidden: Record<string, string[]> = $state.raw({});

  $effect(() => hiddenRooms.subscribe((value) => (hidden = value)));

  const hiddenSet = $derived(new Set(hidden[navigation.spaceId] ?? []));

  const resolveRooms = (list: RoomSummary[]) =>
    list
      .filter((room) => room.membership === "join")
      .filter(
        (room) =>
          !hiddenSet.has(room.roomId) ||
          room.highlightCount > 0 ||
          room.roomId === navigation.roomId,
      )
      .map((room) => toEntity(room, $session?.userId));

  const tree = $derived($spaces.find(({ space }) => space.roomId === navigation.spaceId));
  const space = $derived(tree && toEntity(tree.space, $session?.userId));

  const categories = $derived.by(() => {
    if (!tree) {
      const orphans = resolveRooms(getOrphanRooms($rooms));

      return [
        {
          id: HOME,
          name: text("navigation", "direct_messages"),
          rooms: resolveRooms($directMessages),
          collapsible: false,
        },
        ...(orphans.length
          ? [
              {
                id: `${HOME}:rooms`,
                name: text("navigation", "rooms"),
                rooms: orphans,
                collapsible: true,
              },
            ]
          : []),
      ];
    }

    return [
      ...(tree.rooms.length
        ? [
            {
              id: `${tree.space.roomId}:loose`,
              name: text("navigation", "uncategorised"),
              rooms: resolveRooms(tree.rooms),
              collapsible: true,
            },
          ]
        : []),
      ...tree.categories.map((category) => ({
        id: category.space.roomId,
        name: toEntity(category.space, $session?.userId).name,
        rooms: resolveRooms(category.rooms),
        collapsible: true,
      })),
    ];
  });

  const inviteInfo = (room: RoomSummary) => {
    const own = room.state["m.room.member"]?.[$session?.userId ?? ""];
    const inviter = own?.sender;
    const profile = inviter ? room.state["m.room.member"]?.[inviter]?.content : undefined;
    const direct = own?.content?.is_direct === true && !!inviter;
    const entity = toEntity(room, $session?.userId);
    return {
      entity,
      inviter,
      direct,
      name: direct ? ((profile?.displayname as string | undefined) ?? inviter!) : entity.name,
    };
  };

  const invites = $derived(
    tree ? [] : Object.values($rooms).filter((room) => room.membership === "invite").map(inviteInfo).filter((invite) => !$ignoredUsers.has(invite.inviter ?? "")),
  );
  let inviteBusy: string | null = $state(null);

  const respond = async (invite: ReturnType<typeof inviteInfo>, accept: boolean) => {
    if (!$session || inviteBusy) return;
    const id = invite.entity.id;
    inviteBusy = id;
    try {
      if (accept) {
        await joinRoom($session, id, []);
        if (invite.direct && invite.inviter) await addDirectRoom($session, invite.inviter, id).catch(() => undefined);
        openRoom(HOME, id);
        onpick?.();
      } else await leaveRoom($session, id);
    } catch {
      toastKey(accept ? "join_failed" : "decline_failed", { icon: "leave", tone: "danger" });
    } finally {
      inviteBusy = null;
    }
  };

  const empty = $derived(invites.length === 0 && categories.every((category) => category.rooms.length === 0));

  const browse = () => {
    openBrowse(navigation.spaceId);
    onpick?.();
  };

  const menu = $derived.by(() => {
    const request = roomMenu.request;
    const summary = request && $rooms[request.roomId];
    return request && summary ? { room: toEntity(summary, $session?.userId), x: request.x, y: request.y } : null;
  });
  let confirming: { room: RoomEntity; forget: boolean } | null = $state(null);
  let leavingBusy = $state(false);
  let confirmDialog: ConfirmDialog | undefined = $state();
  let leaveError: MembershipError | null = $state(null);

  const copy = (value: string, key: string, icon: ToastIcon) => copied(value, key, icon);

  const openMenu = (room: RoomEntity, x: number, y: number) => openRoomMenu(room.id, x, y);

  const leave = async (room: RoomEntity, forget: boolean) => {
    if (!$session || leavingBusy) return;
    leavingBusy = true;
    leaveError = null;

    try {
      await leaveRoom($session, room.id);
      if (forget) await forgetRoom($session, room.id).catch((error) => console.warn("Skye could not forget the room", error));
      navigateAwayFrom([room.id]);
      confirmDialog?.dismiss();
    } catch (error) {
      leaveError = describeMembershipError(error);
      if (!confirming) confirming = { room, forget };
    } finally {
      leavingBusy = false;
    }
  };

  const askLeave = (room: RoomEntity, event: MouseEvent | KeyboardEvent) => {
    leaveError = null;
    if (event.shiftKey) return void leave(room, false);
    confirming = { room, forget: false };
  };

  const NOTIFY_ICONS = { all: SETTINGS_ICONS.notifications, mentions: MENU_ICONS.mention, mute: MENU_ICONS.mute };

  const menuItems = (room: RoomEntity): MenuItem[] => {
    const via = $session ? [serverNameFromUserId($session.userId)] : [];
    const inSpace = navigation.spaceId !== HOME;

    const user = room.isDirect && room.directUserId ? userMenuItems(room.directUserId, room.id).filter((item) => !item.separated && !item.danger) : [];

    return [
      ...user,
      { id: "read", label: text("room_menu", "mark_read"), icon: MENU_ICONS.read, separated: user.length > 0, run: () => (markAsRead(room.id), toastKey("marked_read", { icon: "check", tone: "success" })) },
      { id: "unread", label: text("room_menu", "mark_unread"), icon: MENU_ICONS.unread, run: () => markUnread(room.id) && toastKey("marked_unread", { icon: "unread", tone: "accent" }) },
      ...(["all", "mentions", "mute"] as const).map((level, index) => ({ id: `notify-${level}`, label: text("room_menu", `notify_${level}`), icon: NOTIFY_ICONS[level], selected: roomLevel($pushRules, room.id) === level, separated: index === 0, run: () => setRoomLevel(room.id, level) })),
      { id: "link", label: text("room_menu", "copy_link"), separated: true, icon: MENU_ICONS.link, run: () => copy(toMatrixTo(room.alias ?? room.id, via), "link_copied", "link") },
      { id: "id", label: text("room_menu", "copy_id"), icon: MENU_ICONS.id, run: () => copy(room.id, "id_copied", "id") },
      ...(inSpace
        ? [{ id: "hide", label: text("room_menu", "hide"), icon: MENU_ICONS.hide, run: () => (setRoomsHidden(navigation.spaceId, [room.id], true), toastKey("hidden", { icon: "hide", tone: "danger" })) }]
        : []),
      { id: "leave", label: text("room_menu", "leave"), icon: MENU_ICONS.leave, danger: true, run: (event) => askLeave(room, event) },
    ];
  };

  const pick = (roomId: string) => {
    openRoom(navigation.spaceId, roomId);
    onpick?.();
  };
</script>

<section class="channels col min-0">
  <header class="header row-nw align-centre hairline-b">
    {#if tree}
      {@const spaceId = tree.space.roomId}
      <button
        type="button"
        class="title-button ghost row-nw align-centre gap-sm flex-max min-0"
        aria-haspopup="menu"
        onclick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openSpaceMenu(spaceId, rect.left + 8, rect.bottom + 4, rect.width - 16);
        }}
        oncontextmenu={(event) => {
          event.preventDefault();
          openSpaceMenu(spaceId, event.clientX, event.clientY);
        }}
      >
        <h1 class="title bold md truncate flex-max">{space?.name}</h1>
        <svg class="title-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>
      </button>
    {:else}
      <h1 class="title bold md truncate">{text("navigation", "home")}</h1>
    {/if}
  </header>

  <div class="list col flex-max min-0">
    {#if $notificationPrompt}
      <div class="notify-banner col gap-xs" role="region" aria-label={text("notifications", "prompt")}>
        <p class="sm bold">{text("notifications", "prompt")}</p>
        <p class="xs muted">{text("notifications", "prompt_body")}</p>
        <div class="notify-actions row-nw gap-sm">
          <button type="button" class="notify-enable press xs bold" onclick={enableNotifications}>{text("notifications", "enable")}</button>
          <button type="button" class="notify-later ghost press xs" onclick={dismissNotificationPrompt}>{text("notifications", "later")}</button>
        </div>
      </div>
    {/if}
    {#if tree}
      <button
        class="room browse item ghost press row-nw align-centre gap-sm md"
        aria-current={navigation.browsing ? "page" : undefined}
        onclick={browse}
      >
        <svg class="browse-icon faint" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 6h10M4 12h7M4 18h10" />
          <circle cx="17" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="2" />
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m19.4 15.4 2 2" />
        </svg>
        <span class="truncate flex-max">{text("navigation", "browse")}</span>
      </button>
    {/if}
    {#if invites.length}
      <div class="category col">
        <h2 class="category-toggle category-label truncate">{text("navigation", "invites")}</h2>
        <ul class="col">
          {#each invites as invite (invite.entity.id)}
            <li class="notify-banner col gap-xs" use:entityMenu={() => inviteItems(invite)}>
              <p class="sm bold truncate"><EmojiText text={invite.name} /></p>
              <div class="notify-actions row-nw gap-sm">
                <button type="button" class="notify-enable press xs bold" disabled={inviteBusy === invite.entity.id} onclick={() => respond(invite, true)}>{text("navigation", "invite_accept")}</button>
                <button type="button" class="notify-later ghost press xs" disabled={inviteBusy === invite.entity.id} onclick={() => respond(invite, false)}>{text("navigation", "invite_decline")}</button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if empty}
      <p class="empty sm faint">{text("navigation", tree ? "empty_space" : "empty_home")}</p>
    {/if}
    {#each categories as category (category.id)}
      {#if category.rooms.length}
      {@const collapsible = category.collapsible}
      {@const isCollapsed = collapsible && collapsed[category.id]}
      <div class="category col">
        {#if !collapsible}
          <h2 class="category-toggle category-label truncate" use:entityMenu={() => categoryItems(category)}>{category.name}</h2>
        {:else}
        <button
          class="category-toggle ghost press row-nw align-centre gap-xs"
          aria-expanded={!isCollapsed}
          onclick={() => toggle(category.id)}
          use:entityMenu={() => categoryItems(category)}
        >
          <svg class="chevron" class:collapsed={isCollapsed} viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
          </svg>
          <span class="truncate">{category.name}</span>
        </button>
        {/if}

        <div class="rooms" class:collapsed={isCollapsed}>
          <ul class="col">
            {#each category.rooms as room (room.id)}
              {@const active = navigation.roomId === room.id}
              {@const lit = room.hasUnread && !room.quiet}
              {@const count = room.isDirect && !room.quiet ? Math.max(room.unread, room.mentions) : room.mentions}
              {@const hidden = isCollapsed && !active && !lit && !room.mentions}
                <li class="room-slot" class:hidden inert={hidden}>
                  <span class="unread-pill" class:lit={lit && !active} aria-hidden="true"></span>
                  <div class="room-inner">
                  <button
                    class="room item ghost press row-nw align-centre gap-sm md"
                    class:direct={room.isDirect}
                    class:unread={lit || room.mentions > 0}
                    class:silenced={room.muted && !room.mentions}
                    aria-current={active ? "page" : undefined}
                    onclick={() => pick(room.id)}
                    oncontextmenu={(event) => {
                      event.preventDefault();
                      openMenu(room, event.clientX, event.clientY);
                    }}
                    use:longpress={(x, y) => openMenu(room, x, y)}
                  >
                    {#if room.isDirect}
                      {@const status = $statusTextOf(room.directUserId)}
                      {@const shown = room.name.startsWith("@") ? room.name.slice(1).split(":")[0] : room.name}
                      <PresenceDot userId={room.directUserId} size={32}>
                        <Avatar name={shown} url={room.avatar} size="32px" radius="50%" />
                      </PresenceDot>
                      <span class="dm-text col flex-max min-0" use:tooltip={room.directUserId}>
                        <span class="dm-name truncate"><EmojiText text={shown} /></span>
                        {#if status}
                          <span class="dm-status xs muted truncate"><EmojiText text={status} /></span>
                        {/if}
                      </span>
                    {:else}
                      <span class="hash faint" aria-hidden="true">#</span>
                      <span class="truncate flex-max"><EmojiText text={room.name} /></span>
                    {/if}
                    <svg class="mute-icon faint" class:shown={room.muted} viewBox="0 0 24 24" width="14" height="14" aria-label={text("room_menu", "muted")} aria-hidden={!room.muted}><path fill="currentColor" d={MENU_ICONS.mute} /></svg>
                    {#if count > 0 && (!room.quiet || room.mentions)}
                      <span class="count-badge xs bold" aria-label={text("navigation", "unread_count").replace("{count}", String(count))}>{formatCount(count)}</span>
                    {/if}
                  </button>
                  </div>
                </li>
            {/each}
          </ul>
        </div>
      </div>
      {/if}
    {/each}
  </div>
</section>

{#if menu}
  <MessageMenu items={menuItems(menu.room)} x={menu.x} y={menu.y} label={text("room_menu", "actions")} onclose={() => (roomMenu.request = null)} />
{/if}

{#if confirming}
  {@const target = confirming}
  <ConfirmDialog
    bind:this={confirmDialog}
    title={text("room_menu", "leave_title").replace("{name}", target.room.name)}
    body={text("room_menu", "leave_body")}
    cancelLabel={text("room_menu", "cancel")}
    confirmLabel={leavingBusy ? text("room_menu", "leaving") : text("room_menu", "leave")}
    busy={leavingBusy}
    onconfirm={() => leave(target.room, target.forget)}
    onclose={() => (confirming = null)}
  >
    {#if target.room.isDirect}
      <label class="forget row-nw align-centre gap-sm sm">
        <input type="checkbox" bind:checked={confirming.forget} disabled={leavingBusy} />
        <span>{text("room_menu", "forget")}</span>
      </label>
    {/if}
    {#if leaveError}
      <p class="leave-error sm" role="alert">{text("room_menu", "errors", leaveError)}</p>
    {/if}
  </ConfirmDialog>
{/if}

<style>
  .channels {
    height: 100%;
    background-color: var(--colours-foreground);
    border-right: 1px solid var(--colours-outline-hairline);
  }

  .header {
    height: 52px;
    flex: none;
    padding: 0 var(--azure-spacing-lg);
  }

  .title {
    margin: 0;
    color: var(--colours-text-strong);
    text-align: left;
  }

  .title-button {
    align-self: stretch;
    margin: 0 calc(var(--azure-spacing-lg) * -1);
    padding: 0 var(--azure-spacing-lg);
    border-radius: 0;
  }

  .title-button:hover {
    background-color: var(--colours-surface-hover);
  }

  .title-button > * {
    transition: transform var(--azure-duration-fast) var(--azure-ease-out);
  }

  .title-button:active > * {
    transform: scale(0.95);
  }

  .title-button:active {
    background-color: var(--colours-surface-active);
  }

  .title-chevron {
    flex: none;
    color: var(--colours-text-muted);
  }

  .list {
    padding: var(--azure-spacing-md) var(--azure-spacing-sm);
    gap: var(--azure-spacing-lg);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .category-toggle {
    width: 100%;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--colours-text-faint);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .category-label {
    margin: 0;
    padding-left: var(--azure-spacing-md);
  }

  .category-toggle:not(.category-label):hover {
    color: var(--colours-text);
  }

  .chevron {
    flex: none;
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  ul {
    list-style: none;
    margin: var(--azure-spacing-xs) 0 0;
    padding: 0;
  }

  .room {
    width: 100%;
    min-height: 34px;
    padding: var(--azure-spacing-xs) var(--azure-spacing-md);
    text-align: left;
  }

  .room.direct {
    min-height: 48px;
    padding: 6px 10px;
    gap: 12px;
    border-radius: 8px;
  }

  .room.direct[aria-current="page"] {
    color: var(--colours-text-strong);
  }

  .dm-name {
    font-size: 14px;
    font-weight: 500;
    line-height: 18px;
  }

  .room.unread .dm-name,
  .room.direct[aria-current="page"] .dm-name {
    color: var(--colours-text-strong);
  }

  .dm-text {
    gap: 1px;
  }

  .dm-status {
    font-size: 11px;
    line-height: 14px;
    color: var(--colours-text-muted);
  }

  .room-slot:has(.direct) .room-inner {
    padding-block: 1px;
  }

  .room.unread {
    color: var(--colours-text-strong);
    font-weight: 600;
  }

  .room-slot {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    transition:
      grid-template-rows var(--azure-duration-md) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .room-slot.hidden .room-inner {
    padding-block: 0;
  }

  .room-slot.hidden {
    grid-template-rows: 0fr;
    opacity: 0;
  }

  .room-inner {
    min-height: 0;
    overflow: hidden;
    padding-block: 3px;
    transition: padding-block var(--azure-duration-md) var(--azure-ease-out);
  }

  .notify-banner {
    margin: 0 0 var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-lg);
    background-color: var(--colours-accent-faint);
    border: 1px solid var(--colours-outline-hairline);
  }

  .notify-banner p {
    margin: 0;
  }

  .notify-banner .xs {
    line-height: 1.45;
  }

  .notify-actions {
    margin-top: var(--azure-spacing-sm);
  }

  .notify-enable,
  .notify-later {
    padding: 6px 14px;
    border-radius: var(--azure-radius-md);
  }

  .notify-enable {
    border: 0;
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .empty {
    margin: 0;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
  }

  .forget {
    cursor: pointer;
    color: var(--colours-text);
  }

  .forget input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--colours-accent);
  }

  .leave-error {
    margin: 0;
    color: var(--colours-danger);
  }

  .browse {
    margin-bottom: var(--azure-spacing-xs);
  }

  .mute-icon {
    flex-shrink: 0;
    width: 0;
    opacity: 0;
    transform: scale(0.6);
    transition: width var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1), opacity var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1), transform var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .mute-icon.shown {
    width: 14px;
    opacity: 1;
    transform: scale(1);
  }

  .browse-icon {
    width: 16px;
    flex: none;
  }

  .hash {
    width: 16px;
    text-align: center;
    font-size: var(--text-lg);
  }

  .count-badge {
    flex: none;
    min-width: 18px;
    padding: 1px 6px;
    border-radius: var(--azure-radius-pill);
    text-align: center;
    color: white;
    background-color: var(--colours-danger);
    animation: badge-pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  @keyframes badge-pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }

  .room-slot {
    position: relative;
  }

  .unread-pill {
    position: absolute;
    left: calc(-1 * var(--azure-spacing-sm));
    top: 50%;
    width: 4px;
    height: 8px;
    border-radius: 0 var(--azure-radius-pill) var(--azure-radius-pill) 0;
    background-color: var(--colours-text-strong);
    transform: translate(-100%, -50%);
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
    pointer-events: none;
  }

  .unread-pill.lit {
    transform: translate(0, -50%);
  }

  .room.silenced {
    opacity: 0.5;
  }

  .room.silenced.unread {
    font-weight: inherit;
  }

  @media (max-width: 767px) {
    .room {
      min-height: var(--azure-touch);
    }
  }
</style>
