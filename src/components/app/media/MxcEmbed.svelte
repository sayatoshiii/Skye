<script lang="ts">
  import { probeMxc, type MxcProbe } from "../../../scripts/matrix/utilities/media";
  import { nearViewport } from "../../../scripts/misc/lazy";
  import MessageMedia from "./MessageMedia.svelte";

  let { url, sender, ts }: { url: string; sender?: string; ts?: number } = $props();

  const MSGTYPES: Record<string, string> = { image: "m.image", video: "m.video", audio: "m.audio" };

  let probe: MxcProbe | null = $state.raw(null);

  const content = $derived(probe && { msgtype: MSGTYPES[probe.mimetype.split("/")[0]] ?? "m.file", url, body: probe.name, filename: probe.name, info: { mimetype: probe.mimetype, size: probe.size || undefined } });

  const onvisible = () => probeMxc(url).then((value) => (probe = value));
</script>

<div class="mxc" class:open={!!content} use:nearViewport={onvisible}>
  <div class="inner">
    {#if content}
      <MessageMedia {content} {sender} {ts} />
    {/if}
  </div>
</div>

<style>
  .mxc {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 360ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .mxc.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .inner {
    min-height: 0;
    overflow: hidden;
  }
</style>
