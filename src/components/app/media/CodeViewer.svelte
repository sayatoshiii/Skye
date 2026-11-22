<script lang="ts">
  import { writeClipboard } from "../../../scripts/stores/toast";
  import { dismissible } from "../../../scripts/misc/dismiss.svelte";
  import { portal } from "../../../scripts/misc/portal";
  import { escapeHTML } from "../../../scripts/misc/emoji";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";

  let {
    source,
    language,
    html,
    onclose,
  }: {
    source: string;
    language: string;
    html: string | null;
    onclose: () => void;
  } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const lines = $derived(source.replace(/\n$/, "").split("\n").length);
  const exit = dismissible(() => onclose());

  let copied = $state(false);
  let dialog: HTMLDivElement | undefined = $state();

  $effect(() => {
    dialog?.focus();
  });

  const copy = () => {
    writeClipboard(source).then(() => {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    });
  };
</script>

<span class="portal-anchor" hidden></span>
<div class="viewer-layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="viewer-scrim ghost" tabindex="-1" aria-hidden="true" onclick={exit.close}></button>
  <div
    class="viewer col"
    role="dialog"
    aria-modal="true"
    aria-label={language || text("chat", "view_code")}
    tabindex="-1"
    bind:this={dialog}
    inert={exit.closing}
    onanimationend={exit.onanimationend}
    onkeydown={(event) => event.key === "Escape" && exit.close()}
  >
    <div class="viewer-head row-nw align-centre gap-sm">
      <span class="viewer-language sm">{language}</span>
      <button type="button" class="viewer-button ghost press sm" class:done={copied} onclick={copy}>
        {copied ? `✓ ${text("chat", "copied_code")}` : text("chat", "copy_code")}
      </button>
      <button type="button" class="viewer-button viewer-close ghost press" aria-label={text("chat", "close_code")} onclick={exit.close}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
    <div class="viewer-scroll selectable">
      {#if lines > 1}
        <span class="viewer-lines" aria-hidden="true">{#each { length: lines }, index (index)}<span></span>{/each}</span>
      {/if}
      <code class:hljs={!!html}>{@html html ?? escapeHTML(source)}</code>
    </div>
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .viewer-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
    padding: var(--azure-spacing-lg);
  }

  .viewer-scrim {
    position: absolute;
    inset: 0;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
    animation: fade-in var(--azure-duration-md) var(--azure-ease-out);
  }

  .viewer {
    position: relative;
    width: min(100%, 1100px);
    height: min(100%, 90vh);
    overflow: hidden;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    animation: rise-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .viewer-head {
    flex: none;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm) var(--azure-spacing-xs) var(--azure-spacing-lg);
    border-bottom: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
  }

  .viewer-language {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colours-text-faint);
  }

  .viewer-button {
    min-height: 32px;
    min-width: 32px;
    display: grid;
    place-items: center;
    padding: 0 var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .viewer-close {
    padding: 0;
  }

  .viewer-button:hover,
  .viewer-button:focus-visible {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
    outline: none;
  }

  .viewer-button.done {
    color: var(--colours-success);
  }

  .viewer-scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    padding: var(--azure-spacing-md) var(--azure-spacing-md) var(--azure-spacing-md) 0;
    overflow: auto;
    overscroll-behavior: contain;
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: var(--text-sm);
    line-height: 1.5;
    white-space: pre;
    color: var(--colours-text);
  }

  .viewer-scroll code {
    flex: 1 0 auto;
    height: max-content;
    padding-left: var(--azure-spacing-md);
    font: inherit;
  }

  .viewer-lines {
    position: sticky;
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    flex: none;
    height: max-content;
    min-height: 100%;
    padding: 0 var(--azure-spacing-sm) 0 var(--azure-spacing-md);
    text-align: right;
    color: var(--colours-text-faint);
    background-color: var(--colours-foreground);
    border-right: 1px solid var(--colours-outline-hairline);
    user-select: none;
    -webkit-user-select: none;
    counter-reset: line;
  }

  .viewer-lines > span {
    display: block;
    height: 1.5em;
  }

  .viewer-lines > span::before {
    counter-increment: line;
    content: counter(line);
  }

  .viewer-scroll :global(:is(.hljs-comment, .hljs-quote, .hljs-emphasis)) {
    font-style: italic;
  }

  .viewer-scroll :global(.hljs-strong) {
    font-weight: 700;
  }

  .closing .viewer-scrim {
    animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .viewer {
    animation: exit-drop var(--azure-duration-md) var(--azure-ease-out) forwards;
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

  @media (max-width: 767px) {
    .viewer-layer {
      padding: 0;
    }

    .viewer {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: 0;
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }

    .viewer-button {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }
  }
</style>
