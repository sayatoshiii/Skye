import type { Room as LiveKitRoom, RemoteTrack, Participant } from "livekit-client";
import { derived, get, readable, writable } from "svelte/store";
import type { MatrixEvent, RoomId, SyncResponse, UserId } from "../matrix/types";
import {
  callMemberships,
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
  requestSfu,
  scheduleLeave,
  supportsDelayedEvents,
  updateDelayed,
  type CallMembership,
} from "../matrix/utilities/rtc";
import { decryptPreview, redactRoomEvent, registerLiveSyncHook, rooms, sendRoomEvent, session } from "./matrix";
import { toast, toastKey } from "./toast";
import { getLocalisedText } from "../accessibility/language/translation";

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

export type VoicePrefs = { input: string; output: string; pushToTalk: boolean; pttKey: string; pttLabel: string };

export type IncomingCall = { roomId: RoomId; kind: VoiceKind; callerId: UserId; callId?: string };

const PREFS_KEY = "skye:voice";
const DEFAULT_PREFS: VoicePrefs = { input: "default", output: "default", pushToTalk: false, pttKey: "KeyV", pttLabel: "V" };

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

export const callMembers = derived([rooms, tick], ([$rooms]) =>
  Object.fromEntries(
    Object.values($rooms)
      .filter((room) => room.membership === "join")
      .map((room) => [room.roomId, callMemberships(room)] as const)
      .filter(([, list]) => list.length),
  ) as Record<RoomId, CallMembership[]>,
);

export const joinable = derived(rooms, ($rooms) => new Set(Object.values($rooms).filter(isCallRoom).map((room) => room.roomId)));

export const listDevices = async (kind: MediaDeviceKind) =>
  (await navigator.mediaDevices?.enumerateDevices?.().catch(() => []))?.filter((device) => device.kind === kind) ?? [];

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

type Live = {
  room: LiveKitRoom;
  roomId: RoomId;
  keys: KeyProvider | null;
  keyIndex: number;
  key: Uint8Array;
  known: Set<string>;
  timers: ReturnType<typeof setInterval>[];
  delayId: string | null;
  audio: Map<string, HTMLMediaElement>;
  stop: (() => void)[];
};

type KeyProvider = { setParticipantKey: (identity: string, index: number, key: Uint8Array) => Promise<void> };

let live: Live | null = null;

