import type { Room as LiveKitRoom, RemoteTrack, Participant, Track } from "livekit-client";
import { derived, get, readable, writable } from "svelte/store";
import type { MatrixEvent, RoomId, StateEvent, SyncResponse, UserId } from "../matrix/types";
import { serverNameFromUserId } from "../matrix/discovery";
import {
  backendIdentities,
  callMemberships,
  hashIdentity,
  hashKey,
  memberFocus,
  RTC_MEMBER_TYPE,
  STICKY_MAX,
  stickyKeyOf,
  transportKey,
  usesCsApi,
  type LiveKitFocus,
  type StickyEvent,
  decodeKey,
  encodeKey,
  homeserverFoci,
  identityOf,
  isCallRoom,
  KEYS_TYPE,
  leaveOnUnload,
  MEMBERSHIP_LIFETIME,
  membershipContent,
  NOTIFY_TYPES,
  pickFocus,
  putMembership,
  clearMembership,
  stateKeyOf,
  requestSfu,
  scheduleLeave,
  supportsDelayedEvents,
  toDeviceKeyContent,
  updateDelayed,
  type CallMembership,
} from "../matrix/utilities/rtc";
import { decryptPreview, redactRoomEvent, registerLiveSyncHook, registerSyncHook, registerToDeviceHook, rooms, sendEncryptedToDevice, sendRoomEvent, session } from "./matrix";
import { toast, toastKey } from "./toast";
import { voiceUsers } from "./presence";
import { native } from "../misc/native";
import { askShare, bridgePublisher, screenShared, shareAudio } from "./nativescreen";
import { NativeRoom, webInput, nativeDevices, nativeLevels, nativeTuning, nativeVoice, nativeVoices } from "./nativeroom";
import { getLocalisedText } from "../accessibility/language/translation";
import { onWake, vlog } from "./voicelog";

export type VoiceKind = "rtc" | "legacy";
export type VoiceStatus = "connecting" | "ringing" | "connected" | "reconnecting";
export type VoiceQuality = "excellent" | "good" | "poor" | "lost" | "unknown";

export type VoiceState = {
  kind: VoiceKind;
  roomId: RoomId;
  status: VoiceStatus;
  quality: VoiceQuality;
  encrypted: boolean;
  startedAt: number;
};

export type VoicePrefs = { input: string; output: string; camera: string; pushToTalk: boolean; pttKey: string; pttLabel: string; noiseSuppression: boolean; echoCancellation: boolean; autoSensitivity: boolean; sensitivity: number };

export type IncomingCall = { roomId: RoomId; kind: VoiceKind; callerId: UserId; callId?: string };

const PREFS_KEY = "skye:voice";
const DEFAULT_PREFS: VoicePrefs = { input: "default", output: "default", camera: "default", pushToTalk: false, pttKey: "KeyV", pttLabel: "V", noiseSuppression: true, echoCancellation: true, autoSensitivity: true, sensitivity: -50 };

const readPrefs = (): VoicePrefs => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
};

export const voice = writable<VoiceState | null>(null);
export const muted = writable(false);
export const deafened = writable(false);
export const speaking = writable<Set<string>>(new Set());
export const voicePrefs = writable<VoicePrefs>(typeof localStorage === "undefined" ? DEFAULT_PREFS : readPrefs());
export const incomingCall = writable<IncomingCall | null>(null);
export const voiceError = writable<string | null>(null);
voiceError.subscribe((key) => key && toast(getLocalisedText(undefined, "voice", "errors", key) as string, { icon: "mic", tone: "danger" }));
export const pttHeld = writable(false);
export const micBlocked = writable(false);

export const blockMic = () => (micBlocked.set(true), muted.set(true), toastKey("mic_blocked", { icon: "mic", tone: "danger" }));

voicePrefs.subscribe((prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
});

const tick = readable(Date.now(), (set) => {
  const timer = setInterval(() => set(Date.now()), 30000);
  return () => clearInterval(timer);
});

export const stickyMembers = writable<Record<RoomId, Record<string, StickyEvent>>>({});
export const identityHashes = writable<Record<string, string>>({});

const stickyTtl = (event: MatrixEvent) =>
  Math.min(
    ((event.unsigned as Record<string, unknown> | undefined)?.msc4354_sticky_duration_ttl_ms as number | undefined) ??
      ((event as MatrixEvent & { msc4354_sticky?: { duration_ms?: number } }).msc4354_sticky?.duration_ms ?? STICKY_MAX),
    STICKY_MAX,
  );

const keepSticky = (roomId: RoomId, event: MatrixEvent, ttl: number) =>
  event.type === RTC_MEMBER_TYPE &&
  !!event.sender &&
  stickyMembers.update((all) => {
    const entry = { ...(event as StateEvent), state_key: "", until: Date.now() + ttl } as StickyEvent;
    const key = stickyKeyOf(entry);
    const previous = all[roomId]?.[key];
    return (previous?.origin_server_ts ?? 0) > (entry.origin_server_ts ?? 0) ? all : { ...all, [roomId]: { ...all[roomId], [key]: entry } };
  });

registerSyncHook((response: SyncResponse) =>
  Object.entries(response.rooms?.join ?? {}).forEach(([roomId, room]) =>
    [...(room.msc4354_sticky?.events ?? []), ...(room.timeline?.events ?? []).filter((event) => event.type === RTC_MEMBER_TYPE || "msc4354_sticky" in event)]
      .filter((event) => event.type === RTC_MEMBER_TYPE || event.type === "m.room.encrypted")
      .forEach((event) =>
        decryptPreview(event, roomId).then((clear) => clear && keepSticky(roomId, { ...clear, sender: event.sender, origin_server_ts: event.origin_server_ts, event_id: event.event_id, unsigned: event.unsigned }, stickyTtl(event))),
      ),
  ),
);

const ownCopy = (list: CallMembership[], userId: UserId | undefined, deviceId: string | undefined) => {
  const mine = list.filter((member) => member.userId === userId);
  const keep = mine.find((member) => member.deviceId === deviceId) ?? mine.reduce<CallMembership | undefined>((newest, member) => (member.createdTs > (newest?.createdTs ?? -1) ? member : newest), undefined);
  return list.filter((member) => member.userId !== userId || member === keep);
};

export const callMembers = derived([rooms, stickyMembers, tick, session], ([$rooms, $sticky, , $session]) =>
  Object.fromEntries(
    Object.values($rooms)
      .filter((room) => room.membership === "join")
      .map((room) => [room.roomId, ownCopy(callMemberships(room, Object.values($sticky[room.roomId] ?? {})), $session?.userId, $session?.deviceId)] as const)
      .filter(([, list]) => list.length),
  ) as Record<RoomId, CallMembership[]>,
);

