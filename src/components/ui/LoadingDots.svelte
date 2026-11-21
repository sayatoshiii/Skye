<script lang="ts">
  let { label }: { label?: string } = $props();
</script>

<span class="dots row-nw gap-sm" role="status" aria-label={label}><span></span><span></span><span></span></span>

<style>
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    animation: pulse var(--azure-duration-glide) var(--azure-ease-in-out) infinite alternate;
  }

  .dots span:nth-child(2) {
    animation-delay: var(--azure-duration-fast);
  }

  .dots span:nth-child(3) {
    animation-delay: calc(var(--azure-duration-fast) * 2);
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
    }
  }
</style>
