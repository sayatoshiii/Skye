<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";

  type Props = HTMLButtonAttributes & {
    variant?: "secondary" | "primary" | "danger" | "quiet" | "quiet-danger" | "link" | "outline" | "text";
    outlined?: boolean;
    large?: boolean;
    icon?: string;
    children?: Snippet;
  };

  let { variant = "secondary", large = false, outlined = false, icon, children, class: className = "", type = "button", ...rest }: Props = $props();
</script>

<button {type} class={["button", variant, className, { large, outlined, icon: !children, collapsible: !!icon && !!children }]} {...rest}>
  {#if icon}<Icon d={icon} size={children ? 16 : large ? 22 : 18} />{/if}
  {#if children}<span class="button-label">{@render children()}</span>{/if}
</button>
