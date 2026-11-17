<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getEncryptionStatus, historyRestored, restoreOpen, setupRecovery, unlockRecovery } from "../../scripts/stores/matrix";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import { settingsOpen } from "../../scripts/stores/settings";
  import { ignoredUsers, setIgnored } from "../../scripts/stores/ignored";
  import { rooms } from "../../scripts/stores/matrix";
  import { usermenu } from "../../scripts/misc/usermenu";
  import Avatar from "../ui/Avatar.svelte";
  import Icon from "./Icon.svelte";
  import type { SettingsIcon } from "./icons";

  type Status = Awaited<ReturnType<typeof getEncryptionStatus>>;
  type Key = "crossSigning" | "verified" | "backup" | "recovery";
  type Action = "verify" | "restore" | "setup_recovery" | "change_recovery" | "enter_recovery";

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "security", ...path) as string;

  type Row = { key: Key; icon: SettingsIcon; label: string; on: string; off: string; actions?: (status: NonNullable<Status>) => Action[] };

  const PARTS: { id: string; intro?: string; rows: Row[] }[] = [
    {
      id: "encryption",
      intro: "intro",
      rows: [
        { key: "crossSigning", icon: "privacy", label: "cross_signing", on: "cross_ready", off: "cross_missing" },
        { key: "verified", icon: "laptop", label: "device", on: "verified", off: "unverified", actions: (status) => (status.crossSigning && !status.verified ? ["verify"] : []) },
      ],
    },
    {
      id: "backup",
      rows: [
        { key: "recovery", icon: "privacy", label: "recovery", on: "recovery_on", off: "recovery_off", actions: (status) => (status.recovery ? [...(status.verified ? [] : ["enter_recovery" as const]), "change_recovery"] : ["setup_recovery"]) },
        { key: "backup", icon: "key", label: "backup", on: "backup_on", off: "backup_off", actions: () => ["restore"] },
      ],
    },
  ];

  let status = $state.raw<Status | undefined>(undefined);

  $effect(() => historyRestored.subscribe(() => void getEncryptionStatus().then((value) => (status = value), () => (status = null))));

  const bezier = (a: number, b: number) => (s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const x = bezier(0.32, 0);
  const y = bezier(0.72, 1);
  const curve = (t: number) => {
    const s = Array.from({ length: 24 }).reduce<[number, number]>(([lo, hi]) => (x((lo + hi) / 2) < t ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2]), [0, 1]);
    return y((s[0] + s[1]) / 2);
  };

  const reveal = (node: HTMLElement) => ({
    duration: 320,
    easing: curve,
    css: (t: number) => `opacity: ${t}; transform: scale(${0.96 + t * 0.04}); height: ${t * node.offsetHeight}px; margin-block-end: ${(t - 1) * 8}px`,
  });

  const nameOf = (userId: string) =>
    Object.values($rooms).map((room) => room.members[userId]?.displayName).find(Boolean) ?? userId;

  const openRestore = () => {
    settingsOpen.set(false);
    queueMicrotask(() => restoreOpen.set(true));
  };

  let dialog = $state<"confirm_change" | "key" | "enter" | "password" | null>(null);
  let busy = $state(false);
  let recoveryKey = $state("");
  let saved = $state(false);
  let entered = $state("");
  let password = $state("");
  let answer: ((value: string | null) => void) | null = null;

  const refresh = () => getEncryptionStatus().then((value) => (status = value), () => (status = null));

  const askPassword = () =>
    new Promise<string | null>((resolve) => {
      password = "";
      answer = resolve;
      dialog = "password";
    });

  const settlePassword = (value: string | null) => {
    dialog = null;
    answer?.(value);
    answer = null;
    password = "";
  };

  const createRecovery = async () => {
    dialog = null;
    busy = true;
    try {
      const key = await setupRecovery(askPassword);
      key && ((recoveryKey = key), (saved = false), (dialog = "key"));
    } catch {
      toastKey("recovery_failed", { tone: "danger" });
    } finally {
      busy = false;
      refresh();
    }
  };

  const submitKey = async (event: SubmitEvent) => {
    event.preventDefault();
    busy = true;
    try {
      await unlockRecovery(entered);
      dialog = null;
      entered = "";
      toastKey("recovery_unlocked", { tone: "success" });
    } catch {
      toastKey("recovery_wrong", { tone: "danger" });
    } finally {
      busy = false;
      refresh();
    }
  };

  const downloadKey = () => {
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([recoveryKey], { type: "text/plain" })),
      download: "skye-recovery-key.txt",
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const closeKey = () => {
    dialog = null;
    recoveryKey = "";
    saved = false;
  };

  const handlers: Record<Action, () => void> = {
    verify: openRestore,
    restore: openRestore,
    setup_recovery: createRecovery,
    change_recovery: () => (dialog = "confirm_change"),
    enter_recovery: () => ((entered = ""), (dialog = "enter")),
  };

  const ICONS: Record<Action, string> = {
    verify: MENU_ICONS.read,
    restore: MENU_ICONS.retry,
    setup_recovery: MENU_ICONS.add,
    change_recovery: MENU_ICONS.edit,
    enter_recovery: MENU_ICONS.open,
  };

  const rowItems = (actions: Action[]) => (): MenuItem[] => actions.map((action) => ({ id: `security-${action}`, label: text(action), icon: ICONS[action], run: handlers[action] }));

  const keyItems = (): MenuItem[] => [
    { id: "recovery-copy", label: text("recovery_copy"), icon: MENU_ICONS.copy, run: () => copied(recoveryKey) },
    { id: "recovery-download", label: text("recovery_download"), icon: MENU_ICONS.save, run: downloadKey },
  ];
