import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writable } from "svelte/store";
import { native } from "../misc/native";

const none = () => undefined;

export const LOCAL_SCREEN = "local:screen";
const windowsBridge = native && typeof RTCPeerConnection !== "undefined" && typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
export const audioPickable = (native && typeof RTCPeerConnection === "undefined") || windowsBridge;

type Publisher = { publishTrack: (track: MediaStreamTrack, options: { source: string; name: string }) => Promise<unknown>; unpublishTrack: (track: MediaStreamTrack) => Promise<unknown> };
let publisher: () => Publisher | undefined = none;
export const bridgePublisher = (find: () => Publisher | undefined) => void (publisher = find);

const WORKLET = `registerProcessor("skye-feed", class extends AudioWorkletProcessor {
  constructor() { super(); this.queue = []; this.port.onmessage = (event) => this.queue.push(event.data); this.head = 0; }
  process(_, outputs) {
    const [left, right] = outputs[0];
    for (let index = 0; index < left.length; index++) {
      while (this.queue.length && this.head >= this.queue[0].length) { this.queue.shift(); this.head = 0; }
      const chunk = this.queue[0];
      left[index] = chunk ? chunk[this.head] : 0;
      right[index] = chunk ? chunk[this.head + 1] : 0;
      this.head += chunk ? 2 : 0;
    }
    this.queue.length > 24 && this.queue.splice(0, this.queue.length - 6);
    return true;
  }
});`;

let bridge: { context: AudioContext; track: MediaStreamTrack } | null = null;

const releaseBridge = async () => {
  const current = bridge;
  bridge = null;
  await invoke("screen_audio_release").catch(none);
  current && (await publisher()?.unpublishTrack(current.track).catch(none), current.track.stop(), await current.context.close().catch(none));
};

const bridgeAudio = async (apps: string[]) => {
  await releaseBridge();
  if (!apps.length) return;
  const context = new AudioContext({ sampleRate: 48000 });
  const module = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  await context.audioWorklet.addModule(module).finally(() => URL.revokeObjectURL(module));
  const feed = new AudioWorkletNode(context, "skye-feed", { numberOfInputs: 0, outputChannelCount: [2] });
  const sink = context.createMediaStreamDestination();
  feed.connect(sink);
  const track = sink.stream.getAudioTracks()[0];
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (data) => feed.port.postMessage(new Float32Array(data), [data]);
  bridge = { context, track };
  await publisher()?.publishTrack(track, { source: "screen_share_audio", name: "screen-audio" });
  await invoke("screen_audio_capture", { apps, channel });
};

export const screenShared = (track?: MediaStreamTrack) =>
  windowsBridge && (track ? (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface === "window" && pickAudio([]) : releaseBridge());

type Remote = { key: string; identity: string; source: "camera" | "screen"; live: boolean };


export class FrameTrack {
  readonly kind = "video";
  readonly mediaStreamTrack = { readyState: "live" as MediaStreamTrackState, addEventListener: none, removeEventListener: none, stop: none } as unknown as MediaStreamTrack;
  private views = new Map<HTMLMediaElement, HTMLCanvasElement>();
  private frame: ImageBitmap | null = null;
  private busy = false;

  constructor(readonly key: string) {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = this.paint;
    invoke("screen_watch", { key, channel }).catch(none);
  }

  private paint = (data: ArrayBuffer) =>
    !this.busy &&
    ((this.busy = true),
    createImageBitmap(new Blob([data], { type: "image/jpeg" }))
      .then((image) => (this.frame?.close(), (this.frame = image), this.views.forEach(this.draw)))
      .catch(none)
      .finally(() => (this.busy = false)));

  private draw = (canvas: HTMLCanvasElement) => {
    const image = this.frame;
    image && (canvas.width !== image.width || canvas.height !== image.height) && Object.assign(canvas, { width: image.width, height: image.height });
    image && canvas.getContext("2d")?.drawImage(image, 0, 0);
  };

  attach = (element: HTMLMediaElement) => {
    const canvas = this.views.get(element) ?? Object.assign(document.createElement("canvas"), { className: element.className });
    canvas.setAttribute("aria-hidden", "true");
    element.style.display = "none";
    element.after(canvas);
    this.views.set(element, canvas);
    this.draw(canvas);
    return element;
  };

  detach = (element?: HTMLMediaElement) => {
    const targets = element ? [element] : [...this.views.keys()];
    targets.forEach((target) => (this.views.get(target)?.remove(), this.views.delete(target), (target.style.display = "")));
    return targets;
  };

  stop = () => (invoke("screen_unwatch", { key: this.key }).catch(none), this.detach(), this.frame?.close(), (this.frame = null), Object.assign(this.mediaStreamTrack, { readyState: "ended" }));
}

export type FramePublication = { trackSid: string; kind: "video"; source: "screen_share" | "camera"; track: FrameTrack; isMuted: boolean };

const publication = (key: string, source: "screen" | "camera"): FramePublication => ({ trackSid: key, kind: "video", source: source === "screen" ? "screen_share" : "camera", track: new FrameTrack(key), isMuted: false });

export const watchRemotes = (link: string, find: (identity: string) => { trackPublications: Map<string, unknown> } | undefined, changed: () => void): Promise<UnlistenFn> =>
  listen<Remote>(`screen:${link}`, ({ payload }) => {
    const owner = find(payload.identity);
    const previous = owner?.trackPublications.get(payload.key) as FramePublication | undefined;
    previous?.track.stop();
    owner?.trackPublications.delete(payload.key);
    payload.live && owner?.trackPublications.set(payload.key, publication(payload.key, payload.source));
    changed();
  });

export type AudioPicker = { apps: string[]; chosen: string[] };
export const audioPicker = writable<AudioPicker | null>(null);

export const pickAudio = async (chosen?: string[]) => {
  const current = chosen ?? (await invoke<{ apps: string[] } | null>("screen_sharing").catch(() => null))?.apps ?? [];
  const apps = await invoke<string[]>("screen_apps").catch(() => [] as string[]);
  audioPicker.set({ apps: [...new Set([...apps, ...current.filter((app) => app !== "*")])], chosen: current });
};

export const startScreen = async () => {
  const started = await invoke<{ window: boolean; apps: string[] }>("screen_start");
  started.window && pickAudio(started.apps);
  return publication(LOCAL_SCREEN, "screen");
};

export const stopScreen = () => (audioPicker.set(null), invoke("screen_stop").catch(none));

export const shareAudio = (apps: string[]) => (audioPicker.set(null), windowsBridge ? bridgeAudio(apps).catch(none) : invoke("screen_audio", { apps }).catch(none));
