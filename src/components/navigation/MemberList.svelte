<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import { currentRoom, joinedMembers, presence } from "../../scripts/stores/matrix";
  import Avatar from "../ui/Avatar.svelte";

  let { onclose }: { onclose?: () => void } = $props();

  let room: import("../../scripts/matrix/types").RoomSummary | null = $state.raw(null);

  $effect(() => currentRoom.subscribe((value) => (room = value)));

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  const members = $derived.by(() => {
    if (!room) return [];

    const fromState = Object.values(room.members).filter(({ membership }) => membership === "join");
    const merged = { ...Object.fromEntries(fromState.map((member) => [member.userId, member])), ...$joinedMembers[room.roomId] };

    return Object.values(merged)
      .map((member) => ({
        userId: member.userId,
        displayName: member.displayName ?? room.members[member.userId]?.displayName ?? member.userId,
        avatar: member.avatarUrl ?? room.members[member.userId]?.avatarUrl,
        presence: $presence[member.userId],
        powerLevel: getPowerLevel(room, member.userId),
      }))
      .sort((a, b) => b.powerLevel - a.powerLevel || a.displayName.localeCompare(b.displayName));
  });

  const MEMBER_PAGE = 80;

  let limit = $state(MEMBER_PAGE);
  let sentinel: HTMLDivElement | undefined = $state();

  $effect(() => {
    room?.roomId;
    limit = MEMBER_PAGE;
  });

  $effect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) limit += MEMBER_PAGE;
    }, { rootMargin: "400px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  const hasPresence = $derived(members.some((member) => member.presence));

  const groups = $derived(
    hasPresence
      ? [
          {
            id: "online",
            name: text("navigation", "online"),
            members: members.filter((member) => member.presence && member.presence !== "offline"),
          },
          {
            id: "offline",
            name: text("navigation", "offline"),
            members: members.filter((member) => !member.presence || member.presence === "offline"),
          },
        ].filter((group) => group.members.length)
      : [{ id: "all", name: text("navigation", "members"), members }],
  );

  const shown = $derived.by(() => {
    let budget = limit;

    return groups.map((group) => {
      const visible = group.members.slice(0, Math.max(0, budget));
      budget -= visible.length;
      return { ...group, visible };
    });
  });
</script>

<aside class="members col" aria-label={getLocalisedText(undefined, "navigation", "members")}>
  {#if onclose}
    <header class="top row-nw align-centre gap-sm">
      <button class="close ghost press" aria-label={getLocalisedText(undefined, "navigation", "back")} onclick={onclose}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h1 class="md bold">{getLocalisedText(undefined, "navigation", "members")}</h1>
    </header>
  {/if}
  {#key room?.roomId}
  {#each shown as group (group.id)}
    <h2 class="heading xs bold">{group.name} — {group.members.length}</h2>
    <ul class="col gap-xs">
      {#each group.visible as member (member.userId)}
        <li class="member item press row-nw align-centre gap-md" class:offline={hasPresence && (!member.presence || member.presence === "offline")} title={member.userId}>
          <span class="presence-wrap" data-presence={hasPresence ? (member.presence ?? "offline") : undefined}>
            <Avatar name={member.displayName} url={member.avatar} size="32px" radius="50%" />
          </span>
          <span class="md truncate" class:admin={member.powerLevel >= 100}
            class:moderator={member.powerLevel >= 50 && member.powerLevel < 100}>{member.displayName}</span>
        </li>
      {/each}
    </ul>
  {/each}
  {/key}
  {#if limit < members.length}
    <div class="sentinel" bind:this={sentinel}></div>
  {/if}
</aside>

<style>
  .sentinel {
    height: 1px;
    flex: none;
  }

  .top {
    padding-bottom: var(--azure-spacing-sm);
  }

  .top h1 {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .close {
    width: var(--azure-touch);
    height: var(--azure-touch);
    display: grid;
    place-items: center;
    flex: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .close:active {
    color: var(--colours-text-strong);
  }

  .members {
    height: 100%;
    padding: var(--azure-spacing-md) var(--azure-spacing-sm);
    padding-top: max(var(--azure-spacing-md), env(safe-area-inset-top));
    padding-right: max(var(--azure-spacing-sm), env(safe-area-inset-right));
    overflow-y: auto;
    overscroll-behavior: contain;
    background-color: var(--colours-foreground);
    border-left: 1px solid var(--colours-outline-hairline);
  }

  .heading {
    margin: var(--azure-spacing-md) var(--azure-spacing-sm) var(--azure-spacing-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .member {
    min-height: 42px;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    cursor: pointer;
  }

  .member.offline {
    opacity: 0.45;
  }

  .admin {
    color: var(--colours-accent-strong);
  }

  .moderator {
    color: var(--colours-text-strong);
  }

  .presence-wrap {
    position: relative;
    display: flex;
  }

  [data-presence]::after {
    content: "";
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 3px solid var(--colours-foreground);
    background-color: var(--colours-text-faint);
  }

  [data-presence="online"]::after {
    background-color: var(--colours-success);
  }

  [data-presence="unavailable"]::after {
    background-color: var(--colours-warning);
  }
</style>
