<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { settingsOpen } from "../../scripts/stores/settings";
  import Icon from "./Icon.svelte";
  import Settings from "./Settings.svelte";

  const label = getLocalisedText(undefined, "settings", "open") as string;

  let open = $state(false);

  $effect(() => settingsOpen.subscribe((value) => (open = value)));
</script>

<button type="button" class="settings-gear ghost press" aria-label={label} aria-expanded={open} aria-haspopup="dialog" use:tooltip={label} onclick={() => settingsOpen.set(true)}>
  <Icon name="gear" size={20} />
</button>

{#if open}
  <Settings />
{/if}

<style>
  .settings-gear {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--colours-text-muted);
  }

  .settings-gear:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .settings-gear :global(svg) {
    transition: transform var(--azure-duration-slow) var(--azure-ease-spring);
  }

  .settings-gear:hover :global(svg) {
    transform: rotate(60deg);
  }

  @media (max-width: 767px) {
    .settings-gear {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }
</style>
