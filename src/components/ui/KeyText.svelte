<script lang="ts">
  let { text = "" }: { text?: string } = $props();

  const parts = $derived(text.split(/\[\[(.+?)\]\]/));
</script>

{#each parts as part, index (index)}{#if index % 2}<kbd class="key">{part}</kbd>{:else}{part}{/if}{/each}
