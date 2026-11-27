<script lang="ts">
  import Button from "./Button.svelte";
  import KeyText from "./KeyText.svelte";
  import { SETTINGS_ICONS } from "../settings/icons";
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
  <button type="button" class="confirm-scrim modal-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="confirm modal-sheet col gap-md" onanimationend={exit.onanimationend} inert={exit.closing} role="alertdialog" aria-modal="true" aria-labelledby={id} aria-busy={busy} tabindex="-1" onkeydown={(event) => event.key === "Escape" && close()}>
    <header class="head row-nw align-start gap-sm">
      <h3 {id} class="bold flex-max">{title}</h3>
      <Button variant="quiet" class="dismiss" icon={SETTINGS_ICONS.close} aria-label={cancelLabel} disabled={busy} onclick={close} />
    </header>
    {#if body}<p class="muted body"><KeyText text={body} /></p>{/if}
    {@render children?.()}
    <div class="actions row gap-sm">
      <Button variant="secondary" disabled={busy} onclick={close}>{cancelLabel}</Button>
      {#if actions}
        {@render actions()}
      {:else if confirmLabel && onconfirm}
        <Button variant={tone} disabled={busy} autofocus onclick={onconfirm}>{confirmLabel}</Button>
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
  }

  .confirm {
    position: relative;
    width: min(100%, 400px);
    padding: var(--azure-spacing-xl);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
  }

  .confirm h3,
  .confirm p {
    margin: 0;
  }

  .confirm h3 {
    padding-top: 4px;
    font-size: var(--text-lg);
    color: var(--colours-text-strong);
    overflow-wrap: anywhere;
  }

  .head :global(.dismiss) {
    flex: none;
    margin: -6px -10px 0 0;
  }

  .body {
    font-size: var(--text-md);
    line-height: 1.5;
  }

  .actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-top: var(--azure-spacing-xs);
  }

  .actions :global(.button) {
    font-size: var(--text-md);
  }

  .confirm:has(.actions > :global(:nth-child(3))) {
    width: min(100%, 580px);
  }

  @media (max-width: 767px) {
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
