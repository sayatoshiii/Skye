<script lang="ts">
  import { getMediaLink, isMxc } from "../../scripts/matrix/utilities/media";
  import EmojiText from "./EmojiText.svelte";

  let { key, label }: { key: string; label?: string } = $props();

  let src: string | undefined = $state();

  $effect(() => {
    src = undefined;
    if (!isMxc(key)) return;
    let live = true;
    getMediaLink(key, 64).then((link) => live && (src = link));
    return () => (live = false);
  });
</script>

{#if isMxc(key)}
  {#if src}<img class="emoji custom-emoji" {src} alt={label ?? ""} draggable="false" />{:else}<span class="emoji custom-emoji" aria-label={label}></span>{/if}
{:else}
  <EmojiText text={key} />
{/if}

<style>
  .custom-emoji {
    display: inline-block;
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
</style>
