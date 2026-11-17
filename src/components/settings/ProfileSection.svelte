<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { setAvatarUrl, setBanner, setDisplayName, uploadImage } from "../../scripts/matrix/utilities/account";
  import { getWideMediaLink, isMxc } from "../../scripts/matrix/utilities/media";
  import { fetchProfile, forgetProfile } from "../../scripts/matrix/utilities/profile";
  import type { Session } from "../../scripts/matrix/types";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { ownProfile, refreshOwnProfile, session, type Profile } from "../../scripts/stores/matrix";
  import { ownStatus, profileFields, statusMessage, type OwnStatus } from "../../scripts/stores/presence";
  import { unsavedChanges, unsavedNudge } from "../../scripts/stores/settings";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import StatusDialog from "../navigation/StatusDialog.svelte";
  import ProfileIdentity from "../profile/ProfileIdentity.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import ImageCropper from "../ui/ImageCropper.svelte";
  import Icon from "./Icon.svelte";

  type Part = "avatar" | "banner";
  type Staged = { blob: Blob; link: string } | "removed" | null;

  const CROP: Record<Part, { aspect: number; shape: "circle" | "rect"; output: number }> = {
    avatar: { aspect: 1, shape: "circle", output: 512 },
    banner: { aspect: 3, shape: "rect", output: 1200 },
  };

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const account = (...path: string[]) => text("account", ...path);

  let profile = $state.raw<Profile | null>(null);
  let active = $state.raw<Session | null>(null);
  let fields = $state.raw<"stable" | "unstable" | null | undefined>(undefined);
  let status = $state.raw<OwnStatus>({ mode: "online" });
  let banner = $state<string | undefined>();
  let bannerLink = $state<string | undefined>();
  let name = $state<string | null>(null);
  let drafts = $state.raw<Record<Part, Staged>>({ avatar: null, banner: null });
  let crop = $state.raw<{ file: File; part: Part } | null>(null);
  let saving = $state(false);
  let editingStatus = $state(false);
  let bar: HTMLElement | undefined = $state();
  let picker: HTMLInputElement | undefined = $state();
  let picking: Part = "avatar";
  let firstNudge = true;

  $effect(() => ownProfile.subscribe((value) => (profile = value)));
  $effect(() => session.subscribe((value) => (active = value)));
  $effect(() => profileFields.subscribe((value) => (fields = value)));
  $effect(() => ownStatus.subscribe((value) => (status = value)));
  $effect(() =>
    unsavedNudge.subscribe(() => {
      const skip = firstNudge;
      firstNudge = false;
      !skip && bar && (bar.classList.remove("nudged"), void bar.offsetWidth, bar.classList.add("nudged"));
    }),
  );

  $effect(() => {
    const userId = profile?.userId;
    userId && void fetchProfile(userId).then((data) => (banner = data?.banner));
  });

  $effect(() => {
    const url = banner;
    bannerLink = undefined;
    isMxc(url) && void getWideMediaLink(url, 1200, 400).then((link) => url === banner && (bannerLink = link));
  });

  const shown = (draft: Staged, saved: string | undefined) => (draft === "removed" ? undefined : (draft?.link ?? saved));

  const userId = $derived(profile?.userId ?? "");
  const savedName = $derived(profile?.displayName ?? "");
  const shownName = $derived((name ?? savedName).trim() || savedName || userId);
  const shownAvatar = $derived(shown(drafts.avatar, profile?.avatarUrl));
  const shownBanner = $derived(shown(drafts.banner, bannerLink));
  const has = $derived<Record<Part, boolean>>({ avatar: !!shownAvatar, banner: !!shownBanner });
  const message = $derived(statusMessage(status));
  const dirty = $derived((name !== null && !!name.trim() && name.trim() !== savedName) || !!drafts.avatar || !!drafts.banner);

  $effect(() => {
    const value = dirty;
    queueMicrotask(() => unsavedChanges.set(value));
  });

  const revoke = (draft: Staged) => draft && draft !== "removed" && URL.revokeObjectURL(draft.link);

  onMount(() => () => {
    unsavedChanges.set(false);
    Object.values(drafts).forEach(revoke);
  });

  const stage = (part: Part, value: Staged) => {
    revoke(drafts[part]);
    drafts = { ...drafts, [part]: value };
  };

  const pick = (part: Part) => {
    picking = part;
    picker?.click();
  };

  const picked = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    file && (crop = { file, part: picking });
  };

  const applied = (blob: Blob) => {
    const part = crop?.part ?? "avatar";
    crop = null;
    stage(part, { blob, link: URL.createObjectURL(blob) });
  };

  const editors: [string, () => unknown][] = [
    [".banner", () => fields && pick("banner")],
    [".avatar", () => pick("avatar")],
    [".name", () => document.getElementById("settings-name")?.focus()],
    [".status", () => (editingStatus = true)],
  ];
  const editFrom = (event: MouseEvent) => editors.find(([selector]) => (event.target as Element).closest(selector))?.[1]();

  const saved: Record<Part, () => boolean> = { avatar: () => !!profile?.avatarUrl, banner: () => !!banner };
  const remove = (part: Part) => stage(part, saved[part]() ? "removed" : null);

  const reset = () => {
    stage("avatar", null);
    stage("banner", null);
    name = null;
  };

  const save = async () => {
    const current = active;
    if (!current || saving || !dirty) return;
    saving = true;
    const upload = (part: Part) => {
      const draft = drafts[part];
      return draft && draft !== "removed" ? uploadImage(current, draft.blob, `${part}.png`) : Promise.resolve(null);
    };
    try {
      const [avatarUrl, bannerUrl] = await Promise.all([upload("avatar"), upload("banner")]);
      const trimmed = name?.trim();
      trimmed && trimmed !== savedName && (await setDisplayName(current, trimmed));
      drafts.avatar && (await setAvatarUrl(current, avatarUrl ?? ""));
      drafts.banner && fields && (await setBanner(current, fields, bannerUrl), (banner = bannerUrl ?? undefined));
      forgetProfile(current.userId);
      await refreshOwnProfile();
      reset();
      toastKey("profile_saved", { icon: "save", tone: "success" });
    } catch {
      toastKey("profile_failed", { tone: "danger" });
    } finally {
      saving = false;
    }
  };

  const imageItems = (part: Part) => (): MenuItem[] => [
    { id: `${part}-change`, label: account(`change_${part}`), icon: MENU_ICONS.image, filled: true, run: () => pick(part) },
    ...(has[part] ? [{ id: `${part}-remove`, label: account(`remove_${part}`), icon: MENU_ICONS.delete, filled: true, danger: true, run: () => remove(part) }] : []),
  ];

  const nameItems = (): MenuItem[] => [{ id: "name-copy", label: entityText("copy_name"), icon: MENU_ICONS.copy, run: () => copied(shownName) }];

  const statusItems = (): MenuItem[] => [
    { id: "status-edit", label: account("set_status"), icon: MENU_ICONS.status, run: () => (editingStatus = true) },
    ...(message ? [{ id: "status-copy", label: entityText("copy_status"), icon: MENU_ICONS.copy, run: () => copied(message) }] : []),
  ];
