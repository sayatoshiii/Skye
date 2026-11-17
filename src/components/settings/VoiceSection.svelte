<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import type { SettingsSection } from "../../scripts/stores/settings";
  import { listDevices, switchDevice, voicePrefs, type VoicePrefs } from "../../scripts/stores/voice";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Icon from "./Icon.svelte";

  let { go }: { go?: (id: SettingsSection) => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "voice", ...path) as string;

  type Kind = "audioinput" | "audiooutput";

  let prefs = $state.raw<VoicePrefs>({ input: "default", output: "default", pushToTalk: false, pttKey: "KeyV", pttLabel: "V" });
  let inputs = $state.raw<MediaDeviceInfo[]>([]);
  let outputs = $state.raw<MediaDeviceInfo[]>([]);
  let labelled = $state(true);
  let recording = $state(false);
  let level = $state(0);
  let testing: (() => void) | null = $state(null);

  $effect(() => voicePrefs.subscribe((value) => (prefs = value)));

  const sinkSupported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  const refresh = async () => {
    inputs = await listDevices("audioinput");
    outputs = await listDevices("audiooutput");
    labelled = inputs.some((device) => device.label);
  };

  onMount(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => (navigator.mediaDevices?.removeEventListener?.("devicechange", refresh), testing?.());
  });

  const allow = () =>
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => (stream.getTracks().forEach((track) => track.stop()), refresh()))
      .catch(() => undefined);

  const nameOf = (device: MediaDeviceInfo, index: number) => (device.deviceId === "default" ? text("default") : device.label || text("unnamed").replace("{n}", String(index + 1)));

  const options = (list: MediaDeviceInfo[]) => [{ deviceId: "default", label: text("default") } as MediaDeviceInfo, ...list.filter((device) => device.deviceId !== "default")];

  const deviceItems = (kind: Kind, device: MediaDeviceInfo, index: number): MenuItem[] => [
    { id: "device-pick", label: text("pick"), icon: MENU_ICONS.read, selected: prefs[kind === "audioinput" ? "input" : "output"] === device.deviceId, run: () => switchDevice(kind, device.deviceId) },
    { id: "device-copy", label: text("copy_name"), icon: MENU_ICONS.copy, run: () => copied(nameOf(device, index)) },
  ];

  const test = async () => {
    if (testing) return testing();
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: prefs.input === "default" ? undefined : { exact: prefs.input } } })
      .catch(() => null);
    if (!stream) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const read = () => {
      analyser.getByteTimeDomainData(data);
      level = Math.min(1, (Math.max(...data) - 128) / 64);
      frame = requestAnimationFrame(read);
    };
    read();
    testing = () => (cancelAnimationFrame(frame), stream.getTracks().forEach((track) => track.stop()), context.close(), (level = 0), (testing = null));
  };

  const record = (event: KeyboardEvent) => {
    event.preventDefault();
    recording = false;
    voicePrefs.update((value) => ({ ...value, pttKey: event.code, pttLabel: event.key.length === 1 ? event.key.toUpperCase() : event.code }));
  };

  const keyItems = (): MenuItem[] => [
    { id: "ptt-change", label: text("change_key"), icon: MENU_ICONS.edit, run: () => (recording = true) },
    { id: "ptt-toggle", label: text("talk"), icon: MENU_ICONS.read, selected: prefs.pushToTalk, run: () => voicePrefs.update((value) => ({ ...value, pushToTalk: !value.pushToTalk })) },
  ];

  const testItems = (): MenuItem[] => [{ id: "mic-test", label: text(testing ? "testing" : "test"), icon: testing ? MENU_ICONS.end : MENU_ICONS.play, run: test }];
</script>

<svelte:window onkeydown={(event) => recording && record(event)} />

