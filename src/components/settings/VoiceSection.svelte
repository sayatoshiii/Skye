<script lang="ts">
  import { native } from "../../scripts/misc/native";
  import { nativeVoice } from "../../scripts/stores/nativeroom";
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import type { SettingsSection } from "../../scripts/stores/settings";
  import { captureFor, inputLevel, listDevices, transmitting, switchDevice, voicePrefs, watchInput, type VoicePrefs } from "../../scripts/stores/voice";
  import type { MenuItem } from "../app/MessageMenu.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Icon from "./Icon.svelte";

  let { go }: { go?: (id: SettingsSection) => void } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "voice", ...path) as string;

  type Kind = "audioinput" | "audiooutput" | "videoinput";
  const PREF = { audioinput: "input", audiooutput: "output", videoinput: "camera" } as const;

  let prefs = $state.raw<VoicePrefs>({ input: "default", output: "default", camera: "default", pushToTalk: false, pttKey: "KeyV", pttLabel: "V" });
  let inputs = $state.raw<MediaDeviceInfo[]>([]);
  let outputs = $state.raw<MediaDeviceInfo[]>([]);
  let cameras = $state.raw<MediaDeviceInfo[]>([]);
  let labelled = $state(true);
  let camerasLabelled = $state(true);
  let recording = $state(false);
  let testing: (() => void) | null = $state(null);

  $effect(() => voicePrefs.subscribe((value) => (prefs = value)));

  const sinkSupported = nativeVoice || (typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype);
  const SHOWN_DEVICES = 4;
  let more = $state<Record<string, boolean>>({});

  const refresh = async () => {
    inputs = await listDevices("audioinput");
    outputs = await listDevices("audiooutput");
    cameras = await listDevices("videoinput");
    labelled = inputs.some((device) => device.label);
    camerasLabelled = !cameras.length || cameras.some((device) => device.label);
  };

  const setPref = (next: Partial<VoicePrefs>) => voicePrefs.update((current) => ({ ...current, ...next }));

  $effect(() => watchInput());

  onMount(() => {
    native ? Promise.all([allow(), allowCamera()]) : refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => (navigator.mediaDevices?.removeEventListener?.("devicechange", refresh), testing?.());
  });

  const allow = () =>
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => (stream.getTracks().forEach((track) => track.stop()), refresh()))
      .catch(() => undefined);

  const allowCamera = () =>
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => (stream.getTracks().forEach((track) => track.stop()), refresh()))
      .catch(() => undefined);

  const nameOf = (device: MediaDeviceInfo, index: number) => (device.deviceId === "default" ? text("default") : device.label || text("unnamed").replace("{n}", String(index + 1)));

  const options = (list: MediaDeviceInfo[]) => [{ deviceId: "default", label: text("default") } as MediaDeviceInfo, ...list.filter((device) => device.deviceId !== "default")];

  const deviceItems = (kind: Kind, device: MediaDeviceInfo, index: number): MenuItem[] => [
    { id: "device-pick", label: text("pick"), icon: MENU_ICONS.read, selected: prefs[PREF[kind]] === device.deviceId, run: () => switchDevice(kind, device.deviceId) },
    { id: "device-copy", label: text("copy_name"), icon: MENU_ICONS.copy, run: () => copied(nameOf(device, index)) },
  ];

  const WAVE_POINTS = 40;
  const WAVE_GAIN = 2.2;
  const VOICE_HZ = 4000;
  const SETTLE_MS = 400;
  const BAR_GAP = 0.6;
  let canvas = $state<HTMLCanvasElement>();
  let wave = new Float32Array(WAVE_POINTS);

  const draw = (scale = 1) => {
    const pen = canvas?.getContext("2d");
    const ratio = devicePixelRatio || 1;
    const width = (canvas?.clientWidth ?? 0) * ratio;
    const height = (canvas?.clientHeight ?? 0) * ratio;
    if (!canvas || !pen || !width) return;
    canvas.width = width;
    canvas.height = height;
    const slot = width / WAVE_POINTS;
    const bar = Math.max(ratio * 2, slot * (1 - BAR_GAP));
    pen.fillStyle = getComputedStyle(canvas).color;
    wave.forEach((value, index) => {
      const tall = Math.max(bar, Math.min(1, value * WAVE_GAIN * scale) * height);
      pen.beginPath();
      pen.roundRect(index * slot + (slot - bar) / 2, (height - tall) / 2, bar, tall, bar / 2);
      pen.fill();
    });
  };

  const settle = (start = performance.now()) => {
    const progress = Math.min(1, (performance.now() - start) / SETTLE_MS);
    draw(1 - (1 - (1 - progress) ** 3));
    progress < 1 ? requestAnimationFrame(() => settle(start)) : (wave = new Float32Array(WAVE_POINTS));
  };

  $effect(() => {
    const observer = canvas && new ResizeObserver(() => draw(testing ? 1 : 0));
    canvas && observer?.observe(canvas);
    return () => observer?.disconnect();
  });

  const test = async () => {
    if (testing) return testing();
    const stream = await captureFor(prefs).then((audio) => navigator.mediaDevices.getUserMedia({ audio })).catch(() => null);
    if (!stream) return;
    const context = new AudioContext();
    const analyser = Object.assign(context.createAnalyser(), { fftSize: 1024, smoothingTimeConstant: 0.6, minDecibels: -90, maxDecibels: -35 });
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const half = WAVE_POINTS / 2;
    const bins = Math.max(half, Math.round((VOICE_HZ / (context.sampleRate / 2)) * data.length));
    const band = (index: number) => data.subarray(Math.floor((index / half) ** 1.6 * bins), Math.max(Math.floor((index / half) ** 1.6 * bins) + 1, Math.floor(((index + 1) / half) ** 1.6 * bins)));
    let frame = 0;
    const read = () => {
      analyser.getByteFrequencyData(data);
      wave = wave.map((previous, index) => previous * 0.45 + (Math.max(...band(Math.abs(index - half + 0.5) - 0.5 | 0)) / 255) ** 1.3 * 0.55);
      draw();
      frame = requestAnimationFrame(read);
    };
    read();
    testing = () => (cancelAnimationFrame(frame), stream.getTracks().forEach((track) => track.stop()), context.close(), settle(), (testing = null));
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
    {#each options(list).filter((device, index) => more[kind] || index < SHOWN_DEVICES || device.deviceId === current) as device, index (device.deviceId)}
      <button type="button" class="set-row device ghost press" role="radio" aria-checked={current === device.deviceId} onclick={() => switchDevice(kind, device.deviceId)} use:menu={() => deviceItems(kind, device, index)}>
        <span class="set-title truncate">{nameOf(device, index)}</span>
        <span class="tick" aria-hidden="true"><Icon name="check" size={18} /></span>
      </button>
    {/each}
    {#if options(list).length > SHOWN_DEVICES + 1}
      <button type="button" class="set-row device more ghost press" onclick={() => (more = { ...more, [kind]: !more[kind] })} use:menu={() => [{ id: "devices-more", label: text(more[kind] ? "fewer" : "more"), icon: more[kind] ? MENU_ICONS.collapse : MENU_ICONS.expand, run: () => (more = { ...more, [kind]: !more[kind] }) }]}>
        <span class="set-title muted">{text(more[kind] ? "fewer" : "more").replace("{count}", String(options(list).length - SHOWN_DEVICES))}</span>
        <span class="dots" aria-hidden="true">•••</span>
      </button>
    {/if}
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
    <canvas class="wave flex-max" class:live={!!testing} bind:this={canvas} aria-hidden="true"></canvas>
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

<section class="set-section" data-part="camera">
  <h3 class="set-heading">{text("heading_camera")}</h3>
  <div class="col gap-xs">
    <span class="set-title">{text("camera")}</span>
    <p class="set-hint">{text("camera_hint")}</p>
  </div>
  <div class="allow" class:open={!camerasLabelled}>
    <div class="set-row min-0">
      <p class="set-hint">{text("allow_camera_hint")}</p>
      <button type="button" class="set-button primary ghost press" onclick={allowCamera} use:menu={() => [{ id: "camera-allow", label: text("allow_camera"), icon: MENU_ICONS.read, run: allowCamera }]}>{text("allow_camera")}</button>
    </div>
  </div>
  {@render picker("videoinput", cameras, prefs.camera, text("camera"))}
</section>

<section class="set-section" data-part="processing">
  <h3 class="set-heading">{text("heading_processing")}</h3>
  <div class="set-rows">
    <div class="set-row" use:menu={() => [{ id: "noise-toggle", label: text("noise"), icon: MENU_ICONS.read, selected: prefs.noiseSuppression, run: () => setPref({ noiseSuppression: !prefs.noiseSuppression }) }]}>
      <div class="col gap-xs min-0">
        <span class="set-title">{text("noise")}</span>
        <p class="set-hint">{text("noise_hint")}</p>
      </div>
      <Toggle checked={prefs.noiseSuppression} label={text("noise")} onchange={(value) => setPref({ noiseSuppression: value })} />
    </div>
    <div class="set-row" use:menu={() => [{ id: "echo-toggle", label: text("echo"), icon: MENU_ICONS.read, selected: prefs.echoCancellation, run: () => setPref({ echoCancellation: !prefs.echoCancellation }) }]}>
      <div class="col gap-xs min-0">
        <span class="set-title">{text("echo")}</span>
        <p class="set-hint">{text("echo_hint")}</p>
      </div>
      <Toggle checked={prefs.echoCancellation} label={text("echo")} onchange={(value) => setPref({ echoCancellation: value })} />
    </div>
    <div class="set-row" use:menu={() => [{ id: "sensitivity-toggle", label: text("auto_sensitivity"), icon: MENU_ICONS.read, selected: prefs.autoSensitivity, run: () => setPref({ autoSensitivity: !prefs.autoSensitivity }) }]}>
      <div class="col gap-xs min-0">
        <span class="set-title">{text("auto_sensitivity")}</span>
        <p class="set-hint">{text("auto_sensitivity_hint")}</p>
      </div>
      <Toggle checked={prefs.autoSensitivity} label={text("auto_sensitivity")} onchange={(value) => setPref({ autoSensitivity: value })} />
    </div>
    <div class="ptt" class:open={prefs.autoSensitivity}>
      <div class="col gap-sm min-0 sensitivity" inert={!prefs.autoSensitivity}>
        <span class="auto-bar" class:live={$transmitting} aria-hidden="true"></span>
        <p class="set-hint">{text("auto_live")}</p>
      </div>
    </div>
    <div class="ptt" class:open={!prefs.autoSensitivity}>
      <div class="col gap-sm min-0 sensitivity" inert={prefs.autoSensitivity}>
        <div class="row-nw align-centre gap-md">
          <span class="set-title flex-max">{text("sensitivity")}</span>
          <span class="set-hint amount">{text("sensitivity_value").replace("{db}", String(prefs.sensitivity))}</span>
        </div>
        <p class="set-hint">{text("sensitivity_hint")}</p>
        <div class="gate" style:--level={$inputLevel} style:--mark="{prefs.sensitivity + 100}%" class:hot={$inputLevel * 100 - 100 > prefs.sensitivity}>
          <span class="gate-fill" aria-hidden="true"></span>
          <input type="range" min="-100" max="0" step="1" value={prefs.sensitivity} aria-label={text("sensitivity")} oninput={(event) => setPref({ sensitivity: Number(event.currentTarget.value) })} />
        </div>
      </div>
    </div>
  </div>
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

  .more .dots {
    color: var(--colours-text-faint);
    letter-spacing: 2px;
    font-size: 10px;
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

  .wave {
    height: 32px;
    min-width: 0;
    color: var(--colours-text-faint);
    transition: color 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .wave.live {
    color: var(--colours-accent);
  }

  .sensitivity {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
  }

  .amount {
    font-variant-numeric: tabular-nums;
  }

  .auto-bar {
    height: 6px;
    margin: 5px 0;
    border-radius: 999px;
    background: color-mix(in oklab, var(--colours-success) 22%, var(--fill));
    transition:
      background-color 160ms cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow 160ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .auto-bar.live {
    background: var(--colours-success);
    box-shadow: 0 0 12px color-mix(in oklab, var(--colours-success) 45%, transparent);
  }

  .gate {
    display: grid;
    align-items: center;
    height: 16px;
  }

  .gate::before,
  .gate-fill {
    content: "";
    grid-area: 1 / 1;
    height: 6px;
    border-radius: 999px;
  }

  .gate::before {
    background: var(--fill);
  }

  .gate-fill {
    background: var(--colours-accent);
    transform-origin: left;
    transform: scaleX(var(--level));
    opacity: 0.45;
    transition:
      transform 90ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .gate.hot .gate-fill {
    opacity: 1;
  }

  .gate input {
    position: relative;
    z-index: 1;
    grid-area: 1 / 1;
    appearance: none;
    width: 100%;
    height: 16px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }

  .gate input::-webkit-slider-thumb {
    appearance: none;
    width: 6px;
    height: 16px;
    border-radius: 3px;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .gate input::-moz-range-thumb {
    width: 6px;
    height: 16px;
    border: 0;
    border-radius: 3px;
    background: white;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }

  .gate input:active::-webkit-slider-thumb {
    scale: 1.15;
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