callMembers.subscribe((all) =>
  Object.values(all)
    .flat()
    .filter((member) => member.foci.some((focus) => typeof focus.url === "string") && !get(identityHashes)[hashKey(member.userId, member.memberId)])
    .forEach((member) =>
      hashIdentity(member.userId, member.memberId).then(
        (hash) => identityHashes.update((hashes) => ({ ...hashes, [hashKey(member.userId, member.memberId)]: hash })),
        () => undefined,
      ),
    ),
);

callMembers.subscribe((all) => voiceUsers.set(new Set(Object.values(all).flat().map((member) => member.userId))));

export const memberIdentities = derived([callMembers, identityHashes], ([$members, $hashes]) =>
  Object.fromEntries(
    Object.values($members)
      .flat()
      .map((member) => [identityOf(member.userId, member.deviceId), backendIdentities(member, $hashes)] as const),
  ) as Record<string, string[]>,
);

export const identityOwners = derived(memberIdentities, ($identities) =>
  Object.fromEntries(Object.entries($identities).flatMap(([legacy, list]) => list.map((identity) => [identity, legacy] as const))) as Record<string, string>,
);

export const userOfIdentity = (identity: string) => (get(identityOwners)[identity] ?? identity).replace(/:[^:]*$/, "");
export const selfSpeaking = derived([speaking, session], ([$speaking, $session]) => [...$speaking].some((identity) => userOfIdentity(identity) === $session?.userId));

export type UserVolume = { volume: number; muted: boolean; stream?: number };

const VOLUME_KEY = "skye:volumes";

const readVolumes = (): Record<UserId, UserVolume> => {
  try {
    return JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}");
  } catch {
    return {};
  }
};

export const userVolumes = writable<Record<UserId, UserVolume>>(typeof localStorage === "undefined" ? {} : readVolumes());

userVolumes.subscribe((volumes) => {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  } catch {}
});

export const volumeOf = (userId: UserId): UserVolume => get(userVolumes)[userId] ?? { volume: 1, muted: false };
export const setUserVolume = (userId: UserId, volume: number) => userVolumes.update((all) => ({ ...all, [userId]: { ...volumeOf(userId), volume } }));
export const setStreamVolume = (userId: UserId, stream: number) => userVolumes.update((all) => ({ ...all, [userId]: { ...volumeOf(userId), stream } }));
export const toggleUserMute = (userId: UserId) => userVolumes.update((all) => ({ ...all, [userId]: { ...volumeOf(userId), muted: !volumeOf(userId).muted } }));

export type CallMedia = { id: string; identity: string; source: "camera" | "screen"; track: Track; local: boolean };

export const callMedia = writable<CallMedia[]>([]);
export const cameraOn = writable(false);
export const screenOn = writable(false);
export const screenSupported = nativeVoice || (typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia);

export const joinable = derived(rooms, ($rooms) => new Set(Object.values($rooms).filter(isCallRoom).map((room) => room.roomId)));

export const listDevices = async (kind: MediaDeviceKind) =>
  nativeVoice ? nativeDevices(kind) : (await navigator.mediaDevices?.enumerateDevices?.().catch(() => []))?.filter((device) => device.kind === kind) ?? [];

type CallEventHook = (roomId: RoomId, event: MatrixEvent) => void;

const callEventHooks = new Set<CallEventHook>();

export const registerCallEventHook = (hook: CallEventHook) => void callEventHooks.add(hook);

const CALL_TYPES = new Set([KEYS_TYPE, ...NOTIFY_TYPES, "m.call.invite", "m.call.answer", "m.call.candidates", "m.call.hangup", "m.call.reject", "m.call.select_answer", "m.call.negotiate"]);

registerLiveSyncHook((response: SyncResponse) =>
  Object.entries(response.rooms?.join ?? {}).forEach(([roomId, room]) => {
    const summary = get(rooms)[roomId];
    const watched = summary?.isDirect || get(voice)?.roomId === roomId;
    (room.timeline?.events ?? [])
      .filter((event) => CALL_TYPES.has(event.type) || (watched && event.type === "m.room.encrypted"))
      .forEach((event) =>
        decryptPreview(event, roomId).then(
          (clear) => clear && CALL_TYPES.has(clear.type) && callEventHooks.forEach((hook) => hook(roomId, { ...clear, sender: event.sender, origin_server_ts: event.origin_server_ts, event_id: event.event_id })),
        ),
      );
  }),
);

type KeyProvider = { setParticipantKey: (identity: string, index: number, key: Uint8Array) => Promise<void> };

type Link = { key: string; room: LiveKitRoom; keys: (KeyProvider & { provider: unknown }) | null; publish: boolean; speakers: Set<string> };

type Live = {
  roomId: RoomId;
  encrypted: boolean;
  focus: LiveKitFocus;
  links: Map<string, Link>;
  keyIndex: number;
  key: Uint8Array;
  received: Map<string, Map<number, Uint8Array>>;
  known: Set<string>;
  timers: ReturnType<typeof setInterval>[];
  delayId: string | null;
  stop: (() => void)[];
  publishedAt: number;
  createdTs: number;
  healing: boolean;
  failures: number;
  retryAt: number;
};

let live: Live | null = null;

const ownLegacy = () => {
  const active = get(session);
  return active ? identityOf(active.userId, active.deviceId) : "";
};

const ownIdentities = (current: Live) => {
  const active = get(session);
  const hash = active && get(identityHashes)[hashKey(active.userId, ownLegacy())];
  return [ownLegacy(), ...(usesCsApi(current.focus) && hash ? [hash] : [])];
};

const createKeyProvider = async (): Promise<KeyProvider & { provider: unknown }> => {
  const kit = await import("livekit-client");
  class MatrixKeyProvider extends kit.BaseKeyProvider {
    constructor() {
      super({ ratchetWindowSize: 10, keyringSize: 256 });
    }
    setParticipantKey = async (identity: string, index: number, key: Uint8Array) =>
      this.onSetEncryptionKey(await kit.createKeyMaterialFromBuffer(key.slice().buffer), identity, index);
  }
  const provider = new MatrixKeyProvider();
  return { provider, setParticipantKey: provider.setParticipantKey };
};

const applyKey = (current: Live, legacy: string, index: number, key: Uint8Array) =>
  (get(memberIdentities)[legacy] ?? [legacy]).forEach((identity) => current.links.forEach((link) => link.keys?.setParticipantKey(identity, index, key)));

