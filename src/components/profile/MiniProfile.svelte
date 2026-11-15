<script lang="ts">
  import { tick } from "svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { miniProfile, openFullProfile, type ProfileTarget } from "../../scripts/stores/profile";
  import ProfileIdentity from "./ProfileIdentity.svelte";
  import ProfileDetails from "./ProfileDetails.svelte";
  import MessageButton from "./MessageButton.svelte";
  import { createProfileData } from "./profileData.svelte";

  const WIDTH = 300;
  const GAP = 12;

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let target = $state.raw<ProfileTarget | null>(null);
  let card: HTMLElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);
  let placed = $state(false);

  $effect(() => miniProfile.subscribe((value) => (target = value)));

  const data = createProfileData(() => ({ userId: target?.userId, roomId: target?.roomId }));

  const close = (restore = true) => {
    const element = target?.anchor?.element;
    miniProfile.set(null);
    if (restore) element?.focus();
  };

  const place = () => {
    const anchor = target?.anchor;
    if (!card || !anchor) return;
    const { rect, side } = anchor;
    const height = card.offsetHeight;
    const x = side === "left" ? rect.left - WIDTH - GAP : rect.right + GAP;
    left = Math.max(GAP, Math.min(x, innerWidth - WIDTH - GAP));
    top = Math.max(GAP, Math.min(rect.top, innerHeight - height - GAP));
    placed = true;
  };

  $effect(() => {
    if (!target) return;
    target.userId;
    placed = false;
    tick().then(() => {
      place();
      card?.focus();
    });
  });

  $effect(() => {
    if (!card) return;
    const observer = new ResizeObserver(place);
    observer.observe(card);
    return () => observer.disconnect();
  });

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onpointerdown = (event: PointerEvent) => {
    const element = event.target as HTMLElement;
    if (card?.contains(element)) return;
    if (element.closest("[data-profile-trigger]")) return;
    close(false);
  };

  $effect(() => {
    if (!target) return;
    document.addEventListener("pointerdown", onpointerdown, true);
    return () => document.removeEventListener("pointerdown", onpointerdown, true);
  });

  const viewFull = () => {
    if (target) openFullProfile(target.userId, target.roomId);
  };
</script>

{#if target}
  <div class="layer" role="presentation" use:portal>
    <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={() => close()}></button>
    {#key target.userId}
      <div
        class="card col"
        class:placed
        role="dialog"
        aria-label={text("user_profile", "card").replace("{name}", data.displayName)}
        tabindex="-1"
        bind:this={card}
        style:left="{left}px"
        style:top="{top}px"
        {onkeydown}
      >
        <span class="handle" aria-hidden="true"></span>
        <ProfileIdentity
          userId={data.userId}
          displayName={data.displayName}
          avatar={data.avatar}
          banner={data.banner}
          presence={data.status?.presence}
          role={data.role}
          size="sm"
          surface="var(--colours-surface-raised)"
          onopen={viewFull}
        />
        <div class="body col gap-sm">
          <ProfileDetails status={data.status} bio={data.bio} />
          <div class="footer row-nw align-centre gap-sm">
            {#if !data.isSelf}
              <MessageButton userId={data.userId} compact ondone={() => close(false)} />
            {/if}
            <button type="button" class="full ghost press sm bold" onclick={viewFull}>{text("user_profile", "full")}</button>
          </div>
        </div>
      </div>
    {/key}
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
    pointer-events: none;
  }

  .scrim {
    display: none;
  }

  .card {
    position: fixed;
    width: 300px;
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 24px 64px -18px black,
      0 0 44px -20px var(--colours-accent-glow);
    outline: none;
    pointer-events: auto;
    visibility: hidden;
  }

  .card.placed {
    visibility: visible;
    animation: pop var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .card :global(.banner) {
    border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
  }

  .handle {
    display: none;
  }

  .body {
    padding: var(--azure-spacing-md);
  }

  .footer {
    padding-top: var(--azure-spacing-xs);
  }

  .full {
    height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .full:hover,
  .full:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.97);
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 767px) {
    .layer {
      pointer-events: auto;
    }

    .scrim {
      display: block;
      position: absolute;
      inset: 0;
      background-color: var(--colours-scrim);
      animation: fade var(--azure-duration-md) var(--azure-ease-out);
    }

    .card {
      inset: auto 0 0 0 !important;
      width: auto;
      max-height: 85dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      visibility: visible;
    }

    .card.placed {
      animation: rise var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .handle {
      display: block;
      position: absolute;
      top: var(--azure-spacing-sm);
      left: 50%;
      translate: -50% 0;
      z-index: 1;
      width: 36px;
      height: 4px;
      border-radius: var(--azure-radius-pill);
      background-color: color-mix(in oklab, white 55%, transparent);
    }
  }
</style>
