<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { identityOf } from "../../scripts/matrix/utilities/rtc";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { userMenuItems } from "../../scripts/misc/usermenu";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { callMembers, deafened, muted, speaking, voice } from "../../scripts/stores/voice";
  import { reveal } from "../auth/motion";
  import Icon from "../settings/Icon.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  let { roomId }: { roomId: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  const people = $derived(
    [...new Map(($callMembers[roomId] ?? []).map((member) => [member.userId, member])).values()].map((member) => {
      const profile = $rooms[roomId]?.members[member.userId];
      const devices = ($callMembers[roomId] ?? []).filter((entry) => entry.userId === member.userId).map((entry) => identityOf(entry.userId, entry.deviceId));
      return {
        userId: member.userId,
        name: profile?.displayName || member.userId.slice(1).split(":")[0],
        avatar: profile?.avatarUrl,
        talking: $voice?.roomId === roomId && devices.some((identity) => $speaking.has(identity)),
        self: member.userId === $session?.userId,
      };
    }),
  );
</script>

{#if people.length}
  <ul class="members col" aria-label={text("in_voice").replace("{count}", String(people.length))}>
    {#each people as person (person.userId)}
      <li transition:reveal>
        <div class="member row-nw align-centre gap-sm sm" class:talking={person.talking} use:menu={() => userMenuItems(person.userId, roomId)}>
          <span class="ring">
            <Avatar name={person.name} url={person.avatar} size="22px" radius="50%" />
          </span>
          <span class="truncate flex-max"><EmojiText text={person.name} /></span>
          <span class="flags row-nw" class:shown={person.self && ($muted || $deafened)} aria-label={text("muted")}>
            <Icon name={$deafened ? "headphonesOff" : "micOff"} size={14} />
          </span>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .members {
    margin: 0 0 4px;
    padding: 0 0 0 30px;
    list-style: none;
  }

  .member {
    padding: 3px 8px;
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