const storeKey = (current: Live, legacy: string, index: number, key: Uint8Array) => {
  current.received.set(legacy, (current.received.get(legacy) ?? new Map()).set(index, key));
  applyKey(current, legacy, index, key);
};

const replayKeys = (current: Live) => current.received.forEach((keys, legacy) => keys.forEach((key, index) => applyKey(current, legacy, index, key)));

const setOwnKey = (current: Live, index: number, key: Uint8Array) =>
  ownIdentities(current).forEach((identity) => current.links.forEach((link) => link.keys?.setParticipantKey(identity, index, key)));

const keyTargets = (current: Live, only?: Set<string>) => {
  const own = ownLegacy();
  return (get(callMembers)[current.roomId] ?? [])
    .map((member) => ({ userId: member.userId, deviceId: member.deviceId, identity: identityOf(member.userId, member.deviceId) }))
    .filter((member) => member.identity !== own && (!only || only.has(member.identity)))
    .map(({ userId, deviceId }) => ({ userId, deviceId }));
};

const sendKey = (current: Live, only?: Set<string>) => {
  const active = get(session);
  const key = encodeKey(current.key);
  return active && current.encrypted
    ? Promise.allSettled([
        sendRoomEvent(KEYS_TYPE, { keys: [{ index: current.keyIndex, key }], device_id: active.deviceId, call_id: "", sent_ts: Date.now() }, current.roomId),
        sendEncryptedToDevice(KEYS_TYPE, keyTargets(current, only), toDeviceKeyContent(active, current.roomId, current.keyIndex, key)),
      ])
    : undefined;
};

const rotateKey = (current: Live) => {
  current.key = crypto.getRandomValues(new Uint8Array(16));
  current.keyIndex = (current.keyIndex + 1) % 256;
  const index = current.keyIndex;
  const key = current.key;
  sendKey(current);
  setTimeout(() => live === current && setOwnKey(current, index, key), 1000);
};

registerCallEventHook((roomId, event) => {
  const current = live;
  const active = get(session);
  const own = event.sender === active?.userId && event.content?.device_id === active?.deviceId;
  current?.roomId === roomId &&
    event.type === KEYS_TYPE &&
    !own &&
    (event.content?.keys ?? []).forEach((entry: { index?: number; key?: string }) =>
      storeKey(current, identityOf(event.sender ?? "", event.content?.device_id ?? ""), entry.index ?? 0, decodeKey(entry.key ?? "")),
    );
});

type ToDeviceKey = { room_id?: string; media_key?: { index?: number; key?: string }; keys?: { index?: number; key?: string }; member?: { claimed_device_id?: string } };

registerToDeviceHook((event) => {
  const current = live;
  const content = (event.content ?? {}) as ToDeviceKey;
  const media = content.media_key ?? content.keys;
  const deviceId = content.member?.claimed_device_id ?? "";
  const identity = identityOf(event.sender ?? "", deviceId);
  event.type === KEYS_TYPE &&
    current?.roomId === content.room_id &&
    !!event.sender &&
    !!deviceId &&
    identity !== ownLegacy() &&
    typeof media?.key === "string" &&
    !!media.key &&
    typeof media.index === "number" &&
    storeKey(current!, identity, media.index, decodeKey(media.key));
});

const QUALITY: Record<string, VoiceQuality> = { excellent: "excellent", good: "good", poor: "poor", lost: "lost" };

const patch = (next: Partial<VoiceState>) => voice.update((state) => state && { ...state, ...next });

export const applyOutput = (element: HTMLMediaElement) => {
  const sink = get(voicePrefs).output;
  (element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(sink === "default" ? "" : sink).catch(() => undefined);
  element.muted = get(deafened);
};

export const audioElements = new Set<HTMLMediaElement>();

const syncAudio = () => audioElements.forEach(applyOutput);

deafened.subscribe(syncAudio);
voicePrefs.subscribe(syncAudio);

export const voicePing = writable<number | null>(null);

export const measurePing = async () => {
  const link = publishLink();
  const sender = [...(link?.room.localParticipant.trackPublications.values() ?? [])].map((publication) => publication.track?.sender).find(Boolean);
  const stats = sender ? await sender.getStats().catch(() => null) : null;
  const pair = [...(stats?.values() ?? [])].find((entry) => entry.type === "candidate-pair" && entry.nominated && entry.currentRoundTripTime !== undefined);
  const rtt = pair ? pair.currentRoundTripTime * 1000 : (link?.room as unknown as { engine?: { client?: { rtt?: number } } })?.engine?.client?.rtt;
  voicePing.set(rtt ? Math.round(rtt) : null);
};

const publishLink = () => [...(live?.links.values() ?? [])].find((link) => link.publish);
bridgePublisher(() => publishLink()?.room.localParticipant as never);

const voiceOf = () => {
  const entries = [...(live?.links.values() ?? [])].flatMap((link) => [...link.room.remoteParticipants.values()].map((participant) => ({ participant, rank: link.speakers.has(participant.identity) ? 2 : participant.isMicrophoneEnabled ? 1 : 0 })));
  return entries.reduce<Record<string, { participant: Participant; rank: number }>>((best, entry) => {
    const user = userOfIdentity(entry.participant.identity);
    return entry.rank > (best[user]?.rank ?? -1) ? { ...best, [user]: entry } : best;
  }, {});
};

const applyVolumes = () => {
  const chosen = voiceOf();
  live?.links.forEach((link) =>
    link.room.remoteParticipants.forEach((participant) => {
      const level = volumeOf(userOfIdentity(participant.identity));
      const volume = get(deafened) || level.muted || userOfIdentity(participant.identity) === get(session)?.userId || (!nativeVoice && chosen[userOfIdentity(participant.identity)]?.participant !== participant) ? 0 : level.volume;
      participant.setVolume(volume);
      participant.setVolume(get(deafened) || level.muted ? 0 : (level.stream ?? 1), "screen_share_audio" as Parameters<typeof participant.setVolume>[1]);
    }),
  );
};

deafened.subscribe(applyVolumes);
userVolumes.subscribe(applyVolumes);
identityOwners.subscribe(applyVolumes);

const micOpen = () => !get(muted) && !get(deafened) && (!get(voicePrefs).pushToTalk || get(pttHeld));

type MicHook = (open: boolean) => void;
const micHooks = new Set<MicHook>();
export const registerMicHook = (hook: MicHook) => void micHooks.add(hook);

const applyMic = () => {
  const open = micOpen();
  publishLink()?.room.localParticipant.setMicrophoneEnabled(open).then(() => open && micBlocked.set(false), () => open && blockMic());
  micHooks.forEach((hook) => hook(open));
  live && refreshSpeaking(live);
};

muted.subscribe(applyMic);
deafened.subscribe(applyMic);
pttHeld.subscribe(applyMic);
voicePrefs.subscribe(applyMic);

const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

typeof window !== "undefined" &&
  (window.addEventListener("keydown", (event) => {
    const prefs = get(voicePrefs);
    prefs.pushToTalk && get(voice) && event.code === prefs.pttKey && !editable(event.target) && !event.repeat && pttHeld.set(true);
  }),
  window.addEventListener("keyup", (event) => event.code === get(voicePrefs).pttKey && pttHeld.set(false)),
  window.addEventListener("blur", () => pttHeld.set(false)),
  window.addEventListener("pagehide", () => {
    const active = get(session);
    live && active && leaveOnUnload(active, live.roomId);
  }));

const PREF_OF = { audioinput: "input", audiooutput: "output", videoinput: "camera" } as const;

export const switchDevice = (kind: "audioinput" | "audiooutput" | "videoinput", deviceId: string) => {
  vlog(`switch ${kind}`, deviceId);
  voicePrefs.update((prefs) => ({ ...prefs, [PREF_OF[kind]]: deviceId }));
  live?.links.forEach((link) => (link.publish || kind === "audiooutput") && link.room.switchActiveDevice(kind, deviceId === "default" ? "default" : deviceId).catch(() => undefined));
  micHooks.forEach((hook) => hook(micOpen()));
};

export const toggleMute = () => (get(deafened) ? (deafened.set(false), muted.set(false)) : muted.update((value) => !value));
export const toggleDeafen = () => deafened.update((value) => !value);

const SPEAKING_LEVEL = 0.015;
const SPEAKING_HOLD = 450;
const meters = new WeakMap<MediaStreamTrack, () => number>();
const meter = (track: MediaStreamTrack) =>
  meters.get(track) ??
  (() => {
    const context = new AudioContext();
    const analyser = Object.assign(context.createAnalyser(), { fftSize: 512 });
    const data = new Float32Array(analyser.fftSize);
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    track.addEventListener("ended", () => context.close().catch(() => undefined), { once: true });
    const read = () => (analyser.getFloatTimeDomainData(data), Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length) * 4);
    meters.set(track, read);
    return read;
  })();

