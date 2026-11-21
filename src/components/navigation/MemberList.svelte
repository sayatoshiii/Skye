<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import EmojiText from "../ui/EmojiText.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import { levelOf, roleIcon, roleIndex } from "../../scripts/matrix/utilities/power";
  import { currentRoom, joinedMembers } from "../../scripts/stores/matrix";
  import { presenceKinds } from "../../scripts/stores/presence";
  import PresenceDot from "../ui/PresenceDot.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import { openMiniProfile } from "../../scripts/stores/profile";
  import { usermenu } from "../../scripts/misc/usermenu";
  import { flip } from "svelte/animate";
  import { blur } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  let { onclose }: { onclose?: () => void } = $props();

  let room: import("../../scripts/matrix/types").RoomSummary | null = $state.raw(null);

  $effect(() => currentRoom.subscribe((value) => (room = value)));

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  const roles = $derived(roleIndex(room));

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  let settled = $state<string | undefined>();
  $effect(() => {
    const id = room?.roomId;
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (settled = id))));
    return () => cancelAnimationFrame(frame);
  });

  const members = $derived.by(() => {
    if (!room || settled !== room.roomId) return [];

    const fromState = Object.values(room.members).filter(({ membership }) => membership === "join");
    const merged = { ...Object.fromEntries(fromState.map((member) => [member.userId, member])), ...$joinedMembers[room.roomId] };

    return Object.values(merged)
      .map((member) => ({
        userId: member.userId,
        displayName: member.displayName ?? room.members[member.userId]?.displayName ?? member.userId,
        avatar: member.avatarUrl ?? room.members[member.userId]?.avatarUrl,
        presence: $presenceKinds(member.userId),
        powerLevel: getPowerLevel(room, member.userId),
        role: roles.get(levelOf(room, member.userId)),
      }))
      .sort((a, b) => b.powerLevel - a.powerLevel || collator.compare(a.displayName, b.displayName));
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

  const named = $derived(
    [...roles.values()]
      .sort((a, b) => b.level - a.level)
      .map((role) => ({
        id: `role:${role.level}`,
        name: role.name,
        members: members.filter((member) => member.role === role && member.presence !== "offline"),
      })),
  );

  const unranked = $derived(members.filter((member) => !member.role || member.presence === "offline"));

  const groups = $derived(
    [
      ...named,
      {
        id: "online",
        name: text("navigation", "online"),
        members: unranked.filter((member) => member.presence !== "offline" && member.presence !== "unsupported"),
      },
      {
        id: "offline",
        name: text("navigation", "offline"),
        members: unranked.filter((member) => member.presence === "offline"),
      },
      {
        id: "unknown",
        name: text("navigation", "unknown"),
        members: unranked.filter((member) => member.presence === "unsupported"),
      },
    ].filter((group) => group.members.length),
  );

  const shown = $derived.by(() => {
    let budget = limit;

    return groups.map((group) => {
      const visible = group.members.slice(0, Math.max(0, budget));
      budget -= visible.length;
      return { ...group, visible };
    });
  });
  const rows = $derived(shown.flatMap((group) => (group.visible.length ? [{ key: group.id, name: group.name, count: group.members.length, member: null }, ...group.visible.map((member) => ({ key: member.userId, name: "", count: 0, member }))] : [])));
  const lift = (node: HTMLElement, { duration }: { duration: number }) => {
    const { top, left, width, height } = node.getBoundingClientRect();
    const parent = (node.offsetParent ?? node.parentElement)!.getBoundingClientRect();
    Object.assign(node.style, { position: "absolute", top: `${top - parent.top}px`, left: `${left - parent.left}px`, width: `${width}px`, height: `${height}px` });
    return { duration, easing: cubicOut, css: (t: number) => `opacity: ${t}; filter: blur(${(1 - t) * 6}px)` };
  };

  let calm = $state(false);
  let settle: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void room?.roomId;
    calm = false;
  });
  $effect(() => {
    void rows.length;
    clearTimeout(settle);
    !calm && (settle = setTimeout(() => (calm = true), 900));
    return () => clearTimeout(settle);
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
  <ul class="col" in:blur={{ amount: 6, duration: 360, easing: cubicOut }}>
    {#each rows as row (row.key)}
      <li class={row.member ? "member-row" : "heading-row"} animate:flip={{ duration: calm ? 380 : 0, easing: cubicOut }} in:blur={{ amount: 6, duration: calm ? 320 : 0, easing: cubicOut }} out:lift={{ duration: calm ? 200 : 0 }}>
        {#if row.member}
          {@const member = row.member}
          <button type="button" class="member item press ghost row-nw align-centre gap-md" class:offline={member.presence === "offline"} use:tooltip={member.userId} use:usermenu={{ userId: member.userId, roomId: room?.roomId }} data-profile-trigger aria-label={text("user_profile", "open").replace("{name}", member.displayName)} onclick={(event) => room && openMiniProfile(member.userId, event.currentTarget, "left", room.roomId)}>
            <PresenceDot userId={member.userId} size={32}>
              <Avatar name={member.displayName} url={member.avatar} size="32px" radius="50%" fade />
            </PresenceDot>
            <span class="md truncate" class:admin={member.powerLevel >= 100 && !room?.isDirect}
              class:moderator={member.powerLevel >= 50 && member.powerLevel < 100 && !room?.isDirect} style:color={member.role?.color}><EmojiText text={member.displayName} /></span>
            {#if roleIcon(member.role)}<span class="role-icon" aria-hidden="true"><Avatar name={member.role?.name ?? ""} url={roleIcon(member.role)} size="16px" radius="4px" /></span>{/if}
          </button>
        {:else}
          <h2 class="heading xs bold">{row.name} — {row.count}</h2>
        {/if}
      </li>
    {/each}
  </ul>
  {/key}
  {#if limit < members.length}
    <div class="sentinel" bind:this={sentinel}></div>
  {/if}
</aside>

<style>
  .member {
    width: 100%;
    text-align: left;
  }

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

  .member-row + .member-row {
    margin-top: var(--azure-spacing-xs);
  }

  ul {
    position: relative;
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

  .role-icon {
    display: inline-flex;
    flex: none;
  }

  .admin {
    color: var(--colours-accent-strong);
  }

  .moderator {
    color: var(--colours-text-strong);
  }

</style>
