<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { RoomSummary } from "../../scripts/matrix/types";
  import { currentRoom, joinedMembers } from "../../scripts/stores/matrix";
  import { openFullProfile } from "../../scripts/stores/profile";
  import ProfileIdentity from "../profile/ProfileIdentity.svelte";
  import ProfileDetails from "../profile/ProfileDetails.svelte";
  import { createProfileData } from "../profile/profileData.svelte";

  let { onclose }: { onclose?: () => void } = $props();

  let room = $state.raw<RoomSummary | null>(null);

  $effect(() => currentRoom.subscribe((value) => (room = value)));

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const userId = $derived(room?.directUserId);
  const data = createProfileData(() => ({ userId, roomId: room?.roomId }));

  const member = $derived(userId ? room?.members[userId] : undefined);
  const joined = $derived(userId && room ? $joinedMembers[room.roomId]?.[userId] : undefined);
  const left = $derived(!!room && !!$joinedMembers[room.roomId] && !joined && (member?.membership === "leave" || member?.membership === "ban"));
</script>

<aside class="profile col" aria-label={text("user_profile", "label")}>
  {#if onclose}
    <header class="top row-nw align-centre gap-sm">
      <button class="close ghost press" aria-label={text("navigation", "back")} onclick={onclose}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h1 class="md bold">{text("user_profile", "label")}</h1>
    </header>
  {/if}

  {#key userId}
    {#if userId}
      <div class="card col">
        <ProfileIdentity
          {userId}
          displayName={data.displayName}
          avatar={data.avatar}
          banner={data.banner}
          presence={data.status?.presence}
          status={data.status?.statusMessage}
          {left}
          onopen={() => openFullProfile(userId, room?.roomId)}
        />
        <div class="sections col gap-md">
          <ProfileDetails status={data.status} bio={data.bio} />
        </div>
      </div>
    {/if}
  {/key}
</aside>

<style>
  .profile {
    height: 100%;
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    overflow-y: auto;
    overscroll-behavior: contain;
    background-color: var(--colours-foreground);
    border-left: 1px solid var(--colours-outline-hairline);
  }

  .top {
    padding: var(--azure-spacing-md) var(--azure-spacing-sm) var(--azure-spacing-sm);
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

  .card {
    animation: rise var(--azure-duration-glide) var(--azure-ease-fluid) both;
  }

  .sections {
    padding: var(--azure-spacing-md);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
