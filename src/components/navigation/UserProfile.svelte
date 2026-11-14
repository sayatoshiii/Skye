<script lang="ts">
  import EmojiText from "../ui/EmojiText.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getWideMediaLink, isMxc } from "../../scripts/matrix/utilities/media";
  import { fetchProfile, type ExtendedProfile } from "../../scripts/matrix/utilities/profile";
  import type { RoomSummary } from "../../scripts/matrix/types";
  import { currentRoom, joinedMembers, presenceDetails } from "../../scripts/stores/matrix";
  import Avatar from "../ui/Avatar.svelte";

  let { onclose }: { onclose?: () => void } = $props();

  let room: RoomSummary | null = $state.raw(null);
  let details: ExtendedProfile | null = $state.raw(null);
  let banner: string | undefined = $state();
  let copied = $state(false);

  $effect(() => currentRoom.subscribe((value) => (room = value)));

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const userId = $derived(room?.directUserId);
  const member = $derived(userId ? room?.members[userId] : undefined);
  const joined = $derived(userId && room ? $joinedMembers[room.roomId]?.[userId] : undefined);
  const left = $derived(!joined && !!member && member.membership !== "join" && member.membership !== "invite");

  const displayName = $derived(joined?.displayName ?? member?.displayName ?? details?.displayName ?? userId ?? "");
  const avatar = $derived(joined?.avatarUrl ?? member?.avatarUrl ?? details?.avatarUrl);
  const status = $derived(userId ? $presenceDetails[userId] : undefined);

  const hue = $derived(
    [...(userId ?? "")].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7) % 360,
  );

  $effect(() => {
    const id = userId;
    details = null;
    banner = undefined;
    copied = false;
    if (!id) return;

    let cancelled = false;

    fetchProfile(id).then(async (profile) => {
      if (cancelled) return;
      details = profile;
      if (!isMxc(profile?.banner)) return;
      const link = await getWideMediaLink(profile.banner);
      if (!cancelled) banner = link;
    });

    return () => (cancelled = true);
  });

  const formatAgo = (milliseconds: number) => {
    const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: "auto" });
    const seconds = Math.round(milliseconds / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
    const [unit, size] = units.find(([, size]) => seconds >= size) ?? ["second", 1];
    return formatter.format(-Math.round(seconds / size), unit);
  };

  const activity = $derived.by(() => {
    if (!status) return undefined;
    if (status.currentlyActive) return text("user_profile", "active_now");
    if (status.lastActiveAgo === undefined) return undefined;
    const ago = status.lastActiveAgo + Date.now() - status.receivedAt;
    return text("user_profile", "last_active").replace("{time}", formatAgo(ago));
  });

  const copy = async () => {
    if (!userId) return;
    await navigator.clipboard?.writeText(userId).catch(() => undefined);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  };
</script>

<aside class="profile col" aria-label={text("user_profile", "label")} style:--hue={hue}>
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
    <div class="card col">
      <div class="banner" class:image={!!banner} style:background-image={banner ? `url("${banner}")` : undefined}></div>

      <div class="identity col gap-xs">
        <span class="avatar" data-presence={status?.presence ?? "offline"} class:left class:themed={!banner}>
          <Avatar name={displayName} url={avatar} size="84px" radius="50%" />
        </span>

        <h2 class="name bold"><EmojiText text={displayName} /></h2>
        <div class="handle row-nw align-centre gap-xs">
          <span class="id sm truncate">{userId}</span>
          <button class="copy ghost press" class:copied aria-label={copied ? text("user_profile", "copied") : text("user_profile", "copy")} title={copied ? text("user_profile", "copied") : text("user_profile", "copy")} onclick={copy}>
            {#if copied}
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5 9-10" /></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
            {/if}
          </button>
        </div>

        {#if left}
          <p class="left-note sm">{text("user_profile", "left")}</p>
        {/if}
      </div>

      <div class="sections col gap-md">
        {#if status}
          <section class="col gap-xs">
            <h3 class="heading xs bold">{text("user_profile", "status")}</h3>
            <p class="presence-line row-nw align-centre gap-sm sm" data-presence={status.presence}>
              <span class="dot"></span>{text("user_profile", status.presence)}
            </p>
            {#if status.statusMessage}
              <p class="md status-msg">{status.statusMessage}</p>
            {/if}
            {#if activity}
              <p class="xs faint">{activity}</p>
            {/if}
          </section>
        {/if}

        {#if details?.bio}
          <section class="col gap-xs">
            <h3 class="heading xs bold">{text("user_profile", "about")}</h3>
            <p class="md bio">{details.bio}</p>
          </section>
        {/if}
      </div>
    </div>
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

  .banner {
    height: 104px;
    flex: none;
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--colours-accent) 70%, transparent), transparent 60%),
      linear-gradient(135deg, oklch(0.62 0.13 var(--hue)), color-mix(in oklab, oklch(0.45 0.1 calc(var(--hue) + 40)) 80%, var(--colours-foreground)));
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .banner.image {
    background-size: cover;
    background-position: center;
  }

  .identity {
    padding: 0 var(--azure-spacing-md) var(--azure-spacing-md);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .avatar {
    position: relative;
    display: flex;
    width: fit-content;
    margin-top: -48px;
    margin-bottom: var(--azure-spacing-xs);
    border-radius: 50%;
    border: 6px solid var(--colours-foreground);
    background-color: var(--colours-foreground);
    box-shadow: 0 0 24px var(--colours-accent-glow);
  }

  .avatar.themed {
    box-shadow: 0 0 24px color-mix(in oklab, oklch(0.62 0.13 var(--hue)) 55%, transparent);
  }

  .avatar.left :global(img) {
    filter: grayscale(0.7) brightness(0.8);
  }

  .avatar::after {
    content: "";
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 4px solid var(--colours-foreground);
    background-color: var(--colours-text-faint);
  }

  .name {
    margin: 0;
    font-size: var(--text-xl);
    color: var(--colours-text-strong);
    overflow-wrap: anywhere;
  }

  .handle {
    min-width: 0;
  }

  .id {
    color: var(--colours-text-muted);
    user-select: all;
  }

  .copy {
    width: 24px;
    height: 24px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .copy:hover,
  .copy.copied {
    color: var(--colours-accent-strong);
  }

  .left-note {
    margin: var(--azure-spacing-xs) 0 0;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-faint);
  }

  .sections {
    padding: var(--azure-spacing-md);
  }

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

  .bio,
  .status-msg {
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

  [data-presence="online"]::after,
  [data-presence="online"] .dot {
    background-color: var(--colours-success);
  }

  [data-presence="unavailable"]::after,
  [data-presence="unavailable"] .dot {
    background-color: var(--colours-warning);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
