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

export const RTC_MEMBER_TYPE = "org.matrix.msc4143.rtc.member";
export const SLOT_ID = "m.call#ROOM";
export const STICKY_MAX = 60 * 60 * 1000;

export type LiveKitFocus = { type: string; livekit_service_url?: string; livekit_alias?: string; url?: string; server_name?: string };

export type CallMembership = {
  userId: UserId;
  deviceId: string;
  memberId: string;
  stateKey: string;
  createdTs: number;
  expiresAt: number;
  foci: LiveKitFocus[];
  selection: string;
  kind: "session" | "rtc";
};

export type SfuGrant = { url: string; jwt: string };

export type StickyEvent = StateEvent & { until: number };

const isLivekit = (focus: LiveKitFocus | undefined): focus is LiveKitFocus =>
  !!focus && ["livekit", "m.livekit"].includes(focus.type) && (typeof focus.url === "string" || typeof focus.livekit_service_url === "string");

const livekitOnly = (foci: unknown): LiveKitFocus[] => (Array.isArray(foci) ? foci : []).filter(isLivekit);

export const selectTransport = (foci: LiveKitFocus[]) => foci.find((focus) => focus.type === "m.livekit") ?? foci[0];

export const transportKey = (focus: LiveKitFocus) => [focus.url ?? "", focus.livekit_service_url ?? "", focus.livekit_alias ?? ""].join("|");

const fociCache = new Map<string, Promise<LiveKitFocus[]>>();

const transportsEndpoint = (session: Session, prefix: string) =>
  sessionRequest<{ transports?: unknown; rtc_transports?: unknown }>(session, { base: `${session.homeserver}/_matrix/client/${prefix}/`, endpoint: "rtc/transports", method: "GET" }).then(
    (body) => livekitOnly(body.transports ?? body.rtc_transports),
    () => [] as LiveKitFocus[],
  );

export const homeserverFoci = (session: Session) => {
  const server = serverNameFromUserId(session.userId);
  const cached =
    fociCache.get(server) ??
    Promise.all([
      transportsEndpoint(session, "v1"),
      transportsEndpoint(session, "unstable/org.matrix.msc4143"),
      getWellKnown(server).then((known) => livekitOnly(known?.["org.matrix.msc4143.rtc_foci"]), () => []),
    ]).then((lists) => lists.flat());
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

const tokenPrefix = new Map<string, Promise<string>>();

const getTokenPrefix = (session: Session) => {
  const cached =
    tokenPrefix.get(session.homeserver) ??
    getServerVersions(session.homeserver).then(
      (versions) => (versions.unstable_features?.["org.matrix.msc4195.stable"] ? "v1" : "unstable/io.element.msc4195"),
      () => "unstable/io.element.msc4195",
    );
  tokenPrefix.set(session.homeserver, cached);
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
        memberId: (content.membershipID as string | undefined) ?? `${event.sender}:${deviceId}`,
        stateKey: event.state_key ?? "",
        createdTs,
        expiresAt: createdTs + ((content.expires as number | undefined) ?? MEMBERSHIP_LIFETIME),
        foci: livekitOnly(content.foci_preferred),
        selection: content.focus_active?.focus_selection ?? "multi_sfu",
        kind: "session",
      }
    : null;
};

const toRtcMembership = (event: StickyEvent): CallMembership | null => {
  const content = event.content ?? {};
  const member = content.member ?? {};
  const live =
    event.until > Date.now() &&
    member.user_id === event.sender &&
    typeof member.device_id === "string" &&
    typeof member.id === "string" &&
    member.membership !== "leave" &&
    content.application?.type === "m.call" &&
    typeof content.slot_id === "string" &&
    content.slot_id.startsWith("m.call#");
  return live
    ? {
        userId: event.sender ?? "",
        deviceId: member.device_id,
        memberId: member.id,
        stateKey: content.msc4354_sticky_key ?? content.sticky_key ?? content.slot_id,
        createdTs: event.origin_server_ts ?? 0,
        expiresAt: event.until,
        foci: livekitOnly(content.transports?.published),
        selection: "multi_sfu",
        kind: "rtc",
      }
    : null;
};

export const stickyKeyOf = (event: StateEvent) => `${event.sender}|${event.content?.msc4354_sticky_key ?? event.content?.sticky_key ?? event.content?.slot_id ?? ""}`;

export const callMemberships = (room: RoomSummary | undefined, sticky: StickyEvent[] = []) => {
  const fromSticky = sticky.map(toRtcMembership).filter((membership): membership is CallMembership => !!membership);
  const seen = new Set(fromSticky.map((membership) => identityOf(membership.userId, membership.deviceId)));
  return [
    ...fromSticky,
    ...CALL_MEMBER.flatMap((type) => Object.values(room?.state[type] ?? {}))
      .map(toMembership)
      .filter((membership): membership is CallMembership => !!membership && !seen.has(identityOf(membership.userId, membership.deviceId))),
  ]
    .filter((membership) => room?.members[membership.userId]?.membership !== "leave")
    .sort((a, b) => a.createdTs - b.createdTs);
};

export const isCallRoom = (room: RoomSummary | undefined) =>
  CALL_ROOM_TYPES.includes(room?.roomType ?? room?.state["m.room.create"]?.[""]?.content?.type ?? "") || !!room?.state["io.element.call"];

export const pickFocus = (memberships: CallMembership[], own: LiveKitFocus[]) => selectTransport(own) ?? memberships.map((membership) => selectTransport(membership.foci)).find(Boolean);

export const memberFocus = (member: CallMembership, oldest: CallMembership | undefined) =>
  selectTransport(member.selection === "oldest_membership" && oldest?.foci.length ? oldest.foci : member.foci);