export const captureOf = (prefs: VoicePrefs, exact = false) => ({
  deviceId: prefs.input === "default" ? undefined : exact ? { exact: prefs.input } : prefs.input,
  echoCancellation: prefs.echoCancellation,
  noiseSuppression: prefs.noiseSuppression,
  autoGainControl: true,
});

export const captureFor = async (prefs: VoicePrefs) =>
  nativeVoice ? { ...captureOf(prefs), deviceId: await webInput(prefs.input).then((id) => (id ? { exact: id } : undefined)) } : captureOf(prefs, true);

export const inputLevel = writable(0);
export const transmitting = writable(false);
const DB_FLOOR = -100;
const AUTO_DB = -55;
const GATE_HOLD = 300;
const listeners = writable(0);
export const watchInput = () => (listeners.update((count) => count + 1), () => listeners.update((count) => count - 1));

export const userLevels = writable<Record<string, [number, number, number]>>({});
const VISIBLE_DB = [-62, -18];
const loudness = (db: number) => Math.max(0, Math.min(1, (db - VISIBLE_DB[0]) / (VISIBLE_DB[1] - VISIBLE_DB[0])));
const LEVEL_STEP = 0.04;
const quiet = (bars: [number, number, number] | undefined) => !bars || Math.max(...bars) < LEVEL_STEP;
const pushLevels = (levels: Record<string, number>) => {
  const all = get(userLevels);
  const moved = Object.entries(levels).filter(([user, level]) => !(quiet(all[user]) && level < LEVEL_STEP) && Math.abs((all[user]?.[1] ?? 0) - level) + (all[user]?.[0] ?? 0) + (all[user]?.[2] ?? 0) >= LEVEL_STEP);
  moved.length && userLevels.set({ ...all, ...Object.fromEntries(moved.map(([user, level]) => [user, (level < LEVEL_STEP ? [0, 0, 0] : [all[user]?.[1] ?? 0, level, all[user]?.[0] ?? 0]) as [number, number, number]])) });
};
const byUser = (levels: Record<string, number>) =>
  Object.entries(levels).reduce<Record<string, number>>((all, [identity, level]) => ({ ...all, [userOfIdentity(identity)]: Math.max(all[userOfIdentity(identity)] ?? 0, level) }), {});

const showLevel = (db: number, open: boolean) => (
  Math.abs(get(inputLevel) - (db - DB_FLOOR) / -DB_FLOOR) >= 0.01 && inputLevel.set((db - DB_FLOOR) / -DB_FLOOR),
  get(transmitting) !== open && transmitting.set(open),
  nativeVoice && live && get(session) && pushLevels({ [get(session)!.userId]: open && micOpen() ? loudness(db) : 0 })
);

let gateOpen = true;
const applyGate = (open: boolean) => {
  const track = publishLink()?.room.localParticipant.getTrackPublication("microphone" as Track.Source)?.track?.mediaStreamTrack;
  gateOpen = open;
  track && (track.enabled = open);
};

const startMeter = (prefs: VoicePrefs) => {
  let alive = true;
  let loud = 0;
  let stop = () => void (alive = false);
  captureFor(prefs)
    .then((audio) => navigator.mediaDevices.getUserMedia({ audio }))
    .then((stream) => {
      const context = new AudioContext();
      const analyser = Object.assign(context.createAnalyser(), { fftSize: 1024 });
      const data = new Float32Array(analyser.fftSize);
      context.createMediaStreamSource(stream).connect(analyser);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        const db = Math.max(DB_FLOOR, 20 * Math.log10(Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length) || 1e-6));
        const now = performance.now();
        const current = get(voicePrefs);
        loud = db > (current.autoSensitivity ? AUTO_DB : current.sensitivity) ? now : loud;
        const open = now - loud < GATE_HOLD;
        showLevel(db, open);
        const gate = current.autoSensitivity || open;
        gate !== gateOpen && !nativeVoice && applyGate(gate);
      }, 40);
      stop = () => (clearInterval(timer), stream.getTracks().forEach((track) => track.stop()), context.close().catch(() => undefined), showLevel(DB_FLOOR, false));
      alive || stop();
    })
    .catch(() => undefined);
  return () => stop();
};

