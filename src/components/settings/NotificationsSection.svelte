<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { notifyPrefs, saveNotifyPrefs, type NotifyPrefs } from "../../scripts/stores/settings";
  import { toastKey } from "../../scripts/stores/toast";
  import { enableNotifications } from "../../scripts/stores/unread";
  import Toggle from "../ui/Toggle.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "notify", ...path) as string;

  let prefs = $state.raw<NotifyPrefs>({ directs: true, mentionsOnly: true });
  let permission = $state<NotificationPermission | "unsupported">("default");
  let asking = $state(false);

  $effect(() => notifyPrefs.subscribe((value) => (prefs = value)));

  const readPermission = () => (permission = "Notification" in window ? Notification.permission : "unsupported");

  onMount(readPermission);

  const enable = async () => {
    asking = true;
    await enableNotifications();
    asking = false;
    readPermission();
  };

  const update = (next: Partial<NotifyPrefs>) =>
    saveNotifyPrefs({ ...prefs, ...next }).then(
      () => toastKey("settings_saved", { icon: "save", tone: "success" }),
      () => toastKey("settings_failed", { tone: "danger" }),
    );
</script>

<section class="set-section" data-part="browser">
  <h3 class="set-heading">{text("heading_push")}</h3>
  <div class="set-row">
    <div class="col gap-xs min-0">
      <span class="set-title">{text("desktop")}</span>
      <p class="set-hint">{text("desktop_hint")}</p>
      <p class="state xs bold" data-state={permission}>{text(permission)}</p>
    </div>
    {#if permission === "default"}
      <button type="button" class="set-button primary ghost press" disabled={asking} onclick={enable}>{getLocalisedText(undefined, "notifications", "enable")}</button>
    {:else}
      <Toggle checked={permission === "granted"} disabled label={text("desktop")} />
    {/if}
  </div>
</section>

<section class="set-section" data-part="synced">
  <h3 class="set-heading">{text("heading_account")}</h3>
  <div class="set-rows">
    <div class="set-row">
      <div class="col gap-xs min-0">
        <span class="set-title">{text("directs")}</span>
        <p class="set-hint">{text("directs_hint")}</p>
      </div>
      <Toggle checked={prefs.directs} label={text("directs")} onchange={(value) => update({ directs: value })} />
    </div>
    <div class="set-row">
      <span class="set-title">{text("rooms")}</span>
      <div class="choice row-nw" role="radiogroup" aria-label={text("rooms")} style:--index={prefs.mentionsOnly ? 0 : 1}>
        <span class="thumb" aria-hidden="true"></span>
        {#each [true, false] as mentions (mentions)}
          <button type="button" class="choice-option ghost press sm bold" role="radio" aria-checked={prefs.mentionsOnly === mentions} onclick={() => prefs.mentionsOnly !== mentions && update({ mentionsOnly: mentions })}>
            {text(mentions ? "mentions" : "all")}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <p class="set-hint">{text("synced")}</p>
</section>

<style>
  .state {
    margin: 0;
    color: var(--colours-text-faint);
  }

  .state[data-state="granted"] {
    color: var(--colours-success);
  }

  .state[data-state="denied"] {
    color: var(--colours-danger);
  }

  .choice {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--colours-outline-hairline);
  }

  .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    border-radius: 6px;
    background-color: var(--colours-surface-raised);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    transform: translateX(calc(var(--index) * 100%));
    transition: transform var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .choice-option {
    position: relative;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    color: var(--colours-text-muted);
    white-space: nowrap;
  }

  .choice-option[aria-checked="true"] {
    color: var(--colours-text-strong);
  }

  @media (max-width: 767px) {
    .choice-option {
      min-height: var(--azure-touch);
    }
  }
</style>
