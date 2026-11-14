<script lang="ts">
  import { renderEmoji } from "../../scripts/misc/emoji";

  let { text = "" }: { text?: string } = $props();

  const html = $derived(renderEmoji(text));
</script>

{@html html}
