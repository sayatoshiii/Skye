<script lang="ts">
  import type { Snippet } from "svelte";

  let { id, title, children }: { id: string; title: string; children: Snippet } = $props();
</script>

<section class="set-section" data-part={id}>
  <h3 class="set-heading">{title}</h3>
  {@render children()}
</section>
