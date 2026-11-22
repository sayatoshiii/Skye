<script lang="ts">
  import KeyText from "./KeyText.svelte";
  import type { Snippet } from "svelte";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";

  let {
    title,
    body,
    cancelLabel,
    confirmLabel,
    tone = "danger",
    busy = false,
    onconfirm,
    onclose,
    children,
    actions,
  }: {
    title: string;
    body?: string;
    cancelLabel: string;
    confirmLabel?: string;
    tone?: "danger" | "primary";
    busy?: boolean;
    onconfirm?: (event: MouseEvent) => void;
    onclose: () => void;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  const id = `confirm-${Math.random().toString(36).slice(2)}`;

  const exit = dismissible(() => onclose());

  export const dismiss = exit.close;

  const close = () => !busy && exit.close();
</script>

<span class="portal-anchor" hidden></span>
<div class="confirm-layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="confirm-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="confirm col gap-md" onanimationend={exit.onanimationend} inert={exit.closing} role="alertdialog" aria-modal="true" aria-labelledby={id} aria-busy={busy} tabindex="-1" onkeydown={(event) => event.key === "Escape" && close()}>
    <h3 {id} class="md bold">{title}</h3>
    {#if body}<p class="sm muted"><KeyText text={body} /></p>{/if}
    {@render children?.()}
    <div class="actions row gap-sm">
      <button type="button" class="dialog-button ghost press sm bold" disabled={busy} onclick={close}>{cancelLabel}</button>
      {#if actions}
        {@render actions()}
      {:else if confirmLabel && onconfirm}
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" class="dialog-button ghost press sm bold {tone}" disabled={busy} autofocus onclick={onconfirm}>{confirmLabel}</button>
      {/if}
    </div>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .confirm-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
    padding: var(--azure-spacing-lg);
  }

  .confirm-scrim {
    position: absolute;
    inset: 0;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
    animation: fade-in var(--azure-duration-md) var(--azure-ease-out);
  }

  .confirm {
    position: relative;
    width: min(100%, 400px);
    padding: var(--azure-spacing-xl);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    animation: rise-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .confirm h3,
  .confirm p {
    margin: 0;
  }

  .confirm h3 {
    color: var(--colours-text-strong);
    overflow-wrap: anywhere;
  }

  .actions {
    justify-content: flex-end;
  }

  .confirm :global(.dialog-button) {
    min-height: 36px;
    padding: 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-fast) var(--azure-ease-out);
  }

  .confirm :global(.dialog-button:disabled) {
    opacity: 0.6;
    cursor: default;
  }

  .confirm :global(.dialog-button:hover:not(:disabled)) {
    background-color: var(--colours-surface-hover);
  }

  .confirm :global(.dialog-button.danger) {
    color: white;
    background-color: var(--colours-danger);
  }

  .confirm :global(.dialog-button.primary) {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .confirm :global(.dialog-button.primary:hover:not(:disabled)) {
    background-color: color-mix(in oklab, var(--colours-accent) 85%, white);
    box-shadow: 0 0 20px -6px var(--colours-accent-glow);
  }

  .confirm :global(.dialog-button.danger:hover:not(:disabled)) {
    background-color: color-mix(in oklab, var(--colours-danger) 85%, white);
    box-shadow: 0 0 20px -6px var(--colours-danger);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .closing .confirm-scrim {
    animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .confirm {
    animation: exit-drop var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  @media (max-width: 767px) {
    .confirm :global(.dialog-button) {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }

    .confirm-layer {
      justify-content: flex-end;
      padding: 0;
    }

    .confirm {
      width: 100%;
      padding-bottom: calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }
  }
</style>
