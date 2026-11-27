<script lang="ts">
  import Button from "../ui/Button.svelte";
  import UnsavedBar from "./UnsavedBar.svelte";
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
  let bar: { nudge: () => void } | undefined = $state();
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
      !skip && bar?.nudge();
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
  <div class="set-form col" data-glide>
    <section class="set-section" data-part="name">
      <label class="set-heading" for="settings-name">{account("display_name")}</label>
      <div class="set-input" use:menu={nameItems}>
        <input id="settings-name" value={name ?? savedName} maxlength="256" placeholder={userId} autocomplete="off" oninput={(event) => (name = event.currentTarget.value)} />
      </div>
    </section>

    <section class="set-section" data-part="avatar" use:menu={imageItems("avatar")}>
      <h3 class="set-heading">{account("avatar")}</h3>
      <div class="row gap-sm">
        <Button variant="outline" icon={MENU_ICONS.image} onclick={() => pick("avatar")}>{account("change_avatar")}</Button>
        {#if has.avatar}
          <button type="button" class="set-button quiet-danger ghost press" onclick={() => remove("avatar")}>{account("remove_avatar")}</button>
        {/if}
      </div>
    </section>

    <section class="set-section" data-part="banner" use:menu={fields ? imageItems("banner") : undefined}>
      <h3 class="set-heading">{account("banner")}</h3>
      {#if fields}
        <div class="row gap-sm">
          <Button variant="outline" icon={MENU_ICONS.image} onclick={() => pick("banner")}>{account("change_banner")}</Button>
          {#if has.banner}
            <button type="button" class="set-button quiet-danger ghost press" onclick={() => remove("banner")}>{account("remove_banner")}</button>
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
        <Button variant="outline" icon={MENU_ICONS.edit} onclick={() => (editingStatus = true)}>{account("set_status")}</Button>
      </div>
    </section>
  </div>

  <aside class="preview col gap-sm" data-glide>
    <h3 class="set-label">{account("preview")}</h3>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card editable" onclick={editFrom}>
      {#key `${shownAvatar}|${shownBanner}`}
        <div class="blur-swap" style:--swap-blur="12px" style:--swap-scale="0.98">
          <ProfileIdentity {userId} displayName={shownName} avatar={shownAvatar} banner={shownBanner} status={message ?? undefined} size="sm" surface="var(--colours-foreground)" live />
        </div>
      {/key}
    </div>
  </aside>
</div>

<UnsavedBar bind:this={bar} open={dirty} busy={saving} message={text("unsaved")} resetLabel={text("reset")} saveLabel={saving ? account("uploading") : text("save")} onreset={reset} onsave={save} />

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

  :global(.stacked) .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  :global(.stacked) .preview {
    position: static;
    order: -1;
    align-items: center;
  }

  :global(.stacked) .preview .set-label {
    align-self: flex-start;
  }

  :global(.stacked) .card {
    max-width: 100%;
  }

</style>
