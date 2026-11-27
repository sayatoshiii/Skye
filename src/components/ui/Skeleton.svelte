<script lang="ts">
  import { drift, haze } from "../../scripts/misc/haze";
  import { cubicOut } from "svelte/easing";

  let { kind, count = 8 }: { kind: "rooms" | "rail" | "messages"; count?: number } = $props();

  const widths = [62, 48, 74, 40, 56, 68, 44, 52, 70, 38, 60, 50];
</script>

<div class="skeleton {kind}" aria-hidden="true" in:haze={{ blur: 8, duration: 420, easing: cubicOut, scale: 1 }} out:drift={{ blur: 8, duration: 280, easing: cubicOut, scale: 1 }}>
  {#each { length: count }, index}
    <div class="row" style:--delay={`${index * 45}ms`}>
      {#if kind === "rail"}
        <span class="bone circle"></span>
      {:else if kind === "rooms"}
        <span class="bone dot"></span>
        <span class="bone line" style:width={`${widths[index % widths.length]}%`}></span>
      {:else}
        <span class="bone avatar"></span>
        <span class="lines">
          <span class="bone line name" style:width={`${widths[(index + 3) % widths.length] / 2}%`}></span>
          <span class="bone line" style:width={`${widths[index % widths.length] + 20}%`}></span>
          {#if index % 3 === 1}<span class="bone line" style:width={`${widths[(index + 5) % widths.length]}%`}></span>{/if}
        </span>
      {/if}
    </div>
  {/each}
  {#if kind === "messages"}
    <div class="composer bone-shell" style:--delay={`${count * 45}ms`}>
      <span class="bone dot"></span>
      <span class="bone line" style:width="28%"></span>
    </div>
  {/if}
</div>

<style>
  .skeleton {
    display: flex;
    flex-direction: column;
    pointer-events: none;
  }

  .rooms {
    gap: 6px;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
  }

  .rail {
    align-items: center;
    gap: var(--azure-spacing-sm);
  }

  .messages {
    justify-content: flex-end;
    gap: 22px;
    height: 100%;
    padding: var(--azure-spacing-lg);
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    animation: rise 520ms var(--delay) cubic-bezier(0.32, 0.72, 0, 1) both;
  }

  .rooms .row {
    height: 28px;
  }

  .messages .row .lines {
    max-width: 720px;
  }

  .composer {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: 48px;
    margin-top: var(--azure-spacing-xs);
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface);
    animation: rise 520ms var(--delay) cubic-bezier(0.32, 0.72, 0, 1) both;
  }

  .messages .row {
    align-items: flex-start;
    gap: 14px;
  }

  .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }

  .bone {
    display: block;
    flex: none;
    border-radius: var(--azure-radius-pill);
    background: linear-gradient(90deg, var(--colours-surface-hover) 20%, color-mix(in oklab, var(--colours-text-faint) 22%, transparent) 50%, var(--colours-surface-hover) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.6s linear infinite;
  }

  .line {
    height: 10px;
  }

  .name {
    height: 12px;
  }

  .dot {
    width: 18px;
    height: 18px;
    border-radius: 6px;
  }

  .circle {
    width: 48px;
    height: 48px;
    border-radius: 16px;
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      filter: blur(6px);
      translate: 0 4px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bone,
    .row {
      animation: none;
    }
  }
</style>
