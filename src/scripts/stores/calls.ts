import { get, writable } from "svelte/store";
import type { MatrixEvent, RoomId } from "../matrix/types";
import { NOTIFY_TYPES, turnServers } from "../matrix/utilities/rtc";
import { rooms, sendRoomEvent, session } from "./matrix";
import { applyOutput, audioElements, blockMic, callMembers, disconnect, incomingCall, joinVoice, micBlocked, registerCallEventHook, registerMicHook, ringRoom, stopRingRoom, voice, voiceFocus, voicePrefs, captureOf } from "./voice";

type Legacy = {
  roomId: RoomId;
  callId: string;
  partyId: string;
  peer: RTCPeerConnection;
  stream: MediaStream | null;
  remote: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  outbox: RTCIceCandidateInit[];
  flush: ReturnType<typeof setTimeout> | null;
  opponent: string | null;
  timeout: ReturnType<typeof setTimeout> | null;
};

const LIFETIME = 60000;

export const ringing = writable<"in" | "out" | null>(null);

let call: Legacy | null = null;
let offer: { roomId: RoomId; callId: string; partyId: string; sdp: RTCSessionDescriptionInit; expires: number } | null = null;

const newId = () => crypto.randomUUID().replace(/-/g, "");

const base = (current: Pick<Legacy, "callId" | "partyId">) => ({ call_id: current.callId, party_id: current.partyId, version: "1" });

let tone: { context: AudioContext; stop: () => void } | null = null;

const PATTERNS = { in: { period: 4, length: 2, level: 0.08 }, out: { period: 6, length: 1.6, level: 0.05 } } as const;

const playTone = (kind: "in" | "out") => {
  stopTone();
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  const { period, length, level } = PATTERNS[kind];
  const oscillators = [440, 480].map((frequency) => {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start();
    return oscillator;
  });
  const schedule = (from: number) =>
    Array.from({ length: 10 }).forEach((_, index) => {
      const at = from + index * period;
      gain.gain.setTargetAtTime(level, at, 0.02);
      gain.gain.setTargetAtTime(0, at + length, 0.02);
    });
  schedule(context.currentTime + 0.05);
  const loop = setInterval(() => schedule(context.currentTime), period * 10 * 1000);
  tone = {
    context,
    stop: () => (clearInterval(loop), oscillators.forEach((oscillator) => oscillator.stop()), context.close().catch(() => undefined)),
  };
};

const stopTone = () => (tone?.stop(), (tone = null));

ringing.subscribe((kind) => (kind ? playTone(kind) : stopTone()));

const audioSender = (peer: RTCPeerConnection) => peer.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "audio")?.sender;

const openStream = (current: Legacy) =>
  capture().then(
    (stream) => (
      (current.stream = stream),
      micBlocked.set(false),
      audioSender(current.peer)?.replaceTrack(stream.getAudioTracks()[0] ?? null).catch(() => undefined),
      stream
    ),
    () => (blockMic(), null),
  );

registerMicHook((open) => call && (open && !call.stream ? openStream(call) : call.stream?.getAudioTracks().forEach((track) => (track.enabled = open))));

const send = (type: string, content: Record<string, unknown>, roomId: RoomId) => sendRoomEvent(type, content, roomId);

const capture = () => navigator.mediaDevices.getUserMedia({ audio: captureOf(get(voicePrefs), true) });

const setup = async (roomId: RoomId, callId: string) => {
  const active = get(session)!;
  const peer = new RTCPeerConnection({ iceServers: await turnServers(active) });
  const remote = new Audio();
  remote.autoplay = true;
  applyOutput(remote);
  audioElements.add(remote);
  const current: Legacy = { roomId, callId, partyId: active.deviceId, peer, stream: null, remote, pending: [], outbox: [], flush: null, opponent: null, timeout: null };
  peer.ontrack = (event) => (remote.srcObject = event.streams[0] ?? new MediaStream([event.track]));
  peer.onicecandidate = (event) => {
    event.candidate && current.outbox.push(event.candidate.toJSON());
    current.flush ??= setTimeout(() => {
      const candidates = current.outbox.splice(0);
      current.flush = null;
      candidates.length && call === current && send("m.call.candidates", { ...base(current), candidates }, roomId);
    }, 300);
  };
  peer.onconnectionstatechange = () =>
    ({
      connected: () => voice.update((state) => state && { ...state, status: "connected", quality: "good" }),
      disconnected: () => voice.update((state) => state && { ...state, status: "reconnecting", quality: "poor" }),
      failed: () => hangup("ice_failed"),
    })[peer.connectionState as "connected"]?.();
  current.stream = await capture().then(
    (stream) => (micBlocked.set(false), stream),
    () => (blockMic(), null),
  );
  current.stream?.getTracks().forEach((track) => peer.addTrack(track, current.stream!));
  call = current;
  return current;
};

