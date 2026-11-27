<script lang="ts">
  import { type Component } from "svelte";
  import { get } from "svelte/store";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { ROUTES } from "../../scripts/settings/config";
  import { ownProfile, signOut, type Profile } from "../../scripts/stores/matrix";
  import { guardUnsaved, settingsOpen, settingsSection, type SettingsSection } from "../../scripts/stores/settings";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import AccountSection from "./AccountSection.svelte";
  import AppearanceSection from "./AppearanceSection.svelte";
  import DevicesSection from "./DevicesSection.svelte";
  import Icon from "./Icon.svelte";
  import { SETTINGS_ICONS, type SettingsIcon } from "./icons";
  import NotificationsSection from "./NotificationsSection.svelte";
  import PrivacySection from "./PrivacySection.svelte";
  import ProfileSection from "./ProfileSection.svelte";
  import SettingsShell, { type ShellGroup } from "./SettingsShell.svelte";
  import VoiceSection from "./VoiceSection.svelte";

  type Group = "user" | "app";
  type Entry = { id: SettingsSection; group: Group; icon: SettingsIcon; parts: string[]; view: Component<{ go: (id: SettingsSection) => void }> };

  const SECTIONS: Entry[] = [
    { id: "profile", group: "user", icon: "profile", parts: ["name", "avatar", "banner", "status"], view: ProfileSection },
    { id: "account", group: "user", icon: "account", parts: ["info", "password", "removal"], view: AccountSection },
    { id: "devices", group: "user", icon: "laptop", parts: ["current", "others"], view: DevicesSection },
    { id: "privacy", group: "user", icon: "privacy", parts: ["encryption", "backup", "ignored"], view: PrivacySection },
    { id: "appearance", group: "app", icon: "appearance", parts: ["theme", "accent", "motion", "behaviour"], view: AppearanceSection },
    { id: "notifications", group: "app", icon: "notifications", parts: ["browser", "synced"], view: NotificationsSection },
    { id: "voice", group: "app", icon: "mic", parts: ["input", "output", "camera", "talk"], view: VoiceSection },
  ];
  const GROUPS: Group[] = ["user", "app"];
  const BY_ID = Object.fromEntries(SECTIONS.map((entry) => [entry.id, entry])) as Record<SettingsSection, Entry>;

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const signOutLabel = getLocalisedText(undefined, "profile", "sign_out") as string;

  const groups: ShellGroup<SettingsSection>[] = GROUPS.map((group, index) => ({
    id: group,
    title: index ? text("groups", group) : undefined,
    entries: SECTIONS.filter((entry) => entry.group === group).map((entry) => ({
      id: entry.id,
      label: text("sections", entry.id),
      icon: SETTINGS_ICONS[entry.icon],
      parts: entry.parts.map((id) => ({ id, label: text("parts", id) })),
    })),
  }));

  const requested = get(settingsSection);
  let section = $state<SettingsSection>(requested ?? "profile");
  let paged = $state(!!requested);
  let confirming = $state(false);
  let leaving = $state(false);
  let profile = $state.raw<Profile | null>(null);

  $effect(() => ownProfile.subscribe((value) => (profile = value)));
  $effect(() =>
    settingsSection.subscribe((value) => {
      value && ((section = value), (paged = true), settingsSection.set(null));
    }),
  );

  const current = $derived(BY_ID[section]);
  const name = $derived(profile?.displayName || profile?.userId || "");

  const leave = async () => {
    leaving = true;
    await signOut();
    location.replace(ROUTES.login);
  };

  const meItems = (go: (id: SettingsSection) => void): MenuItem[] => [
    { id: "me-edit", label: text("edit_profile"), icon: MENU_ICONS.edit, run: () => go("profile") },
    { id: "me-name", label: getLocalisedText(undefined, "entity_menu", "copy_name") as string, icon: MENU_ICONS.copy, run: () => copied(name) },
    { id: "me-id", label: text("account", "copy_id"), icon: MENU_ICONS.id, run: () => copied(profile?.userId ?? "", "user_id_copied", "id") },
  ];
</script>

{#snippet footnote()}
  Skye {import.meta.env.SKYE_VERSION}{#if import.meta.env.SKYE_COMMIT}{" "}({import.meta.env.SKYE_COMMIT}){/if}
{/snippet}

{#snippet top(go: (id: SettingsSection) => void)}
  <button type="button" class="me ghost press row-nw align-centre gap-sm" onclick={() => go("profile")} use:menu={() => meItems(go)}>
    <Avatar {name} url={profile?.avatarUrl} size="48px" radius="50%" />
    <span class="col min-0">
      <span class="md truncate me-name">{name}</span>
      <span class="sm row-nw align-centre gap-xs me-edit">{text("edit_profile")}<Icon name="edit" size={12} /></span>
    </span>
  </button>
{/snippet}

<SettingsShell
  label={text("title")}
  {groups}
  bind:section
  bind:paged
  searchable
  {footnote}
  guard={guardUnsaved}
  onclose={() => settingsOpen.set(false)}
  {top}
  actions={[{ id: "sign-out", label: signOutLabel, icon: SETTINGS_ICONS.signout, run: () => (confirming = true) }]}
>
  {#snippet children(go)}
    <current.view {go} />
  {/snippet}
</SettingsShell>

{#if confirming}
  <ConfirmDialog title={text("sign_out_title")} body={text("sign_out_body")} cancelLabel={text("cancel")} confirmLabel={signOutLabel} busy={leaving} onconfirm={leave} onclose={() => (confirming = false)} />
{/if}

<style>
  .me {
    width: 100%;
    min-height: 56px;
    padding: 4px 8px;
    border-radius: 8px;
    gap: 12px;
    text-align: left;
  }

  .me:hover {
    background-color: var(--colours-surface-hover);
  }

  .me-name {
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .me-edit {
    color: var(--colours-text-muted);
    transition: color var(--azure-duration-fast) var(--sheet);
  }

  .me:hover .me-edit {
    color: var(--colours-accent);
  }
</style>
