<script lang="ts">
  import { toastKey } from "../../scripts/stores/toast";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { RoomSummary, Session, SpaceTree } from "../../scripts/matrix/types";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { longpress } from "../../scripts/misc/longpress";
  import { toEntity } from "../../scripts/stores/entities";
  import { directMessages, markAsRead, rooms, session, spaces } from "../../scripts/stores/matrix";
  import { entityText, openEntityMenu } from "../../scripts/misc/entitymenu.svelte";
  import { get } from "svelte/store";
  import { HOME, getHomeRoomIds, navigation, openRoom, openRoomMenu, openSpaceMenu, spaceMenu } from "../../scripts/stores/navigation.svelte";
  import JoinDialog from "../app/JoinDialog.svelte";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import { spaceActions } from "../../scripts/menus/space";
  import Avatar from "../ui/Avatar.svelte";
  import BadgeCut from "../ui/BadgeCut.svelte";
  import { spaceUnread, unreadDirects, type SpaceUnread } from "../../scripts/stores/unread";
  import Skeleton from "../ui/Skeleton.svelte";
  import { synced } from "../../scripts/stores/matrix";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let activeSession: Session | null = $state.raw(null);
  let roomMap: Record<string, RoomSummary> = $state.raw({});
  let trees: SpaceTree[] = $state.raw([]);

  $effect(() => session.subscribe((value) => (activeSession = value)));
  $effect(() => rooms.subscribe((value) => (roomMap = value)));
  $effect(() => spaces.subscribe((value) => (trees = value)));

  let spaceState: Record<string, SpaceUnread> = $state.raw({});
  let dmList: { room: RoomSummary; count: number }[] = $state.raw([]);

  $effect(() => spaceUnread.subscribe((value) => (spaceState = value)));
  $effect(() => unreadDirects.subscribe((value) => (dmList = value)));

  const shownDirects = $derived(dmList.slice(0, 5));

  const dmName = (room: RoomSummary) => toEntity(room, activeSession?.userId).name.replace(/^@([^:]+):.*$/, "$1");

  const unreadLabel = (count: number) => text("navigation", "unread_count").replace("{count}", count.toLocaleString());

  const pop = (node: Element, { out = false } = {}) => ({
    duration: out ? 220 : 320,
    css: (t: number) =>
      out
        ? `max-height:${t * 52}px;opacity:${t};transform:scale(${0.6 + 0.4 * t})`
        : `transform:scale(${t < 0.7 ? (t / 0.7) * 1.12 : 1.12 - ((t - 0.7) / 0.3) * 0.12});opacity:${Math.min(1, t * 2)}`,
  });

  let joining = $state(false);

  const openMenu = openSpaceMenu;

  const homeItems = (): MenuItem[] => [
    { id: "home-dms", label: entityText("mark_dms_read"), icon: MENU_ICONS.read, disabled: !dmList.length, run: () => (get(directMessages).forEach(({ roomId }) => markAsRead(roomId)), toastKey("marked_read", { icon: "check", tone: "success" })) },
    { id: "home-all", label: entityText("mark_home_read"), icon: MENU_ICONS.read, run: () => (getHomeRoomIds().forEach((roomId) => markAsRead(roomId)), toastKey("marked_read", { icon: "check", tone: "success" })) },
  ];

  const openAny = (spaceId: string, x: number, y: number) =>
    spaceId === HOME ? openEntityMenu(homeItems(), x, y) : openMenu(spaceId, x, y);


  const entries = $derived([
    { id: HOME, name: getLocalisedText(undefined, "navigation", "home") as string, avatar: undefined },
    ...$spaces.map(({ space }) => ({
      id: space.roomId,
      name: space.name ?? space.roomId,
      avatar: space.avatarUrl,
    })),
  ]);
</script>

