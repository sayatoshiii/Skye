<script lang="ts">
  import { SETTINGS_ICONS, type SettingsIcon } from "./icons";

  let { name, size = 18 }: { name: SettingsIcon; size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d={SETTINGS_ICONS[name]} /></svg>
