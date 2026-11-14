<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import {
    getDirectRooms,
    getRoom,
    getSpace,
    getSpaceRoomIds,
    type PlaceholderRoom,
  } from "../../scripts/stores/placeholder";
  import { HOME, navigation, openRoom } from "../../scripts/stores/navigation.svelte";
  import Avatar from "../ui/Avatar.svelte";

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

  const resolveRooms = (ids: string[]) =>
    ids.map(getRoom).filter(Boolean) as PlaceholderRoom[];

  const space = $derived(getSpace(navigation.spaceId));

  const categories = $derived.by(() => {
    if (!space)
      return [
        {
          id: HOME,
          name: getLocalisedText(undefined, "navigation", "direct_messages") as string,
          rooms: getDirectRooms(),
          collapsible: false,
        },
      ];

    const loose = space.children.filter((child) => typeof child === "string");
    const nested = space.children.filter((child) => typeof child !== "string");

    return [
      ...(loose.length
        ? [
            {
              id: `${space.id}:loose`,
              name: getLocalisedText(undefined, "navigation", "uncategorised") as string,
              rooms: resolveRooms(loose),
              collapsible: true,
            },
          ]
        : []),
      ...nested.map((child) => ({
        id: child.id,
        name: child.name,
        rooms: resolveRooms(getSpaceRoomIds(child)),
        collapsible: true,
      })),
    ];
  });

  const pick = (roomId: string) => {
    openRoom(navigation.spaceId, roomId);
    onpick?.();
  };
</script>

<section class="channels col min-0">
  <header class="header row-nw align-centre hairline-b">
    <h1 class="title bold md truncate">
      {space?.name ?? getLocalisedText(undefined, "navigation", "direct_messages")}
    </h1>
  </header>

  <div class="list col flex-max min-0">
    {#each categories as category (category.id)}
      {@const collapsible = category.collapsible}
      {@const isCollapsed = collapsible && collapsed[category.id]}
      <div class="category col">
        {#if !collapsible}
          <h2 class="category-toggle category-label truncate">{category.name}</h2>
        {:else}
        <button
          class="category-toggle ghost press row-nw align-centre gap-xs"
          aria-expanded={!isCollapsed}
          onclick={() => toggle(category.id)}
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
              {@const hidden = isCollapsed && !active && !room.unread && !room.mentions}
                <li class="room-slot" class:hidden inert={hidden}>
                  <div class="room-inner">
                  <button
                    class="room item ghost press row-nw align-centre gap-sm md"
                    class:unread={room.unread || room.mentions}
                    aria-current={active ? "page" : undefined}
                    onclick={() => pick(room.id)}
                  >
                    {#if room.isDirect}
                      <Avatar name={room.name} url={room.avatar} size="28px" radius="50%" />
                    {:else}
                      <span class="hash faint" aria-hidden="true">#</span>
                    {/if}
                    <span class="truncate flex-max">{room.name}</span>
                    {#if room.mentions}
                      <span class="badge xs bold">{room.mentions}</span>
                    {/if}
                  </button>
                  </div>
                </li>
            {/each}
          </ul>
        </div>
      </div>
    {/each}
  </div>
</section>

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

  .room-slot.hidden {
    grid-template-rows: 0fr;
    opacity: 0;
  }

  .room-inner {
    min-height: 0;
    overflow: hidden;
    padding-block: 3px;
  }

  .hash {
    width: 16px;
    text-align: center;
    font-size: var(--text-lg);
  }

  .badge {
    min-width: 18px;
    padding: 1px 6px;
    border-radius: var(--azure-radius-pill);
    text-align: center;
    color: white;
    background-color: var(--colours-danger);
  }

  @media (max-width: 767px) {
    .room {
      min-height: var(--azure-touch);
    }
  }
</style>
