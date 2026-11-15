<script lang="ts">
  import EmojiText from "../ui/EmojiText.svelte";
  import type { Snippet } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { PresenceDetails } from "../../scripts/stores/matrix";

  let {
    status,
    bio,
    children,
  }: { status?: PresenceDetails; bio?: string; children?: Snippet } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

</script>

{#if bio}
  <section class="col gap-sm">
    <h3 class="heading xs bold">{text("user_profile", "about")}</h3>
    <p class="md strong">{bio}</p>
  </section>
{/if}

{@render children?.()}

<style>
  section {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: color-mix(in oklab, var(--colours-foreground) 85%, var(--colours-background));
  }

  .heading {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  p {
    margin: 0;
  }

  .strong {
    color: var(--colours-text-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .faint {
    color: var(--colours-text-faint);
  }

</style>
