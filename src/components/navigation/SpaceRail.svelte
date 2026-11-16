<script lang="ts">
  import { copied, toastKey, type ToastIcon } from "../../scripts/stores/toast";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { serverNameFromUserId } from "../../scripts/matrix/discovery";
  import type { RoomSummary, Session, SpaceTree } from "../../scripts/matrix/types";
  import { toMatrixTo } from "../../scripts/matrix/utilities/links";
  import { leaveRoom } from "../../scripts/matrix/utilities/membership";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { longpress } from "../../scripts/misc/longpress";
  import { toEntity } from "../../scripts/stores/entities";
  import { markRoomRead, rooms, session, spaces } from "../../scripts/stores/matrix";
  import { HOME, getSpaceRoomIds, navigateAwayFrom, navigation, openBrowse, openRoom, openSpaceMenu, spaceMenu } from "../../scripts/stores/navigation.svelte";
  import JoinDialog from "../app/JoinDialog.svelte";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let activeSession: Session | null = $state.raw(null);
  let roomMap: Record<string, RoomSummary> = $state.raw({});
  let trees: SpaceTree[] = $state.raw([]);

  $effect(() => session.subscribe((value) => (activeSession = value)));
  $effect(() => rooms.subscribe((value) => (roomMap = value)));
  $effect(() => spaces.subscribe((value) => (trees = value)));

  let joining = $state(false);
  let leaving: { spaceId: string; name: string; rooms: string[] } | null = $state.raw(null);
  let confirmDialog: ConfirmDialog | undefined = $state();
  let progress: { done: number; total: number } | null = $state(null);
  let failedCount = $state(0);

  const copy = (value: string, key: string, icon: ToastIcon) => copied(value, key, icon);

  const joinedRoomsOf = (tree: SpaceTree) =>
    [...getSpaceRoomIds(tree), ...tree.categories.map((category) => category.space.roomId)].filter(
      (roomId) => roomMap[roomId]?.membership === "join",
    );

  const openMenu = openSpaceMenu;

  const menuItems = (spaceId: string): MenuItem[] => {
    const tree = trees.find((candidate) => candidate.space.roomId === spaceId);
    if (!tree) return [];
    const entity = toEntity(tree.space, activeSession?.userId);
    const via = activeSession ? [serverNameFromUserId(activeSession.userId)] : [];

    return [
      { id: "read", label: text("space_menu", "mark_read"), icon: MENU_ICONS.read, run: () => (joinedRoomsOf(tree).forEach((roomId) => markRoomRead(roomId)), toastKey("marked_read", { icon: "check", tone: "success" })) },
      { id: "browse", label: text("space_menu", "browse"), icon: MENU_ICONS.browse, run: () => openBrowse(spaceId) },
      { id: "link", label: text("space_menu", "copy_link"), icon: MENU_ICONS.link, run: () => copy(toMatrixTo(entity.alias ?? spaceId, via), "link_copied", "link") },
      { id: "id", label: text("space_menu", "copy_id"), icon: MENU_ICONS.id, run: () => copy(spaceId, "id_copied", "id") },
      {
        id: "leave",
        label: text("space_menu", "leave"),
        icon: MENU_ICONS.leave,
        danger: true,
        run: () => {
          failedCount = 0;
          leaving = { spaceId, name: entity.name, rooms: joinedRoomsOf(tree) };
        },
      },
    ];
  };

  const leaveSpace = async (withRooms: boolean) => {
    if (!activeSession || !leaving || progress) return;
    const ids = withRooms ? [...leaving.rooms, leaving.spaceId] : [leaving.spaceId];
    const left: string[] = [];
    progress = { done: 0, total: ids.length };

    for (const roomId of ids) {
      try {
        await leaveRoom(activeSession, roomId);
        left.push(roomId);
      } catch (error) {
        console.warn("Skye could not leave the room", error);
      }
      progress.done += 1;
    }

    navigateAwayFrom(left);
    failedCount = ids.length - left.length;
    progress = null;
    if (!failedCount) confirmDialog?.dismiss();
  };

  const leaveAllLabel = (count: number) =>
    count === 1 ? text("space_menu", "leave_all_one") : text("space_menu", "leave_all").replace("{count}", count.toLocaleString());

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
  {#each entries as space, index (space.id)}
    {@const active = navigation.spaceId === space.id}
    <button
      class="space ghost press"
      class:active
      class:glow={active}
      use:tooltip={{ text: space.name, placement: "right" }}
      aria-current={active ? "page" : undefined}
      onclick={() => openRoom(space.id)}
      oncontextmenu={(event) => {
        if (space.id === HOME) return;
        event.preventDefault();
        openMenu(space.id, event.clientX, event.clientY);
      }}
      use:longpress={(x, y) => openMenu(space.id, x, y)}
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
        <Avatar name={space.name} url={space.avatar} size="44px" radius={active ? "30%" : "50%"} />
      {/if}
    </button>
    {#if index === 0}
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
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d={MENU_ICONS.add} /></svg>
    </span>
  </button>
</nav>

{#if joining}
  <JoinDialog onclose={() => (joining = false)} />
{/if}

{#if spaceMenu.request}
  {@const menu = spaceMenu.request}
  <MessageMenu items={menuItems(menu.spaceId)} x={menu.x} y={menu.y} label={text("space_menu", "actions")} minWidth={menu.width} onclose={() => (spaceMenu.request = null)} />
{/if}

{#if leaving}
  {@const target = leaving}
  <ConfirmDialog
    bind:this={confirmDialog}
    title={text("space_menu", "leave_title").replace("{name}", target.name)}
    body={text("space_menu", "leave_body")}
    cancelLabel={text("space_menu", "cancel")}
    busy={!!progress}
    onclose={() => (leaving = null)}
  >
    {#if progress}
      <p class="sm muted" role="status">{text("space_menu", "progress").replace("{done}", String(progress.done)).replace("{total}", String(progress.total))}</p>
      <progress class="meter" value={progress.done} max={progress.total}></progress>
    {:else if failedCount}
      <p class="sm danger-text" role="alert">{text("space_menu", "failed").replace("{count}", String(failedCount))}</p>
    {/if}
    <div class="leave-options col gap-sm">
      {#if target.rooms.length}
        <button type="button" class="dialog-button ghost press sm bold danger" disabled={!!progress} onclick={() => leaveSpace(true)}>{leaveAllLabel(target.rooms.length)}</button>
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="dialog-button ghost press sm bold danger" disabled={!!progress} autofocus onclick={() => leaveSpace(false)}>{text("space_menu", "leave_only")}</button>
    </div>
    {#snippet actions()}{/snippet}
  </ConfirmDialog>
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

  .meter {
    width: 100%;
    height: 6px;
    accent-color: var(--colours-accent);
  }

  .danger-text {
    margin: 0;
    color: var(--colours-danger);
  }

  .sm.muted {
    margin: 0;
  }

  .leave-options {
    align-items: stretch;
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
