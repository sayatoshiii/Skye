<script lang="ts">
  import { untrack } from "svelte";

  let {
    label,
    icon,
    separated = false,
    slider,
  }: {
    label: string;
    icon: string;
    separated?: boolean;
    slider: { value: number; min: number; max: number; step: number; format: (value: number) => string; input: (value: number) => void };
  } = $props();

  let value = $state(untrack(() => slider.value));
  const fill = $derived(((value - slider.min) / (slider.max - slider.min)) * 100);
  const change = (event: Event) => ((value = Number((event.currentTarget as HTMLInputElement).value)), slider.input(value));
</script>

<div class="slider col gap-xs sm" class:separated role="group" aria-label={label}>
  <span class="head row-nw align-centre gap-md">
    <span class="flex-max truncate">{label}</span>
    <span class="amount xs">{slider.format(value)}</span>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d={icon} /></svg>
  </span>
  <input type="range" min={slider.min} max={slider.max} step={slider.step} {value} aria-label={label} style:--fill="{fill}%" oninput={change} />
</div>

<style>
  .slider {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    color: var(--colours-text);
  }

  .slider.separated {
    margin-top: calc(var(--azure-spacing-xs) * 2 + 1px);
    position: relative;
  }

  .slider.separated::before {
    content: "";
    position: absolute;
    top: calc(var(--azure-spacing-xs) * -1 - 1px);
    left: var(--azure-spacing-sm);
    right: var(--azure-spacing-sm);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .head svg {
    color: var(--colours-text-faint);
  }

  .amount {
    color: var(--colours-text-muted);
    font-variant-numeric: tabular-nums;
  }

  input {
    appearance: none;
    width: 100%;
    height: 6px;
    margin: 6px 0;
    border-radius: 999px;
    background: linear-gradient(to right, var(--colours-accent) var(--fill), var(--colours-surface-hover) var(--fill));
    outline: none;
    cursor: pointer;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  input::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  input:active::-webkit-slider-thumb {
    scale: 1.15;
  }

  input:active::-moz-range-thumb {
    scale: 1.15;
  }
</style>
