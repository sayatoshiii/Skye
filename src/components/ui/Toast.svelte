<script lang="ts">
  import KeyText from "./KeyText.svelte";
  import { currentToast, type Toast } from "../../scripts/stores/toast";

  const PATHS: Record<Toast["icon"], string> = {
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 4a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
    id: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16",
    pin: "M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6",
    unpin: "M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6M4 4l16 16",
    check: "M5 12l4 4L19 6",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    save: "M12 4v11m-5-5 5 5 5-5M5 20h14",
    hide: "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2",
    show: "M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Zm9-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
    leave: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
    unread: "M20 11v5a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2h7M19 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
    mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0m-7 7v3M4 4l16 16",
    location: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  };

  let shown: Toast | null = $state.raw(null);
  let leaving = $state(false);

  $effect(() =>
    currentToast.subscribe((value) => {
      if (value) {
        shown = value;
        leaving = false;
      } else if (shown) leaving = true;
    }),
  );

  const onanimationend = (event: AnimationEvent) => {
    if (leaving && event.target === event.currentTarget) {
      shown = null;
      leaving = false;
    }
  };
</script>

<div class="toast-region" role="status" aria-live="polite">
  {#if shown}
    {#key shown.id}
      <div class="toast-pill {shown.tone}" class:closing={leaving} {onanimationend}>
        <span class="toast-icon">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d={PATHS[shown.icon]} /></svg>
        </span>
        <span class="toast-text"><KeyText text={shown.text} /></span>
      </div>
    {/key}
  {/if}
</div>

<style>
  .toast-region {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--azure-z-toast, 300);
    pointer-events: none;
  }

  .toast-pill {
    --tone: var(--colours-text);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 6px;
    border-radius: 999px;
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
    color: var(--colours-text);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    animation: toast-in 380ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .toast-pill.success {
    --tone: var(--colours-success);
  }

  .toast-pill.danger {
    --tone: var(--colours-danger);
  }

  .toast-pill.accent {
    --tone: var(--colours-accent);
  }

  .toast-pill.success,
  .toast-pill.danger,
  .toast-pill.accent {
    background-color: color-mix(in oklab, var(--tone) 18%, var(--colours-surface-raised));
    border-color: color-mix(in oklab, var(--tone) 40%, transparent);
  }

  .toast-pill.closing {
    animation: exit-fade 160ms ease-in forwards;
  }

  .toast-icon {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: color-mix(in oklab, var(--tone) 22%, transparent);
    color: var(--tone);
  }

  .toast-icon path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.92);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast-pill {
      animation-duration: 1ms;
    }
  }
</style>
