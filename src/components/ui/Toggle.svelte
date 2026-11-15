<script lang="ts">
  let {
    checked = false,
    label,
    disabled = false,
    onchange,
  }: { checked?: boolean; label: string; disabled?: boolean; onchange?: (checked: boolean) => void } = $props();
</script>

<button
  type="button"
  class="toggle press"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange?.(!checked)}
>
  <span class="knob" aria-hidden="true"></span>
</button>

<style>
  .toggle {
    --width: 40px;
    --height: 24px;
    --inset: 3px;
    --knob: calc(var(--height) - var(--inset) * 2);

    position: relative;
    flex: none;
    width: var(--width);
    height: var(--height);
    padding: 0;
    border: none;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-outline-strong);
    cursor: pointer;
    transition:
      background-color var(--azure-duration-md) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-out);
  }

  .toggle[aria-checked="true"] {
    background-color: var(--colours-accent);
    box-shadow: 0 0 16px -6px var(--colours-accent-glow);
  }

  .toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .knob {
    position: absolute;
    top: var(--inset);
    left: var(--inset);
    width: var(--knob);
    height: var(--knob);
    border-radius: 50%;
    background-color: var(--colours-text-strong);
    box-shadow: 0 1px 3px hsla(0, 0%, 0%, 0.35);
    transition:
      transform var(--azure-duration-slow) var(--azure-ease-spring),
      width var(--azure-duration-fast) var(--azure-ease-out);
  }

  .toggle[aria-checked="true"] .knob {
    transform: translateX(calc(var(--width) - var(--knob) - var(--inset) * 2));
  }

  .toggle:not(:disabled):active .knob {
    width: calc(var(--knob) + 4px);
  }

  .toggle[aria-checked="true"]:not(:disabled):active .knob {
    transform: translateX(calc(var(--width) - var(--knob) - var(--inset) * 2 - 4px));
  }
</style>
