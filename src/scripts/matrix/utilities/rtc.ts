import { baseURL } from "../../api/client";
import { getServerVersions, getWellKnown, serverNameFromUserId } from "../discovery";
import { sessionRequest } from "../session";
import type { RoomId, RoomSummary, Session, StateEvent, UserId } from "../types";
import { CALL_MEMBER } from "./content";

export const MEMBER_TYPE = CALL_MEMBER[0];
export const KEYS_TYPE = "io.element.call.encryption_keys";
export const NOTIFY_TYPES = ["org.matrix.msc4075.rtc.notification", "org.matrix.msc4075.call.notify", "m.call.notify"];
export const CALL_ROOM_TYPES = ["org.matrix.msc3417.call", "m.call", "io.element.call"];
export const MEMBERSHIP_LIFETIME = 4 * 60 * 60 * 1000;
export const DELAY_MS = 20000;

export type LiveKitFocus = { type: "livekit"; livekit_service_url: string; livekit_alias?: string };

export type CallMembership = {
  userId: UserId;
  deviceId: string;
  stateKey: string;
  createdTs: number;
  expiresAt: number;
  foci: LiveKitFocus[];
};

export type SfuGrant = { url: string; jwt: string };

const livekitOnly = (foci: unknown): LiveKitFocus[] =>
  (Array.isArray(foci) ? foci : []).filter((focus) => focus?.type === "livekit" && typeof focus.livekit_service_url === "string");

const fociCache = new Map<string, Promise<LiveKitFocus[]>>();

export const homeserverFoci = (session: Session) => {
  const server = serverNameFromUserId(session.userId);
  const cached = fociCache.get(server) ?? getWellKnown(server).then((known) => livekitOnly(known?.["org.matrix.msc4143.rtc_foci"]), () => []);
  fociCache.set(server, cached);
  return cached;
};

const delayedSupport = new Map<string, Promise<boolean>>();

export const supportsDelayedEvents = (session: Session) => {
  const cached =
    delayedSupport.get(session.homeserver) ??
    getServerVersions(session.homeserver).then((versions) => !!versions.unstable_features?.["org.matrix.msc4140"], () => false);
  delayedSupport.set(session.homeserver, cached);
  return cached;
};

const toMembership = (event: StateEvent): CallMembership | null => {
  const content = event.content ?? {};
  const deviceId = content.device_id as string | undefined;
  const createdTs = (content.created_ts as number | undefined) ?? event.origin_server_ts ?? 0;
  const live = content.application === "m.call" && !!deviceId && Date.now() < createdTs + ((content.expires as number | undefined) ?? MEMBERSHIP_LIFETIME);
  return live
    ? {
        userId: event.sender ?? "",
        deviceId: deviceId!,
        stateKey: event.state_key ?? "",
        createdTs,
        expiresAt: createdTs + ((content.expires as number | undefined) ?? MEMBERSHIP_LIFETIME),
        foci: livekitOnly(content.foci_preferred),
      }
    : null;
};

export const callMemberships = (room: RoomSummary | undefined) =>
  CALL_MEMBER.flatMap((type) => Object.values(room?.state[type] ?? {}))
    .map(toMembership)
    .filter((membership): membership is CallMembership => !!membership && room?.members[membership.userId]?.membership !== "leave")
    .sort((a, b) => a.createdTs - b.createdTs);

export const isCallRoom = (room: RoomSummary | undefined) =>
  CALL_ROOM_TYPES.includes(room?.roomType ?? room?.state["m.room.create"]?.[""]?.content?.type ?? "") || !!room?.state["io.element.call"];

export const pickFocus = (memberships: CallMembership[], fallback: LiveKitFocus[]) =>
  memberships.find((membership) => membership.foci.length)?.foci[0] ?? fallback[0];

export const identityOf = (userId: UserId, deviceId: string) => `${userId}:${deviceId}`;

export const stateKeyOf = (session: Session) => `_${session.userId}_${session.deviceId}`;

export const membershipContent = (session: Session, focus: LiveKitFocus, roomId: RoomId) => ({
  application: "m.call",
  call_id: "",
  scope: "m.room",
  device_id: session.deviceId,
  expires: MEMBERSHIP_LIFETIME,
  focus_active: { type: "livekit", focus_selection: "oldest_membership" },
  foci_preferred: [{ type: "livekit", livekit_service_url: focus.livekit_service_url, livekit_alias: focus.livekit_alias ?? roomId }],
  "m.call.intent": "audio",
});

const stateEndpoint = (session: Session, roomId: RoomId) =>
  `rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(MEMBER_TYPE)}/${encodeURIComponent(stateKeyOf(session))}`;

export const putMembership = (session: Session, roomId: RoomId, content: Record<string, unknown>) =>
  sessionRequest(session, { endpoint: stateEndpoint(session, roomId), method: "PUT", body: content });

export const scheduleLeave = (session: Session, roomId: RoomId) =>
  sessionRequest<{ delay_id: string }>(session, {
    endpoint: stateEndpoint(session, roomId),
    method: "PUT",
    query: { "org.matrix.msc4140.delay": DELAY_MS },
    body: {},
  }).then((response) => response.delay_id);

export const updateDelayed = (session: Session, delayId: string, action: "restart" | "send" | "cancel") =>
  sessionRequest(session, {
    base: `${session.homeserver}/_matrix/client/unstable/org.matrix.msc4140/`,
    endpoint: `delayed_events/${encodeURIComponent(delayId)}`,
    method: "POST",
    body: { action },
  });

export const leaveOnUnload = (session: Session, roomId: RoomId) =>
  fetch(`${baseURL.MATRIX(session.homeserver)}${stateEndpoint(session, roomId)}`, {
    method: "PUT",
    keepalive: true,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => undefined);

export const requestOpenId = (session: Session) =>
  sessionRequest<Record<string, unknown>>(session, {
    endpoint: `user/${encodeURIComponent(session.userId)}/openid/request_token`,
    method: "POST",
    body: {},
  });

export const requestSfu = async (session: Session, focus: LiveKitFocus, roomId: RoomId): Promise<SfuGrant> => {
  const openid = await requestOpenId(session);
  const response = await fetch(`${focus.livekit_service_url.replace(/\/+$/, "")}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: focus.livekit_alias ?? roomId, openid_token: openid, device_id: session.deviceId }),
  });
  const body = await response.json().catch(() => ({}));
  return response.ok && body.url && body.jwt ? { url: body.url, jwt: body.jwt } : Promise.reject(new Error("sfu_failed"));
};

export type TurnServer = { uris?: string[]; username?: string; password?: string; ttl?: number };

export const turnServers = (session: Session): Promise<RTCIceServer[]> =>
  sessionRequest<TurnServer>(session, { endpoint: "voip/turnServer", method: "GET" }).then(
    (turn) => (turn.uris?.length ? [{ urls: turn.uris, username: turn.username, credential: turn.password }] : []),
    () => [],
  );

export const encodeKey = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");

export const decodeKey = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
