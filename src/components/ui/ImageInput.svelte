<script lang="ts">
  import ImageCropper from "./ImageCropper.svelte";

  let { shape = "squircle", disabled = false, onpick }: { shape?: "circle" | "squircle" | "rect"; disabled?: boolean; onpick: (blob: Blob, file: File) => void } = $props();

  let picker: HTMLInputElement | undefined = $state();
  let cropping: File | null = $state.raw(null);
  let source: File | null = $state.raw(null);

  const select = (event: Event & { currentTarget: HTMLInputElement }) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file?.type.startsWith("image/")) file.type === "image/gif" ? choose(file, file) : (cropping = file);
  };

  const choose = (blob: Blob, file: File) => ((source = file), onpick(blob, file));
  const apply = (blob: Blob) => (cropping && choose(blob, cropping), (cropping = null));

  export const open = () => picker?.click();
  export const recrop = () => (source && source.type !== "image/gif" ? (cropping = source) : open());
  export const forget = () => (source = null);
</script>

<input class="sr-only" type="file" accept="image/*" bind:this={picker} onchange={select} {disabled} tabindex="-1" />

{#if cropping}
  <ImageCropper file={cropping} {shape} onapply={apply} oncancel={() => (cropping = null)} />
{/if}
