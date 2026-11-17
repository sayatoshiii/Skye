<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { changePassword, deactivateAccount, listDevices, listThreepids, type ThreePid } from "../../scripts/matrix/utilities/account";
  import type { Session } from "../../scripts/matrix/types";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { ROUTES } from "../../scripts/settings/config";
  import { ownProfile, session, signOut, type Profile } from "../../scripts/stores/matrix";
  import type { SettingsSection } from "../../scripts/stores/settings";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";

  let { go }: { go: (id: SettingsSection) => void } = $props();

  type Row = { id: string; label: string; value: string; mono?: boolean; masked?: string; action: "edit" | "copy" | null; run?: () => void; items: () => MenuItem[] };

  const MEDIUM: Record<string, string> = { email: "email", msisdn: "phone" };
  const MASK: Record<string, (value: string) => string> = {
    email: (value) => value.replace(/^(.)[^@]*/, "$1*****"),
    msisdn: (value) => value.replace(/.(?=.{4})/g, "*"),
  };

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const me = (...path: string[]) => text("me", ...path);

  let profile = $state.raw<Profile | null>(null);
  let active = $state.raw<Session | null>(null);
  let threepids = $state.raw<ThreePid[] | null | undefined>(undefined);
  let deviceCount = $state<number | null>(null);
  let dialog = $state<"password" | "deactivate" | null>(null);
  let busy = $state(false);
  let error = $state("");
  let current = $state("");
  let next = $state("");
  let repeat = $state("");
  let typed = $state("");
  let revealed = $state<Record<string, boolean>>({});

  $effect(() => ownProfile.subscribe((value) => (profile = value)));
  $effect(() => session.subscribe((value) => (active = value)));

  $effect(() => {
    const value = active;
    value && void listThreepids(value).then((list) => (threepids = list), () => (threepids = null));
    value && void listDevices(value).then((list) => (deviceCount = list.length), () => (deviceCount = null));
  });

  const userId = $derived(profile?.userId ?? "");
  const name = $derived(profile?.displayName || userId);
  const server = $derived(userId.split(":").slice(1).join(":"));

  const copyItem = (id: string, label: string, value: string, key = "copied"): MenuItem => ({ id, label, icon: MENU_ICONS.copy, run: () => copied(value, key, key === "copied" ? "copy" : "id") });

  const contacts = $derived<Row[]>(
    (threepids ?? []).map((pid) => ({
      id: `pid-${pid.address}`,
      label: me(MEDIUM[pid.medium] ?? "contact"),
      value: pid.address,
      masked: (MASK[pid.medium] ?? MASK.msisdn)(pid.address),
      action: "copy",
      run: () => copied(pid.address),
      items: () => [copyItem("pid-copy", me("copy"), pid.address)],
    })),
  );

  const rows = $derived<Row[]>([
    {
      id: "name",
      label: me("display_name"),
      value: name,
      action: "edit",
      run: () => go("profile"),
      items: () => [{ id: "name-edit", label: text("account", "edit_name"), icon: MENU_ICONS.edit, run: () => go("profile") }, copyItem("name-copy", entityText("copy_name"), name)],
    },
    { id: "id", label: me("user_id"), value: userId, mono: true, action: "copy", run: () => copied(userId, "user_id_copied", "id"), items: () => [copyItem("id-copy", text("account", "copy_id"), userId, "user_id_copied")] },
    { id: "server", label: me("homeserver"), value: server, mono: true, action: "copy", run: () => copied(server, "homeserver_copied"), items: () => [copyItem("server-copy", me("copy_homeserver"), server, "homeserver_copied")] },
    ...(contacts.length
      ? contacts
      : [{ id: "contact", label: me("contact"), value: threepids === undefined ? me("loading") : me("none"), action: null, items: () => [] }]),
  ]);

  const devicesLabel = $derived(deviceCount === null ? "" : deviceCount === 1 ? me("device_one") : me("device_count").replace("{count}", String(deviceCount)));

  const open = (kind: "password" | "deactivate") => {
    current = next = repeat = typed = error = "";
    dialog = kind;
  };

  const close = () => {
    current = next = repeat = typed = "";
    dialog = null;
  };

  const mismatch = $derived(!!repeat && next !== repeat);
  const canChange = $derived(!!current && !!next && next === repeat && !busy);
  const canDeactivate = $derived(typed.trim() === userId && !!current && !busy);

  const submitPassword = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!active || !canChange) return;
    busy = true;
    error = "";
    try {
      await changePassword(active, current, next);
      toastKey("password_changed", { icon: "check", tone: "success" });
      close();
    } catch {
      error = text("password", "wrong");
    } finally {
      busy = false;
    }
  };

  const submitDeactivate = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!active || !canDeactivate) return;
    busy = true;
    error = "";
    try {
      await deactivateAccount(active, current);
      current = "";
      await signOut().catch(() => undefined);
      location.replace(ROUTES.login);
    } catch {
      error = text("deactivate", "failed");
      busy = false;
    }
  };

