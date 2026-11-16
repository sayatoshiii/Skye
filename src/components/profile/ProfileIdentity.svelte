<script lang="ts">
  import { writeClipboard } from "../../scripts/stores/toast";
  import { tooltip } from "../../scripts/misc/tooltip";
  import type { Snippet } from "svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import PresenceDot from "../ui/PresenceDot.svelte";
  import { formatAgo } from "../../scripts/misc/time";
  import { presenceDetails } from "../../scripts/stores/matrix";
  import { statusTextOf } from "../../scripts/stores/presence";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { hueOf } from "../../scripts/matrix/utilities/profile";
  import { profileTint } from "../../scripts/misc/palette.svelte";
  import { usermenu } from "../../scripts/misc/usermenu";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { fetchProfile } from "../../scripts/matrix/utilities/profile";
  import { downloadMedia } from "../../scripts/matrix/utilities/download";
  import { copied as copyValue, toastKey } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";

  let {
    userId,
    roomId,
    displayName,
    avatar,
    banner,
    presence,
    status,
    left = false,
    role,
    size = "md",
    surface = "var(--colours-foreground)",
    onopen,
    actions,
  }: {
    userId: string;
    roomId?: string;
    displayName: string;
    avatar?: string;
    banner?: string;
    presence?: string;
    status?: string;
    left?: boolean;
    role?: "admin" | "moderator" | "member";
    size?: "sm" | "md" | "lg";
    surface?: string;
    onopen?: () => void;
    actions?: Snippet;
  } = $props();

  const AVATAR = { sm: 72, md: 84, lg: 112 };

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => () => clearTimeout(copyTimer));

  const copy = async () => {
    await writeClipboard(userId).catch(() => undefined);
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  };

  const shownStatus = $derived(status?.trim() || $statusTextOf(userId));

  const activity = $derived.by(() => {
    const details = $presenceDetails[userId];
    if (!details) return undefined;
    if (details.currentlyActive) return text("user_profile", "active_now");
    if (details.lastActiveAgo === undefined) return undefined;
    const ago = details.lastActiveAgo + Date.now() - details.receivedAt;
    return text("user_profile", "last_active").replace("{time}", formatAgo(ago, [["day", 86400], ["hour", 3600], ["minute", 60]]));
  });

  const tint = profileTint(() => ({ avatar, banner }));

  const bannerSource = () => fetchProfile(userId).then((profile) => profile?.banner);

  const bannerItems = (): MenuItem[] => [
    { id: "banner-open", label: entityText("open_image"), icon: MENU_ICONS.open, run: () => window.open(banner, "_blank", "noopener,noreferrer") },
    { id: "banner-save", label: entityText("save"), icon: MENU_ICONS.save, run: () => bannerSource().then((url) => url && downloadMedia({ url }, `banner-${userId.slice(1).split(":")[0]}`).then(() => toastKey("saved", { icon: "save", tone: "success" }))).catch(() => undefined) },
    { id: "banner-link", label: entityText("copy_banner_link"), icon: MENU_ICONS.link, run: () => bannerSource().then((url) => url && copyValue(url, "link_copied", "link")) },
  ];

  const openLabel = $derived(text("user_profile", "open").replace("{name}", displayName));
</script>

