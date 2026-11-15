<script lang="ts">
  import { getMediaLink } from "../../../scripts/matrix/utilities/media";
  import { HTML_FORMAT, renderFormatted, renderPlain, stripReplyFallback } from "../../../scripts/misc/formatting";

  let {
    content,
    ownUserId,
    resolveName,
  }: {
    content: Record<string, any>;
    ownUserId?: string;
    resolveName?: (userId: string) => string | undefined;
  } = $props();

  let root: HTMLElement | undefined = $state();

  const isHtml = $derived(content.format === HTML_FORMAT && typeof content.formatted_body === "string");

  const rendered = $derived.by(() => {
    const isReply = !!content["m.relates_to"]?.["m.in_reply_to"];
    const html = content.format === HTML_FORMAT && typeof content.formatted_body === "string" ? content.formatted_body : null;
    if (html) return renderFormatted(html, { ownUserId, resolveName });
    const body = typeof content.body === "string" ? content.body : "";
    return renderPlain(isReply ? stripReplyFallback(body) : body);
  });

  $effect(() => {
    rendered;
    root?.querySelectorAll<HTMLImageElement>("img[data-mxc]").forEach((image) => {
      getMediaLink(image.dataset.mxc!, 256).then((link) => link && (image.src = link));
    });
  });

  const reveal = (event: Event) => {
    const spoiler = (event.target as HTMLElement).closest?.(".spoiler");
    if (!spoiler || spoiler.classList.contains("revealed")) return;
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    spoiler.classList.add("revealed");
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="rich" class:formatted={isHtml} bind:this={root} onclick={reveal} onkeydown={reveal}>{@html rendered.html}</span>

<style>
  .rich.formatted {
    white-space: normal;
  }

  .rich :global(a) {
    color: var(--colours-accent);
    text-decoration: none;
  }

  .rich :global(a:hover) {
    text-decoration: underline;
  }

  .rich :global(a.mention) {
    padding: 0 4px;
    border-radius: var(--azure-radius-sm);
    font-weight: 600;
    color: var(--colours-accent-strong);
    background-color: var(--colours-accent-soft);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .rich :global(a.mention:hover) {
    text-decoration: none;
    background-color: color-mix(in oklab, var(--colours-accent) 28%, transparent);
  }

  .rich :global(:is(p, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6, table, details)) {
    margin: var(--azure-spacing-xs) 0;
    white-space: normal;
  }

  .rich :global(:is(h1, h2, h3, h4, h5, h6)) {
    color: var(--colours-text-strong);
    line-height: 1.3;
  }

  .rich :global(h1) {
    font-size: 1.5em;
  }

  .rich :global(h2) {
    font-size: 1.3em;
  }

  .rich :global(:is(h3, h4, h5, h6)) {
    font-size: 1.1em;
  }

  .rich :global(:is(ul, ol)) {
    padding-left: 1.4em;
  }

  .rich :global(blockquote) {
    padding-left: var(--azure-spacing-md);
    border-left: 3px solid var(--colours-outline-strong);
    color: var(--colours-text-muted);
  }

  .rich :global(code) {
    padding: 1px 5px;
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
    font-size: 0.88em;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(pre) {
    position: relative;
    max-width: 100%;
    overflow-x: auto;
    padding: var(--azure-spacing-md);
    white-space: pre;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-foreground);
    border: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(pre[data-language])::before {
    content: attr(data-language);
    display: block;
    margin-bottom: var(--azure-spacing-sm);
    font-size: var(--text-xs);
    color: var(--colours-text-faint);
  }

  .rich :global(pre code) {
    padding: 0;
    border: 0;
    background: none;
  }

  .rich :global(table) {
    border-collapse: collapse;
    display: block;
    overflow-x: auto;
  }

  .rich :global(:is(th, td)) {
    padding: 4px 8px;
    border: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(hr) {
    border: 0;
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(img.inline-image) {
    max-width: 256px;
    max-height: 256px;
    vertical-align: middle;
    border-radius: var(--azure-radius-sm);
  }

  .rich :global(.spoiler) {
    border-radius: var(--azure-radius-sm);
    cursor: pointer;
    color: transparent;
    background-color: var(--colours-surface-pressed);
    transition:
      color var(--azure-duration-md) var(--azure-ease-out),
      background-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .rich :global(.spoiler *) {
    visibility: hidden;
  }

  .rich :global(.spoiler:hover) {
    background-color: var(--colours-outline-strong);
  }

  .rich :global(.spoiler.revealed) {
    cursor: text;
    color: inherit;
    background-color: var(--colours-surface-hover);
  }

  .rich :global(.spoiler.revealed *) {
    visibility: visible;
  }
</style>
