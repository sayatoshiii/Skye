<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { hueOf } from "../../scripts/matrix/utilities/profile";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { ownProfile } from "../../scripts/stores/matrix";
  import { ownStatus, setOwnStatus } from "../../scripts/stores/presence";
  import EmojiPicker from "../app/EmojiPicker.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import MessageMenu, { type MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import PresenceDot from "../ui/PresenceDot.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const exit = dismissible(() => onclose());
  const close = () => exit.close();

  const SMILE = "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0";
  const CHECK = MENU_ICONS.read;
  const OPTIONS = [
    { id: "24h", minutes: 24 * 60 },
    { id: "4h", minutes: 4 * 60 },
    { id: "1h", minutes: 60 },
    { id: "30m", minutes: 30 },
    { id: "never", minutes: 0 },
  ] as const;
  type ClearOption = (typeof OPTIONS)[number]["id"];

  let draftText = $state($ownStatus.text ?? "");
  let draftEmoji = $state($ownStatus.emoji ?? "");
  let clear: ClearOption = $state("never");
  let picking = $state(false);
  let clearMenu: { x: number; y: number } | null = $state(null);
  let emojiButton: HTMLButtonElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    queueMicrotask(() => input?.focus());
  });

  const userId = $derived($ownProfile?.userId ?? "");
  const name = $derived($ownProfile?.displayName ?? userId);
  const preview = $derived([draftEmoji, draftText.trim()].filter(Boolean).join(" "));

  const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const describe = (minutes: number) => {
    const at = new Date(Date.now() + minutes * 60_000);
    if (minutes < 60) return time(at);
    const sameDay = at.toDateString() === new Date().toDateString();
    return text("status", "at")
      .replace("{when}", text("status", sameDay ? "today_word" : "tomorrow"))
      .replace("{time}", time(at));
  };

  const labelOf = (id: ClearOption) => text("status", `clear_${id}`);

  const clearItems = $derived<MenuItem[]>(
    OPTIONS.map((option) => ({
      id: option.id,
      label: option.minutes ? `${labelOf(option.id)} (${describe(option.minutes)})` : labelOf(option.id),
      icon: clear === option.id ? CHECK : "",
      run: () => (clear = option.id),
    })),
  );

  const openClearMenu = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    clearMenu = { x: rect.left, y: rect.bottom + 4 };
  };

  const save = () => {
    const trimmed = draftText.trim();
    const minutes = OPTIONS.find((option) => option.id === clear)?.minutes ?? 0;
    const has = !!trimmed || !!draftEmoji;
    setOwnStatus({
      mode: $ownStatus.mode,
      text: trimmed || undefined,
      emoji: draftEmoji || undefined,
      clearAt: has && minutes ? Date.now() + minutes * 60_000 : undefined,
    });
    close();
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !picking && !clearMenu) close();
  };
</script>