export const hashIdentity = async (userId: UserId, memberId: string) =>
  encodeKey(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([userId, memberId])))));

export const hashKey = (userId: UserId, memberId: string) => JSON.stringify([userId, memberId]);

export const backendIdentities = (member: CallMembership, hashes: Record<string, string>) => [
  ...(member.foci.some((focus) => typeof focus.url === "string") && hashes[hashKey(member.userId, member.memberId)] ? [hashes[hashKey(member.userId, member.memberId)]] : []),
  ...(member.foci.some((focus) => typeof focus.livekit_service_url === "string") || member.kind === "session" ? [identityOf(member.userId, member.deviceId)] : []),
];

export const identityOf = (userId: UserId, deviceId: string) => `${userId}:${deviceId}`;

export const toDeviceKeyContent = (session: Session, roomId: RoomId, index: number, key: string) => ({
  room_id: roomId,
  member_id: identityOf(session.userId, session.deviceId),
  media_key: { index, key },
  keys: { index, key },
  member: { id: identityOf(session.userId, session.deviceId), claimed_device_id: session.deviceId },
  session: { application: "m.call", call_id: "", scope: "m.room" },
  sent_ts: Date.now(),
});

export const stateKeyOf = (session: Session) => `_${session.userId}_${session.deviceId}`;

export const membershipContent = (session: Session, focus: LiveKitFocus, roomId: RoomId) => ({
  application: "m.call",
  call_id: "",
  scope: "m.room",
  device_id: session.deviceId,
  expires: MEMBERSHIP_LIFETIME,
  focus_active: { type: "livekit", focus_selection: "multi_sfu" },
  foci_preferred: [focus.livekit_service_url ? { ...focus, livekit_alias: focus.livekit_alias ?? roomId } : focus],
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

const openIdCache = new Map<string, { at: number; until: number; token: Promise<Record<string, unknown>> }>();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchOpenId = (session: Session, tries = 3): Promise<Record<string, unknown>> =>
  sessionRequest<Record<string, unknown>>(session, {
    endpoint: `user/${encodeURIComponent(session.userId)}/openid/request_token`,
    method: "POST",
    body: {},
  }).catch((error: { status?: number; retryAfterMs?: number }) =>
    error?.status === 429 && tries > 1 ? wait(Math.min(error.retryAfterMs ?? 2000, 15000)).then(() => fetchOpenId(session, tries - 1)) : Promise.reject(error),
  );

export const requestOpenId = (session: Session) => {
  const key = `${session.userId}|${session.deviceId}`;
  const cached = openIdCache.get(key);
  const fresh = cached && cached.until > Date.now();
  const token = fresh ? cached.token : fetchOpenId(session);
  !fresh &&
    (openIdCache.set(key, { at: Date.now(), until: Date.now() + 60_000, token }),
    token.then(
      (value) => openIdCache.get(key)?.token === token && openIdCache.set(key, { at: Date.now(), until: Date.now() + Math.max(60, Number(value.expires_in ?? 3600) - 300) * 1000, token }),
      () => openIdCache.get(key)?.token === token && openIdCache.delete(key),
    ));
  return token;
};

const openIdGrant = async (session: Session, focus: LiveKitFocus, roomId: RoomId, publisher: boolean, memberId: string) => {
  const openid = await requestOpenId(session);
  const base = (focus.livekit_service_url ?? "").replace(/\/+$/, "");
  const legacy = () =>
    fetch(`${base}/sfu/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: focus.livekit_alias ?? roomId, openid_token: openid, device_id: session.deviceId }),
    });
  const modern = () =>
    fetch(`${base}/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, slot_id: SLOT_ID, openid_token: openid, member: { id: memberId, claimed_user_id: session.userId, claimed_device_id: session.deviceId } }),
    }).then((response) => (response.status === 404 ? legacy() : response));
  return publisher ? legacy() : modern();
};

const csApiGrant = async (session: Session, focus: LiveKitFocus, roomId: RoomId, memberId: string, serverName: string) =>
  sessionRequest<{ jwt?: string }>(session, {
    base: `${session.homeserver}/_matrix/client/${await getTokenPrefix(session)}/`,
    endpoint: "rtc/livekit/get_token",
    method: "POST",
    body: { url: focus.url, server_name: focus.server_name ?? serverName, room_id: roomId, slot_id: SLOT_ID, member_id: memberId },
  }).then((body) => (body.jwt ? { url: focus.url!, jwt: body.jwt } : Promise.reject(new Error("sfu_failed"))));

export const usesCsApi = (focus: LiveKitFocus) => typeof focus.url === "string" && !focus.livekit_service_url;

export const requestSfu = async (session: Session, focus: LiveKitFocus, roomId: RoomId, publisher = true, serverName = serverNameFromUserId(session.userId)): Promise<SfuGrant> => {
  const memberId = identityOf(session.userId, session.deviceId);
  if (usesCsApi(focus)) return csApiGrant(session, focus, roomId, memberId, serverName).catch(() => Promise.reject(new Error("sfu_failed")));
  const response = await openIdGrant(session, focus, roomId, publisher, memberId);
  const body = await response.json().catch(() => ({}));
  return response.ok && body.jwt ? { url: body.url ?? focus.url, jwt: body.jwt } : Promise.reject(new Error("sfu_failed"));
};

export type TurnServer = { uris?: string[]; username?: string; password?: string; ttl?: number };

export const turnServers = (session: Session): Promise<RTCIceServer[]> =>
  sessionRequest<TurnServer>(session, { endpoint: "voip/turnServer", method: "GET" }).then(
    (turn) => (turn.uris?.length ? [{ urls: turn.uris, username: turn.username, credential: turn.password }] : []),
    () => [],
  );

export const encodeKey = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");

export const decodeKey = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
