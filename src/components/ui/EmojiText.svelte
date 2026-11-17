<script lang="ts">
  import { renderEmoji } from "../../scripts/misc/emoji";
  import { swap } from "../../scripts/misc/swap";

  let { text = "", fade = true }: { text?: string; fade?: boolean } = $props();

  const html = $derived(renderEmoji(text));
</script>

<span use:swap={fade ? text : ""}>{@html html}</span>
