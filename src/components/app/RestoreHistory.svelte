<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { isBackupError } from "../../scripts/matrix/utilities/backup";
  import type { VerificationPhase, VerificationState } from "../../scripts/matrix/verification";
  import {
    acceptVerification,
    cancelVerification,
    clearVerification,
    confirmVerification,
    hasKeyBackup,
    restoreHistory,
    restoreOpen,
    startVerification,
    verification,
  } from "../../scripts/stores/matrix";

  type Mode = "key" | "phrase";
  type Phase = "checking" | "missing" | "idle" | "restoring" | "done";

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  let open = $state(false);
  let mode = $state<Mode>("key");
  let phase = $state<Phase>("checking");
  let secret = $state("");
  let error = $state("");
  let progress = $state({ imported: 0, total: 0 });
  let field: HTMLInputElement | undefined = $state();
  let flow = $state.raw<VerificationState | null>(null);

  const CANCELLABLE: VerificationPhase[] = ["requesting", "incoming", "waiting", "comparing", "confirming"];
  const SETTLED: VerificationPhase[] = ["restored", "cancelled", "failed"];
  const BUSY: VerificationPhase[] = ["requesting", "waiting", "confirming", "syncing", "restoring"];

  const verifying = $derived(!!flow && flow.phase !== "idle");

  const fill = (template: string, values: Record<string, number>) =>
    Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, String(value)),
      template,
    );

  const close = () => {
    if (phase === "restoring") return;
    if (flow && CANCELLABLE.includes(flow.phase)) cancelVerification();
    queueMicrotask(() => restoreOpen.set(false));
  };

  const reset = async () => {
    if (flow && SETTLED.includes(flow.phase)) clearVerification();
    secret = "";
    error = "";
    progress = { imported: 0, total: 0 };
    phase = "checking";
    phase = (await hasKeyBackup().catch(() => true)) ? "idle" : "missing";
  };

  const describeError = (cause: unknown) =>
    isBackupError(cause)
      ? text("encryption", "errors", cause.code)
      : text("encryption", "errors", "generic");

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!secret.trim() || phase === "restoring") return;

    error = "";
    phase = "restoring";

    try {
      progress = await restoreHistory(secret, mode === "phrase", (next) => (progress = next));
      secret = "";
      phase = "done";
    } catch (cause) {
      error = describeError(cause);
      phase = "idle";
    }
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (open && event.key === "Escape") close();
  };

  $effect(() => verification.subscribe((value) => (flow = value)));

  $effect(() =>
    restoreOpen.subscribe((value) => {
      open = value;
      if (value) reset();
    }),
  );

  $effect(() => {
    if (open && phase === "idle" && !verifying) field?.focus();
  });
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="dialog surface col gap-lg" role="dialog" aria-modal="true" aria-labelledby="restore-title">
    {#if verifying && flow}
      <header class="col gap-sm">
        <h2 id="restore-title" class="lg bold">
          {text("encryption", "verify", flow.phase === "incoming" ? "incoming_title" : "title")}
        </h2>
        {#if flow.deviceId}
          <p class="xs muted mono">{text("encryption", "verify", "device").replace("{device}", flow.deviceId)}</p>
        {/if}
      </header>

      {#if flow.phase === "incoming"}
        <p class="sm">{text("encryption", "verify", "incoming")}</p>
        <div class="actions col gap-sm">
          <button type="button" class="primary press" onclick={acceptVerification}>{text("encryption", "verify", "accept")}</button>
          <button type="button" class="secondary press" onclick={cancelVerification}>{text("encryption", "verify", "decline")}</button>
        </div>
      {:else if flow.phase === "comparing"}
        <p class="sm muted">{text("encryption", "verify", "compare")}</p>
        <ol class="emoji" aria-live="polite">
          {#each flow.emoji as item, index (index)}
            <li class="glyph col">
              <span class="symbol" aria-hidden="true">{item.symbol}</span>
              <span class="xs muted">{item.description}</span>
            </li>
          {/each}
        </ol>
        <div class="actions col gap-sm">
          <button type="button" class="primary press" onclick={confirmVerification}>{text("encryption", "verify", "match")}</button>
          <button type="button" class="secondary press" onclick={cancelVerification}>{text("encryption", "verify", "mismatch")}</button>
        </div>
      {:else if BUSY.includes(flow.phase)}
        <div class="status row-nw gap-md" aria-live="polite">
          <span class="pulse" aria-hidden="true"></span>
          <p class="sm">{text("encryption", "verify", flow.phase)}</p>
        </div>
        {#if flow.phase === "restoring" && flow.progress.total}
          <p class="xs muted" aria-live="polite">{fill(text("encryption", "progress"), flow.progress)}</p>
        {/if}
        {#if CANCELLABLE.includes(flow.phase)}
          <button type="button" class="secondary press" onclick={cancelVerification}>{text("encryption", "cancel")}</button>
        {:else}
          <button type="button" class="secondary press" onclick={close}>{text("encryption", "close")}</button>
        {/if}
      {:else if flow.phase === "restored"}
        <p class="sm" role="status">{fill(text("encryption", "done"), flow.progress)}</p>
        <button type="button" class="primary press" onclick={close}>{text("encryption", "close")}</button>
      {:else}
        <p class="sm" class:error={flow.phase === "failed"} role="alert">
          {flow.phase === "failed"
            ? text("encryption", "errors", flow.error ?? "generic")
            : text("encryption", "verify", "cancelled")}
        </p>
        <div class="actions col gap-sm">
          <button type="button" class="primary press" onclick={startVerification}>{text("encryption", "verify", "retry")}</button>
          <button type="button" class="secondary press" onclick={clearVerification}>{text("encryption", "verify", "back")}</button>
        </div>
      {/if}
    {:else}
    <header class="col gap-sm">
      <h2 id="restore-title" class="lg bold">{text("encryption", "title")}</h2>
      <p class="sm muted">{text("encryption", "description")}</p>
    </header>

    {#if phase === "idle" || phase === "missing"}
      <div class="col gap-sm">
        <button type="button" class="primary press" onclick={startVerification}>{text("encryption", "verify", "action")}</button>
        <p class="xs muted hint">{text("encryption", "verify", "action_hint")}</p>
      </div>
      <div class="divider row-nw gap-md" role="separator">
        <span class="xs muted">{text("encryption", "verify", "or")}</span>
      </div>
    {/if}

    {#if phase === "checking"}
      <p class="sm muted" aria-live="polite">{text("encryption", "checking")}</p>
      <button type="button" class="secondary press" onclick={close}>{text("encryption", "cancel")}</button>
    {:else if phase === "missing"}
      <p class="sm muted" role="status">{text("encryption", "errors", "no_backup")}</p>
      <button type="button" class="secondary press" onclick={close}>{text("encryption", "close")}</button>
    {:else if phase === "done"}
      <p class="sm" role="status">{fill(text("encryption", "done"), progress)}</p>
      <button type="button" class="primary press" onclick={close}>{text("encryption", "close")}</button>
    {:else}
      <form class="col gap-md" onsubmit={submit}>
        <div class="modes row-nw" role="radiogroup">
          {#each ["key", "phrase"] as const as option (option)}
            <button
              type="button"
              class="mode ghost press sm bold"
              role="radio"
              aria-checked={mode === option}
              disabled={phase === "restoring"}
              onclick={() => {
                mode = option;
                error = "";
              }}
            >
              {text("encryption", option === "key" ? "mode_key" : "mode_phrase")}
            </button>
          {/each}
        </div>

        <label class="col gap-sm">
          <span class="xs bold label">{text("encryption", mode === "key" ? "key_label" : "phrase_label")}</span>
          <input
            class="input secret"
            class:mono={mode === "key"}
            type={mode === "key" ? "text" : "password"}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder={mode === "key" ? text("encryption", "key_hint") : ""}
            aria-invalid={!!error}
            disabled={phase === "restoring"}
            bind:value={secret}
            bind:this={field}
          />
        </label>

        {#if error}<p class="error sm" role="alert">{error}</p>{/if}
        {#if phase === "restoring" && progress.total}
          <p class="xs muted" aria-live="polite">{fill(text("encryption", "progress"), progress)}</p>
        {/if}

        <div class="actions col gap-sm">
          <button type="submit" class="secondary press" disabled={phase === "restoring" || !secret.trim()}>
            {text("encryption", phase === "restoring" ? "restoring" : "submit")}
          </button>
          <button type="button" class="secondary press" disabled={phase === "restoring"} onclick={close}>{text("encryption", "cancel")}</button>
        </div>
      </form>
    {/if}
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    background-color: var(--colours-scrim);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--azure-z-popover);
    width: min(420px, calc(100vw - 2 * var(--azure-spacing-lg)));
    max-height: calc(100dvh - 2 * var(--azure-spacing-lg));
    overflow-y: auto;
    box-sizing: border-box;
    padding: var(--azure-spacing-xl);
    background-color: var(--colours-surface-raised);
    border-radius: var(--azure-radius-lg);
    box-shadow:
      0 24px 48px -12px hsla(0, 0%, 0%, 0.65),
      0 0 64px -16px var(--colours-accent-glow),
      inset 0 1px 0 hsla(0, 0%, 100%, 0.06);
    transform: translate(-50%, -50%);
    animation: rise var(--azure-duration-slow) var(--azure-ease-spring);
  }

  h2 {
    margin: 0;
    color: var(--colours-text-strong);
  }

  p {
    margin: 0;
  }

  .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  .modes {
    padding: 3px;
    border: 1px solid var(--colours-outline-hairline);
    border-radius: var(--azure-radius-pill);
  }

  .mode {
    flex: 1;
    min-height: 34px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-text-muted);
  }

  .mode:hover {
    color: var(--colours-text);
  }

  .mode[aria-checked="true"] {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-active);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
  }

  .secret {
    width: 100%;
    box-sizing: border-box;
    padding: var(--azure-spacing-md);
  }

  .mono {
    font-family: ui-monospace, monospace;
  }

  .secret[aria-invalid="true"] {
    border-color: color-mix(in oklab, var(--colours-danger) 55%, transparent);
  }

  .error {
    color: var(--colours-danger);
  }

  .hint {
    text-align: center;
  }

  .divider {
    align-items: center;
  }

  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background-color: var(--colours-outline-hairline);
  }

  .divider span {
    white-space: nowrap;
    color: var(--colours-text-faint);
  }

  .emoji {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--azure-spacing-sm);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .glyph {
    align-items: center;
    gap: var(--azure-spacing-xs);
    min-height: 76px;
    padding: var(--azure-spacing-sm) var(--azure-spacing-xs);
    box-sizing: border-box;
    justify-content: center;
    text-align: center;
    border: 1px solid var(--colours-outline-hairline);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface-hover);
    animation: fade var(--azure-duration-md) var(--azure-ease-out) backwards;
  }

  .glyph:nth-child(4) ~ .glyph {
    transform: translateX(50%);
  }

  .symbol {
    font-size: 30px;
    line-height: 1.1;
  }

  .status {
    align-items: center;
  }

  .pulse {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--colours-accent);
    box-shadow: 0 0 12px var(--colours-accent-glow);
    animation: pulse 1.4s var(--azure-ease-out) infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
      transform: scale(0.8);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse,
    .glyph {
      animation: none;
    }
  }

  .primary,
  .secondary {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: calc(var(--azure-touch) + 4px);
    padding: 0 var(--azure-spacing-xl);
    box-sizing: border-box;
    border-radius: var(--azure-radius-pill);
    font: inherit;
    font-size: var(--text-md);
    font-weight: 700;
    cursor: pointer;
  }

  .primary {
    border: 1px solid color-mix(in oklab, var(--colours-accent) 28%, transparent);
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 10%, transparent);
  }

  .primary:hover:not(:disabled) {
    color: var(--colours-text-strong);
    border-color: color-mix(in oklab, var(--colours-accent) 45%, transparent);
    background-color: color-mix(in oklab, var(--colours-accent) 18%, transparent);
  }

  .primary:disabled,
  .secondary:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .secondary {
    color: var(--colours-text);
    background-color: transparent;
    border: 1px solid var(--colours-outline-hairline);
  }

  .secondary:hover:not(:disabled) {
    background-color: var(--colours-surface-hover);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 12px)) scale(0.97);
    }
  }

  @media (max-width: 767px) {
    .dialog {
      top: auto;
      bottom: 0;
      width: 100%;
      max-height: 90dvh;
      padding-bottom: calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      border-bottom: 0;
      transform: translateX(-50%);
      animation-name: sheet;
    }
  }

  @keyframes sheet {
    from {
      transform: translate(-50%, 100%);
    }
  }
</style>