<nav class="rail col align-centre gap-sm" aria-label={getLocalisedText(undefined, "navigation", "spaces")}>
  {#if !$synced && !entries.length}<Skeleton kind="rail" count={6} />{/if}
  {#each entries as space, index (space.id)}
    {@const active = navigation.spaceId === space.id}
    {@const flags = spaceState[space.id]}
    <button
      class="space ghost press"
      class:active
      class:has-unread={space.id !== HOME && (flags?.unread || !!flags?.mentions)}
      class:glow={active}
      use:tooltip={{ text: space.name, placement: "right" }}
      aria-current={active ? "page" : undefined}
      onclick={() => openRoom(space.id)}
      oncontextmenu={(event) => {
        event.preventDefault();
        openAny(space.id, event.clientX, event.clientY);
      }}
      use:longpress={(x, y) => openAny(space.id, x, y)}
    >
      <span class="pill" aria-hidden="true"></span>
      {#if space.id === HOME}
        <span class="home centre row">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-4.4 3.5A1 1 0 0 1 4 19.7V5.5Z"
            />
          </svg>
        </span>
      {:else}
        <BadgeCut count={flags?.mentions ?? 0} label={text("navigation", "mention_count").replace("{count}", String(flags?.mentions ?? 0))}>
          <Avatar name={space.name} url={space.avatar} size="44px" radius={active ? "30%" : "50%"} />
        </BadgeCut>
      {/if}
    </button>
    {#if index === 0}
      {#each shownDirects as item (item.room.roomId)}
        {@const name = dmName(item.room)}
        {@const entity = toEntity(item.room, activeSession?.userId)}
        <div class="dm-slot" in:pop out:pop={{ out: true }}>
          <button
            class="space dm-unread ghost press has-unread"
            use:tooltip={{ text: name, placement: "right" }}
            aria-label={`${name}, ${unreadLabel(item.count)}`}
            onclick={() => openRoom(HOME, item.room.roomId)}
            oncontextmenu={(event) => {
              event.preventDefault();
              openRoomMenu(item.room.roomId, event.clientX, event.clientY);
            }}
            use:longpress={(x, y) => openRoomMenu(item.room.roomId, x, y)}
          >
            <span class="pill" aria-hidden="true"></span>
            <BadgeCut count={item.count} label={unreadLabel(item.count)}>
              <Avatar name={name} url={entity.avatar} size="44px" radius="50%" />
            </BadgeCut>
          </button>
        </div>
      {/each}
      <hr class="divider" />
    {/if}
  {/each}
  <button
    class="space add ghost press"
    use:tooltip={{ text: text("navigation", "add"), placement: "right" }}
    aria-label={text("navigation", "add")}
    aria-haspopup="dialog"
    onclick={() => (joining = true)}
  >
    <span class="pill" aria-hidden="true"></span>
    <span class="plus centre row">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
    </span>
  </button>
</nav>

{#if joining}
  <JoinDialog onclose={() => (joining = false)} />
{/if}

{#if spaceMenu.request}
  {@const menu = spaceMenu.request}
  <MessageMenu items={spaceActions(menu.spaceId)} x={menu.x} y={menu.y} label={text("space_menu", "actions")} minWidth={menu.width} onclose={() => (spaceMenu.request = null)} />
{/if}

<style>
  .rail {
    width: 68px;
    flex: none;
    border-right: 1px solid var(--colours-outline-hairline);
    padding: var(--azure-spacing-md) 0;
    padding-top: max(var(--azure-spacing-md), env(safe-area-inset-top));
    padding-left: env(safe-area-inset-left);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    overscroll-behavior: contain;
    background-color: var(--colours-foreground);
  }

  .space {
    position: relative;
    width: 68px;
    display: flex;
    justify-content: center;
  }

  .space:active {
    transform: translateY(1px);
  }

  .pill {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 8px;
    border-radius: 0 var(--azure-radius-pill) var(--azure-radius-pill) 0;
    background-color: var(--colours-text-strong);
    transform: translate(-100%, -50%);
    transition:
      height var(--azure-duration-md) var(--azure-ease-spring),
      transform var(--azure-duration-md) var(--azure-ease-out);
  }

  .space:hover .pill {
    transform: translate(0, -50%);
    height: 20px;
  }

  .space.has-unread .pill {
    transform: translate(0, -50%);
  }

  .dm-slot {
    width: 68px;
    overflow: visible;
  }

  .space.active .pill {
    transform: translate(0, -50%);
    height: 36px;
    background-color: var(--colours-accent);
  }

  .home {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--colours-text);
    background-color: var(--colours-surface-raised);
    transition:
      border-radius var(--azure-duration-md) var(--azure-ease-out),
      background-color var(--azure-duration-md) var(--azure-ease-out),
      color var(--azure-duration-md) var(--azure-ease-out);
  }

  .space:hover .home,
  .space.active .home {
    border-radius: 30%;
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .plus {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--colours-accent);
    background-color: var(--colours-surface-raised);
    transition:
      border-radius var(--azure-duration-md) var(--azure-ease-out),
      background-color var(--azure-duration-md) var(--azure-ease-out),
      color var(--azure-duration-md) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-out);
  }

  .add:hover .plus,
  .add:focus-visible .plus {
    border-radius: 30%;
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
    box-shadow: 0 0 20px -6px var(--colours-accent-glow);
  }

  .add:hover .pill {
    transform: translate(-100%, -50%);
  }



  .sm.muted {
    margin: 0;
  }


  .divider {
    width: 28px;
    height: 2px;
    margin: var(--azure-spacing-xs) 0;
    border: 0;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-outline-hairline);
  }
</style>
