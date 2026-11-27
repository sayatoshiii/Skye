<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { SETTINGS_ICONS } from "../settings/icons";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import ImageInput from "./ImageInput.svelte";

  let {
    url,
    name = "",
    size = 80,
    disabled = false,
    onpick,
    onremove,
  }: { url?: string; name?: string; size?: number; disabled?: boolean; onpick: (blob: Blob, file: File) => void; onremove?: () => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "create", ...path) as string;

  let input: { open: () => void; recrop: () => void; forget: () => void } | undefined = $state();
  let preview: string | null = $state(null);

  $effect(() => () => void (preview && URL.revokeObjectURL(preview)));

  const choose = (blob: Blob, file: File) => {
    preview && URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(blob);
    onpick(blob, file);
  };

  const remove = () => (preview && URL.revokeObjectURL(preview), (preview = null), input?.forget(), onremove?.());
</script>

<div class="picker" style:--size="{size}px">
  <ImageInput bind:this={input} {disabled} onpick={choose} />
  <button type="button" class="face ghost col centre press" class:filled={!!(preview || url)} aria-label={preview ? text("crop", "title") : text("upload")} onclick={() => input?.recrop()} {disabled}>
    {#if preview}
      <img src={preview} alt="" />
    {:else if url}
      <Avatar {name} {url} size="{size}px" radius="50%" />
    {:else}
      <Icon d={SETTINGS_ICONS.image} size={24} />
      <span class="xs bold">{text("upload")}</span>
    {/if}
  </button>
  <button type="button" class="badge ghost press row centre" aria-label={text("crop", "change")} onclick={() => input?.open()} {disabled}><Icon d={MENU_ICONS.add} size={14} /></button>
  {#if onremove && (preview || url)}
    <button type="button" class="badge remove ghost press row centre" aria-label={text("remove")} onclick={remove} {disabled}><Icon d={MENU_ICONS.close} size={14} /></button>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
  }

  .face {
    width: 100%;
    height: 100%;
    gap: 2px;
    overflow: hidden;
    border-radius: 50%;
    border: 2px dashed var(--colours-outline-hairline);
    color: var(--colours-text-faint);
    background-color: var(--colours-background);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .face.filled {
    border: none;
  }

  .face:hover:not(:disabled) {
    color: var(--colours-text-muted);
    border-color: var(--colours-outline-strong);
  }

  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .badge.remove {
    top: auto;
    bottom: -2px;
    color: white;
    background-color: var(--colours-danger);
  }
</style>
