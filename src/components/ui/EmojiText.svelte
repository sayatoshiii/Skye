<script lang="ts">
  import { renderEmoji } from "../../scripts/misc/emoji";
  import { swap } from "../../scripts/misc/swap";

  let { text = "" }: { text?: string } = $props();

  const html = $derived(renderEmoji(text));
</script>

<span use:swap={text}>{@html html}</span>