</script>

<section class="set-section" data-part="info">
  <h3 class="set-heading">{text("parts", "info")}</h3>
  <div class="set-rows">
    {#each rows as row (row.id)}
      {@const hidden = !!row.masked && !revealed[row.id]}
      <div class="set-row" use:menu={row.items}>
        <span class="set-title">{row.label}</span>
        <span class="set-value">
          <span class:mono={row.mono}>{hidden ? row.masked : row.value}</span>
          {#if row.masked}
            <button type="button" class="set-link ghost" onclick={() => (revealed = { ...revealed, [row.id]: hidden })}>{me(hidden ? "reveal" : "hide")}</button>
          {/if}
        </span>
        {#if row.action}
          <button type="button" class="set-button ghost press" onclick={row.run}>{me(row.action)}</button>
        {/if}
      </div>
    {/each}
  </div>
</section>

<section class="set-section" data-part="password">
  <h3 class="set-heading">{me("password_heading")}</h3>
  <div class="set-rows">
    <div class="set-row">
      <span class="set-title">{me("password_label")}</span>
      <button type="button" class="set-button ghost press" onclick={() => open("password")}>{me("edit")}</button>
    </div>
    <button type="button" class="set-chevron ghost press row-nw align-centre gap-sm" onclick={() => go("devices")}>
      <span class="set-title flex-max">{me("devices")}</span>
      <span class="set-value">{devicesLabel}</span>
      <Icon name="next" size={22} />
    </button>
  </div>
</section>

<section class="set-section" data-part="removal">
  <h3 class="set-heading">{me("removal")}</h3>
  <div class="set-row">
    <p class="set-hint">{me("removal_hint")}</p>
    <button type="button" class="set-button danger ghost press" onclick={() => open("deactivate")}>{me("deactivate")}</button>
  </div>
</section>

{#if dialog === "password"}
  <ConfirmDialog title={text("password", "title")} body={text("password", "body")} cancelLabel={text("cancel")} {busy} onclose={close}>
    <form id="settings-password" class="col gap-sm" onsubmit={submitPassword}>
      <input class="field" type="password" bind:value={current} autocomplete="current-password" placeholder={text("password", "current")} aria-label={text("password", "current")} />
      <input class="field" type="password" bind:value={next} autocomplete="new-password" placeholder={text("password", "next")} aria-label={text("password", "next")} />
      <input class="field" class:invalid={mismatch} type="password" bind:value={repeat} autocomplete="new-password" placeholder={text("password", "confirm")} aria-label={text("password", "confirm")} />
      {#if mismatch || error}<p class="xs error">{mismatch ? text("password", "mismatch") : error}</p>{/if}
    </form>
    {#snippet actions()}
      <button type="submit" form="settings-password" class="dialog-button ghost press sm bold primary" disabled={!canChange}>{me("change_password")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

{#if dialog === "deactivate"}
  <ConfirmDialog title={text("deactivate", "title")} body={text("deactivate", "body")} cancelLabel={text("cancel")} {busy} onclose={close}>
    <form id="settings-deactivate" class="col gap-sm" onsubmit={submitDeactivate}>
      <label class="col gap-xs">
        <span class="xs bold faint">{text("deactivate", "type_id").replace("{id}", userId)}</span>
        <input class="field mono" bind:value={typed} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder={userId} />
      </label>
      <input class="field" type="password" bind:value={current} autocomplete="current-password" placeholder={text("deactivate", "password")} aria-label={text("deactivate", "password")} />
      {#if error}<p class="xs error">{error}</p>{/if}
    </form>
    {#snippet actions()}
      <button type="submit" form="settings-deactivate" class="dialog-button ghost press sm bold danger" disabled={!canDeactivate}>{text("deactivate", "confirm")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

<style>
  .mono {
    font-family: ui-monospace, monospace;
  }

  .field {
    width: 100%;
    min-height: 40px;
    padding: 0 var(--azure-spacing-md);
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background-color: transparent;
    border: 1px solid var(--colours-outline-hairline);
    border-radius: 8px;
    outline: none;
  }

  .field.invalid {
    border-color: color-mix(in oklab, var(--colours-danger) 60%, transparent);
  }

  .error {
    margin: 0;
    color: var(--colours-danger);
  }

</style>
