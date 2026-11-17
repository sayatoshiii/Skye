<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { audioPicker, shareAudio } from "../../scripts/stores/nativescreen";
  import type { MenuItem } from "./MessageMenu.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Icon from "../settings/Icon.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  let chosen = $state<string[]>([]);
  $effect(() => audioPicker.subscribe((picker) => picker && (chosen = picker.chosen)));

  const choices = $derived([{ id: "*", label: text("share_audio_all") }, ...($audioPicker?.apps ?? []).map((app) => ({ id: app, label: app }))]);
  const everything = $derived(chosen.includes("*"));

  const toggle = (id: string) =>
    (chosen = id === "*" ? (everything ? [] : ["*"]) : chosen.includes(id) ? chosen.filter((app) => app !== id) : [...chosen.filter((app) => app !== "*"), id]);

  const items = (id: string, label: string): MenuItem[] => [
    { id: `share-audio-${id}`, label: text(chosen.includes(id) ? "share_audio_drop" : "share_audio_pick").replace("{app}", label), icon: MENU_ICONS.read, selected: chosen.includes(id), run: () => toggle(id) },
    { id: `share-audio-only-${id}`, label: text("share_audio_only").replace("{app}", label), icon: MENU_ICONS.read, run: () => shareAudio([id]) },
  ];
</script>

{#if $audioPicker}
  <ConfirmDialog title={text("share_audio_title")} body={text("share_audio_body")} cancelLabel={text("share_audio_cancel")} confirmLabel={text(chosen.length ? "share_audio_confirm" : "share_audio_none")} tone="primary" onconfirm={() => shareAudio(chosen)} onclose={() => audioPicker.set(null)}>
    <div class="choices col gap-xs" role="group" aria-label={text("share_audio_title")}>
      {#each choices as choice (choice.id)}
        {@const on = chosen.includes(choice.id)}
        <button type="button" class="choice ghost press sm row-nw align-centre gap-sm" class:on class:dim={everything && choice.id !== "*"} role="checkbox" aria-checked={on} onclick={() => toggle(choice.id)} use:menu={() => items(choice.id, choice.label)}>
          <span class="truncate flex-max">{choice.label}</span>
          <span class="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
        </button>
      {/each}
      {#if !$audioPicker.apps.length}
        <p class="xs muted empty">{text("share_audio_empty")}</p>
      {/if}
    </div>
  </ConfirmDialog>
{/if}

<style>
  .choices {
    max-height: 280px;
    overflow-y: auto;
  }

  .choice {
    width: 100%;
    min-height: 40px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text);
    text-align: start;
    background-color: var(--fill);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .choice:hover {
    background-color: var(--colours-surface-hover);
  }

  .choice.on {
    background-color: color-mix(in oklab, var(--colours-accent) 18%, var(--fill));
  }

  .choice.dim {
    opacity: 0.5;
  }

  .tick {
    display: grid;
    color: var(--colours-accent);
    opacity: 0;
    scale: 0.6;
    transition:
      opacity 240ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .choice.on .tick {
    opacity: 1;
    scale: 1;
  }

  .empty {
    margin: 0;
    padding: var(--azure-spacing-xs) var(--azure-spacing-md);
  }
</style>
