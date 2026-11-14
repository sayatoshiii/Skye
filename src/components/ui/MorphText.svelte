<script lang="ts">
  import { lift } from "../auth/motion";

  let {
    text,
    tag = "span",
    class: className = "",
    id,
  }: { text: string; tag?: string; class?: string; id?: string } = $props();

  const words = $derived(text.split(/\s+/).filter(Boolean));

  let widths: number[] = $state([]);
</script>

<svelte:element this={tag} class="morph {className}" {id}>
  <span class="sr-only">{text}</span>
  <span class="words" aria-hidden="true">
    {#each words as word, index (index)}
      <span class="slot" style:width={widths[index] ? `${widths[index]}px` : undefined}>
        <span class="measure" bind:offsetWidth={widths[index]}>{word}</span>
        {#key word}
          <span class="word" in:lift={{ direction: 1 }} out:lift={{ direction: -1 }}>{word}</span>
        {/key}
      </span>{index < words.length - 1 ? " " : ""}
    {/each}
  </span>
</svelte:element>

<style>
  .words {
    display: inline;
  }

  .slot {
    position: relative;
    display: inline-block;
    vertical-align: bottom;
    overflow: clip;
    overflow-clip-margin: 0.2em;
    padding-block: 0.06em;
    transition: width var(--azure-duration-glide) var(--azure-ease-fluid);
  }

  .measure {
    display: inline-block;
    visibility: hidden;
    white-space: nowrap;
  }

  .word {
    position: absolute;
    left: 0;
    top: 0.06em;
    white-space: nowrap;
  }
</style>
