<script lang="ts">
  import { profileTint } from "../../scripts/misc/palette.svelte";
  import { tick } from "svelte";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { miniProfile, openFullProfile, type ProfileTarget } from "../../scripts/stores/profile";
  import ProfileIdentity from "./ProfileIdentity.svelte";
  import ProfileDetails from "./ProfileDetails.svelte";
  import MessageButton from "./MessageButton.svelte";
  import { createProfileData } from "./profileData.svelte";
  import EmojiPicker from "../app/EmojiPicker.svelte";
  import { getEmojiURL } from "../../scripts/misc/emoji";
  import { twemojiFile } from "../../scripts/misc/emoji-data";
  import { useEmoji } from "../../scripts/settings/emoji";
  import { mediaSettings } from "../../scripts/settings/media";
  import { directRoomOf, handoff, openDirect } from "../../scripts/stores/navigation.svelte";
  import { sendText } from "../../scripts/stores/matrix";
  import { toast } from "../../scripts/stores/toast";
  import { voicePrefs } from "../../scripts/stores/voice";

  const WIDTH = 300;
  const GAP = 12;

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let target = $state.raw<ProfileTarget | null>(null);
  let card: HTMLElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);
  let placed = $state(false);

  $effect(() => miniProfile.subscribe((value) => (target = value)));

  const tint = profileTint(() => ({ avatar: data.avatar, banner: data.banner }));
  const data = createProfileData(() => ({ userId: target?.userId, roomId: target?.roomId }));

  let restoring = true;

  const exit = dismissible(() => {
    const element = target?.anchor?.element;
    miniProfile.set(null);
    if (restoring) element?.focus();
  });

  const close = (restore = true) => {
    restoring = restore;
    exit.close();
  };

  const place = () => {
    const anchor = target?.anchor;
    if (!card || !anchor) return;
    const { rect, side } = anchor;
    const height = card.offsetHeight;
    const x = side === "left" ? rect.left - WIDTH - GAP : rect.right + GAP;
    left = Math.max(GAP, Math.min(x, innerWidth - WIDTH - GAP));
    top = Math.max(GAP, Math.min(rect.top, innerHeight - height - GAP));
    placed = true;
  };

  $effect(() => {
    if (!target) return;
    target.userId;
    placed = false;
    tick().then(() => {
      place();
      card?.focus();
    });
  });

  $effect(() => {
    if (!card) return;
    const observer = new ResizeObserver(place);
    observer.observe(card);
    return () => observer.disconnect();
  });

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onpointerdown = (event: PointerEvent) => {
    const element = event.target as HTMLElement;
    if (card?.contains(element) || element.closest(".emoji-picker")) return;
    const trigger = element.closest("[data-profile-trigger]");
    if (trigger && trigger !== target?.anchor?.element) return;
    close(false);
  };

  $effect(() => {
    if (!target) return;
    document.addEventListener("pointerdown", onpointerdown, true);
    return () => document.removeEventListener("pointerdown", onpointerdown, true);
  });

  const direct = $derived(target && !data.isSelf ? directRoomOf(target.userId) : undefined);
  let quick = $state("");

  let quickField: HTMLInputElement | undefined = $state();
  const typing = (node: EventTarget | null) => node instanceof HTMLElement && (node.isContentEditable || !!node.closest("input, textarea, select"));
  const onwindowkey = (event: KeyboardEvent) =>
    quickField &&
    !emojiOpen &&
    !typing(event.target) &&
    !event.altKey &&
    !event.isComposing &&
    !($voicePrefs.pushToTalk && !event.ctrlKey && !event.metaKey && event.code === $voicePrefs.pttKey) &&
    (event.ctrlKey || event.metaKey ? ["v", "a", "z", "y"].includes(event.key.toLowerCase()) : event.key.length === 1 || event.key === "Backspace") &&
    !(event.key === " " && (event.target as HTMLElement).closest?.("button, a, [role=button], [role=menuitem]")) &&
    !getSelection()?.toString() &&
    quickField.focus({ preventScroll: true });
  let emojiButton: HTMLButtonElement | undefined = $state();
  let emojiOpen = $state(false);

  const insertEmoji = (unicode: string) => {
    const at = quickField?.selectionStart ?? quick.length;
    quick = quick.slice(0, at) + unicode + quick.slice(quickField?.selectionEnd ?? at);
    useEmoji(unicode);
    requestAnimationFrame(() => (quickField?.focus(), quickField?.setSelectionRange(at + unicode.length, at + unicode.length)));
  };

  const sendQuick = (event: KeyboardEvent) => event.key === "Enter" && !event.shiftKey && !event.isComposing && (event.preventDefault(), submitQuick());

  const submitQuick = () => {
    const body = quick.trim();
    if (!body || !direct) return;
    const opens = $mediaSettings.quickOpensChat && target;
    sendText(direct, body).then(() => !opens && toast(text("user_profile", "quick_sent")), () => toast(text("user_profile", "quick_failed"), { tone: "danger" }));
    opens && openDirect(opens.userId);
    quick = "";
    close(false);
  };

  const pasteQuick = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length || !direct || !target) return;
    event.preventDefault();
    handoff.value = { roomId: direct, files, text: quick };
    openDirect(target.userId);
    quick = "";
    close(false);
  };

  const viewFull = () => {
    if (target) openFullProfile(target.userId, target.roomId);
  };
</script>

<svelte:window onkeydown={onwindowkey} />

