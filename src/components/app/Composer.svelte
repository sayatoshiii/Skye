<script lang="ts" module>
  export type Pending = { id: number; file: File; preview?: string; progress: number | null; error?: string; extra?: Record<string, any> };
</script>

<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import EmojiText from "../ui/EmojiText.svelte";
  import { getEmojiURL } from "../../scripts/misc/emoji";
  import { twemojiFile } from "../../scripts/misc/emoji-data";
  import { useEmoji } from "../../scripts/settings/emoji";
  import EmojiPicker from "./EmojiPicker.svelte";
  import GifPicker from "./GifPicker.svelte";
  import type { GifFavourite } from "../../scripts/settings/gifs";
  import EditorField from "./EditorField.svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { formatBytes, sanitiseFilename } from "../../scripts/matrix/utilities/attachments";
  import type { Pill } from "../../scripts/misc/mentions";
  import { entityText, menu, openEntityMenu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import ImageEditor, { type EditorSession } from "./media/ImageEditor.svelte";
  import { EDITABLE } from "../../scripts/misc/image-editor";

  type Props = {
    draft: string;
    pills?: Pill[];
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
    onreplace?: (id: number, file: File) => void;
    oneditlast: () => boolean;
    onmetadata: (keep: boolean) => void;
    onpoll?: () => void;
    onlocation?: () => void;
    ongif?: (gif: GifFavourite) => void;
  };

  let {
    draft = $bindable(),
    pills = $bindable([]),
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
    onreplace,
    oneditlast,
    onmetadata,
    onpoll,
    onlocation,
    ongif,
  }: Props = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const ICONS = {
    reply: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1",
  };

  const FACES = ["😀", "😄", "😁", "😆", "😊", "😉", "😎", "🤩", "🥳", "😺", "🙂", "🤗"];

  let picker: HTMLInputElement | undefined = $state();
  let editor: EditorField | undefined = $state();
  let pickerButton: HTMLButtonElement | undefined = $state();
  let pickerOpen = $state(false);
  let emojiPicker: EmojiPicker | undefined = $state();
  let gifButton: HTMLButtonElement | undefined = $state();
  let gifOpen = $state(false);
  let gifPicker: GifPicker | undefined = $state();
  let face = $state(FACES[0]);
  let editing: Pending | null = $state.raw(null);
  const sessions = new Map<number, EditorSession>();

  $effect(() => [...sessions.keys()].forEach((id) => pending.some((item) => item.id === id) || sessions.delete(id)));

  const editable = (item: Pending) => !!onreplace && !item.error && item.progress === null && EDITABLE.includes(item.file.type);

  const hasJpeg = $derived(pending.some((item) => item.file.type === "image/jpeg"));
  const ready = $derived(!!draft.trim() || pending.some((item) => !item.error && item.progress === null));
  const replyParts = $derived(text("chat", "replying_to").split("{name}"));

  const twemojiSrc = (unicode: string) => getEmojiURL(twemojiFile(unicode));
  const shuffleFace = () => (face = FACES[Math.floor(Math.random() * FACES.length)]);

  const insertPicked = (unicode: string, keepOpen: boolean) => {
    editor?.insert(unicode);
    useEmoji(unicode);
    if (keepOpen) pickerOpen = true;
  };

  const onkey = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" && !draft && !event.shiftKey) {
      if (oneditlast()) event.preventDefault();
    } else if (event.key === "Escape" && replying) {
      event.preventDefault();
      oncancelreply();
    }
  };

  const plusItems = () => [
    { id: "plus-files", label: text("media", "attach_files"), icon: MENU_ICONS.attach, run: () => picker?.click() },
    ...(onpoll ? [{ id: "plus-poll", label: text("media", "create_poll"), icon: MENU_ICONS.poll, run: onpoll }] : []),
    ...(onlocation ? [{ id: "plus-location", label: text("location", "send"), icon: MENU_ICONS.location, run: onlocation }] : []),
  ];

  const openPlus = (event: MouseEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openEntityMenu(plusItems(), box.left, box.top);
  };

  const onpick = () => {
    if (picker?.files?.length) onfiles([...picker.files]);
    if (picker) picker.value = "";
  };
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
          <li class="chip col" class:error={!!item.error} class:busy={item.progress !== null} use:tooltip={item.error ?? name} use:menu={() => [
            ...(editable(item) ? [{ id: "chip-edit", label: text("image_editor", "edit"), icon: MENU_ICONS.edit, run: () => (editing = item) }] : []),
            { id: "chip-name", label: entityText("copy_file_name"), icon: MENU_ICONS.copy, run: () => copied(name) },
            { id: "chip-remove", label: entityText("remove_attachment"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: item.progress !== null, run: () => onremove(item.id) },
          ]}>
            <button type="button" disabled={!editable(item)} class="chip-preview row centre" class:editable={editable(item)} aria-label={editable(item) ? text("image_editor", "edit_named").replace("{name}", name) : undefined} onclick={() => editable(item) && (editing = item)}>
              {#if item.preview}
                <img src={item.preview} alt="" draggable="false" />
              {:else}
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 3h8l4 4v14H6zM14 3v4h4" /></svg>
              {/if}
              {#if item.progress !== null}
                <span class="progress" style:--progress={item.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} aria-label={text("media", "uploading").replace("{percent}", String(Math.round(item.progress * 100)))}></span>
              {/if}
              {#if editable(item)}
                <span class="chip-edit" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M16 3l5 5L8 21H3v-5zM13 6l5 5" /></svg></span>
              {/if}
            </button>
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
      <button type="button" class="icon attach ghost press" aria-label={text("media", "more")} aria-haspopup="menu" use:tooltip={text("media", "more")} use:menu={plusItems} onclick={openPlus}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d={MENU_ICONS.add} />
        </svg>
      </button>
      <input class="sr-only" type="file" multiple tabindex="-1" aria-hidden="true" bind:this={picker} onchange={onpick} />
      <EditorField bind:this={editor} bind:value={draft} bind:pills bind:field {label} composer onsubmit={onsend} {onkey} {onfiles} />
      {#if ongif}
        <button
          type="button"
          class="icon gif-toggle ghost press"
          class:open={gifOpen}
          aria-label={text("gifs", "open_picker")}
          use:tooltip={text("gifs", "open_picker")}
          aria-expanded={gifOpen}
          aria-haspopup="dialog"
          bind:this={gifButton}
          onclick={() => (gifOpen ? gifPicker?.dismiss() : (emojiPicker?.dismiss(), (gifOpen = true)))}
        ><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><mask id="composer-gif-mask"><rect width="24" height="24" fill="white" /><text x="12" y="15.6" text-anchor="middle" font-size="9.5" font-weight="800" font-family="system-ui, sans-serif" letter-spacing="0.4" fill="black">GIF</text></mask><rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="currentColor" mask="url(#composer-gif-mask)" /></svg></button>
      {/if}
      <button
        type="button"
        class="icon emoji-button ghost press"
        class:open={pickerOpen}
        aria-label={text("emoji", "open_picker")} use:tooltip={text("emoji", "open_picker")}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        bind:this={pickerButton}
        onmouseenter={shuffleFace}
        onclick={() => (pickerOpen ? emojiPicker?.dismiss() : (pickerOpen = true))}
      >
        <img src={twemojiSrc(face)} alt="" width="20" height="20" draggable="false" />
      </button>
      <button type="submit" class="icon send ghost press" class:ready aria-label={text("chat", "send")} use:tooltip={text("chat", "send")}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z" />
        </svg>
      </button>
    </div>
  </div>
</form>

{#if pickerOpen && pickerButton}
  <EmojiPicker bind:this={emojiPicker} anchor={pickerButton} oninsert={insertPicked} onclose={() => (pickerOpen = false)} ongif={ongif && (() => (gifOpen = true))} />
{/if}

{#if gifOpen && gifButton && ongif}
  <GifPicker bind:this={gifPicker} anchor={gifButton} onpick={ongif} onclose={() => (gifOpen = false)} />
{/if}

{#if editing}
  <ImageEditor file={editing.file} session={sessions.get(editing.id)} onsave={(file, session) => editing && (sessions.set(editing.id, session), onreplace?.(editing.id, file), (editing = null))} onclose={() => (editing = null)} />
{/if}

<style>
  .composer {
    position: absolute;
    inset: auto 0 0;
    z-index: var(--azure-z-raised);
    transform: translateZ(0);
    pointer-events: none;
    padding: 0 var(--azure-spacing-lg) var(--azure-spacing-lg);
    padding-bottom: calc(26px + env(safe-area-inset-bottom));
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

  button.chip-preview {
    width: 100%;
    padding: 0;
    border: none;
    opacity: 1;
  }

  .chip-preview.editable {
    cursor: pointer;
  }

  .chip-preview.editable img {
    transition: scale var(--azure-duration-md) var(--azure-ease-out);
  }

  .chip-preview.editable:hover img {
    scale: 1.05;
  }

  .chip-edit {
    position: absolute;
    top: 6px;
    left: 6px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--colours-text-strong);
    background-color: hsla(242, 10%, 10%, 0.72);
    backdrop-filter: blur(12px);
    border: 1px solid var(--colours-outline-hairline);
    opacity: 0;
    scale: 0.85;
    transition: opacity var(--azure-duration-md) var(--azure-ease-out), scale var(--azure-duration-md) var(--azure-ease-spring);
  }

  .chip-preview:hover .chip-edit,
  .chip-preview:focus-visible .chip-edit {
    opacity: 1;
    scale: 1;
  }

  @media (hover: none) {
    .chip-edit {
      opacity: 1;
      scale: 1;
    }
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

  .gif-toggle svg {
    opacity: 0.45;
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .gif-toggle:is(:hover, :focus-visible, .open) svg {
    opacity: 1;
    color: var(--colours-text-strong);
    transform: scale(1.14);
  }

  .emoji-button {
    display: grid;
    place-items: center;
  }

  .emoji-button img {
    width: 20px;
    height: 20px;
    filter: grayscale(1) brightness(1.6);
    opacity: 0.45;
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .emoji-button:is(:hover, :focus-visible, .open) img {
    filter: none;
    opacity: 1;
    transform: scale(1.14);
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (max-width: 767px) {
    .icon {
      width: var(--azure-touch);
      height: var(--azure-touch);
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
