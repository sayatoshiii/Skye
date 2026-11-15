<script lang="ts">
  import type { Snippet } from "svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { hueOf } from "../../scripts/matrix/utilities/profile";

  let {
    userId,
    displayName,
    avatar,
    banner,
    presence,
    left = false,
    role,
    size = "md",
    surface = "var(--colours-foreground)",
    onopen,
    actions,
  }: {
    userId: string;
    displayName: string;
    avatar?: string;
    banner?: string;
    presence?: string;
    left?: boolean;
    role?: "admin" | "moderator";
    size?: "sm" | "md" | "lg";
    surface?: string;
    onopen?: () => void;
    actions?: Snippet;
  } = $props();

  const AVATAR = { sm: "72px", md: "84px", lg: "112px" };

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => () => clearTimeout(copyTimer));

  const copy = async () => {
    await navigator.clipboard?.writeText(userId).catch(() => undefined);
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  };

  const openLabel = $derived(text("user_profile", "open").replace("{name}", displayName));
</script>

<div class="identity-card col {size}" style:--hue={hueOf(userId)} style:--surface={surface}>
  <div class="banner" class:image={!!banner} style:background-image={banner ? `url("${banner}")` : undefined}></div>

  <div class="identity col gap-xs">
    <div class="top-row row-nw">
      {#if onopen}
        <button type="button" class="avatar ghost press" data-presence={presence ?? "offline"} class:left class:themed={!banner} aria-label={openLabel} onclick={onopen}>
          <Avatar name={displayName} url={avatar} size={AVATAR[size]} radius="50%" />
        </button>
      {:else}
        <span class="avatar" data-presence={presence ?? "offline"} class:left class:themed={!banner}>
          <Avatar name={displayName} url={avatar} size={AVATAR[size]} radius="50%" />
        </span>
      {/if}
      {#if actions}
        <div class="actions row-nw align-centre gap-xs">{@render actions()}</div>
      {/if}
    </div>

    {#if onopen}
      <button type="button" class="name-button ghost" aria-label={openLabel} onclick={onopen}><h2 class="name bold"><EmojiText text={displayName} /></h2></button>
    {:else}
      <h2 class="name bold"><EmojiText text={displayName} /></h2>
    {/if}
    <div class="handle row-nw align-centre gap-xs">
      <span class="id sm truncate">{userId}</span>
      <button type="button" class="copy ghost press" class:copied aria-label={copied ? text("user_profile", "copied") : text("user_profile", "copy")} title={copied ? text("user_profile", "copied") : text("user_profile", "copy")} onclick={copy}>
        {#if copied}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5 9-10" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
        {/if}
      </button>
    </div>

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
      radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--colours-accent) 70%, transparent), transparent 60%),
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
    position: relative;
    display: flex;
    width: fit-content;
    padding: 0;
    margin-top: calc(var(--lift) * -1);
    margin-bottom: var(--azure-spacing-xs);
    border-radius: 50%;
    border: var(--ring) solid var(--surface);
    background-color: var(--surface);
    box-shadow: 0 0 24px var(--colours-accent-glow);
    transition: box-shadow var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .avatar.themed {
    box-shadow: 0 0 24px color-mix(in oklab, oklch(0.62 0.13 var(--hue)) 55%, transparent);
  }

  button.avatar:hover,
  button.avatar:focus-visible {
    box-shadow: 0 0 32px var(--colours-accent-glow);
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
    border: 4px solid var(--surface);
    background-color: var(--colours-text-faint);
  }

  [data-presence="online"]::after {
    background-color: var(--colours-success);
  }

  [data-presence="unavailable"]::after {
    background-color: var(--colours-warning);
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
    text-decoration-color: var(--colours-accent);
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
    color: var(--colours-accent-strong);
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
    background-color: var(--colours-accent);
    box-shadow: 0 0 8px var(--colours-accent-glow);
  }

  .role[data-role="moderator"] .role-dot {
    background-color: var(--colours-warning);
    box-shadow: none;
  }

  .left-note {
    margin: var(--azure-spacing-xs) 0 0;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-faint);
  }
</style>
