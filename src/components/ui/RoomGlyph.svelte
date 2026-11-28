<script lang="ts">
  import { SETTINGS_ICONS } from "../settings/icons";
  import Avatar from "./Avatar.svelte";

  let { name = "", avatar, voice = false, live = false, size = 20 }: { name?: string; avatar?: string; voice?: boolean; live?: boolean; size?: number } = $props();
</script>

{#snippet kind(size: number)}
  {#if voice}
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={SETTINGS_ICONS.speaker} /></svg>
  {:else}
    <span class="hash" style:font-size="{size}px" aria-hidden="true">#</span>
  {/if}
{/snippet}

<span class="glyph faint" class:live class:pictured={!!avatar} style:--size="{size}px">
  {#if avatar}
    <span class="face"><Avatar {name} url={avatar} size="{size}px" radius="0" /></span>
    <span class="badge">{@render kind(9)}</span>
  {:else}
    {@render kind(size - 2)}
  {/if}
</span>

<style>
  .glyph {
    position: relative;
    flex: none;
    width: var(--size);
    display: inline-grid;
    place-items: center;
    transition: color 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .live {
    color: var(--colours-success);
  }

  .face {
    display: flex;
    overflow: hidden;
    border-radius: 50%;
    transition: border-radius 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  :global(:is(:hover, :focus-visible, [aria-current="page"])) > .glyph .face {
    border-radius: 30%;
  }

  .hash {
    line-height: 1;
  }

  .badge {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 13px;
    height: 13px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-weight: 700;
    background-color: rgb(0 0 0 / 0.72);
    backdrop-filter: blur(4px);
    color: var(--colours-text-muted);
  }

  .live .badge {
    color: var(--colours-success);
  }
</style>
