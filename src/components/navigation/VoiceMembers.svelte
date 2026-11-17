<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { identityOf } from "../../scripts/matrix/utilities/rtc";
  import { fetchProfile } from "../../scripts/matrix/utilities/profile";
  import { volumeItems } from "../../scripts/misc/voicemenu";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { userMenuItems } from "../../scripts/misc/usermenu";
  import { openMiniProfile } from "../../scripts/stores/profile";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { callMembers, deafened, memberIdentities, muted, speaking, userOfIdentity, voice } from "../../scripts/stores/voice";
  import { reveal } from "../auth/motion";
  import Icon from "../settings/Icon.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  let { roomId }: { roomId: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  let fetched = $state<Record<string, { displayName?: string; avatarUrl?: string } | null>>({});
  $effect(() => {
    ($callMembers[roomId] ?? []).map((member) => member.userId).filter((userId) => !$rooms[roomId]?.members[userId]?.avatarUrl && !(userId in fetched)).forEach((userId) => ((fetched[userId] = null), fetchProfile(userId).then((profile) => (fetched[userId] = profile))));
  });
  const people = $derived(
    [...new Map(($callMembers[roomId] ?? []).map((member) => [member.userId, member])).values()].map((member) => {
      const profile = $rooms[roomId]?.members[member.userId]?.avatarUrl ? $rooms[roomId]?.members[member.userId] : { ...$rooms[roomId]?.members[member.userId], ...fetched[member.userId] };
      const devices = ($callMembers[roomId] ?? []).filter((entry) => entry.userId === member.userId).flatMap((entry) => $memberIdentities[identityOf(entry.userId, entry.deviceId)] ?? [identityOf(entry.userId, entry.deviceId)]);
      return {
        userId: member.userId,
        name: profile?.displayName || member.userId.slice(1).split(":")[0],
        avatar: profile?.avatarUrl,
        talking: $voice?.roomId === roomId && (devices.some((identity) => $speaking.has(identity)) || [...$speaking].some((identity) => userOfIdentity(identity) === member.userId)),
        self: member.userId === $session?.userId,
      };
    }),
  );
</script>

{#if people.length}
  <ul class="members col" aria-label={text("in_voice").replace("{count}", String(people.length))}>
    {#each people as person (person.userId)}
      <li transition:reveal>
        <button type="button" class="member ghost row-nw align-centre gap-md sm" class:talking={person.talking} data-profile-trigger onclick={(event) => (event.stopPropagation(), openMiniProfile(person.userId, event.currentTarget, "right", roomId))} use:menu={() => [...userMenuItems(person.userId, roomId), ...volumeItems(person.userId)]}>
          <span class="ring">
            <Avatar name={person.name} url={person.avatar} size="24px" radius="50%" />
          </span>
          <span class="truncate flex-max"><EmojiText text={person.name} /></span>
          <span class="flags row-nw" class:shown={person.self && ($muted || $deafened)} aria-label={text("muted")}>
            <Icon name={$deafened ? "headphonesOff" : "micOff"} size={14} />
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .members {
    margin: 2px 0 6px;
    padding: 0 6px 0 22px;
    list-style: none;
  }

  .member {
    width: 100%;
    padding: 8px 10px;
    margin: 2px 0;
    text-align: start;
    cursor: pointer;
    border-radius: 8px;
    color: var(--colours-text-muted);
    transition:
      color 240ms cubic-bezier(0.32, 0.72, 0, 1),
      background-color 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .member:hover {
    background: color-mix(in oklab, white 5%, transparent);
    color: var(--colours-text-strong);
  }

  .ring {
    display: grid;
    border-radius: 50%;
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .talking {
    color: var(--colours-text-strong);
  }

  .talking .ring {
    box-shadow: 0 0 0 2px var(--colours-success);
  }

  .flags {
    color: var(--colours-danger);
    opacity: 0;
    scale: 0.6;
    transition:
      opacity 240ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .flags.shown {
    opacity: 1;
    scale: 1;
  }
</style>