{#snippet picker(kind: Kind, list: MediaDeviceInfo[], current: string, label: string)}
  <div class="set-rows devices" role="radiogroup" aria-label={label}>
    {#each options(list) as device, index (device.deviceId)}
      <button type="button" class="set-row device ghost press" role="radio" aria-checked={current === device.deviceId} onclick={() => switchDevice(kind, device.deviceId)} use:menu={() => deviceItems(kind, device, index)}>
        <span class="set-title truncate">{nameOf(device, index)}</span>
        <span class="tick" aria-hidden="true"><Icon name="check" size={18} /></span>
      </button>
    {/each}
  </div>
{/snippet}

<section class="set-section" data-part="input">
  <h3 class="set-heading">{text("heading_input")}</h3>
  <div class="col gap-xs">
    <span class="set-title">{text("input")}</span>
    <p class="set-hint">{text("input_hint")}</p>
  </div>
  <div class="allow" class:open={!labelled}>
    <div class="set-row min-0">
      <p class="set-hint">{text("allow_hint")}</p>
      <button type="button" class="set-button primary ghost press" onclick={allow} use:menu={() => [{ id: "mic-allow", label: text("allow"), icon: MENU_ICONS.read, run: allow }]}>{text("allow")}</button>
    </div>
  </div>
  {@render picker("audioinput", inputs, prefs.input, text("input"))}
  <div class="set-row">
    <span class="meter flex-max" aria-hidden="true"><span class="meter-fill" style:--level={level}></span></span>
    <button type="button" class="set-button ghost press" onclick={test} use:menu={testItems}>{text(testing ? "testing" : "test")}</button>
  </div>
</section>

<section class="set-section" data-part="output">
  <h3 class="set-heading">{text("heading_output")}</h3>
  <div class="col gap-xs">
    <span class="set-title">{text("output")}</span>
    <p class="set-hint">{text(sinkSupported ? "output_hint" : "output_unsupported")}</p>
  </div>
  {#if sinkSupported}
    {@render picker("audiooutput", outputs, prefs.output, text("output"))}
  {/if}
</section>

<section class="set-section" data-part="talk">
  <h3 class="set-heading">{text("heading_talk")}</h3>
  <div class="set-rows">
    <div class="set-row" use:menu={keyItems}>
      <div class="col gap-xs min-0">
        <span class="set-title">{text("talk")}</span>
        <p class="set-hint">{text("talk_hint")}</p>
      </div>
      <Toggle checked={prefs.pushToTalk} label={text("talk")} onchange={(value) => voicePrefs.update((current) => ({ ...current, pushToTalk: value }))} />
    </div>
    <div class="ptt" class:open={prefs.pushToTalk}>
      <div class="set-row min-0" inert={!prefs.pushToTalk}>
        <span class="set-title">{text("key")}</span>
        <button type="button" class="set-button ghost press key" class:recording onclick={() => (recording = !recording)} use:menu={keyItems}>
          <Icon name="keyboard" size={16} />
          <span>{recording ? text("record") : prefs.pttLabel}</span>
        </button>
      </div>
    </div>
  </div>
</section>

<style>
  .devices {
    margin: 0;
  }

  .device {
    width: 100%;
    text-align: start;
    border-radius: 0;
  }

  .tick {
    display: grid;
    color: var(--colours-accent);
    opacity: 0;
    scale: 0.6;
    transition:
      opacity var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1),
      scale var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .device[aria-checked="true"] .tick {
    opacity: 1;
    scale: 1;
  }

  .allow,
  .ptt {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 360ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .allow > *,
  .ptt > * {
    overflow: hidden;
    min-height: 0;
  }

  .allow.open,
  .ptt.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .allow .set-row {
    flex-wrap: wrap;
  }

  .meter {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: var(--fill);
    overflow: hidden;
  }

  .meter-fill {
    position: absolute;
    inset: 0;
    background: var(--colours-accent);
    border-radius: inherit;
    transform-origin: left;
    transform: scaleX(var(--level));
    transition: transform 90ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .key {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 96px;
    justify-content: center;
    transition: background-color var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .key.recording {
    background: color-mix(in oklab, var(--colours-accent) 30%, var(--fill));
  }
</style>