let meterKey = "";
let stopMeter = () => {};
derived([voice, voicePrefs, listeners], ([$voice, $prefs, $listeners]) =>
  (nativeVoice ? !$voice && $listeners > 0 : ($voice && !$prefs.autoSensitivity) || $listeners > 0) ? `${$prefs.input}:${$prefs.noiseSuppression}:${$prefs.echoCancellation}` : "",
).subscribe((key) => {
  key !== meterKey && (stopMeter(), (stopMeter = key ? startMeter(get(voicePrefs)) : () => {}), (meterKey = key));
  key || gateOpen || applyGate(true);
});

nativeVoice && nativeLevels(showLevel);
nativeVoice && nativeVoices((levels) => pushLevels(byUser(Object.fromEntries(Object.entries(levels).map(([identity, db]) => [identity, loudness(db)])))));

const capture = (prefs: VoicePrefs) => `${prefs.noiseSuppression}:${prefs.echoCancellation}`;
let processed = capture(get(voicePrefs));
voicePrefs.subscribe((prefs) => {
  const changed = capture(prefs) !== processed;
  processed = capture(prefs);
  nativeVoice && nativeTuning(prefs);
  changed &&
    !nativeVoice &&
    (publishLink()?.room.localParticipant.getTrackPublication("microphone" as Track.Source)?.track as { restartTrack?: (options: MediaTrackConstraints) => Promise<void> } | undefined)
      ?.restartTrack?.(captureOf(prefs))
      .then(() => applyGate(gateOpen))
      .catch(() => undefined);
});

const TALKING = 0.12;
export const talkingUsers = derived([userLevels, voice], ([$levels, $voice]) => new Set($voice ? Object.keys($levels).filter((user) => Math.max(...$levels[user]) > TALKING) : []));

const refreshSpeaking = (current: Live) => live === current && speaking.set(new Set([...current.links.values()].flatMap((link) => [...link.speakers]).filter((identity) => micOpen() || userOfIdentity(identity) !== get(session)?.userId)));

const refreshMedia = (current: Live) => {
  const link = [...current.links.values()].find((entry) => entry.publish);
  live === current &&
    (callMedia.set(
      [...current.links.values()].flatMap((entry) =>
        [...(entry.publish ? [entry.room.localParticipant] : []), ...entry.room.remoteParticipants.values()].flatMap((participant) =>
          [...participant.trackPublications.values()]
            .filter((publication) => publication.kind === "video" && !!publication.track && !publication.isMuted && publication.track.mediaStreamTrack?.readyState !== "ended")
            .map((publication) => ({
              id: `${participant.identity}:${publication.trackSid}`,
              identity: participant.identity,
              source: publication.source === "screen_share" ? ("screen" as const) : ("camera" as const),
              track: publication.track!,
              local: participant.isLocal,
            })),
        ),
      ),
    ),
    cameraOn.set(!!link?.room.localParticipant.isCameraEnabled),
    screenOn.set(!!link?.room.localParticipant.isScreenShareEnabled));
};

const publishMembership = async (current: Live) => {
  const active = get(session)!;
  const stale = current.delayId;
  current.delayId = null;
  stale && updateDelayed(active, stale, "cancel").catch(() => undefined);
  const delayId = (await supportsDelayedEvents(active)) ? await scheduleLeave(active, current.roomId).catch((error) => (console.warn("Skye could not schedule the call leave", error), null)) : null;
  if (live !== current) return void (delayId && updateDelayed(active, delayId, "cancel").catch(() => undefined));
  current.delayId = delayId;
  await putMembership(active, current.roomId, membershipContent(active, current.focus, current.roomId, current.createdTs));
  vlog("membership published", { delayed: !!delayId, expires: new Date(Date.now() + MEMBERSHIP_LIFETIME).toISOString() });
  live === current ? ((current.publishedAt = Date.now()), (current.failures = 0), (current.retryAt = 0)) : await putMembership(active, current.roomId, {}).catch(() => undefined);
};

const heal = (current: Live, reason: string) =>
  live === current &&
  !current.healing &&
  Date.now() >= current.retryAt &&
  (console.warn(`Skye is republishing its call membership: ${reason}`),
  vlog(`membership heal: ${reason}`),
  (current.healing = true),
  publishMembership(current)
    .then(
      () => void (live === current && sendKey(current)),
      (error) => void (console.warn("Skye could not republish its call membership", error), vlog("membership heal failed", error, `failures ${current.failures + 1}`), (current.failures += 1), (current.retryAt = Date.now() + Math.min(60000, 2000 * 2 ** current.failures))),
    )
    .finally(() => (current.healing = false)));

const restartLeave = (current: Live) => {
  const active = get(session);
  const delayId = current.delayId;
  active &&
    delayId &&
    !current.healing &&
    updateDelayed(active, delayId, "restart").then(
      () => current.delayId === delayId && (current.failures = 0),
      (error: { status?: number }) =>
        current.delayId === delayId &&
        (console.warn("Skye could not restart its delayed call leave", error), vlog("delayed leave restart failed", error?.status ?? error, `failures ${current.failures + 1}`), (current.failures += 1), (error?.status === 404 || current.failures >= 2) && heal(current, "delayed leave lost")),
    );
};

const keepMembership = async (current: Live) => {
  await publishMembership(current);
  live === current &&
    current.timers.push(
      setInterval(() => restartLeave(current), 5000),
      setInterval(() => heal(current, "refresh"), MEMBERSHIP_LIFETIME - 10 * 60 * 1000),
    );
};

const neededFoci = (current: Live) => {
  const members = (get(callMembers)[current.roomId] ?? []).filter((member) => identityOf(member.userId, member.deviceId) !== ownLegacy());
  return new Map(
    members
      .map((member) => ({ member, focus: memberFocus(member, members[0]) }))
      .filter((entry): entry is { member: CallMembership; focus: LiveKitFocus } => !!entry.focus)
      .map((entry) => [transportKey(entry.focus), entry] as const),
  );
};

const syncLinks = (current: Live) => {
  const needed = neededFoci(current);
  current.links.forEach((link, key) => !link.publish && !needed.has(key) && closeLink(current, key));
  needed.forEach(
    (entry, key) =>
      !current.links.has(key) &&
      (vlog("opening listen link", key),
      openLink(current, entry.focus, false, serverNameFromUserId(entry.member.userId)).catch(
        (error) => (console.warn("Skye could not reach another MatrixRTC server", error), vlog("listen link failed", key, error), closeLink(current, key), setTimeout(() => live === current && syncLinks(current), 5000)),
      )),
  );
};