const teardown = () => {
  const current = call;
  call = null;
  ringing.set(null);
  voice.update((state) => (state?.kind === "legacy" ? null : state));
  current && (clearTimeout(current.timeout ?? undefined), current.stream?.getTracks().forEach((track) => track.stop()), current.peer.close(), audioElements.delete(current.remote), (current.remote.srcObject = null));
};

export const placeCall = async (roomId: RoomId) => {
  const members = get(callMembers)[roomId] ?? [];
  const focus = await voiceFocus(roomId);
  if (members.length || focus) return members.length ? joinVoice(roomId) : (await joinVoice(roomId), get(voice)?.roomId === roomId && ringRoom(roomId));
  await disconnect();
  const current = await setup(roomId, newId());
  voice.set({ kind: "legacy", roomId, status: "ringing", quality: "unknown", encrypted: !!get(rooms)[roomId]?.encryption, startedAt: Date.now() });
  ringing.set("out");
  current.stream || current.peer.addTransceiver("audio", { direction: "sendrecv" });
  const description = await current.peer.createOffer();
  await current.peer.setLocalDescription(description);
  current.timeout = setTimeout(() => call === current && current.opponent === null && hangup("invite_timeout"), LIFETIME);
  await send("m.call.invite", { ...base(current), lifetime: LIFETIME, offer: { type: description.type, sdp: description.sdp } }, roomId);
};

export const answerCall = async () => {
  const incoming = get(incomingCall);
  incomingCall.set(null);
  ringing.set(null);
  if (!incoming) return;
  if (incoming.kind === "rtc" || !offer || offer.callId !== incoming.callId) return joinVoice(incoming.roomId);
  const pending = offer;
  offer = null;
  await disconnect();
  const current = await setup(pending.roomId, pending.callId);
  current.opponent = pending.partyId;
  voice.set({ kind: "legacy", roomId: pending.roomId, status: "connecting", quality: "unknown", encrypted: !!get(rooms)[pending.roomId]?.encryption, startedAt: Date.now() });
  await current.peer.setRemoteDescription(pending.sdp);
  current.stream || current.peer.getTransceivers().forEach((transceiver) => (transceiver.direction = "sendrecv"));
  const answer = await current.peer.createAnswer();
  await current.peer.setLocalDescription(answer);
  await send("m.call.answer", { ...base(current), answer: { type: answer.type, sdp: answer.sdp } }, pending.roomId);
  current.pending.splice(0).forEach((candidate) => current.peer.addIceCandidate(candidate).catch(() => undefined));
};

export const declineCall = () => {
  const incoming = get(incomingCall);
  const pending = offer;
  incomingCall.set(null);
  ringing.set(null);
  offer = null;
  const active = get(session);
  incoming?.kind === "legacy" && pending && active && send("m.call.reject", { call_id: pending.callId, party_id: active.deviceId, version: "1" }, pending.roomId);
};

export const hangup = (reason = "user_hangup") => {
  const current = call;
  teardown();
  current && send("m.call.hangup", { ...base(current), reason }, current.roomId);
};

const fromOther = (event: MatrixEvent) => event.sender !== get(session)?.userId || event.content?.party_id !== get(session)?.deviceId;

