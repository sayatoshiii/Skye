<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";

  let { visible = true }: { visible?: boolean } = $props();

  const tips = (getLocalisedText(undefined, "loading", "tips") as string[] | undefined) ?? [];
  const tip = tips[Math.floor(Math.random() * tips.length)];
</script>

<div class="loading col centre gap-lg" class:hidden={!visible} role="status" aria-live="polite" inert={!visible}>
  <span class="sr-only">{getLocalisedText(undefined, "loading", "label")}</span>
  <span class="orbit glow" aria-hidden="true">
    <span class="cube"></span>
    <span class="cube"></span>
  </span>
  {#if tip}
    <p class="tip md muted">{tip}</p>
  {/if}
</div>

<style>
  .loading {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: var(--azure-spacing-xl);
    background-color: var(--colours-background);
    transition:
      opacity var(--azure-duration-glide) var(--azure-ease-fluid),
      visibility 0s linear 0s;
  }

  .loading.hidden {
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--azure-duration-glide) var(--azure-ease-fluid),
      visibility 0s linear var(--azure-duration-glide);
  }

  .orbit {
    position: relative;
    width: 40px;
    height: 40px;
  }

  .cube {
    position: absolute;
    top: 0;
    left: 0;
    width: 14px;
    height: 14px;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-accent);
    animation: travel 1.8s var(--azure-ease-in-out) infinite;
  }

  .cube:nth-child(2) {
    background-color: var(--colours-accent-strong);
    animation-delay: -0.9s;
  }

  @keyframes travel {
    25% {
      transform: translateX(26px) rotate(-90deg) scale(0.6);
    }
    50% {
      transform: translate(26px, 26px) rotate(-180deg);
    }
    75% {
      transform: translateY(26px) rotate(-270deg) scale(0.6);
    }
    100% {
      transform: rotate(-360deg);
    }
  }

  .tip {
    max-width: 32ch;
    margin: 0;
    text-align: center;
    animation: rise var(--azure-duration-slow) var(--azure-ease-out) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cube {
      animation: breathe 2.4s var(--azure-ease-in-out) infinite alternate;
    }

    .cube:nth-child(2) {
      display: none;
    }

    .orbit {
      display: grid;
      place-items: center;
    }

    .cube {
      position: static;
    }

    .loading,
    .loading.hidden {
      transition-duration: 0s;
    }
  }

  @keyframes breathe {
    to {
      opacity: 0.4;
    }
  }
</style>
