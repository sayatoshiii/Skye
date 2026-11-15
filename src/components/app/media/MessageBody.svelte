<script lang="ts">
  import { getMediaLink } from "../../../scripts/matrix/utilities/media";
  import { HTML_FORMAT, renderFormatted, renderPlain, stripReplyFallback } from "../../../scripts/misc/formatting";
  import { isJumbo } from "../../../scripts/misc/emoji";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import EmojiInfo from "../../ui/EmojiInfo.svelte";
  import CodeViewer from "./CodeViewer.svelte";

  let {
    content,
    ownUserId,
    resolveName,
    jumbo = false,
    interactive = true,
    highlight = true,
  }: {
    highlight?: boolean;
    content: Record<string, any>;
    jumbo?: boolean;
    interactive?: boolean;
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

  let info: { anchor: HTMLElement; unicode: string; src: string } | null = $state.raw(null);
  let infoCard: EmojiInfo | undefined = $state();

  const large = $derived.by(() => {
    if (!jumbo || !rendered.html.includes('class="emoji"')) return false;
    const body = typeof content.body === "string" ? content.body : "";
    return isJumbo(content["m.relates_to"]?.["m.in_reply_to"] ? stripReplyFallback(body) : body);
  });

  $effect(() => {
    rendered;
    if (!interactive) return;
    root?.querySelectorAll<HTMLImageElement>("img.emoji").forEach((image) => {
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", image.alt);
      image.setAttribute("aria-haspopup", "dialog");
    });
  });

  const openEmoji = (event: Event) => {
    if (!interactive) return false;
    const image = (event.target as HTMLElement).closest?.("img.emoji") as HTMLImageElement | null;
    if (!image || image.closest(".spoiler:not(.revealed)")) return false;
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return false;
    event.preventDefault();
    event.stopPropagation();
    if (info?.anchor === image) infoCard?.dismiss();
    else info = { anchor: image, unicode: image.alt, src: image.src };
    return true;
  };

  $effect(() => {
    rendered;
    root?.querySelectorAll<HTMLImageElement>("img[data-mxc]").forEach((image) => {
      getMediaLink(image.dataset.mxc!, 256).then((link) => link && (image.src = link));
    });
  });

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const VIEW_LINES = 60;
  const VIEW_CHARS = 4000;

  let viewer: { source: string; language: string; html: string | null } | null = $state.raw(null);

  const lineCount = (source: string) => source.replace(/\n$/, "").split("\n").length;

  const gutter = (lines: number) => {
    const column = document.createElement("span");
    column.className = "code-lines";
    column.setAttribute("aria-hidden", "true");
    column.innerHTML = "<span></span>".repeat(lines);
    return column;
  };

  $effect(() => {
    rendered;
    if (!root || !highlight) return;
    let live = true;
    const blocks = [...root.querySelectorAll<HTMLElement>("pre > code")];
    if (!blocks.length) return;
    import("../../../scripts/misc/highlight").then(({ highlightCode }) => {
      blocks.forEach(async (code) => {
        const pre = code.parentElement!;
        if (pre.querySelector(":scope > .code-head")) return;
        const head = document.createElement("div");
        head.className = "code-head";
        const label = document.createElement("span");
        label.className = "code-language";
        label.textContent = pre.dataset.language ?? "";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "code-copy";
        copy.textContent = text("chat", "copy_code");
        const source = code.textContent ?? "";
        const lines = lineCount(source);
        head.append(label);
        if (lines > VIEW_LINES || source.length > VIEW_CHARS) {
          const expand = document.createElement("button");
          expand.type = "button";
          expand.className = "code-copy code-expand";
          expand.textContent = text("chat", "view_code");
          head.append(expand);
        }
        head.append(copy);
        const body = document.createElement("div");
        body.className = "code-scroll";
        code.replaceWith(body);
        if (lines > 1) body.append(gutter(lines));
        body.append(code);
        pre.prepend(head);
        const html = await highlightCode(source, pre.dataset.language).catch(() => null);
        if (!live || !html || !code.isConnected || code.textContent !== source) return;
        code.innerHTML = html;
        code.classList.add("hljs");
      });
    });
    return () => {
      live = false;
    };
  });

  const copyCode = (event: Event) => {
    const button = (event.target as HTMLElement).closest?.(".code-copy") as HTMLButtonElement | null;
    if (!button || !root?.contains(button)) return false;
    event.stopPropagation();
    if (event instanceof KeyboardEvent) return true;
    const pre = button.closest("pre");
    const code = pre?.querySelector<HTMLElement>(".code-scroll > code");
    const source = code?.textContent ?? "";
    if (button.classList.contains("code-expand")) {
      viewer = { source, language: pre?.dataset.language ?? "", html: code?.classList.contains("hljs") ? code.innerHTML : null };
      return true;
    }
    navigator.clipboard?.writeText(source).then(() => {
      button.textContent = `\u2713 ${text("chat", "copied_code")}`;
      button.classList.add("done");
      setTimeout(() => {
        button.textContent = text("chat", "copy_code");
        button.classList.remove("done");
      }, 1500);
    });
    return true;
  };

  const reveal = (event: Event) => {
    if (copyCode(event)) return;
    if (openEmoji(event)) return;
    const spoiler = (event.target as HTMLElement).closest?.(".spoiler");
    if (!spoiler || spoiler.classList.contains("revealed")) return;
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    spoiler.classList.add("revealed");
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="rich" class:formatted={isHtml} class:jumbo={large} bind:this={root} onclick={reveal} onkeydown={reveal}>{@html rendered.html}</span>
{#if info}
  {#key info}
    <EmojiInfo bind:this={infoCard} anchor={info.anchor} unicode={info.unicode} src={info.src} onclose={() => (info = null)} />
  {/key}
{/if}
{#if viewer}
  <CodeViewer source={viewer.source} language={viewer.language} html={viewer.html} onclose={() => (viewer = null)} />
{/if}

<style>
  .rich :global(img.emoji[role="button"]) {
    cursor: pointer;
    outline: none;
  }

  .rich :global(img.emoji[role="button"]:focus-visible) {
    border-radius: var(--azure-radius-sm);
    box-shadow: 0 0 0 2px var(--colours-accent);
  }

  .rich.jumbo {
    display: block;
    line-height: 1;
  }

  .rich.jumbo :global(img.emoji) {
    width: 48px;
    height: 48px;
    margin: 2px 1px;
    vertical-align: bottom;
  }

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
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    border-radius: var(--azure-radius-sm);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(pre) {
    max-width: 100%;
    padding: 0;
    overflow: hidden;
    white-space: pre;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-foreground);
    border: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(pre > .code-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--azure-spacing-sm);
    padding: 4px var(--azure-spacing-sm) 4px var(--azure-spacing-md);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--colours-text-faint);
    white-space: normal;
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .rich :global(.code-copy) {
    padding: 2px 8px;
    border: 0;
    border-radius: var(--azure-radius-sm);
    font: inherit;
    color: var(--colours-text-muted);
    background: none;
    cursor: pointer;
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .rich :global(.code-copy:hover),
  .rich :global(.code-copy:focus-visible) {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
    outline: none;
  }

  .rich :global(.code-copy.done) {
    color: var(--colours-success);
  }

  .rich :global(pre code) {
    display: block;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
  }

  .rich :global(pre > code) {
    padding: var(--azure-spacing-md);
    overflow-x: auto;
  }

  .rich :global(.code-scroll) {
    display: flex;
    max-height: calc(var(--code-max-lines) * 1.5em + 2 * var(--azure-spacing-md));
    padding: var(--azure-spacing-md) var(--azure-spacing-md) var(--azure-spacing-md) 0;
    overflow: auto;
    font-family: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    line-height: 1.5;
    overscroll-behavior: contain;
    --code-max-lines: 20;
  }

  .rich :global(.code-scroll > code) {
    flex: 1 0 auto;
    padding-left: var(--azure-spacing-md);
    font-size: 1em;
    line-height: inherit;
  }

  .rich :global(.code-language) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rich :global(.code-lines) {
    position: sticky;
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    flex: none;
    height: max-content;
    padding: 0 var(--azure-spacing-sm) 0 var(--azure-spacing-md);
    text-align: right;
    color: var(--colours-text-faint);
    background-color: var(--colours-foreground);
    border-right: 1px solid var(--colours-outline-hairline);
    user-select: none;
    -webkit-user-select: none;
    counter-reset: line;
  }

  .rich :global(.code-lines > span::before) {
    counter-increment: line;
    content: counter(line);
  }

  .rich :global(.code-lines > span) {
    display: block;
    height: 1.5em;
  }

  .rich :global(.hljs-comment),
  .rich :global(.hljs-quote) {
    font-style: italic;
  }

  .rich :global(.hljs-emphasis) {
    font-style: italic;
  }

  .rich :global(.hljs-strong) {
    font-weight: 700;
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