const handlers: Record<string, (roomId: RoomId, event: MatrixEvent) => unknown> = {
  "m.call.invite": (roomId, event) => {
    const fresh = (event.unsigned?.age ?? Date.now() - (event.origin_server_ts ?? 0)) < (event.content?.lifetime ?? LIFETIME);
    const mine = event.sender === get(session)?.userId;
    fresh && !mine && !call && !get(voice) && event.content?.offer &&
      ((offer = { roomId, callId: event.content.call_id, partyId: event.content.party_id, sdp: event.content.offer, expires: Date.now() + (event.content.lifetime ?? LIFETIME) }),
      incomingCall.set({ roomId, kind: "legacy", callerId: event.sender ?? "", callId: event.content.call_id }),
      ringing.set("in"),
      setTimeout(() => offer?.callId === event.content?.call_id && (get(incomingCall)?.callId === event.content?.call_id && incomingCall.set(null), ringing.set(null), (offer = null)), event.content.lifetime ?? LIFETIME));
  },
  "m.call.answer": async (_roomId, event) => {
    const current = call;
    if (!current || current.opponent || !fromOther(event)) return;
    current.opponent = event.content?.party_id ?? "";
    ringing.set(null);
    voice.update((state) => state && { ...state, status: "connecting" });
    await current.peer.setRemoteDescription(event.content?.answer);
    current.pending.splice(0).forEach((candidate) => current.peer.addIceCandidate(candidate).catch(() => undefined));
    send("m.call.select_answer", { ...base(current), selected_party_id: current.opponent }, current.roomId);
  },
  "m.call.candidates": (_roomId, event) => {
    const current = call;
    const candidates: RTCIceCandidateInit[] = event.content?.candidates ?? [];
    current && fromOther(event) &&
      (current.peer.remoteDescription ? candidates.forEach((candidate) => current.peer.addIceCandidate(candidate).catch(() => undefined)) : current.pending.push(...candidates));
  },
  "m.call.hangup": (_roomId, event) => {
    offer?.callId === event.content?.call_id && (incomingCall.set(null), ringing.set(null), (offer = null));
    fromOther(event) && teardown();
  },
  "m.call.reject": (_roomId, event) => fromOther(event) && teardown(),
  "m.call.select_answer": (_roomId, event) => event.content?.selected_party_id !== get(session)?.deviceId && fromOther(event) && teardown(),
  "m.call.negotiate": async (_roomId, event) => {
    const current = call;
    const description: RTCSessionDescriptionInit | undefined = event.content?.description;
    if (!current || !description || !fromOther(event)) return;
    await current.peer.setRemoteDescription(description);
    const answer = description.type === "offer" ? await current.peer.createAnswer() : null;
    answer && (await current.peer.setLocalDescription(answer), send("m.call.negotiate", { ...base(current), lifetime: LIFETIME, description: { type: answer.type, sdp: answer.sdp } }, current.roomId));
  },
};

const ringHandler = (roomId: RoomId, event: MatrixEvent) => {
  const fresh = Date.now() - (event.origin_server_ts ?? 0) < LIFETIME;
  const mine = event.sender === get(session)?.userId;
  const ring = (event.content?.notify_type ?? event.content?.notification_type) === "ring";
  fresh && !mine && ring && !get(voice) && !get(incomingCall) && (incomingCall.set({ roomId, kind: "rtc", callerId: event.sender ?? "" }), ringing.set("in"), setTimeout(() => get(incomingCall)?.roomId === roomId && get(incomingCall)?.kind === "rtc" && (incomingCall.set(null), ringing.set(null)), LIFETIME));
};

NOTIFY_TYPES.forEach((type) => (handlers[type] = ringHandler));

registerCallEventHook((roomId, event) => {
  const run = handlers[event.type];
  const own = event.content?.call_id === call?.callId || event.type === "m.call.invite" || NOTIFY_TYPES.includes(event.type) || event.content?.call_id === offer?.callId;
  return own && run && Promise.resolve(run(roomId, event)).catch((error) => console.warn("Skye could not handle a call event", error));
});

export const ringAgain = (roomId: RoomId) => {
  const current = call;
  return current?.roomId === roomId && !current.opponent
    ? current.peer.localDescription &&
        (clearTimeout(current.timeout ?? undefined),
        (current.timeout = setTimeout(() => call === current && current.opponent === null && hangup("invite_timeout"), LIFETIME)),
        ringing.set("out"),
        send("m.call.invite", { ...base(current), lifetime: LIFETIME, offer: { type: current.peer.localDescription.type, sdp: current.peer.localDescription.sdp } }, roomId))
    : ringRoom(roomId);
};

export const stopRinging = (roomId: RoomId) => (call?.roomId === roomId && !call.opponent ? hangup() : stopRingRoom(roomId));

export const leaveCall = () => (get(voice)?.kind === "legacy" ? hangup() : disconnect());
