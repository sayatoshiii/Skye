<script lang="ts">
  import { tick } from "svelte";
  import { portal } from "../../scripts/misc/portal";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getRoomDisplayName } from "../../scripts/matrix/rooms";
  import { fullProfile, getMutualRooms, getSpaceFor, type ProfileTarget } from "../../scripts/stores/profile";
  import { HOME, navigation, openRoom } from "../../scripts/stores/navigation.svelte";
  import type { RoomSummary } from "../../scripts/matrix/types";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import ProfileIdentity from "./ProfileIdentity.svelte";
  import ProfileDetails from "./ProfileDetails.svelte";
  import MessageButton from "./MessageButton.svelte";
  import { notes, setNote } from "../../scripts/stores/notes";
  import { createProfileData } from "./profileData.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let target = $state.raw<ProfileTarget | null>(null);
  let dialog: HTMLElement | undefined = $state();
  let tab: "about" | "mutual" = $state("about");
  let moreOpen = $state(false);
  let returnFocus: HTMLElement | null = null;

  $effect(() => fullProfile.subscribe((value) => (target = value)));

  const data = createProfileData(() => ({ userId: target?.userId, roomId: target?.roomId }));

  const mutual = $derived(target && data.ownUserId && !data.isSelf ? (data.rooms, getMutualRooms(target.userId, data.ownUserId)) : []);

  $effect(() => {
    if (!target) return;
    target.userId;
    tab = "about";
    moreOpen = false;
    returnFocus ??= document.activeElement as HTMLElement | null;
    tick().then(() => dialog?.querySelector<HTMLElement>(".close")?.focus());
  });

  const close = () => {
    fullProfile.set(null);
    returnFocus?.focus?.();
    returnFocus = null;
  };

  const focusables = () =>
    [...(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])].filter((element) => element.offsetParent !== null);

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (moreOpen) return void (moreOpen = false);
      return close();
    }
    if (event.key !== "Tab") return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const ontabkey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    tab = tab === "about" ? "mutual" : "about";
    tick().then(() => dialog?.querySelector<HTMLElement>(`[role=tab][aria-selected=true]`)?.focus());
  };

  const copyId = () => {
    if (target) navigator.clipboard?.writeText(target.userId).catch(() => undefined);
    moreOpen = false;
  };

  const go = (room: RoomSummary) => {
    close();
    if (room.isSpace) return openRoom(room.roomId);
    openRoom(getSpaceFor(room.roomId) ?? HOME, room.roomId);
    navigation.pane = "chat";
  };

  const formatDate = (ts: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(ts);

  let noteMap: Record<string, string> = $state.raw({});
  $effect(() => notes.subscribe((value) => (noteMap = value)));
  const noteText = $derived(noteMap[data?.userId ?? ""] ?? "");
</script>

{#if target}
  <div class="layer col centre" role="presentation" use:portal>
    <button type="button" class="scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
    <div class="modal col" role="dialog" aria-modal="true" aria-label={text("user_profile", "card").replace("{name}", data.displayName)} tabindex="-1" bind:this={dialog} {onkeydown}>
      <button type="button" class="close ghost press" aria-label={text("user_profile", "close")} onclick={close}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div class="scroll col">
        <ProfileIdentity
          userId={data.userId}
          displayName={data.displayName}
          avatar={data.avatar}
          banner={data.banner}
          presence={data.status?.presence}
          role={data.role}
          size="lg"
          surface="var(--colours-surface-raised)"
        >
          {#snippet actions()}
            {#if !data.isSelf}
              <MessageButton userId={data.userId} ondone={close} />
            {/if}
            <span class="more-wrap">
              <button type="button" class="more ghost press" aria-label={text("user_profile", "more")} aria-haspopup="menu" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>
              </button>
              {#if moreOpen}
                <span class="more-menu col" role="menu">
                  <button type="button" role="menuitem" class="more-item ghost press sm" onclick={copyId}>{text("user_profile", "copy")}</button>
                </span>
              {/if}
            </span>
          {/snippet}
        </ProfileIdentity>

        <div class="tabs row-nw" role="tablist" aria-label={text("user_profile", "tabs")}>
          <button type="button" role="tab" id="tab-about" class="tab ghost sm bold" aria-selected={tab === "about"} aria-controls="panel-about" tabindex={tab === "about" ? 0 : -1} onclick={() => (tab = "about")} onkeydown={ontabkey}>{text("user_profile", "tab_about")}</button>
          {#if !data.isSelf}
            <button type="button" role="tab" id="tab-mutual" class="tab ghost sm bold" aria-selected={tab === "mutual"} aria-controls="panel-mutual" tabindex={tab === "mutual" ? 0 : -1} onclick={() => (tab = "mutual")} onkeydown={ontabkey}><span class="row-nw align-centre gap-sm">{text("user_profile", "tab_mutual")}{#if mutual.length}<span class="stack row-nw" aria-hidden="true">{#each mutual.slice(0, 3) as room (room.roomId)}<span class="stack-item"><Avatar name={getRoomDisplayName(room, data.ownUserId)} url={room.avatarUrl} size="18px" radius="50%" /></span>{/each}</span>{/if}<span class="faint">{mutual.length}</span></span></button>
          {/if}
        </div>

        {#if tab === "about"}
          <div class="panel col gap-md" role="tabpanel" id="panel-about" aria-labelledby="tab-about">
            <ProfileDetails status={data.status} bio={data.bio}>
              {#if data.room && !data.room.isDirect}
                <section class="col gap-sm">
                  <h3 class="heading xs bold">{text("user_profile", "role")}</h3>
                  <p class="md strong">{data.role ? text("user_profile", data.role) : text("user_profile", "member")} · <EmojiText text={getRoomDisplayName(data.room, data.ownUserId)} /></p>
                </section>
              {/if}
              {#if data.memberSince}
                <section class="col gap-sm">
                  <h3 class="heading xs bold">{text("user_profile", "member_since")}</h3>
                  <p class="md strong">{formatDate(data.memberSince)}</p>
                </section>
              {/if}
            </ProfileDetails>
            {#if !data.isSelf}
              <section class="col gap-sm">
                <label class="heading xs bold" for="profile-note">{text("user_profile", "note")}</label>
                <textarea
                  id="profile-note"
                  class="note"
                  rows="2"
                  maxlength="256"
                  placeholder={text("user_profile", "note_hint")}
                  value={noteText}
                  oninput={(event) => setNote(data.userId, event.currentTarget.value)}
                ></textarea>
              </section>
            {/if}
          </div>
        {:else}
          <div class="panel col" role="tabpanel" id="panel-mutual" aria-labelledby="tab-mutual">
            {#if !mutual.length}
              <p class="sm faint nothing">{text("user_profile", "no_mutual")}</p>
            {:else}
              <ul class="rooms col">
                {#each mutual as room (room.roomId)}
                  {@const name = getRoomDisplayName(room, data.ownUserId)}
                  <li>
                    <button type="button" class="room row-nw align-centre gap-md ghost press" onclick={() => go(room)}>
                      <Avatar {name} url={room.avatarUrl} size="32px" radius={room.isSpace ? "30%" : "50%"} />
                      <span class="col min-0 flex-max">
                        <span class="md truncate strong"><EmojiText text={name} /></span>
                        {#if room.isSpace}<span class="xs faint">{text("user_profile", "space")}</span>{/if}
                      </span>
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .stack {
    padding-left: 4px;
  }

  .stack-item {
    display: flex;
    margin-left: -6px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--colours-surface-raised);
  }

  .note {
    width: 100%;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    resize: none;
    field-sizing: content;
    min-height: 1.4em;
    font: inherit;
    font-size: var(--text-md);
    line-height: 1.4;
    color: var(--colours-text-strong);
    background: none;
    border: 0;
    outline: none;
  }

  .note::placeholder {
    color: var(--colours-text-faint);
  }

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
    background-color: color-mix(in oklab, black 55%, transparent);
    backdrop-filter: blur(8px);
    animation: scrim var(--azure-duration-glide) var(--azure-ease-fluid);
  }

  .modal {
    position: relative;
    width: min(600px, 100%);
    max-height: 90vh;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow:
      0 32px 80px -24px black,
      0 0 60px -24px var(--colours-accent-glow);
    outline: none;
    overflow: hidden;
    animation: pop var(--azure-duration-glide) var(--azure-ease-fluid);
  }

  .scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .close {
    position: absolute;
    top: var(--azure-spacing-md);
    right: var(--azure-spacing-md);
    z-index: 2;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-pill);
    color: white;
    background-color: color-mix(in oklab, black 40%, transparent);
    backdrop-filter: blur(6px);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .close:hover,
  .close:focus-visible {
    background-color: color-mix(in oklab, black 65%, transparent);
  }

  .more-wrap {
    position: relative;
    margin-left: var(--azure-spacing-md);
  }

  .more {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .more:hover,
  .more:focus-visible {
    color: var(--colours-accent);
  }

  .more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 3;
    min-width: 180px;
    padding: var(--azure-spacing-xs);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 16px 40px -12px black;
    animation: pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .more-item {
    min-height: 34px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    text-align: left;
    color: var(--colours-text);
  }

  .more-item:hover,
  .more-item:focus-visible {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .tabs {
    gap: var(--azure-spacing-lg);
    padding: 0 var(--azure-spacing-lg);
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .tab {
    position: relative;
    padding: var(--azure-spacing-md) 0;
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .tab::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-accent);
    box-shadow: 0 0 10px var(--colours-accent-glow);
    scale: 0 1;
    transition: scale var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .tab:hover,
  .tab[aria-selected="true"] {
    color: var(--colours-text-strong);
  }

  .tab[aria-selected="true"]::after {
    scale: 1 1;
  }

  .panel {
    padding: var(--azure-spacing-lg);
    animation: fade var(--azure-duration-md) var(--azure-ease-out);
  }

  section {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: color-mix(in oklab, var(--colours-foreground) 85%, var(--colours-background));
  }

  .heading {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  p {
    margin: 0;
  }

  .strong {
    color: var(--colours-text-strong);
  }

  .faint {
    color: var(--colours-text-faint);
  }

  .nothing {
    padding: var(--azure-spacing-lg) 0;
    text-align: center;
  }

  .rooms {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rooms li + li {
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .room {
    width: 100%;
    padding: var(--azure-spacing-sm);
    border-radius: var(--azure-radius-sm);
    text-align: left;
    color: var(--colours-text-faint);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .room:hover,
  .room:focus-visible {
    background-color: var(--colours-surface-hover);
    color: var(--colours-accent);
  }

  @keyframes scrim {
    from {
      background-color: transparent;
      backdrop-filter: blur(0);
    }
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .modal,
    .panel {
      animation: none;
    }
  }

  @media (max-width: 767px) {
    .layer {
      padding: 0;
    }

    .modal {
      width: 100%;
      height: 100%;
      max-height: none;
      border-radius: 0;
      border: none;
      padding-bottom: env(safe-area-inset-bottom);
      animation: rise var(--azure-duration-glide) var(--azure-ease-fluid);
    }

    .close {
      top: calc(var(--azure-spacing-md) + env(safe-area-inset-top));
    }
  }
</style>