const closeLink = (current: Live, key: string) => {
  const link = current.links.get(key);
  current.links.delete(key);
  link?.room.disconnect().catch(() => undefined);
  refreshSpeaking(current);
  refreshMedia(current);
};

const watchMembers = (current: Live) =>
  callMembers.subscribe((all) => {
    const own = ownLegacy();
    const members = all[current.roomId] ?? [];
    const sessions = new Map(members.filter((member) => identityOf(member.userId, member.deviceId) !== own).map((member) => [`${identityOf(member.userId, member.deviceId)}|${member.memberId}|${member.kind === "session" ? member.createdTs : ""}`, identityOf(member.userId, member.deviceId)]));
    const fresh = new Set([...sessions].filter(([entry]) => !current.known.has(entry)).map(([, identity]) => identity));
    const joined = fresh.size > 0;
    const left = [...current.known].some((entry) => !sessions.has(entry));
    current.known = new Set(sessions.keys());
    (joined || left) && vlog("members changed", { joined: [...fresh], left: [...current.known].length, total: sessions.size, self: members.some((member) => identityOf(member.userId, member.deviceId) === own) });
    current.publishedAt && !members.some((member) => identityOf(member.userId, member.deviceId) === own) && Date.now() - current.publishedAt > 15000 && heal(current, "membership missing");
    current.encrypted && left && (vlog("rotating key"), rotateKey(current));
    current.encrypted && joined && !left && sendKey(current, fresh);
    replayKeys(current);
    syncLinks(current);
  });

export const voiceFocus = async (roomId: RoomId) => {
  const active = get(session);
  return active ? pickFocus(callMemberships(get(rooms)[roomId]), await homeserverFoci(active)) : undefined;
};

const openLink = async (current: Live, focus: LiveKitFocus, publish: boolean, serverName?: string) => {
  const active = get(session)!;
  const key = transportKey(focus);
  const kit = await import("livekit-client");
  const shim = nativeVoice ? new NativeRoom(current.encrypted, publish) : null;
  const keys = current.encrypted ? (shim ? { provider: null, setParticipantKey: shim.setKey } : await createKeyProvider()) : null;
  const worker = keys && !shim ? new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" }) : undefined;
  const prefs = get(voicePrefs);
  const room = (shim as unknown as LiveKitRoom | null) ?? new kit.Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: true,
    audioCaptureDefaults: captureOf(prefs),
    videoCaptureDefaults: { deviceId: prefs.camera === "default" ? undefined : prefs.camera },
    audioOutput: { deviceId: prefs.output === "default" ? undefined : prefs.output },
    e2ee: keys && worker ? { keyProvider: keys.provider as InstanceType<typeof kit.BaseKeyProvider>, worker } : undefined,
  });
  const link: Link = { key, room, keys, publish, speakers: new Set() };
  current.links.set(key, link);
  const media = () => (refreshMedia(current), applyVolumes());
  const heard = new Map<string, number>();
  const poll = shim ? undefined : setInterval(() => {
    const now = performance.now();
    const levels: Record<string, number> = {};
    [...(publish ? [room.localParticipant] : []), ...room.remoteParticipants.values()].forEach((participant: Participant) => {
      const publication = participant.getTrackPublication(kit.Track.Source.Microphone);
      const track = publication?.track;
      const level = !track || publication.isMuted ? 0 : Math.max(meter(track.mediaStreamTrack)(), participant.isLocal ? 0 : ((track as RemoteTrack).receiver?.getSynchronizationSources()[0]?.audioLevel ?? 0));
      levels[participant.identity] = Math.min(1, level * 2.5);
      level > SPEAKING_LEVEL && heard.set(participant.identity, now);
    });
    pushLevels(byUser(levels));
    const next = new Set([...heard].filter(([, at]) => now - at < SPEAKING_HOLD).map(([identity]) => identity));
    (next.size !== link.speakers.size || [...next].some((identity) => !link.speakers.has(identity))) && ((link.speakers = next), refreshSpeaking(current), applyVolumes());
  }, 80);
  room.once(kit.RoomEvent.Disconnected, () => clearInterval(poll));
  const tag = publish ? "main" : key;
  const who = (participant?: Participant) => participant?.identity ?? "?";
  room
    .on(kit.RoomEvent.ConnectionStateChanged, (state) => vlog(`livekit ${tag} state ${state}`))
    .on(kit.RoomEvent.SignalReconnecting, () => vlog(`livekit ${tag} signal reconnecting`))
    .on(kit.RoomEvent.Reconnecting, () => vlog(`livekit ${tag} reconnecting`))
    .on(kit.RoomEvent.Reconnected, () => vlog(`livekit ${tag} reconnected`))
    .on(kit.RoomEvent.Disconnected, (reason?: unknown) => vlog(`livekit ${tag} disconnected`, reason ?? "", { current: live === current, tracked: current.links.get(key) === link }))
    .on(kit.RoomEvent.ConnectionQualityChanged, (quality, participant) => participant.isLocal && vlog(`livekit ${tag} quality ${quality}`))
    .on(kit.RoomEvent.ParticipantConnected, (participant: Participant) => vlog(`livekit ${tag} participant joined`, who(participant)))
    .on(kit.RoomEvent.ParticipantDisconnected, (participant: Participant) => vlog(`livekit ${tag} participant left`, who(participant)))
    .on(kit.RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: Participant) => vlog(`livekit ${tag} subscribed ${track.kind}`, who(participant)))
    .on(kit.RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant: Participant) => vlog(`livekit ${tag} unsubscribed ${track.kind}`, who(participant)))
    .on(kit.RoomEvent.TrackSubscriptionFailed, (sid: string, participant: Participant, error?: unknown) => vlog(`livekit ${tag} subscription failed`, sid, who(participant), error ?? ""))
    .on(kit.RoomEvent.TrackMuted, (_publication, participant: Participant) => vlog(`livekit ${tag} muted`, who(participant)))
    .on(kit.RoomEvent.TrackUnmuted, (_publication, participant: Participant) => vlog(`livekit ${tag} unmuted`, who(participant)))
    .on(kit.RoomEvent.MediaDevicesError, (error: unknown) => vlog(`livekit ${tag} device error`, error))
    .on(kit.RoomEvent.EncryptionError, (error: unknown) => vlog(`livekit ${tag} encryption error`, error))
    .on(kit.RoomEvent.AudioPlaybackStatusChanged, () => (vlog(`livekit ${tag} audio playback ${room.canPlaybackAudio ? "allowed" : "blocked"}`), room.canPlaybackAudio || resumeAudio(room, "playback blocked")));
  room
    .on(kit.RoomEvent.ConnectionQualityChanged, (quality, participant) => publish && participant.isLocal && patch({ quality: QUALITY[quality] ?? "unknown" }))
    .on(kit.RoomEvent.Reconnecting, () => publish && patch({ status: "reconnecting" }))
    .on(kit.RoomEvent.Reconnected, () => publish && patch({ status: "connected" }))
    .on(kit.RoomEvent.Disconnected, () => live === current && current.links.get(key) === link && (publish ? rejoin(current) : (closeLink(current, key), setTimeout(() => live === current && syncLinks(current), 2000))))
    .on(kit.RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: Participant) => (track.kind === "audio" && userOfIdentity(participant.identity) !== get(session)?.userId && watchElement(track.attach(), `${tag} ${participant.identity}`), media()))
    .on(kit.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => (track.detach().forEach((element) => element.remove()), media()))
    .on(kit.RoomEvent.TrackMuted, media)
    .on(kit.RoomEvent.TrackUnmuted, media)
    .on(kit.RoomEvent.TrackUnpublished, media)
    .on(kit.RoomEvent.TrackPublished, media)
    .on(kit.RoomEvent.LocalTrackPublished, (publication) => {
      const track = publication.track;
      track?.mediaStreamTrack?.addEventListener("ended", () => (room.localParticipant.unpublishTrack(track).catch(() => undefined).finally(media), media()), { once: true });
      media();
    })
    .on(kit.RoomEvent.LocalTrackUnpublished, media)
    .on(kit.RoomEvent.ParticipantConnected, media)
    .on(kit.RoomEvent.ParticipantDisconnected, media)
    .on(kit.RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => shim && ((link.speakers = new Set(speakers.map((participant) => participant.identity))), refreshSpeaking(current), applyVolumes()));
  keys && setOwnKey(current, current.keyIndex, current.key);
  keys && replayKeys(current);
  const grant = await requestSfu(active, focus, current.roomId, publish, serverName);
  vlog(`livekit ${tag} connecting`, grant.url, { encrypted: current.encrypted, native: !!shim });
  await room.connect(grant.url, grant.jwt).catch((error) => (vlog(`livekit ${tag} connect failed, trying relay`, error), room.connect(grant.url, grant.jwt, { rtcConfig: { iceTransportPolicy: "relay" } })));
  keys && (await room.setE2EEEnabled(true));
  live === current && current.links.get(key) === link ? media() : room.disconnect().catch(() => undefined);
  return link;
};

