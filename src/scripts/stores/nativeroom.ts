import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { native } from "../misc/native";
import { startScreen, stopScreen, watchRemotes, type FramePublication } from "./nativescreen";

export const nativeVoice = native && typeof RTCPeerConnection === "undefined";

type Member = { identity: string; mic: boolean };
type Update = { kind: "members"; members: Member[] } | { kind: "speakers"; identities: string[] } | { kind: "quality"; quality: string } | { kind: "status"; status: "reconnecting" | "reconnected" | "disconnected" };
type Handler = (...args: any[]) => void;

const none = () => undefined;

class NativeParticipant {
  isMicrophoneEnabled = false;
  isCameraEnabled = false;
  isScreenShareEnabled = false;
  trackPublications = new Map();
  private volumes = new Map<string, number>();
  constructor(readonly room: NativeRoom, readonly identity: string, readonly isLocal = false) {}
  getTrackPublication = none;
  setVolume = (volume: number, source?: string) => {
    const identity = source ? `${this.identity}#screen` : this.identity;
    this.volumes.get(identity) !== volume && (this.volumes.set(identity, volume), invoke("voice_volume", { identity, volume }).catch(none));
  };
  setMicrophoneEnabled = (open: boolean) => ((this.isMicrophoneEnabled = open), invoke("voice_mic", { link: this.room.id, open }));
  setCameraEnabled = () => Promise.reject(new Error("native_video"));
  setScreenShareEnabled = (on: boolean) => (on ? this.share() : this.unshare());
  private share = () =>
    startScreen().then(
      (publication) => (this.trackPublications.set(publication.trackSid, publication), (this.isScreenShareEnabled = true), this.room.notify("localTrackPublished", publication)),
      (error) => Promise.reject(Object.assign(new Error(String(error)), { name: /cancel/i.test(String(error)) ? "AbortError" : "Error" })),
    );
  private unshare = () =>
    stopScreen().then(() => {
      const local = [...this.trackPublications.values()].filter((publication: FramePublication) => publication.source === "screen_share");
      local.forEach((publication: FramePublication) => (publication.track.stop(), this.trackPublications.delete(publication.trackSid)));
      this.isScreenShareEnabled = false;
      this.room.notify("localTrackUnpublished");
    });
  unpublishTrack = () => Promise.resolve();
}

export class NativeRoom {
  readonly id = crypto.randomUUID();
  readonly localParticipant = new NativeParticipant(this, "", true);
  remoteParticipants = new Map<string, NativeParticipant>();
  private handlers = new Map<string, Set<Handler>>();
  private keys: [string, number, number[]][] = [];
  private connected = false;
  private stop: UnlistenFn = none;
  private unwatch: UnlistenFn = none;

  constructor(private encrypted: boolean, private publish: boolean) {}

  on = (event: string, handler: Handler) => (this.handlers.set(event, (this.handlers.get(event) ?? new Set()).add(handler)), this);
  once = (event: string, handler: Handler) => this.on(event, (...args: unknown[]) => (this.handlers.get(event)?.delete(handler), handler(...args)));
  private emit = (event: string, ...args: unknown[]) => [...(this.handlers.get(event) ?? [])].forEach((handler) => handler(...args));
  notify = (event: string, ...args: unknown[]) => this.emit(event, ...args);

  setKey = (identity: string, index: number, key: Uint8Array) =>
    this.connected ? invoke<void>("voice_key", { link: this.id, identity, index, key: [...key] }) : (this.keys.push([identity, index, [...key]]), Promise.resolve());

  private members = (members: Member[]) => {
    const fresh = new Map(members.map((member) => [member.identity, Object.assign(this.remoteParticipants.get(member.identity) ?? new NativeParticipant(this, member.identity), { isMicrophoneEnabled: member.mic })]));
    const joined = [...fresh.keys()].filter((identity) => !this.remoteParticipants.has(identity));
    const left = [...this.remoteParticipants.values()].filter((participant) => !fresh.has(participant.identity));
    this.remoteParticipants = fresh;
    joined.forEach((identity) => this.emit("participantConnected", fresh.get(identity)));
    left.forEach((participant) => this.emit("participantDisconnected", participant));
    this.emit("trackMuted");
  };

  private update = ({ payload }: { payload: Update }) =>
    ({
      members: () => this.members((payload as Extract<Update, { kind: "members" }>).members),
      speakers: () => this.emit("activeSpeakersChanged", (payload as Extract<Update, { kind: "speakers" }>).identities.map((identity) => this.remoteParticipants.get(identity) ?? { identity })),
      quality: () => this.emit("connectionQualityChanged", (payload as Extract<Update, { kind: "quality" }>).quality, this.localParticipant),
      status: () => this.emit((payload as Extract<Update, { kind: "status" }>).status),
    })[payload.kind]();

  connect = async (url: string, token: string) => {
    this.stop = await listen<Update>(`voice:${this.id}`, this.update);
    this.unwatch = await watchRemotes(this.id, (identity) => this.remoteParticipants.get(identity), () => this.emit("trackPublished"));
    await invoke("voice_connect", { link: this.id, url, token, encrypted: this.encrypted, publish: this.publish, keys: this.keys.splice(0) }).catch((error) => (this.stop(), Promise.reject(new Error(String(error)))));
    this.connected = true;
  };

  disconnect = async () => (this.stop(), this.unwatch(), this.localParticipant.isScreenShareEnabled && (await this.unshare()), (this.connected = false), await invoke("voice_disconnect", { link: this.id }).catch(none), this.emit("disconnected"));
  setE2EEEnabled = () => Promise.resolve();
  switchActiveDevice = (kind: MediaDeviceKind, deviceId: string) => (kind === "videoinput" ? Promise.resolve() : invoke("voice_device", { output: kind === "audiooutput", id: deviceId }));
}

type NativeDevice = { id: string; label: string };

let pendingDevices: Promise<{ inputs: NativeDevice[]; outputs: NativeDevice[] }> | null = null;
const deviceList = () => (pendingDevices ??= invoke<{ inputs: NativeDevice[]; outputs: NativeDevice[] }>("voice_devices").catch(() => ({ inputs: [], outputs: [] })).finally(() => setTimeout(() => (pendingDevices = null), 500)));

export const nativeDevices = async (kind: MediaDeviceKind) =>
  kind === "videoinput"
    ? []
    : (await deviceList())[kind === "audioinput" ? "inputs" : "outputs"].map(
        ({ id, label }) => ({ deviceId: id, label, kind, groupId: "", toJSON: () => ({ deviceId: id, label, kind }) }) as MediaDeviceInfo,
      );

type Tunable = { noiseSuppression: boolean; echoCancellation: boolean; autoSensitivity: boolean; sensitivity: number };

export const nativeTuning = (prefs: Tunable) =>
  invoke("voice_tuning", { tuning: { noise: prefs.noiseSuppression, echo: prefs.echoCancellation, auto: prefs.autoSensitivity, threshold: prefs.sensitivity } }).catch(none);

export const nativeLevels = (show: (db: number, open: boolean) => void) => listen<{ db: number; open: boolean }>("voice:level", ({ payload }) => show(payload.db, payload.open));

export const nativeVoices = (show: (levels: Record<string, number>) => void) => listen<Record<string, number>>("voice:levels", ({ payload }) => show(payload));