<div class="identity-card col {size}" style:--hue={hueOf(userId)} style:--surface={surface} style:--profile-tint={tint.colour} style:--profile-glow={tint.glow} style:--profile-ink={tint.ink}>
  <div class="banner" class:image={!!banner} style:background-image={banner ? `url("${banner}")` : undefined} use:menu={banner ? bannerItems : undefined}></div>

  <div class="identity col gap-xs">
    <div class="top-row row-nw">
      {#if onopen}
        <button type="button" class="avatar ghost press" use:usermenu={{ userId, roomId }} class:left class:themed={!banner} aria-label={openLabel} onclick={onopen}>
          <PresenceDot {userId} size={AVATAR[size]}>
            <Avatar name={displayName} url={avatar} size={`${AVATAR[size]}px`} radius="50%" />
          </PresenceDot>
        </button>
      {:else}
        <span class="avatar" use:usermenu={{ userId, roomId }} class:left class:themed={!banner}>
          <PresenceDot {userId} size={AVATAR[size]}>
            <Avatar name={displayName} url={avatar} size={`${AVATAR[size]}px`} radius="50%" />
          </PresenceDot>
        </span>
      {/if}
      {#if actions}
        <div class="actions row-nw align-centre gap-xs">{@render actions()}</div>
      {/if}
    </div>

    {#if onopen}
      <button type="button" class="name-button ghost" use:usermenu={{ userId, roomId }} aria-label={openLabel} onclick={onopen}><h2 class="name bold"><EmojiText text={displayName} /></h2></button>
    {:else}
      <h2 class="name bold" use:usermenu={{ userId, roomId }}><EmojiText text={displayName} /></h2>
    {/if}
    <div class="handle row-nw align-centre gap-xs">
      <span class="id sm truncate">{userId}</span>
      <button type="button" class="copy ghost press" class:copied aria-label={copied ? text("user_profile", "copied") : text("user_profile", "copy")} use:tooltip={copied ? text("user_profile", "copied") : text("user_profile", "copy")} onclick={copy}>
        {#if copied}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5 9-10" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
        {/if}
      </button>
    </div>

    {#if shownStatus}
      <p class="status md"><EmojiText text={shownStatus} /></p>
    {/if}
    {#if activity}
      <p class="activity xs">{activity}</p>
    {/if}

    {#if role}
      <span class="role xs bold row-nw align-centre gap-xs" data-role={role}>
        <span class="role-dot" aria-hidden="true"></span>{text("user_profile", role)}
      </span>
    {/if}

    {#if left}
      <p class="left-note sm">{text("user_profile", "left")}</p>
    {/if}
  </div>
</div>

<style>
  .identity-card {
    --tint: var(--profile-tint, oklch(0.62 0.13 var(--hue)));
    --glow: var(--profile-glow, color-mix(in oklab, oklch(0.62 0.13 var(--hue)) 55%, transparent));
    --banner: 104px;
    --ring: 6px;
    --lift: 48px;
  }

  .sm {
    --banner: 88px;
    --lift: 40px;
    --ring: 5px;
  }

  .lg {
    --banner: 168px;
    --lift: 64px;
    --ring: 7px;
  }

  .banner {
    height: var(--banner);
    flex: none;
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--tint) 70%, transparent), transparent 60%),
      linear-gradient(135deg, oklch(0.62 0.13 var(--hue)), color-mix(in oklab, oklch(0.45 0.1 calc(var(--hue) + 40)) 80%, var(--surface)));
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

  .top-row {
    justify-content: space-between;
    align-items: flex-start;
  }

  .actions {
    padding-top: var(--azure-spacing-lg);
  }

  .avatar {
    --presence-outset: calc(var(--ring) * 0.6);
    position: relative;
    display: flex;
    width: fit-content;
    padding: 0;
    margin-top: calc(var(--lift) * -1);
    margin-bottom: var(--azure-spacing-xs);
    border-radius: 50%;
    border: var(--ring) solid var(--surface);
    background-color: var(--surface);
    box-shadow: 0 0 24px var(--glow);
    transition: box-shadow var(--azure-duration-md) var(--azure-ease-fluid);
  }

  button.avatar:hover,
  button.avatar:focus-visible {
    box-shadow: 0 0 32px var(--glow);
  }

  .avatar.left :global(img) {
    filter: grayscale(0.7) brightness(0.8);
  }

  .name-button {
    padding: 0;
    text-align: left;
    width: fit-content;
    max-width: 100%;
  }

  .name-button:hover .name,
  .name-button:focus-visible .name {
    text-decoration: underline;
    text-decoration-color: var(--tint);
    text-underline-offset: 3px;
  }

  .name {
    margin: 0;
    font-size: var(--text-xl);
    color: var(--colours-text-strong);
    overflow-wrap: anywhere;
  }

  .sm .name {
    font-size: var(--text-lg);
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
    color: var(--tint);
  }

  .role {
    width: fit-content;
    margin-top: var(--azure-spacing-xs);
    padding: 2px var(--azure-spacing-sm);
    border-radius: var(--azure-radius-pill);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-muted);
  }

  .role-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--tint);
    box-shadow: 0 0 8px var(--glow);
  }

  .role[data-role="member"] .role-dot {
    background-color: var(--colours-text-faint);
    box-shadow: none;
  }

  .role[data-role="moderator"] .role-dot {
    background-color: var(--colours-warning);
    box-shadow: none;
  }

  .status {
    margin: var(--azure-spacing-xs) 0 0;
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  .activity {
    margin: 2px 0 0;
    color: var(--colours-text-faint);
  }

  .left-note {
    margin: var(--azure-spacing-xs) 0 0;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-faint);
  }
</style>