</script>

{#each PARTS as part (part.id)}
  <section class="set-section" data-part={part.id}>
    <h3 class="set-heading">{getLocalisedText(undefined, "settings", "parts", part.id)}</h3>
    {#if part.intro}<p class="set-hint">{text(part.intro)}</p>{/if}
    {#if status}
      <div class="set-rows">
        {#each part.rows as row (row.key)}
          {@const actions = row.actions?.(status) ?? []}
          <div class="set-row" use:menu={actions.length ? rowItems(actions) : undefined}>
            <span class="set-tile"><Icon name={row.icon} size={22} /></span>
            <span class="col gap-xs min-0 flex-max">
              <span class="set-title">{text(row.label)}</span>
              <span class="set-hint">{text(`${row.label}_hint`)}</span>
            </span>
            <span class="set-value tight"><span class="pill" class:good={status[row.key]} class:bad={!status[row.key]}>{text(status[row.key] ? row.on : row.off)}</span></span>
            {#each actions as action (action)}
              <button type="button" class="set-button ghost press" disabled={busy} use:menu={rowItems([action])} onclick={handlers[action]}>{text(action)}</button>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <p class="set-hint">{text(status === undefined ? "checking" : "unavailable")}</p>
    {/if}
  </section>
{/each}

{#if dialog === "confirm_change"}
  <ConfirmDialog title={text("change_title")} body={text("change_body")} cancelLabel={text("cancel")} confirmLabel={text("change_recovery")} {busy} onconfirm={createRecovery} onclose={() => (dialog = null)} />
{/if}

{#if dialog === "password"}
  <ConfirmDialog title={text("password_title")} body={text("password_body")} cancelLabel={text("cancel")} onclose={() => settlePassword(null)}>
    <form id="settings-recovery-password" onsubmit={(event) => (event.preventDefault(), password && settlePassword(password))}>
      <input class="field" type="password" bind:value={password} autocomplete="current-password" aria-label={text("password")} placeholder={text("password")} />
    </form>
    {#snippet actions()}
      <button type="submit" form="settings-recovery-password" class="dialog-button ghost press sm bold primary" disabled={!password}>{text("continue")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

{#if dialog === "key"}
  <ConfirmDialog title={text("key_title")} body={text("key_body")} cancelLabel={text("done")} busy={!saved} onclose={closeKey}>
    <div class="key col gap-sm" use:menu={keyItems}>
      <code class="recovery-key sm">{recoveryKey}</code>
      <div class="row gap-sm">
        <button type="button" class="set-button ghost press" use:menu={keyItems} onclick={() => copied(recoveryKey)}>{text("recovery_copy")}</button>
        <button type="button" class="set-button ghost press" use:menu={keyItems} onclick={downloadKey}>{text("recovery_download")}</button>
      </div>
    </div>
    <Toggle checked={saved} label={text("key_saved")} onchange={(on: boolean) => (saved = on)} />
  </ConfirmDialog>
{/if}

{#if dialog === "enter"}
  <ConfirmDialog title={text("enter_title")} body={text("enter_body")} cancelLabel={text("cancel")} {busy} onclose={() => (dialog = null)}>
    <form id="settings-recovery-enter" onsubmit={submitKey}>
      <input class="field" bind:value={entered} autocomplete="off" spellcheck="false" aria-label={text("recovery")} placeholder={text("enter_placeholder")} />
    </form>
    {#snippet actions()}
      <button type="submit" form="settings-recovery-enter" class="dialog-button ghost press sm bold primary" disabled={!entered.trim() || busy}>{text("unlock")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

<section class="set-section" data-part="ignored">
  <h3 class="set-heading">{getLocalisedText(undefined, "settings", "parts", "ignored")}</h3>
  <p class="set-hint">{text("ignored_intro")}</p>
  <ul class="ignored col">
    {#each [...$ignoredUsers] as userId (userId)}
      <li class="set-row" use:usermenu={{ userId }} transition:reveal>
        <Avatar name={nameOf(userId)} size="36px" />
        <span class="col gap-xs min-0 flex-max">
          <span class="set-title truncate">{nameOf(userId)}</span>
          <span class="set-hint truncate">{userId}</span>
        </span>
        <button type="button" class="set-button ghost press" onclick={() => setIgnored(userId, false)}>{text("unignore")}</button>
      </li>
    {/each}
  </ul>
  <p class="set-hint none" class:shown={!$ignoredUsers.size}><span>{text("ignored_none")}</span></p>
</section>

<style>
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
    transition: border-color 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .field:focus {
    border-color: color-mix(in oklab, var(--colours-accent) 55%, transparent);
  }

  .recovery-key {
    padding: var(--azure-spacing-md);
    border-radius: 8px;
    word-spacing: 0.4em;
    line-height: 1.6;
    user-select: all;
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, var(--colours-accent) 8%, transparent);
  }

  .ignored {
    margin: 0;
    padding: 0;
    list-style: none;
    gap: 8px;
  }

  .ignored > li {
    overflow: hidden;
  }

  .none {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.4s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .none > span {
    min-height: 0;
    overflow: hidden;
  }

  .none.shown {
    grid-template-rows: 1fr;
    opacity: 1;
  }
</style>
