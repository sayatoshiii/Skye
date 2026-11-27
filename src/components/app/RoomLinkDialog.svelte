<script lang="ts">
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { joinRoom, knockRoom } from "../../scripts/matrix/utilities/hierarchy";
  import type { RoomLink } from "../../scripts/matrix/utilities/links";
  import { describeMembershipError, resolveLink, type MembershipError, type ResolvedLink } from "../../scripts/matrix/utilities/membership";
  import { session, waitForRoom } from "../../scripts/stores/matrix";
  import { openJoined } from "../../scripts/stores/navigation.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  let { link, onclose }: { link: RoomLink; onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "join", ...path) as string;

  let dialog: ConfirmDialog | undefined = $state();
  let resolved = $state.raw<ResolvedLink | null>(null);
  let looking = $state(true);
  let busy = $state(false);
  let requested = $state(false);
  let error = $state<MembershipError | null>(null);

  $effect(() => {
    const active = $session;
    active &&
      resolveLink(active, link)
        .then((value) => (resolved = value))
        .catch((reason) => (error = describeMembershipError(reason)))
        .finally(() => (looking = false));
  });

  const preview = $derived(resolved?.preview);
  const knock = $derived(["knock", "knock_restricted"].includes(preview?.joinRule ?? ""));
  const invite = $derived(["invite", "private"].includes(preview?.joinRule ?? ""));
  const blocked = $derived(!!error && error !== "rate_limited" && error !== "failed");

  const join = async () => {
    const active = $session;
    const target = resolved?.roomId ?? link.target;
    if (!active || busy) return;
    busy = true;
    error = null;
    try {
      if (knock) return void (await knockRoom(active, target, resolved?.via ?? link.via), (requested = true));
      const { room_id } = await joinRoom(active, target, resolved?.via ?? link.via);
      await waitForRoom(room_id, AbortSignal.timeout(15000)).catch(() => undefined);
      openJoined(room_id);
      dialog?.dismiss();
    } catch (reason) {
      error = describeMembershipError(reason);
    } finally {
      busy = false;
    }
  };

  const label = $derived(knock ? text("knock") : preview?.isSpace ? text("join_space") : text("join"));
</script>

<ConfirmDialog bind:this={dialog} title={preview?.name ?? link.target} cancelLabel={text("close")} tone="primary" {onclose}>
  <div class="link col gap-md">
    {#if looking}
      <p class="sm faint" in:fade={{ duration: 200 }}>{text("looking")}</p>
    {:else}
      <div class="card row-nw align-centre gap-md" in:fade={{ duration: 260, easing: cubicOut }}>
        <Avatar name={preview?.name ?? link.target} url={preview?.avatarUrl} size="48px" radius={preview?.isSpace ? "14px" : "50%"} fade />
        <span class="col min-0 flex-max">
          <span class="md bold truncate"><EmojiText text={preview?.name ?? link.target} /></span>
          <span class="xs faint truncate">{[preview?.isSpace ? text("space") : text("room"), preview?.memberCount === 1 ? text("member") : preview?.memberCount ? text("members").replace("{count}", String(preview.memberCount)) : null, preview?.alias].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      {#if preview?.topic}<p class="topic sm muted">{preview.topic}</p>{/if}
      {#if !preview && !error}<p class="xs faint">{text("no_preview")}</p>{/if}
      {#if invite && !error}<p class="xs faint">{text("invite_only")}</p>{/if}
    {/if}
    {#if error}
      <p class="failed sm" in:fade={{ duration: 220 }}>{text("errors", error)}</p>
    {:else if requested}
      <p class="sm" in:fade={{ duration: 220 }}>{text("requested")}</p>
    {/if}
  </div>
  {#snippet actions()}
    {#if !blocked && !requested}
      <button type="button" class="button primary" disabled={looking || busy} onclick={join}>{busy ? text("joining") : label}</button>
    {/if}
  {/snippet}
</ConfirmDialog>

<style>
  .card {
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .topic {
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  p {
    margin: 0;
  }

  .failed {
    color: var(--colours-danger);
  }
</style>
