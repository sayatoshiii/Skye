<script lang="ts">
  import { formatAgo as formatAgoBase } from "../../scripts/misc/time";
  import type { Snippet } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import type { PresenceDetails } from "../../scripts/stores/matrix";

  let {
    status,
    bio,
    children,
  }: { status?: PresenceDetails; bio?: string; children?: Snippet } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const formatAgo = (milliseconds: number) =>
    formatAgoBase(milliseconds, [["day", 86400], ["hour", 3600], ["minute", 60]]);

  const activity = $derived.by(() => {
    if (!status) return undefined;
    if (status.currentlyActive) return text("user_profile", "active_now");
    if (status.lastActiveAgo === undefined) return undefined;
    const ago = status.lastActiveAgo + Date.now() - status.receivedAt;
    return text("user_profile", "last_active").replace("{time}", formatAgo(ago));
  });
</script>

{#if status}
  <section class="col gap-sm">
    <h3 class="heading xs bold">{text("user_profile", "status")}</h3>
    <p class="presence-line row-nw align-centre gap-sm sm" data-presence={status.presence}>
      <span class="dot"></span>{text("user_profile", status.presence)}
    </p>
    {#if status.statusMessage}
      <p class="md strong">{status.statusMessage}</p>
    {/if}
    {#if activity}
      <p class="xs faint">{activity}</p>
    {/if}
  </section>
{/if}

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

  .presence-line {
    color: var(--colours-text-muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
  }

  [data-presence="online"] .dot {
    background-color: var(--colours-success);
  }

  [data-presence="unavailable"] .dot {
    background-color: var(--colours-warning);
  }
</style>
