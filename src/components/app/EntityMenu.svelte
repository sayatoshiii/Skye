<script lang="ts">
  import { entityMenu, entityText } from "../../scripts/misc/entitymenu.svelte";
  import MessageMenu from "./MessageMenu.svelte";
</script>

{#if entityMenu.request}
  {@const request = entityMenu.request}
  {#key request}
    <MessageMenu items={request.items} x={request.x} y={request.y} label={entityText("actions")} onclose={() => (entityMenu.request = null)} />
  {/key}
{/if}