{#if target}
  <span class="portal-anchor" hidden></span>
  <div class="layer" class:closing={exit.closing} role="presentation" use:portal>
    <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={() => close()}></button>
    {#key target.userId}
      <div
        class="card col"
        style:--profile-tint={tint.colour}
        style:--profile-glow={tint.glow} style:--profile-ink={tint.ink}
        class:placed
        role="dialog"
        aria-label={text("user_profile", "card").replace("{name}", data.displayName.replace(/^@/, ""))}
        tabindex="-1"
        bind:this={card}
        inert={exit.closing}
        onanimationend={exit.onanimationend}
        style:left="{left}px"
        style:top="{top}px"
        {onkeydown}
      >
        <span class="handle" aria-hidden="true"></span>
        <ProfileIdentity
          userId={data.userId}
          roomId={target?.roomId}
          displayName={data.displayName}
          avatar={data.avatar}
          banner={data.banner}
          presence={data.status?.presence}
          status={data.status?.statusMessage}
          role={data.role}
          namedRole={data.namedRole}
          size="sm"
          surface="var(--colours-surface-raised)"
          onopen={viewFull}
        />
        <div class="body col gap-sm">
          <ProfileDetails status={data.status} bio={data.bio} />
          {#if direct}
            <div class="quick-bar row-nw align-centre">
              <input class="quick sm" bind:this={quickField} type="text" bind:value={quick} placeholder={text("user_profile", "quick_message").replace("{name}", data.displayName.replace(/^@/, ""))} aria-label={text("user_profile", "quick_message").replace("{name}", data.displayName.replace(/^@/, ""))} onkeydown={sendQuick} onpaste={pasteQuick} />
              <button type="button" class="quick-icon emoji ghost press" class:open={emojiOpen} aria-label={text("emoji", "open_picker")} use:tooltip={text("emoji", "open_picker")} aria-expanded={emojiOpen} bind:this={emojiButton} onclick={() => (emojiOpen = !emojiOpen)}><img src={getEmojiURL(twemojiFile("😀"))} alt="" width="18" height="18" draggable="false" /></button>
              <button type="button" class="quick-icon send ghost press" class:ready={!!quick.trim()} aria-label={text("chat", "send")} use:tooltip={text("chat", "send")} onclick={submitQuick}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z" /></svg></button>
            </div>
            {#if emojiOpen && emojiButton}
              <EmojiPicker anchor={emojiButton} oninsert={insertEmoji} onclose={() => (emojiOpen = false)} />
            {/if}
          {/if}
          <div class="footer row-nw align-centre gap-sm">
            {#if !data.isSelf && !direct}
              <MessageButton userId={data.userId} compact ondone={() => close(false)} />
            {/if}
            <button type="button" class="full ghost press sm bold" onclick={viewFull}>{text("user_profile", "full")}</button>
          </div>
        </div>
      </div>
    {/key}
  </div>
  <span class="portal-anchor" hidden></span>
{/if}

<style>
  .quick-bar {
    gap: 2px;
    height: 38px;
    padding: 0 4px 0 0;
    border: 1px solid var(--colours-border);
    border-radius: var(--azure-radius-sm);
    background: var(--colours-surface);
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .quick-bar:focus-within {
    border-color: var(--profile-tint, var(--colours-accent));
  }

  .quick {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--azure-spacing-md);
    border: 0;
    color: var(--colours-text-strong);
    background: none;
    font: inherit;
    font-size: var(--text-md);
    outline: none;
  }

  .quick-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .quick-icon:hover {
    background: var(--colours-surface-hover);
  }

  .emoji img {
    filter: grayscale(1) brightness(1.6);
    opacity: 0.45;
    transition:
      filter var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .emoji:is(:hover, :focus-visible, .open) img {
    filter: none;
    opacity: 1;
    transform: scale(1.14);
  }

  .send.ready {
    color: var(--profile-tint, var(--colours-accent));
  }

  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-popover);
    pointer-events: none;
  }

  .scrim {
    display: none;
  }

  .card {
    position: fixed;
    width: 300px;
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 24px 64px -18px black,
      0 0 44px -20px var(--profile-glow, var(--colours-accent-glow));
    outline: none;
    pointer-events: auto;
    visibility: hidden;
  }

  .card.placed {
    visibility: visible;
    animation: pop var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .layer.closing {
    pointer-events: none;
  }

  .closing .card.placed {
    animation: profile-out var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes profile-out {
    to {
      opacity: 0;
      transform: translateY(4px) scale(0.97);
    }
  }

  .card :global(.banner) {
    border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
  }

  .handle {
    display: none;
  }

  .body {
    padding: var(--azure-spacing-md);
  }

  .footer {
    padding-top: var(--azure-spacing-xs);
  }

  .full {
    height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .full:hover,
  .full:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.97);
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 767px) {
    .layer {
      pointer-events: auto;
    }

    .scrim {
      display: block;
      position: absolute;
      inset: 0;
      background-color: var(--colours-scrim);
      animation: fade var(--azure-duration-md) var(--azure-ease-out);
    }

    .card {
      inset: auto 0 0 0 !important;
      width: auto;
      max-height: 85dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
      visibility: visible;
    }

    .card.placed {
      animation: rise var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .closing .scrim {
      animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .closing .card.placed {
      animation: exit-sink var(--azure-duration-md) var(--azure-ease-out) forwards;
    }

    .handle {
      display: block;
      position: absolute;
      top: var(--azure-spacing-sm);
      left: 50%;
      translate: -50% 0;
      z-index: 1;
      width: 36px;
      height: 4px;
      border-radius: var(--azure-radius-pill);
      background-color: color-mix(in oklab, white 55%, transparent);
    }
  }
</style>
