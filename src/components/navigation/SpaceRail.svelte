<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { spaces } from "../../scripts/stores/placeholder";
  import { HOME, navigation, openRoom } from "../../scripts/stores/navigation.svelte";
  import Avatar from "../ui/Avatar.svelte";

  const entries = $derived([
    { id: HOME, name: getLocalisedText(undefined, "navigation", "home") as string, avatar: undefined },
    ...spaces,
  ]);
</script>

<nav class="rail col align-centre gap-sm" aria-label={getLocalisedText(undefined, "navigation", "spaces")}>
  {#each entries as space, index (space.id)}
    {@const active = navigation.spaceId === space.id}
    <button
      class="space ghost press"
      class:active
      class:glow={active}
      title={space.name}
      aria-current={active ? "page" : undefined}
      onclick={() => openRoom(space.id)}
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
</nav>

<style>
  .rail {
    width: 68px;
    flex: none;
    border-right: 1px solid var(--colours-outline-hairline);
    padding: var(--azure-spacing-md) 0;
    padding-top: max(var(--azure-spacing-md), env(safe-area-inset-top));
    padding-left: env(safe-area-inset-left);
    overflow-y: auto;
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

  .divider {
    width: 28px;
    height: 2px;
    margin: var(--azure-spacing-xs) 0;
    border: 0;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-outline-hairline);
  }
</style>
