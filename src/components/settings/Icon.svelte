<script lang="ts">
  import Icon from "../ui/Icon.svelte";
  import { SETTINGS_ICONS, type SettingsIcon } from "./icons";

  let { name, size = 18 }: { name: SettingsIcon; size?: number } = $props();
</script>

<Icon d={SETTINGS_ICONS[name]} {size} />
