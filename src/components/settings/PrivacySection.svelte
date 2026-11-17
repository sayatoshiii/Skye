<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getEncryptionStatus, historyRestored, restoreOpen } from "../../scripts/stores/matrix";
  import { settingsOpen } from "../../scripts/stores/settings";
  import Icon from "./Icon.svelte";
  import type { SettingsIcon } from "./icons";

  type Status = Awaited<ReturnType<typeof getEncryptionStatus>>;
  type Key = "crossSigning" | "verified" | "backup";

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "security", ...path) as string;

  type Row = { key: Key; icon: SettingsIcon; label: string; on: string; off: string; action?: (status: NonNullable<Status>) => string | undefined };

  const PARTS: { id: string; intro?: string; rows: Row[] }[] = [
    {
      id: "encryption",
      intro: "intro",
      rows: [
        { key: "crossSigning", icon: "privacy", label: "cross_signing", on: "cross_ready", off: "cross_missing" },
        { key: "verified", icon: "laptop", label: "device", on: "verified", off: "unverified", action: (status) => (status.crossSigning && !status.verified ? "verify" : undefined) },
      ],
    },
    { id: "backup", rows: [{ key: "backup", icon: "key", label: "backup", on: "backup_on", off: "backup_off", action: () => "restore" }] },
  ];

  let status = $state.raw<Status | undefined>(undefined);

  $effect(() => historyRestored.subscribe(() => void getEncryptionStatus().then((value) => (status = value), () => (status = null))));

  const openRestore = () => {
    settingsOpen.set(false);
    queueMicrotask(() => restoreOpen.set(true));
  };
</script>

{#each PARTS as part (part.id)}
  <section class="set-section" data-part={part.id}>
    <h3 class="set-heading">{getLocalisedText(undefined, "settings", "parts", part.id)}</h3>
    {#if part.intro}<p class="set-hint">{text(part.intro)}</p>{/if}
    {#if status}
      <div class="set-rows">
        {#each part.rows as row (row.key)}
          {@const action = row.action?.(status)}
          <div class="set-row">
            <span class="set-tile"><Icon name={row.icon} size={22} /></span>
            <span class="col gap-xs min-0 flex-max">
              <span class="set-title">{text(row.label)}</span>
              <span class="set-hint">{text(`${row.label}_hint`)}</span>
            </span>
            <span class="set-value tight"><span class="pill" class:good={status[row.key]} class:bad={!status[row.key]}>{text(status[row.key] ? row.on : row.off)}</span></span>
            {#if action}
              <button type="button" class="set-button ghost press" class:primary={action === "verify"} onclick={openRestore}>{text(action)}</button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="set-hint">{text(status === undefined ? "checking" : "unavailable")}</p>
    {/if}
  </section>
{/each}