const ownIdentity = () => {
  const active = get(session);
  return active ? identityOf(active.userId, active.deviceId) : "";
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

const sendKey = (current: Live) => {
  const active = get(session);
  return active && current.keys
    ? sendRoomEvent(KEYS_TYPE, { keys: [{ index: current.keyIndex, key: encodeKey(current.key) }], device_id: active.deviceId, call_id: "", sent_ts: Date.now() }, current.roomId)
    : undefined;
};

const rotateKey = (current: Live) => {
  current.key = crypto.getRandomValues(new Uint8Array(16));
  current.keyIndex = (current.keyIndex + 1) % 256;
  const index = current.keyIndex;
  const key = current.key;
  sendKey(current);
  setTimeout(() => live === current && current.keys?.setParticipantKey(ownIdentity(), index, key), 1000);
};

registerCallEventHook((roomId, event) => {
  const current = live;
  const active = get(session);
  const own = event.sender === active?.userId && event.content?.device_id === active?.deviceId;
  current?.roomId === roomId &&
    event.type === KEYS_TYPE &&
    !own &&
    (event.content?.keys ?? []).forEach((entry: { index?: number; key?: string }) =>
      current.keys?.setParticipantKey(identityOf(event.sender ?? "", event.content?.device_id ?? ""), entry.index ?? 0, decodeKey(entry.key ?? "")),
    );
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

const micOpen = () => !get(muted) && !get(deafened) && (!get(voicePrefs).pushToTalk || get(pttHeld));

type MicHook = (open: boolean) => void;
const micHooks = new Set<MicHook>();
export const registerMicHook = (hook: MicHook) => void micHooks.add(hook);

const applyMic = () => {
  const open = micOpen();
  live?.room.localParticipant.setMicrophoneEnabled(open).then(() => open && micBlocked.set(false), () => open && blockMic());
  micHooks.forEach((hook) => hook(open));
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

export const switchDevice = (kind: "audioinput" | "audiooutput", deviceId: string) => {
  voicePrefs.update((prefs) => ({ ...prefs, [kind === "audioinput" ? "input" : "output"]: deviceId }));
  live?.room.switchActiveDevice(kind, deviceId).catch(() => undefined);
  micHooks.forEach((hook) => hook(micOpen()));
};

export const toggleMute = () => (get(deafened) ? (deafened.set(false), muted.set(false)) : muted.update((value) => !value));
export const toggleDeafen = () => deafened.update((value) => !value);

const trackSpeakers = (speakers: Participant[]) => speaking.set(new Set(speakers.map((participant) => participant.identity)));

const keepMembership = async (current: Live, focus: Parameters<typeof membershipContent>[1]) => {
  const active = get(session)!;
  const delayed = await supportsDelayedEvents(active);
  current.delayId = delayed ? await scheduleLeave(active, current.roomId).catch(() => null) : null;
  await putMembership(active, current.roomId, membershipContent(active, focus, current.roomId));
  current.timers.push(
    setInterval(() => current.delayId && updateDelayed(active, current.delayId, "restart").catch(() => undefined), 8000),
    setInterval(() => putMembership(active, current.roomId, membershipContent(active, focus, current.roomId)).catch(() => undefined), MEMBERSHIP_LIFETIME - 10 * 60 * 1000),
  );
};

const watchMembers = (current: Live) =>
  callMembers.subscribe((all) => {
    const identities = new Set((all[current.roomId] ?? []).map((member) => identityOf(member.userId, member.deviceId)));
    const joined = [...identities].some((identity) => !current.known.has(identity));
    const left = [...current.known].some((identity) => !identities.has(identity));
    current.known = identities;
    current.keys && left && rotateKey(current);
    current.keys && joined && !left && sendKey(current);
  });

export const voiceFocus = async (roomId: RoomId) => {
  const active = get(session);
  return active ? pickFocus(callMemberships(get(rooms)[roomId]), await homeserverFoci(active)) : undefined;
};

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

export const joinVoice = async (roomId: RoomId) => {
  const active = get(session);
  const summary = get(rooms)[roomId];
  const focus = await voiceFocus(roomId);
  if (!active || !summary) return;
  if (!focus) return voiceError.set("no_focus");
  get(voice) && (await disconnect());
  voiceError.set(null);
  incomingCall.set(null);
  micBlocked.set(false);
  const encrypted = !!summary.encryption;
  voice.set({ kind: "rtc", roomId, status: "connecting", quality: "unknown", encrypted, startedAt: Date.now() });
  try {
    const kit = await import("livekit-client");
    const keys = encrypted ? await createKeyProvider() : null;
    const worker = keys ? new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" }) : undefined;
    const prefs = get(voicePrefs);
    const room = new kit.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: prefs.input === "default" ? undefined : prefs.input, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      audioOutput: { deviceId: prefs.output === "default" ? undefined : prefs.output },
      e2ee: keys && worker ? { keyProvider: keys.provider as InstanceType<typeof kit.BaseKeyProvider>, worker } : undefined,
    });
    const current: Live = { room, roomId, keys, keyIndex: 0, key: crypto.getRandomValues(new Uint8Array(16)), known: new Set(), timers: [], delayId: null, audio: new Map(), stop: [] };
    live = current;
    const grant = await requestSfu(active, focus, roomId);
    room
      .on(kit.RoomEvent.ActiveSpeakersChanged, trackSpeakers)
      .on(kit.RoomEvent.ConnectionQualityChanged, (quality, participant) => participant.isLocal && patch({ quality: QUALITY[quality] ?? "unknown" }))
      .on(kit.RoomEvent.Reconnecting, () => patch({ status: "reconnecting" }))
      .on(kit.RoomEvent.Reconnected, () => patch({ status: "connected" }))
      .on(kit.RoomEvent.Disconnected, () => live === current && disconnect())
      .on(kit.RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
        const element = track.kind === "audio" ? track.attach() : null;
        element && (applyOutput(element), audioElements.add(element), current.audio.set(`${participant.identity}:${track.sid}`, element));
      })
      .on(kit.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((element) => (audioElements.delete(element), element.remove())));
    keys && (await keys.setParticipantKey(ownIdentity(), 0, current.key));
    await room.connect(grant.url, grant.jwt);
    keys && (await room.setE2EEEnabled(true));
    await room.localParticipant.setMicrophoneEnabled(micOpen()).catch((error) => (console.warn("Skye could not open the microphone", error), blockMic()));
    live === current && patch({ status: "connected" });
    current.stop.push(watchMembers(current));
    await keepMembership(current, focus);
    sendKey(current);
  } catch (error) {
    console.warn("Skye could not join voice", error);
    voiceError.set((error as Error)?.message === "sfu_failed" ? "sfu_failed" : "join_failed");
    await disconnect();
  }
};

export const disconnect = async () => {
  const current = live;
  const active = get(session);
  live = null;
  voice.update((state) => (state?.kind === "rtc" ? null : state));
  speaking.set(new Set());
  pttHeld.set(false);
  if (!current || !active) return;
  current.timers.forEach(clearInterval);
  current.stop.forEach((stop) => stop());
  current.audio.forEach((element) => (audioElements.delete(element), element.remove()));
  await current.room.disconnect().catch(() => undefined);
  await (current.delayId ? updateDelayed(active, current.delayId, "send") : Promise.reject()).catch(() => putMembership(active, current.roomId, {})).catch(() => undefined);
};