</script>

<input type="file" accept="image/*" bind:this={picker} onchange={picked} hidden />

<div class="layout">
  <div class="form col">
    <section class="set-section" data-part="name">
      <label class="set-heading" for="settings-name">{account("display_name")}</label>
      <div class="set-input" use:menu={nameItems}>
        <input id="settings-name" value={name ?? savedName} maxlength="256" placeholder={userId} autocomplete="off" oninput={(event) => (name = event.currentTarget.value)} />
      </div>
    </section>

    <section class="set-section" data-part="avatar" use:menu={imageItems("avatar")}>
      <h3 class="set-heading">{account("avatar")}</h3>
      <div class="row gap-sm">
        <button type="button" class="set-button ghost press" onclick={() => pick("avatar")}>{account("change_avatar")}</button>
        {#if has.avatar}
          <button type="button" class="set-button outline-danger ghost press remove-link" onclick={() => remove("avatar")}>{account("remove_avatar")}</button>
        {/if}
      </div>
    </section>

    <section class="set-section" data-part="banner" use:menu={fields ? imageItems("banner") : undefined}>
      <h3 class="set-heading">{account("banner")}</h3>
      {#if fields}
        <div class="row gap-sm">
          <button type="button" class="set-button ghost press" onclick={() => pick("banner")}>{account("change_banner")}</button>
          {#if has.banner}
            <button type="button" class="set-button outline-danger ghost press remove-link" onclick={() => remove("banner")}>{account("remove_banner")}</button>
          {/if}
        </div>
      {:else}
        <p class="set-hint">{account("banner_unsupported")}</p>
      {/if}
    </section>

    <section class="set-section" data-part="status">
      <h3 class="set-heading">{account("status")}</h3>
      <div class="status row-nw align-centre gap-md" use:menu={statusItems}>
        <span class="sm truncate flex-max status-text" class:empty={!message}><EmojiText text={message ?? account("no_status")} /></span>
        <button type="button" class="set-button ghost press" onclick={() => (editingStatus = true)}><Icon name="edit" size={14} />{account("set_status")}</button>
      </div>
    </section>
  </div>

  <aside class="preview col gap-sm">
    <h3 class="set-label">{account("preview")}</h3>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card editable" onclick={editFrom}>
      {#key `${shownAvatar}|${shownBanner}`}
        <div class="swap">
          <ProfileIdentity {userId} displayName={shownName} avatar={shownAvatar} banner={shownBanner} status={message ?? undefined} size="sm" surface="var(--colours-foreground)" />
        </div>
      {/key}
    </div>
  </aside>
</div>

{#if dirty || saving}
  <div class="unsaved-dock">
    <div class="unsaved motion-keep row-nw align-centre gap-sm" bind:this={bar} role="status" onanimationend={(event) => event.target === bar && event.animationName.includes("flash") && bar?.classList.remove("nudged")}>
      <span class="unsaved-text truncate">{text("unsaved")}</span>
      <button type="button" class="unsaved-reset ghost press" disabled={saving} onclick={reset}>{text("reset")}</button>
      <button type="button" class="unsaved-save ghost press" disabled={saving} onclick={save}>{saving ? account("uploading") : text("save")}</button>
    </div>
  </div>
{/if}

{#if crop}
  <ImageCropper file={crop.file} {...CROP[crop.part]} onapply={applied} oncancel={() => (crop = null)} />
{/if}

{#if editingStatus}
  <StatusDialog onclose={() => (editingStatus = false)} />
{/if}

<style>
  .editable :global(:is(.banner, .avatar, .name, .status)) {
    cursor: pointer;
    transition: filter 200ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .editable :global(:is(.banner, .avatar, .name, .status):hover) {
    filter: brightness(1.15);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: var(--azure-spacing-xl);
    align-items: start;
  }

  .form .set-section {
    gap: var(--azure-spacing-md);
    padding-bottom: 32px;
  }

  .form .set-section + .set-section {
    padding-top: 32px;
  }

  .status-text {
    color: var(--colours-text);
  }

  .status-text.empty {
    color: var(--colours-text-faint);
  }

  .preview {
    position: sticky;
    top: 80px;
  }

  .card {
    width: 300px;
    border-color: var(--colours-outline-hairline);
    overflow: hidden;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 16px 40px -18px black;
  }

  .unsaved-dock {
    position: sticky;
    bottom: var(--azure-spacing-lg);
    z-index: 4;
    margin-top: auto;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .swap {
    animation: image-swap 520ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes image-swap {
    from {
      opacity: 0.35;
      filter: blur(12px);
      transform: scale(0.98);
    }
  }

  .unsaved {
    max-width: 100%;
    pointer-events: auto;
    padding: 6px 6px 6px 16px;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-foreground);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
    color: var(--colours-text);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    animation: unsaved-in 460ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .unsaved-reset,
  .set-button.remove-link {
    border-color: transparent;
  }

  .unsaved-save {
    flex: none;
    min-height: 30px;
    padding: 0 12px;
    border-radius: var(--azure-radius-pill);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .unsaved-reset {
    margin: 0 10px 0 20px;
    color: var(--colours-text-muted);
  }

  .unsaved-reset:hover:not(:disabled) {
    color: var(--colours-text-strong);
    text-decoration: underline;
  }

  .unsaved-save {
    padding: 0 16px;
    color: var(--colours-on-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 78%, var(--colours-surface-raised));
  }

  .unsaved-save:hover:not(:disabled) {
    background-color: var(--colours-accent);
  }

  .unsaved button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .unsaved:global(.nudged) {
    animation:
      unsaved-in 460ms cubic-bezier(0.34, 1.56, 0.64, 1) both,
      unsaved-shake 500ms linear,
      unsaved-flash 600ms var(--azure-ease-out);
  }

  .unsaved:global(.nudged) .unsaved-text {
    animation: unsaved-bold 600ms var(--azure-ease-out);
  }

  .unsaved:global(.nudged) .unsaved-reset {
    animation: unsaved-reset-flash 600ms var(--azure-ease-out);
  }

  .unsaved:global(.nudged) .unsaved-save {
    animation: unsaved-save-flash 600ms var(--azure-ease-out);
  }

  @keyframes unsaved-bold {
    0%,
    35% {
      font-weight: 700;
    }
  }

  @keyframes unsaved-reset-flash {
    0%,
    35% {
      color: white;
    }
  }

  @keyframes unsaved-save-flash {
    0%,
    35% {
      color: var(--colours-danger);
      background-color: white;
    }
  }

  @keyframes unsaved-in {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.92);
    }
  }

  @keyframes unsaved-shake {
    10% {
      transform: translateX(-10px) scale(1.03);
    }
    22% {
      transform: translateX(9px) scale(1.02);
    }
    34% {
      transform: translateX(-7px) scale(1.01);
    }
    46% {
      transform: translateX(6px);
    }
    58% {
      transform: translateX(-4px);
    }
    70% {
      transform: translateX(3px);
    }
    84% {
      transform: translateX(-1px);
    }
  }

  @keyframes unsaved-flash {
    0%,
    35% {
      background-color: color-mix(in oklab, var(--colours-danger) 85%, var(--colours-surface-raised));
      border-color: var(--colours-danger);
      color: white;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .unsaved:global(.nudged) {
      animation: unsaved-flash 600ms var(--azure-ease-out);
    }
  }

  :global(:root[data-motion="reduce"]) .unsaved:global(.nudged) {
    animation: unsaved-flash 600ms var(--azure-ease-out);
  }

  @media (max-width: 1023px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .preview {
      position: static;
      order: -1;
      align-items: center;
    }

    .preview .set-label {
      align-self: flex-start;
    }

    .card {
      max-width: 100%;
    }
  }

  @media (max-width: 767px) {
    .unsaved-dock {
      bottom: calc(var(--azure-spacing-md) + env(safe-area-inset-bottom));
    }

    .unsaved-text {
      font-size: var(--text-xs);
    }
  }
</style>