const MEDIA_ERRORS = ["NotAllowedError", "AbortError"];

export const toggleCamera = () => {
  const link = publishLink();
  const next = !get(cameraOn);
  const prefs = get(voicePrefs);
  link &&
    link.room.localParticipant
      .setCameraEnabled(next, { deviceId: prefs.camera === "default" ? undefined : prefs.camera })
      .catch(() => voiceError.set("camera"))
      .finally(() => live && refreshMedia(live));
};

export const toggleScreen = () => {
  const link = publishLink();
  const portalShare = async () => {
    const choice = await askShare();
    if (!choice) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    const id = `${choice.surface}:0:0`;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id, maxFrameRate: choice.fps, ...(choice.height ? { maxHeight: choice.height } : {}) } } } as MediaStreamConstraints);
    const track = stream.getVideoTracks()[0];
    track.contentHint = choice.mode === "text" ? "detail" : "motion";
    const publication = await link!.room.localParticipant.publishTrack(track, { source: "screen_share" as Track.Source, simulcast: false, videoEncoding: { maxBitrate: choice.mode === "text" ? 2_500_000 : 6_000_000, maxFramerate: choice.fps } });
    track.addEventListener("ended", () => link!.room.localParticipant.unpublishTrack(track));
    choice.apps.length && shareAudio(choice.apps);
    return publication;
  };
  link &&
    [portalShare, link.room.localParticipant.setScreenShareEnabled.bind(link.room.localParticipant)][+(!portal || get(screenOn))](!get(screenOn), { audio: { restrictOwnAudio: true }, systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include" })
      .then((publication) => screenShared(publication?.track?.mediaStreamTrack))
      .catch((error) => !MEDIA_ERRORS.includes((error as Error)?.name) && voiceError.set("screen"))
      .finally(() => live && refreshMedia(live));
};

const portal = native && !nativeVoice && /linux/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);

const ringTargets = (roomId: RoomId) => {
  const summary = get(rooms)[roomId];
  const own = get(session)?.userId;
  return summary?.isDirect ? [summary.directUserId ?? ""].filter(Boolean) : Object.keys(summary?.members ?? {}).filter((userId) => userId !== own && summary?.members[userId]?.membership === "join");
};

export const ringingRooms = writable<Record<RoomId, boolean>>({});
const ringEvents = new Map<RoomId, { ids: string[]; timer: ReturnType<typeof setTimeout> }>();
const setRinging = (roomId: RoomId, on: boolean) => ringingRooms.update((all) => ({ ...all, [roomId]: on }));

export const stopRingRoom = (roomId: RoomId) => {
  const entry = ringEvents.get(roomId);
  ringEvents.delete(roomId);
  setRinging(roomId, false);
  clearTimeout(entry?.timer);
  return Promise.allSettled((entry?.ids ?? []).map((eventId) => redactRoomEvent(eventId, roomId)));
};

export const ringRoom = (roomId: RoomId) => {
  const users = ringTargets(roomId);
  const direct = !!get(rooms)[roomId]?.isDirect;
  const mentions = { user_ids: users, room: !direct };
  const now = Date.now();
  clearTimeout(ringEvents.get(roomId)?.timer);
  const entry = { ids: [] as string[], timer: setTimeout(() => ringEvents.get(roomId) === entry && (ringEvents.delete(roomId), setRinging(roomId, false)), 30000) };
  ringEvents.set(roomId, entry);
  setRinging(roomId, true);
  return Promise.allSettled([
    sendRoomEvent(NOTIFY_TYPES[1], { application: "m.call", call_id: "", notify_type: "ring", "m.mentions": mentions }, roomId),
    sendRoomEvent(NOTIFY_TYPES[0], { notification_type: "ring", sender_ts: now, lifetime: 30000, "m.mentions": mentions }, roomId),
  ]).then((results) => (entry.ids = results.flatMap((result) => (result.status === "fulfilled" && typeof result.value === "string" ? [result.value] : []))));
};

const waitOnline = () => (navigator.onLine ? Promise.resolve() : (vlog("rejoin waiting for network"), new Promise((done) => (addEventListener("online", done, { once: true }), setTimeout(done, 60000)))));