<span class="portal-anchor" hidden></span>
<div class="layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <form
    class="dialog col"
    onanimationend={exit.onanimationend}
    inert={exit.closing}
    role="dialog"
    aria-modal="true"
    aria-labelledby="status-title"
    tabindex="-1"
    {onkeydown}
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <span class="handle" aria-hidden="true"></span>
    <header class="row-nw align-centre">
      <h2 id="status-title" class="lg bold flex-max">{text("status", "custom_title")}</h2>
      <button type="button" class="close ghost press row centre" aria-label={text("status", "close")} onclick={close}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="card col" style:--hue={hueOf(userId)}>
      <div class="banner"></div>
      <div class="identity col">
        <div class="top row-nw">
          <span class="avatar">
            <PresenceDot {userId} size={64}>
              <Avatar name={name} url={$ownProfile?.avatarUrl} size="64px" radius="50%" />
            </PresenceDot>
          </span>
        </div>
        <strong class="md bold strong truncate"><EmojiText text={name} /></strong>
        <span class="xs muted truncate">{userId}</span>
        {#if preview}
          <p class="status sm" aria-live="polite"><EmojiText text={preview} /></p>
        {/if}
      </div>
    </div>

    <label class="field col gap-xs">
      <span class="xs bold faint label">{text("status", "label")}</span>
      <span class="input row-nw align-centre">
        <button
          type="button"
          class="icon ghost press"
          bind:this={emojiButton}
          aria-label={text("status", "emoji")}
          use:tooltip={text("status", "emoji")}
          onclick={() => (picking = !picking)}
        >
          {#if draftEmoji}<EmojiText text={draftEmoji} />{:else}<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d={SMILE} /></svg>{/if}
        </button>
        <input bind:this={input} class="flex-max min-0" type="text" maxlength="128" placeholder={text("status", "placeholder")} bind:value={draftText} />
        {#if draftText || draftEmoji}
          <button
            type="button"
            class="icon ghost press"
            aria-label={text("status", "clear_text")}
            use:tooltip={text("status", "clear_text")}
            onclick={() => {
              draftText = "";
              draftEmoji = "";
              input?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /><path fill="none" stroke="var(--colours-surface-raised)" stroke-width="2" stroke-linecap="round" d="M9 9l6 6M15 9l-6 6" /></svg>
          </button>
        {/if}
      </span>
    </label>

    <footer class="foot row-nw align-centre gap-sm">
      <button type="button" class="select ghost press row-nw align-centre gap-xs sm" aria-haspopup="menu" aria-label={text("status", "clear_after")} onclick={openClearMenu}>
        <span>{labelOf(clear)}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" /></svg>
      </button>
      <button type="submit" class="button primary ghost press md bold">{text("status", "save")}</button>
    </footer>
  </form>
</div>
<span class="portal-anchor" hidden></span>

{#if clearMenu}
  <MessageMenu items={clearItems} x={clearMenu.x} y={clearMenu.y} label={text("status", "clear_after")} minWidth={240} onclose={() => (clearMenu = null)} />
{/if}

{#if picking && emojiButton}
  <EmojiPicker
    anchor={emojiButton}
    oninsert={(unicode) => {
      draftEmoji = unicode;
      picking = false;
      input?.focus();
    }}
    onclose={() => (picking = false)}
  />
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: var(--azure-spacing-lg);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  .dialog {
    position: relative;
    width: min(100%, 440px);
    max-height: 100%;
    overflow-y: auto;
    padding: var(--azure-spacing-xl);
    gap: var(--azure-spacing-lg);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 24px 64px -16px black,
      0 0 40px -20px var(--colours-accent-glow);
    outline: none;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .handle {
    display: none;
  }

  h2 {
    margin: 0;
  }

  h2,
  .strong {
    color: var(--colours-text-strong);
  }

  .close {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .close:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .card {
    align-self: center;
    flex: none;
    width: min(100%, 300px);
    overflow: clip;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
  }

  .banner {
    height: 52px;
    background: linear-gradient(135deg, oklch(0.55 0.13 var(--hue)), oklch(0.4 0.1 calc(var(--hue) + 40)));
  }

  .identity {
    padding: 0 var(--azure-spacing-lg) var(--azure-spacing-lg);
    gap: 2px;
  }

  .top {
    margin-top: -36px;
    margin-bottom: var(--azure-spacing-sm);
  }

  .avatar {
    position: relative;
    display: flex;
    padding: 4px;
    border-radius: 50%;
    background-color: var(--colours-foreground);
  }

  .status {
    margin: var(--azure-spacing-xs) 0 0;
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  .label {
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .input {
    gap: var(--azure-spacing-xs);
    padding: 0 var(--azure-spacing-xs);
    min-height: 44px;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-hover);
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .input:focus-within {
    border-color: color-mix(in oklab, var(--colours-accent) 55%, transparent);
  }

  input:focus-visible {
    outline: none;
  }

  input {
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background: none;
    border: none;
    outline: none;
    padding: var(--azure-spacing-sm) 0;
  }

  .icon {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
    font-size: var(--text-lg);
  }

  .icon:hover {
    color: var(--colours-text-strong);
  }

  .foot {
    justify-content: space-between;
    margin: 0 calc(var(--azure-spacing-xl) * -1) calc(var(--azure-spacing-xl) * -1);
    padding: var(--azure-spacing-lg) var(--azure-spacing-xl);
    background-color: var(--colours-surface-hover);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .select {
    min-height: 36px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text);
  }

  .select:hover {
    background-color: var(--colours-surface-hover);
  }

  .button {
    min-height: 42px;
    padding: 0 var(--azure-spacing-xl);
    border-radius: var(--azure-radius-md);
  }

  .button.primary {
    color: var(--colours-on-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 78%, var(--colours-surface-raised));
  }

  .button.primary:hover {
    background-color: var(--colours-accent);
  }

  .closing .scrim {
    animation: fade-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .closing .dialog {
    animation: pop-out var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes pop-out {
    to {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }

  @keyframes slide {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes sink {
    to {
      transform: translateY(100%);
    }
  }

  @media (max-width: 767px) {
    .layer {
      justify-content: flex-end;
      padding: 0;
    }

    .dialog {
      width: 100%;
      max-height: 90dvh;
      padding: var(--azure-spacing-sm) var(--azure-spacing-lg) calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      animation: slide var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .closing .dialog {
      animation: sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .handle {
      display: block;
      width: 36px;
      height: 4px;
      margin: 0 auto;
      border-radius: var(--azure-radius-pill);
      background-color: var(--colours-outline-strong);
    }

    .card {
      width: 100%;
    }

    .foot {
      margin: 0 calc(var(--azure-spacing-lg) * -1) calc((var(--azure-spacing-xl) + env(safe-area-inset-bottom)) * -1);
      padding: var(--azure-spacing-lg) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
    }

    .button,
    .close {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }
  }
</style>
