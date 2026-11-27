<script lang="ts">
  import type { ClassValue } from "svelte/elements";

  let { d, size = 16, class: className }: { d: string; size?: number; class?: ClassValue } = $props();
</script>

<svg class={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" {d} /></svg>