let rejoining: Live | null = null;

const rejoin = async (current: Live, attempt = 0): Promise<void> => {
  if (!attempt && rejoining === current) return void vlog("rejoin already running");
  rejoining = current;
  const saved = get(voice);
  const direct = !!get(rooms)[current.roomId]?.isDirect;
  const others = (get(callMembers)[current.roomId] ?? []).some((member) => member.userId !== get(session)?.userId);
  vlog(`rejoin attempt ${attempt + 1}`, { direct, others, online: navigator.onLine });
  if (!saved) return void vlog("rejoin skipped, call was left");
  if ((direct && !others) || attempt > 5) return (vlog(direct && !others ? "rejoin skipped, nobody else in the DM call" : "rejoin gave up"), disconnect());
  patch({ status: "reconnecting" });
  await waitOnline();
  if (!get(voice)) return void vlog("rejoin stopped, call was left");
  await joinVoice(current.roomId, saved.startedAt).catch((error) => vlog("rejoin join threw", error));
  if (live && live !== current && get(voice)?.status === "connected") return void vlog("rejoined");
  live === current && (await disconnect());
  voice.set({ ...saved, status: "reconnecting" });
  await new Promise((done) => setTimeout(done, 2000 * 2 ** attempt));
  return get(voice)?.status === "reconnecting" && !live ? rejoin(current, attempt + 1) : vlog("rejoin stopped, call was left or rejoined elsewhere");
};

const resumeAudio = (room: LiveKitRoom, why: string) =>
  (room as { startAudio?: () => Promise<void> }).startAudio?.().then(
    () => vlog(`audio resumed (${why})`, { playback: room.canPlaybackAudio }),
    (error) => vlog(`audio resume failed (${why})`, error),
  );

const watchElement = (element: HTMLMediaElement, label: string) => {
  ["pause", "stalled", "suspend", "emptied", "ended", "error"].forEach((name) => element.addEventListener(name, () => vlog(`audio element ${name}`, label, { paused: element.paused, ready: element.readyState })));
  element.addEventListener("playing", () => vlog("audio element playing", label));
  return element;
};

onWake((why) => {
  const current = live;
  vlog(`wake: ${why}`, { inCall: !!current, status: get(voice)?.status ?? "none" });
  if (!current) return;
  current.links.forEach((link) => resumeAudio(link.room, why));
  restartLeave(current);
  const main = publishLink();
  why !== "devices" && main && (main.room as { state?: string }).state === "disconnected" && (vlog("main link dead after wake, rejoining"), rejoin(current));
});

export const joinVoice = async (roomId: RoomId, startedAt = Date.now()) => {
  const active = get(session);
  const summary = get(rooms)[roomId];
  vlog("join voice", roomId);
  const focus = await voiceFocus(roomId);
  if (!active || !summary) return void vlog("join skipped, no session or room");
  if (!focus) return voiceError.set("no_focus");
  get(voice) && (await disconnect());
  voiceError.set(null);
  incomingCall.set(null);
  micBlocked.set(false);
  const encrypted = !!summary.encryption;
  voice.set({ kind: "rtc", roomId, status: "connecting", quality: "unknown", encrypted, startedAt });
  const current: Live = { roomId, encrypted, focus, links: new Map(), keyIndex: 0, key: crypto.getRandomValues(new Uint8Array(16)), received: new Map(), known: new Set(), timers: [], delayId: null, stop: [], publishedAt: 0, createdTs: Date.now(), healing: false, failures: 0, retryAt: 0 };
  live = current;
  try {
    const ownHash = await hashIdentity(active.userId, ownLegacy());
    identityHashes.update((hashes) => ({ ...hashes, [hashKey(active.userId, ownLegacy())]: ownHash }));
    const link = await openLink(current, focus, true);
    await link.room.localParticipant.setMicrophoneEnabled(micOpen()).catch((error) => (console.warn("Skye could not open the microphone", error), blockMic()));
    live === current && (patch({ status: "connected" }), vlog("joined"));
    current.stop.push(watchMembers(current));
    clearStaleSelf(current.roomId);
    await keepMembership(current);
    sendKey(current);
  } catch (error) {
    console.warn("Skye could not join voice", error);
    vlog("join failed", error);
    live === current && voiceError.set((error as Error)?.message === "sfu_failed" ? "sfu_failed" : "join_failed");
    live === current && (await disconnect());
  }
};

native &&
  (import("@tauri-apps/api/event").then(({ listen }) => listen<{ held: boolean }>("ptt", ({ payload }) => get(voicePrefs).pushToTalk && get(voice) && pttHeld.set(payload.held))),
  voicePrefs.subscribe((prefs) => import("@tauri-apps/api/core").then(({ invoke }) => invoke("ptt_bind", { code: prefs.pushToTalk ? prefs.pttKey : "" }).catch(() => undefined))));

native &&
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen("skye:quit", () => (dispatchEvent(new Event("pagehide")), disconnect()).finally(() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("leave")))),
  );

const clearStaleSelf = (roomId: RoomId) => {
  const active = get(session);
  const own = active && stateKeyOf(active);
  callMemberships(get(rooms)[roomId], Object.values(get(stickyMembers)[roomId] ?? {}))
    .filter((member) => active && member.userId === active.userId && member.kind === "session" && member.deviceId === active.deviceId && member.stateKey !== own && member.stateKey.startsWith(`_${active.userId}_`))
    .forEach((member) => clearMembership(active!, roomId, member.stateKey).catch(() => undefined));
};

export const disconnect = async () => {
  const current = live;
  current && vlog("leaving call", new Error().stack?.split("\n")[2]?.trim() ?? "");
  const active = get(session);
  live = null;
  voice.update((state) => (state?.kind === "rtc" ? null : state));
  speaking.set(new Set());
  callMedia.set([]);
  cameraOn.set(false);
  screenOn.set(false);
  pttHeld.set(false);
  if (!current || !active) return;
  current.timers.forEach(clearInterval);
  current.stop.forEach((stop) => stop());
  await Promise.allSettled([...current.links.values()].map((link) => link.room.disconnect()));
  current.links.clear();
  const delayId = current.delayId;
  current.delayId = null;
  await (delayId ? updateDelayed(active, delayId, "send") : Promise.reject())
    .catch(() => (delayId && updateDelayed(active, delayId, "cancel").catch(() => undefined), putMembership(active, current.roomId, {})))
    .catch((error) => (console.warn("Skye could not leave the call cleanly", error), vlog("leave not clean", error)));
};
