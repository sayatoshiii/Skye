<script lang="ts">
  import { portal } from "../../scripts/misc/portal";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import ColourPicker from "./ColourPicker.svelte";

  type Props = { anchor: HTMLElement; value: string; onchange: (value: string, done?: boolean) => void; onclose: () => void };
  let { anchor, value, onchange, onclose }: Props = $props();

  let node: HTMLDivElement | undefined = $state();
  let x = $state(0);
  let y = $state(0);
  let below = $state(true);

  const exit = dismissible(() => onclose());

  const place = () => {
    if (!node) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = node.getBoundingClientRect();
    below = a.bottom + 10 + height < innerHeight - 8;
    x = Math.min(Math.max(8, a.left + a.width / 2 - width / 2), innerWidth - width - 8);
    y = below ? a.bottom + 10 : a.top - 10 - height;
  };

  $effect(() => {
    place();
    const outside = (event: PointerEvent) => !node?.contains(event.target as Node) && !anchor.contains(event.target as Node) && exit.close();
    const key = (event: KeyboardEvent) => event.key === "Escape" && (event.stopPropagation(), exit.close());
    addEventListener("pointerdown", outside, true);
    addEventListener("keydown", key, true);
    addEventListener("resize", place);
    return () => (removeEventListener("pointerdown", outside, true), removeEventListener("keydown", key, true), removeEventListener("resize", place));
  });
</script>

<div bind:this={node} class="popover" class:below class:closing={exit.closing} style:left="{x}px" style:top="{y}px" role="dialog" use:portal onanimationend={exit.onanimationend}>
  <ColourPicker {value} {onchange} />
</div>

<style>
  .popover {
    position: fixed;
    z-index: var(--azure-z-popover);
    padding: var(--azure-spacing-lg);
    border-radius: var(--azure-radius-lg);
    background: hsla(242, 10%, 10%, 0.86);
    backdrop-filter: blur(22px) saturate(1.4);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 14px 40px rgb(0 0 0 / 0.45);
    transform-origin: top center;
    animation: colour-pop var(--azure-duration-md) var(--azure-ease-spring);
  }

  .popover:not(.below) {
    transform-origin: bottom center;
  }

  .popover.closing {
    animation: exit-pop var(--azure-duration-fast) var(--azure-ease-out) forwards;
  }

  @keyframes colour-pop {
    from {
      opacity: 0;
      scale: 0.94;
    }
  }
</style>
