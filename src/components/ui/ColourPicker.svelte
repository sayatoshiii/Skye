<script lang="ts">
  type Props = { value: string; onchange: (value: string, done?: boolean) => void };
  let { value, onchange }: Props = $props();

  const toHsv = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: max ? d / max : 0, v: max };
  };

  const toHex = (h: number, s: number, v: number) => {
    const f = (n: number) => {
      const k = (n + h / 60) % 6;
      return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0");
    };
    return `#${f(5)}${f(3)}${f(1)}`;
  };

  let hsv = $state({ h: 0, s: 0, v: 0 });
  let field = $state("");
  const hex = $derived(toHex(hsv.h, hsv.s, hsv.v));

  $effect(() => {
    if (value.toLowerCase() === hex && field) return;
    hsv = toHsv(value);
    field = value;
  });

  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  const drag = (set: (x: number, y: number) => void) => (event: PointerEvent) => {
    const node = event.currentTarget as HTMLElement;
    const apply = (e: PointerEvent, done = false) => {
      const r = node.getBoundingClientRect();
      set(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
      field = hex;
      onchange(hex, done);
    };
    node.setPointerCapture(event.pointerId);
    apply(event);
    const move = (e: PointerEvent) => apply(e);
    const up = (e: PointerEvent) => (apply(e, true), node.removeEventListener("pointermove", move), node.removeEventListener("pointerup", up));
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
  };

  const commitField = () => {
    const clean = field.trim().replace(/^#?/, "#");
    const full = /^#[0-9a-f]{3}$/i.test(clean) ? `#${[...clean.slice(1)].map((c) => c + c).join("")}` : clean;
    if (!/^#[0-9a-f]{6}$/i.test(full)) return void (field = hex);
    hsv = toHsv(full.toLowerCase());
    field = hex;
    onchange(hex);
  };
</script>

<div class="picker col">
  <div class="area" role="slider" tabindex="-1" aria-label="Saturation and brightness" aria-valuenow={Math.round(hsv.s * 100)} style:--hue="hsl({hsv.h} 100% 50%)" onpointerdown={drag((x, y) => (hsv = { ...hsv, s: x, v: 1 - y }))}>
    <span class="thumb" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={hex}></span>
  </div>
  <div class="hue" role="slider" tabindex="-1" aria-label="Hue" aria-valuenow={Math.round(hsv.h)} onpointerdown={drag((x) => (hsv = { ...hsv, h: x * 359.9 }))}>
    <span class="thumb" style:left="{(hsv.h / 360) * 100}%" style:background="hsl({hsv.h} 100% 50%)"></span>
  </div>
  <div class="row-nw align-centre gap-sm">
    <span class="preview" style:background={hex}></span>
    <input class="hex" bind:value={field} maxlength="7" spellcheck="false" aria-label="Hex" onkeydown={(event) => event.key === "Enter" && commitField()} onblur={commitField} />
  </div>
</div>

<style>
  .picker {
    gap: var(--azure-spacing-md);
    width: 198px;
  }

  .area,
  .hue {
    position: relative;
    touch-action: none;
    cursor: crosshair;
  }

  .area {
    height: 130px;
    border-radius: var(--azure-radius-md);
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
  }

  .hue {
    height: 14px;
    border-radius: var(--azure-radius-pill);
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }

  .thumb {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    translate: -50% -50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
    pointer-events: none;
  }

  .hue .thumb {
    top: 50%;
  }

  .preview {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--azure-radius-sm);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
  }

  .hex {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-hover);
    color: var(--colours-text-strong);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-transform: uppercase;
    outline: none;
    transition: border-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .hex:focus {
    border-color: var(--colours-accent);
  }
</style>
