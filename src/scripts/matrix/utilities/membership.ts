import { baseURL, isMatrixError } from "../../api/client";
import { sessionRequest } from "../session";
import type { Session } from "../types";
import { getHierarchy } from "./hierarchy";
import type { RoomLink } from "./links";

export type RoomPreview = {
  roomId: string;
  name?: string;
  topic?: string;
  avatarUrl?: string;
  alias?: string;
  memberCount?: number;
  joinRule?: string;
  isSpace: boolean;
  membership?: string;
};

export type ResolvedLink = {
  roomId: string;
  via: string[];
  preview?: RoomPreview;
};

export type MembershipError = "not_found" | "forbidden" | "banned" | "rate_limited" | "failed";

type RawSummary = {
  room_id: string;
  name?: string;
  topic?: string;
  avatar_url?: string;
  canonical_alias?: string;
  num_joined_members?: number;
  join_rule?: string;
  room_type?: string;
  membership?: string;
};

type RawPublicRooms = { chunk?: (RawSummary & { join_rule?: string })[] };

const PUBLIC_ROOMS_LIMIT = 20;

const withVia = (path: string, key: string, via: string[]) =>
  via.length ? `${path}?${via.map((server) => `${key}=${encodeURIComponent(server)}`).join("&")}` : path;

const toPreview = (raw: RawSummary): RoomPreview => ({
  roomId: raw.room_id,
  name: raw.name,
  topic: raw.topic,
  avatarUrl: raw.avatar_url,
  alias: raw.canonical_alias,
  memberCount: raw.num_joined_members,
  joinRule: raw.join_rule,
  isSpace: raw.room_type === "m.space",
  membership: raw.membership,
});

const serverOf = (address: string) => {
  const colon = address.indexOf(":");
  return colon < 0 ? undefined : address.slice(colon + 1);
};

export const resolveAlias = (session: Session, alias: string) =>
  sessionRequest<{ room_id: string; servers?: string[] }>(session, {
    endpoint: `directory/room/${encodeURIComponent(alias)}`,
    method: "GET",
  });

const fetchSummary = (session: Session, roomIdOrAlias: string, via: string[]) =>
  sessionRequest<RawSummary>(session, {
    base: baseURL.MATRIX_V1(session.homeserver),
    endpoint: withVia(`room_summary/${encodeURIComponent(roomIdOrAlias)}`, "via", via),
    method: "GET",
  }).then(toPreview);

const fetchFromHierarchy = async (session: Session, roomId: string): Promise<RoomPreview | undefined> =>
  (await getHierarchy(session, roomId)).find((candidate) => candidate.roomId === roomId);

const fetchFromDirectory = async (session: Session, roomId: string, term: string, server?: string) => {
  const response = await sessionRequest<RawPublicRooms>(session, {
    endpoint: "publicRooms",
    method: "POST",
    query: server ? { server } : undefined,
    body: { limit: PUBLIC_ROOMS_LIMIT, filter: { generic_search_term: term } },
  });
  const match = response.chunk?.find((room) => room.room_id === roomId);
  return match && toPreview(match);
};

const firstOf = async (attempts: (() => Promise<RoomPreview | undefined>)[]) => {
  for (const attempt of attempts) {
    const result = await attempt().catch(() => undefined);
    if (result) return result;
  }
};

export const resolveLink = async (session: Session, link: RoomLink): Promise<ResolvedLink> => {
  const aliased = link.kind === "alias" ? await resolveAlias(session, link.target) : undefined;
  const roomId = aliased?.room_id ?? link.target;
  const via = [...new Set([...link.via, ...(aliased?.servers ?? []), serverOf(link.target)].filter((server): server is string => !!server))];
  const term = link.kind === "alias" ? link.target.slice(1, link.target.indexOf(":")) : roomId;

  const preview = await firstOf([
    () => fetchSummary(session, roomId, via),
    () => fetchFromHierarchy(session, roomId),
    () => fetchFromDirectory(session, roomId, term, via[0]),
  ]);

  return { roomId, via, preview };
};

export const leaveRoom = (session: Session, roomId: string) =>
  sessionRequest(session, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/leave`,
    method: "POST",
    body: {},
  });

export const forgetRoom = (session: Session, roomId: string) =>
  sessionRequest(session, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/forget`,
    method: "POST",
    body: {},
  });

export const describeMembershipError = (error: unknown): MembershipError => {
  if (!isMatrixError(error)) return "failed";
  if (error.errcode === "M_NOT_FOUND" || error.status === 404) return "not_found";
  if (error.errcode === "M_LIMIT_EXCEEDED") return "rate_limited";
  if (error.errcode === "M_FORBIDDEN") return /\bban/i.test(error.body.error ?? "") ? "banned" : "forbidden";
  return "failed";
};
