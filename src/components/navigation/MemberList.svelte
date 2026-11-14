<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { members } from "../../scripts/stores/mock";
  import Avatar from "../ui/Avatar.svelte";

  let { onclose }: { onclose?: () => void } = $props();

  const groups = $derived([
    {
      id: "online",
      name: getLocalisedText(undefined, "navigation", "online") as string,
      members: members.filter(({ presence }) => presence !== "offline"),
    },
    {
      id: "offline",
      name: getLocalisedText(undefined, "navigation", "offline") as string,
      members: members.filter(({ presence }) => presence === "offline"),
    },
  ]);
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
  {#each groups as group (group.id)}
    <h2 class="heading xs bold">{group.name} — {group.members.length}</h2>
    <ul class="col gap-xs">
      {#each group.members as member (member.userId)}
        <li class="member item press row-nw align-centre gap-md" class:offline={member.presence === "offline"} title={member.userId}>
          <span class="presence-wrap" data-presence={member.presence}>
            <Avatar name={member.displayName} url={member.avatar} size="32px" radius="50%" />
          </span>
          <span class="md truncate" class:admin={member.powerLevel >= 100}>{member.displayName}</span>
        </li>
      {/each}
    </ul>
  {/each}
</aside>

<style>
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

  .presence-wrap {
    position: relative;
    display: flex;
  }

  .presence-wrap::after {
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
