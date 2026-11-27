<script lang="ts">
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import Button from "../ui/Button.svelte";

  let {
    label,
    value,
    mono = false,
    masked,
    reveal,
    action,
    icon,
    onaction,
    items,
  }: {
    label: string;
    value?: string;
    mono?: boolean;
    masked?: string;
    reveal?: { show: string; hide: string };
    action?: string;
    icon?: string;
    onaction?: () => void;
    items?: () => MenuItem[];
  } = $props();

  let revealed = $state(false);
  const hidden = $derived(!!masked && !revealed);
</script>

<div class="set-row" use:menu={items}>
  <span class="set-title">{label}</span>
  {#if value !== undefined}
    <span class="set-value">
      <span class="truncate min-0" class:set-mono={mono}>{hidden ? masked : value}</span>
      {#if masked && reveal}
        <button type="button" class="set-link ghost" onclick={() => (revealed = !revealed)}>{hidden ? reveal.show : reveal.hide}</button>
      {/if}
    </span>
  {/if}
  {#if action}
    <Button variant="outline" {icon} class="set-action" onclick={onaction}>{action}</Button>
  {/if}
</div>
