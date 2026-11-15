<script lang="ts" module>
  export type Pending = { id: number; file: File; preview?: string; progress: number | null; error?: string };
</script>

<script lang="ts">
  import EmojiText from "../ui/EmojiText.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { formatBytes, sanitiseFilename } from "../../scripts/matrix/utilities/attachments";
  import { FORMAT_KEYS, formatEdit, highlightMarkdown, type Edit, type FormatAction } from "../../scripts/misc/markdown-highlight";

  type Props = {
    draft: string;
    field?: HTMLTextAreaElement;
    dockHeight?: number;
    label: string;
    replying: { name: string } | null;
    pending: Pending[];
    keepImageMetadata?: boolean;
    onsend: () => void;
    oncancelreply: () => void;
    onfiles: (files: File[]) => void;
    onremove: (id: number) => void;
    oneditlast: () => boolean;
    onmetadata: (keep: boolean) => void;
  };

  let {
    draft = $bindable(),
    field = $bindable(),
    dockHeight = $bindable(60),
    label,
    replying,
    pending,
    keepImageMetadata,
    onsend,
    oncancelreply,
    onfiles,
    onremove,
    oneditlast,
    onmetadata,
  }: Props = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const ICONS = {
    reply: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1",
  };

  const FORMAT_ICONS: Record<FormatAction, string> = {
    bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
    strike: "M5 12h14M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.4 1 2.3 3 2.8M8 16.5c.6 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3",
    spoiler: "m3 3 18 18M10.6 6.1Q11.3 6 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.5 7.5C4.3 9.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1M10 10a3 3 0 0 0 4 4",
    code: "m8 8-4 4 4 4m8-8 4 4-4 4",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    quote: "M5 5v14M10 8h9M10 12h9M10 16h6",
  };

  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modLabel = text("format", mac ? "mod_mac" : "mod");
  const touch = () => matchMedia("(pointer: coarse)").matches;

  let picker: HTMLInputElement | undefined = $state();
  let mirror: HTMLDivElement | undefined = $state();
  let toolbar: { x: number; y: number; below: boolean } | null = $state(null);

  const highlighted = $derived(highlightMarkdown(draft));
  const hasJpeg = $derived(pending.some((item) => item.file.type === "image/jpeg"));
  const ready = $derived(!!draft.trim() || pending.some((item) => !item.error && item.progress === null));
  const replyParts = $derived(text("chat", "replying_to").split("{name}"));

  const resize = () => {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    syncScroll();
  };

  const syncScroll = () => {
    if (mirror && field) mirror.scrollTop = field.scrollTop;
  };

  $effect(() => {
    draft;
    resize();
  });

  const locate = (offset: number): [Node, number] | null => {
    if (!mirror) return null;
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
      last = node;
    }
    return last ? [last, last.length] : null;
  };

  const updateToolbar = () => {
    if (!field || !mirror || document.activeElement !== field || field.selectionStart === field.selectionEnd || touch()) {
      toolbar = null;
      return;
    }
    syncScroll();
    const start = locate(field.selectionStart);
    const end = locate(field.selectionEnd);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const bounds = field.getBoundingClientRect();
    const first = rects.find((rect) => rect.bottom > bounds.top && rect.top < bounds.bottom) ?? rects[0];
    if (!first) return;
    const line = rects.filter((rect) => Math.abs(rect.top - first.top) < 2);
    const left = Math.min(...line.map((rect) => rect.left));
    const right = Math.max(...line.map((rect) => rect.right));
    const top = Math.max(first.top, bounds.top);
    const below = top < 56;
    toolbar = {
      x: Math.min(Math.max((left + right) / 2, 160), innerWidth - 160),
      y: below ? first.bottom : top,
      below,
    };
  };

  const apply = (edit: Edit) => {
    if (!field) return;
    field.focus();
    field.setSelectionRange(edit.from, edit.to);
    const done = edit.insert
      ? document.execCommand("insertText", false, edit.insert)
      : edit.from === edit.to || document.execCommand("delete");
    if (!done) {
      field.setRangeText(edit.insert, edit.from, edit.to, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.setSelectionRange(edit.start, edit.end);
    updateToolbar();
  };

  const format = (action: FormatAction) => {
    if (!field) return;
    apply(formatEdit(action, field.value, field.selectionStart, field.selectionEnd, text("format", "link_placeholder")));
  };

  const onkeydown = (event: KeyboardEvent) => {
    if ((mac ? event.metaKey : event.ctrlKey) && !event.altKey) {
      const bind = FORMAT_KEYS.find((entry) => entry.code === event.code && entry.shift === event.shiftKey);
      if (bind) {
        event.preventDefault();
        format(bind.action);
        return;
      }
    }
    if (event.key === "ArrowUp" && !draft && !event.shiftKey) {
      if (oneditlast()) event.preventDefault();
      return;
    }
    if (event.key === "Escape" && replying) {
      event.preventDefault();
      oncancelreply();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || touch()) return;

    event.preventDefault();
    onsend();
  };

  const onpaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    onfiles(files);
  };

  const onpick = () => {
    if (picker?.files?.length) onfiles([...picker.files]);
    if (picker) picker.value = "";
  };

  $effect(() => {
    const onselection = () => document.activeElement === field && updateToolbar();
    document.addEventListener("selectionchange", onselection);
    addEventListener("resize", updateToolbar);
    return () => {
      document.removeEventListener("selectionchange", onselection);
      removeEventListener("resize", updateToolbar);
    };
  });
</script>

<form class="composer" onsubmit={(event) => { event.preventDefault(); onsend(); }}>
  <div class="dock col" bind:clientHeight={dockHeight}>
    {#if replying}
      <div class="reply-bar row-nw align-centre gap-sm sm">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.reply} /></svg>
        <span class="flex-max truncate muted">{replyParts[0]}<strong class="reply-target"><EmojiText text={replying.name} /></strong>{replyParts[1]}</span>
        <button type="button" class="chip-close ghost press" aria-label={text("chat", "cancel_reply")} onclick={oncancelreply}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    {/if}
    {#if pending.length}
      <ul class="tray row-nw gap-sm">
        {#each pending as item (item.id)}
          {@const name = sanitiseFilename(item.file.name)}
          <li class="chip col" class:error={!!item.error} class:busy={item.progress !== null} title={item.error ?? name}>
            <span class="chip-preview row centre">
              {#if item.preview}
                <img src={item.preview} alt="" draggable="false" />
              {:else}
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 3h8l4 4v14H6zM14 3v4h4" /></svg>
              {/if}
              {#if item.progress !== null}
                <span class="progress" style:--progress={item.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} aria-label={text("media", "uploading").replace("{percent}", String(Math.round(item.progress * 100)))}></span>
              {/if}
            </span>
            <span class="chip-name xs truncate">{item.error ?? name}</span>
            <span class="chip-size xs faint">{formatBytes(item.file.size)}</span>
            {#if item.progress === null}
              <button type="button" class="chip-remove ghost press" aria-label={text("media", "remove").replace("{name}", name)} onclick={() => onremove(item.id)}>
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if hasJpeg}
        <label class="metadata row-nw align-centre gap-sm xs muted">
          <input type="checkbox" checked={keepImageMetadata} onchange={(event) => onmetadata(event.currentTarget.checked)} />
          {text("media", "keep_metadata")}
        </label>
      {/if}
    {/if}
    <div class="field row-nw align-centre gap-sm">
      <button type="button" class="icon attach ghost press" aria-label={text("media", "attach_files")} onclick={() => picker?.click()}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <input class="sr-only" type="file" multiple tabindex="-1" aria-hidden="true" bind:this={picker} onchange={onpick} />
      <div class="input flex-max">
        <div class="mirror" aria-hidden="true" bind:this={mirror}>{@html highlighted}</div>
        <textarea
          rows="1"
          enterkeyhint="send"
          placeholder={label}
          aria-label={label}
          bind:value={draft}
          bind:this={field}
          onscroll={syncScroll}
          onblur={() => (toolbar = null)}
          onselect={updateToolbar}
          {onkeydown}
          {onpaste}
        ></textarea>
      </div>
      <button type="submit" class="icon send ghost press" class:ready aria-label={text("chat", "send")}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z" />
        </svg>
      </button>
    </div>
  </div>
</form>

{#if toolbar}
  <div
    class="format-bar row-nw align-centre"
    class:below={toolbar.below}
    role="toolbar"
    tabindex="-1"
    aria-label={text("format", "toolbar")}
    style:left="{toolbar.x}px"
    style:top="{toolbar.y}px"
    use:portal
    onmousedown={(event) => event.preventDefault()}
  >
    {#each FORMAT_KEYS as bind (bind.action)}
      <button type="button" class="format ghost press" aria-label={text("format", bind.action)} aria-keyshortcuts="{mac ? 'Meta' : 'Control'}+{bind.label}" onclick={() => format(bind.action)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={FORMAT_ICONS[bind.action]} /></svg>
        <span class="tip row-nw align-centre gap-sm xs">{text("format", bind.action)}<kbd>{modLabel}+{bind.label}</kbd></span>
      </button>
      {#if bind.action === "code"}<span class="divider" aria-hidden="true"></span>{/if}
    {/each}
  </div>
{/if}

<style>
  .composer {
    position: absolute;
    inset: auto 0 0;
    z-index: var(--azure-z-raised);
    pointer-events: none;
    padding: 0 var(--azure-spacing-lg) var(--azure-spacing-lg);
    padding-bottom: max(var(--azure-spacing-lg), env(safe-area-inset-bottom));
  }

  .dock {
    pointer-events: auto;
    gap: var(--azure-spacing-sm);
  }

  .field {
    pointer-events: auto;
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    transition:
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-out);
  }

  .field:focus-within {
    border-color: color-mix(in oklab, var(--colours-accent) 45%, transparent);
    box-shadow: 0 0 24px -8px var(--colours-accent-glow);
  }

  .input {
    position: relative;
    display: grid;
    min-width: 0;
  }

  textarea,
  .mirror {
    margin: 0;
    padding: 9px 0;
    border: 0;
    font: inherit;
    font-size: var(--text-md);
    font-kerning: normal;
    letter-spacing: normal;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: normal;
    tab-size: 4;
  }

  textarea {
    position: relative;
    width: 100%;
    min-width: 0;
    max-height: 40vh;
    resize: none;
    outline: none;
    background: none;
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: var(--colours-text-strong);
    scrollbar-width: none;
  }

  textarea::-webkit-scrollbar {
    display: none;
  }

  textarea::selection {
    background-color: color-mix(in oklab, var(--colours-accent) 35%, transparent);
  }

  textarea::placeholder {
    color: var(--colours-text-faint);
    -webkit-text-fill-color: var(--colours-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: var(--colours-text-strong);
  }

  .mirror :global(.md-bold),
  .mirror :global(.md-h1),
  .mirror :global(.md-h2),
  .mirror :global(.md-h3) {
    text-shadow:
      0.35px 0 0 currentColor,
      -0.35px 0 0 currentColor;
  }

  .mirror :global(.md-h1) {
    color: var(--colours-accent-strong);
  }

  .mirror :global(.md-italic) {
    font-family: "Montserrat Upright", sans-serif;
    font-style: italic;
    font-synthesis: style;
  }

  .mirror :global(.md-underline) {
    text-decoration-line: underline;
    text-underline-offset: 3px;
  }

  .mirror :global(.md-strike) {
    text-decoration-line: line-through;
    color: var(--colours-text-muted);
  }

  .mirror :global(.md-underline.md-strike) {
    text-decoration-line: underline line-through;
  }

  .mirror :global(.md-code),
  .mirror :global(.md-block) {
    color: var(--colours-text);
    background-color: var(--colours-surface-active);
    box-shadow: 0 0 0 1px var(--colours-surface-active);
  }

  .mirror :global(.md-spoiler) {
    color: var(--colours-text-muted);
    background-color: color-mix(in oklab, var(--colours-text-faint) 22%, transparent);
  }

  .mirror :global(.md-quote) {
    box-shadow: inset 3px 0 0 var(--colours-outline-strong);
  }

  .mirror :global(.md-link) {
    color: var(--colours-accent);
  }

  .mirror :global(.md-url) {
    text-decoration-line: underline;
    text-decoration-color: color-mix(in oklab, var(--colours-accent) 50%, transparent);
  }

  .mirror :global(.md-mention) {
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    box-shadow: 0 0 0 2px var(--colours-accent-faint);
    border-radius: var(--azure-radius-sm);
  }

  .mirror :global(.md-sym.md-sym) {
    color: var(--colours-text-faint);
    text-shadow: none;
    text-decoration-line: none;
    font-style: normal;
  }

  .icon {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .send,
  .send:hover,
  .attach,
  .attach:hover {
    color: var(--colours-text-faint);
    background: none;
  }

  .attach:hover {
    color: var(--colours-accent);
  }

  .attach svg {
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .attach:hover svg {
    transform: rotate(90deg);
  }

  .attach:active svg {
    transform: rotate(90deg) scale(0.85);
    transition-duration: var(--azure-duration-instant);
  }

  .send svg {
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      filter var(--azure-duration-md) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .send.ready {
    color: var(--colours-accent);
  }

  .send.ready svg {
    filter: drop-shadow(0 0 6px var(--colours-accent-glow));
  }

  .send.ready:hover svg {
    transform: translateX(2px);
  }

  .send:active svg {
    transform: scale(0.85);
    transition-duration: var(--azure-duration-instant);
  }

  .reply-bar {
    padding: 0 var(--azure-spacing-xs) 0 var(--azure-spacing-md);
    min-height: 34px;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    color: var(--colours-text-faint);
    animation: rise-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .reply-target {
    color: var(--colours-text-strong);
  }

  .chip-close {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .chip-close:hover {
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  .tray {
    list-style: none;
    margin: 0;
    padding: var(--azure-spacing-sm);
    overflow-x: auto;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
  }

  .chip {
    position: relative;
    flex: none;
    width: 112px;
    padding: var(--azure-spacing-xs);
    gap: 2px;
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface);
    border: 1px solid var(--colours-outline-hairline);
    animation: rise-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  .chip.error {
    border-color: color-mix(in oklab, var(--colours-danger) 50%, transparent);
  }

  .chip.error .chip-name {
    color: var(--colours-danger);
    white-space: normal;
  }

  .chip-preview {
    position: relative;
    height: 72px;
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .chip-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .chip.busy .chip-preview img {
    opacity: 0.5;
  }

  .progress {
    position: absolute;
    inset: auto 0 0;
    height: 3px;
    background: linear-gradient(to right, var(--colours-accent) calc(var(--progress) * 100%), transparent 0);
    box-shadow: 0 0 10px var(--colours-accent-glow);
    transition: background var(--azure-duration-fast) linear;
  }

  .chip-name {
    padding: 0 2px;
    color: var(--colours-text);
  }

  .chip-size {
    padding: 0 2px;
  }

  .chip-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--colours-text-muted);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-light);
  }

  .chip-remove:hover {
    color: var(--colours-danger);
  }

  .metadata {
    padding: 0 var(--azure-spacing-sm);
    cursor: pointer;
  }

  .metadata input {
    accent-color: var(--colours-accent);
  }

  .format-bar {
    position: fixed;
    z-index: var(--azure-z-popover);
    gap: 2px;
    padding: 4px;
    translate: -50% calc(-100% - 8px);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-light);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 8px 24px -8px rgb(0 0 0 / 0.6),
      0 0 24px -12px var(--colours-accent-glow);
    transform-origin: 50% 100%;
    animation: pop-in var(--azure-duration-md) var(--azure-ease-spring);
    transition:
      left var(--azure-duration-fast) var(--azure-ease-out),
      top var(--azure-duration-fast) var(--azure-ease-out);
  }

  .format-bar.below {
    translate: -50% 8px;
    transform-origin: 50% 0;
  }

  .format {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .format:hover,
  .format:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .format:active svg {
    transform: scale(0.85);
  }

  .divider {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background-color: var(--colours-outline-hairline);
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    padding: 4px 8px;
    white-space: nowrap;
    pointer-events: none;
    border-radius: var(--azure-radius-sm);
    z-index: 1;
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-raised);
    border: 1px solid var(--colours-outline-light);
    box-shadow: 0 6px 16px -6px rgb(0 0 0 / 0.7);
    opacity: 0;
    translate: -50% 4px;
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      translate var(--azure-duration-fast) var(--azure-ease-out);
  }

  .below .tip {
    bottom: auto;
    top: calc(100% + 10px);
    translate: -50% -4px;
  }

  .format:hover .tip,
  .format:focus-visible .tip {
    opacity: 1;
    translate: -50% 0;
    transition-delay: 300ms;
  }

  kbd {
    font: inherit;
    color: var(--colours-text-faint);
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .format-bar {
      animation-duration: 1ms;
      transition: none;
    }
  }

  @media (max-width: 767px) {
    .icon {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    textarea,
    .mirror {
      font-size: 16px;
    }

    .chip-close {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }

    .chip-remove {
      width: 28px;
      height: 28px;
    }
  }
</style>
