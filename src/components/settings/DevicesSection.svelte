<script lang="ts">
  import Button from "../ui/Button.svelte";
  import { haze } from "../../scripts/misc/haze";
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { accountManagement, clientInfo, deleteDevice, deleteDevices, deviceKind, listDevices, manageLink, renameDevice, type AccountManagement, type ClientInfo, type Device } from "../../scripts/matrix/utilities/account";
  import type { Session } from "../../scripts/matrix/types";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { formatAgo } from "../../scripts/misc/time";
  import { registerSyncHook, session } from "../../scripts/stores/matrix";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", ...path) as string;
  const dev = (...path: string[]) => text("devices", ...path);

  let active = $state.raw<Session | null>(null);
  let devices = $state.raw<Device[] | null>(null);
  let failed = $state(false);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let saving = $state(false);
  let removing = $state.raw<Device | "others" | null>(null);
  let askingPassword = $state(false);
  let password = $state("");
  let answer: ((value: string | null) => void) | null = null;

  $effect(() => session.subscribe((value) => (active = value)));

  let manage = $state.raw<AccountManagement | null>(null);
  let clients = $state.raw<Record<string, ClientInfo | null>>({});

  const load = async () => {
    failed = false;
    const current = active;
    if (!current) return void (devices = null);
    manage ?? accountManagement(current).then((value) => (manage = value));
    const known = devices;
    devices = await listDevices(current).catch(() => (known ?? ((failed = true), null)));
    devices?.filter((device) => !(device.device_id in clients)).forEach((device) => clientInfo(current, device.device_id).then((info) => (clients = { ...clients, [device.device_id]: info })));
  };

  const KIND_ICONS = { mobile: "phone", desktop: "monitor", web: "globe", unknown: "laptop" } as const;
  const iconOf = (device: Device) => KIND_ICONS[deviceKind(device, clients[device.device_id] ?? null)];
  const external = (wanted: string[], deviceId?: string) => manage && void window.open(manageLink(manage, wanted, deviceId), "_blank", "noopener,noreferrer");
  const startRename = (device: Device) => ((editing = device.device_id), (draft = device.display_name ?? ""));
  const askRemove = (target: Device | "others") =>
    manage ? external(target === "others" ? ["org.matrix.devices_list", "org.matrix.sessions_list"] : ["org.matrix.device_delete", "org.matrix.session_end", "org.matrix.device_view", "org.matrix.session_view"], target === "others" ? undefined : target.device_id) : (removing = target);

  const ACTIVE_WINDOW = 5 * 60 * 1000;
  let now = $state(Date.now());

  onMount(() => {
    void load();
    const timer = setInterval(() => document.visibilityState === "visible" && ((now = Date.now()), void load()), 15000);
    const stop = registerSyncHook((response) => active && response.device_lists?.changed?.includes(active.userId) && void load());
    return () => (clearInterval(timer), stop());
  });

  const live = (device: Device) => isCurrent(device) || (!!device.last_seen_ts && now - device.last_seen_ts < ACTIVE_WINDOW);

  const isCurrent = (device: Device) => device.device_id === active?.deviceId;
  const mine = $derived((devices ?? []).find(isCurrent));
  const others = $derived((devices ?? []).filter((device) => !isCurrent(device)));

  const nameOf = (device: Device) => device.display_name?.trim() || dev("unnamed");
  const seen = (device: Device) => (device.last_seen_ts ? dev("last_seen").replace("{time}", formatAgo(Date.now() - device.last_seen_ts)) : dev("never"));
  const details = (device: Device) => [device.device_id, device.last_seen_ip, live(device) ? null : seen(device)].filter(Boolean);

  const deviceItems = (device: Device) => (): MenuItem[] => [
    { id: "device-rename", label: dev("rename"), icon: MENU_ICONS.edit, run: () => startRename(device) },
    { id: "device-name", label: entityText("copy_name"), icon: MENU_ICONS.copy, run: () => copied(nameOf(device)) },
    { id: "device-id", label: entityText("copy_device_id"), icon: MENU_ICONS.id, run: () => copied(device.device_id, "id_copied", "id") },
    ...(isCurrent(device) ? [] : [{ id: "device-signout", label: dev("sign_out"), icon: MENU_ICONS.leave, danger: true, separated: true, run: () => askRemove(device) }]),
  ];


  const saveRename = async (event: SubmitEvent, device: Device) => {
    event.preventDefault();
    if (!active || saving) return;
    saving = true;
    const name = draft.trim();
    try {
      await renameDevice(active, device.device_id, name);
      devices = (devices ?? []).map((entry) => (entry.device_id === device.device_id ? { ...entry, display_name: name } : entry));
      editing = null;
      toastKey("device_renamed", { icon: "save", tone: "success" });
    } catch {
      toastKey("device_failed", { tone: "danger" });
    } finally {
      saving = false;
    }
  };

  const askPassword = () =>
    new Promise<string | null>((resolve) => {
      password = "";
      answer = resolve;
      askingPassword = true;
    });

  const settlePassword = (value: string | null) => {
    askingPassword = false;
    answer?.(value);
    answer = null;
    password = "";
  };

  const signOutTarget = async () => {
    const target = removing;
    if (!active || !target || saving) return;
    saving = true;
    const ids = target === "others" ? others.map((device) => device.device_id) : [target.device_id];
    try {
      const result = await (target === "others" ? deleteDevices(active, ids, askPassword) : deleteDevice(active, ids[0], askPassword));
      result !== null && ((devices = (devices ?? []).filter((entry) => !ids.includes(entry.device_id))), toastKey(target === "others" ? "devices_signed_out" : "device_signed_out", { icon: "leave", tone: "success" }));
    } catch {
      toastKey("device_failed", { tone: "danger" });
    } finally {
      saving = false;
      removing = null;
    }
  };

  const confirmText = $derived(
    removing === "others"
      ? { title: dev("sign_out_all_title"), body: dev("sign_out_all_body"), label: dev("sign_out_all") }
      : { title: dev("sign_out_title").replace("{name}", removing ? nameOf(removing) : ""), body: dev("sign_out_body"), label: dev("sign_out") },
  );
