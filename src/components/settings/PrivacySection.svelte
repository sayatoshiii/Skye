<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { getEncryptionStatus, historyRestored, restoreOpen } from "../../scripts/stores/matrix";
  import { settingsOpen } from "../../scripts/stores/settings";
  import { ignoredUsers, setIgnored } from "../../scripts/stores/ignored";
  import { rooms } from "../../scripts/stores/matrix";
  import { usermenu } from "../../scripts/misc/usermenu";
  import Avatar from "../ui/Avatar.svelte";
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

  const reveal = (node: HTMLElement) => ({
    duration: 320,
    css: (t: number) => `opacity: ${t}; transform: scale(${0.96 + t * 0.04}); height: ${t * node.offsetHeight}px; margin-block-end: ${(t - 1) * 8}px`,
    easing: (t: number) => 1 - Math.pow(1 - t, 3),
  });

  const nameOf = (userId: string) =>
    Object.values($rooms).map((room) => room.members[userId]?.displayName).find(Boolean) ?? userId;

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
              <button type="button" class="set-button ghost press" onclick={openRestore}>{text(action)}</button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="set-hint">{text(status === undefined ? "checking" : "unavailable")}</p>
    {/if}
  </section>
{/each}

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
