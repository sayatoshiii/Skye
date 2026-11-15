<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { openDirect } from "../../scripts/stores/navigation.svelte";

  let { userId, ondone, compact = false }: { userId: string; ondone?: () => void; compact?: boolean } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let busy = $state(false);
  let failed = $state(false);

  const run = async () => {
    if (busy) return;
    busy = true;
    failed = false;
    try {
      await openDirect(userId);
      ondone?.();
    } catch (error) {
      console.warn("Skye could not open a direct message", userId, error);
      failed = true;
    } finally {
      busy = false;
    }
  };
</script>

<button type="button" class="message-button row-nw align-centre centre gap-sm sm bold press" class:compact class:failed aria-busy={busy} use:tooltip={failed ? text("user_profile", "message_failed") : undefined} onclick={run}>
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 5h16v11H9l-5 4V5Z" /></svg>
  <span>{busy ? text("user_profile", "messaging") : failed ? text("user_profile", "message_failed") : text("user_profile", "message")}</span>
</button>

<style>
  .message-button {
    height: 36px;
    padding: 0 var(--azure-spacing-lg);
    border: none;
    border-radius: var(--azure-radius-sm);
    color: white;
    background-color: var(--colours-accent);
    box-shadow: 0 0 20px -6px var(--colours-accent-glow);
    cursor: pointer;
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .message-button:hover,
  .message-button:focus-visible {
    filter: brightness(1.08);
    box-shadow: 0 0 28px -4px var(--colours-accent-glow);
  }

  .message-button[aria-busy="true"] {
    opacity: 0.7;
    cursor: progress;
  }

  .message-button.failed {
    background-color: var(--colours-danger);
    box-shadow: none;
  }

  .compact {
    height: 32px;
    padding: 0 var(--azure-spacing-md);
  }
</style>