</script>

{#snippet rename(device: Device)}
  <form class="rename row-nw gap-sm" onsubmit={(event) => saveRename(event, device)}>
    <span class="set-input flex-max min-0"><input bind:value={draft} maxlength="100" aria-label={dev("name_label")} /></span>
    <button type="button" class="set-button ghost press" onclick={() => (editing = null)}>{text("cancel")}</button>
    <button type="submit" class="set-button primary ghost press" disabled={saving}>{text("save")}</button>
  </form>
{/snippet}

{#snippet info(device: Device)}
  <span class="set-tile device-icon"><Icon name={iconOf(device)} size={22} /></span>
  <span class="col min-0 flex-max">
    <span class="row-nw align-centre gap-sm min-0">
      <span class="set-title truncate device-name">{nameOf(device)}</span>
      {#if isCurrent(device)}<span class="tag xs bold">{dev("current")}</span>{/if}
    </span>
    <span class="meta row-nw align-centre gap-xs xs min-0">
      {#if live(device)}<span class="live row-nw align-centre bold" transition:haze={{ blur: 4, duration: 320, easing: cubicOut, scale: 1 }}><span class="live-dot"></span>{dev("active_now")}</span><span class="faint">·</span>{/if}
      {#key details(device).join(" · ")}<span class="faint truncate" in:fade={{ duration: 260, easing: cubicOut }}>{details(device).join(" · ")}</span>{/key}
    </span>
  </span>
{/snippet}

{#if failed}
  <div class="set-panel set-row">
    <p class="set-hint">{dev("load_failed")}</p>
    <button type="button" class="set-button ghost press" onclick={load}>{dev("retry")}</button>
  </div>
{:else if !devices}
  <p class="set-hint">{dev("loading")}</p>
{:else}
  {#if manage}
    <div class="notice row-nw align-centre gap-md" role="note">
      <svg class="notice-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 11v5M12 8h.01" /></svg>
      <p class="sm flex-max min-0">{dev("managed")}</p>
      <Button variant="link" onclick={() => external(["org.matrix.devices_list", "org.matrix.sessions_list"])}>{dev("open_account")}</Button>
    </div>
  {/if}
  {#if mine}
    <section class="set-section" data-part="current">
      <h3 class="set-heading">{dev("current")}</h3>
      <div class="current col gap-md" use:menu={editing === mine.device_id ? undefined : deviceItems(mine)}>
        {#if editing === mine.device_id}
          {@render rename(mine)}
        {:else}
          <div class="row-nw align-centre gap-md">
            {@render info(mine)}
            <button type="button" class="set-button ghost press" onclick={() => startRename(mine)}>{dev("rename")}</button>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="set-section" data-part="others">
    <h3 class="set-heading">{dev("others")}</h3>
    {#if others.length}
      <ul class="list col">
        {#each others as device (device.device_id)}
          <li class="device" animate:flip={{ duration: 380, easing: cubicOut }} in:haze={{ blur: 6, duration: 360, easing: cubicOut, scale: 1 }} out:haze={{ blur: 6, duration: 260, easing: cubicOut, scale: 1 }} use:menu={editing === device.device_id ? undefined : deviceItems(device)}>
            {#if editing === device.device_id}
              {@render rename(device)}
            {:else}
              <div class="row-nw align-centre gap-md">
                {@render info(device)}
                <span class="row-nw gap-xs actions">
                  <button type="button" class="set-button ghost press" onclick={() => startRename(device)}>{dev("rename")}</button>
                  <button type="button" class="set-button quiet-danger ghost press" onclick={() => askRemove(device)}>{dev("sign_out")}</button>
                </span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="row-nw">
        <button type="button" class="set-button danger ghost press" onclick={() => askRemove("others")}>{dev("sign_out_all")}</button>
      </div>
    {:else}
      <p class="set-hint">{dev("none_other")}</p>
    {/if}
  </section>
{/if}

{#if removing && !askingPassword}
  <ConfirmDialog title={confirmText.title} body={confirmText.body} cancelLabel={text("cancel")} confirmLabel={confirmText.label} busy={saving} onconfirm={signOutTarget} onclose={() => !saving && (removing = null)} />
{/if}

{#if askingPassword}
  <ConfirmDialog title={dev("password_title")} body={dev("password_body")} cancelLabel={text("cancel")} onclose={() => settlePassword(null)}>
    <form id="settings-device-password" onsubmit={(event) => (event.preventDefault(), password && settlePassword(password))}>
      <input class="field" type="password" bind:value={password} autocomplete="current-password" aria-label={dev("password")} placeholder={dev("password")} />
    </form>
    {#snippet actions()}
      <button type="submit" form="settings-device-password" class="button danger" disabled={!password}>{dev("confirm")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

<style>
  .live {
    gap: 5px;
    flex: none;
    color: var(--colours-success);
  }

  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: currentColor;
    animation: ring 1.6s ease-out infinite;
  }

  @keyframes ring {
    from {
      box-shadow: 0 0 0 0 color-mix(in oklab, currentColor 60%, transparent);
    }
    to {
      box-shadow: 0 0 0 6px transparent;
    }
  }

  .notice {
    margin-bottom: var(--azure-spacing-lg);
    padding: var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid color-mix(in oklab, var(--colours-accent) 35%, transparent);
    background-color: var(--colours-accent-faint);
    color: var(--colours-text);
  }

  .notice p {
    margin: 0;
  }

  .notice-icon {
    flex: none;
    color: var(--colours-accent);
  }

  .current {
    padding: var(--azure-spacing-md);
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--colours-accent) 35%, transparent);
    background-color: color-mix(in oklab, var(--colours-accent) 5%, transparent);
  }

  .current .device-icon {
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 16%, transparent);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list {
    gap: 24px;
  }

  .device-name {
    color: var(--colours-text-strong);
  }

  .tag {
    flex: none;
    padding: 1px 8px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .field {
    width: 100%;
    min-height: 42px;
    padding: 0 var(--azure-spacing-md);
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background-color: transparent;
    border: 1px solid var(--colours-outline-hairline);
    border-radius: 8px;
    outline: none;
  }

  .field:focus {
    border-color: color-mix(in oklab, var(--colours-accent) 55%, transparent);
  }

  @media (max-width: 767px) {
    .device > .row-nw {
      flex-wrap: wrap;
    }

    .actions {
      width: 100%;
      padding-left: 56px;
    }

    .rename {
      flex-wrap: wrap;
    }
  }
</style>
