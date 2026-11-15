import { baseURL } from "../../api/client";
import { sessionRequest } from "../session";
import type { Session } from "../types";

export type HierarchyRoom = {
  roomId: string;
  name?: string;
  topic?: string;
  avatarUrl?: string;
  alias?: string;
  memberCount: number;
  joinRule: string;
  roomType?: string;
  isSpace: boolean;
  worldReadable: boolean;
  children: { roomId: string; via: string[] }[];
  allowedRooms: string[];
};

type RawChunk = {
  room_id: string;
  name?: string;
  topic?: string;
  avatar_url?: string;
  canonical_alias?: string;
  num_joined_members?: number;
  join_rule?: string;
  room_type?: string;
  world_readable?: boolean;
  allowed_room_ids?: string[];
  children_state?: { state_key: string; content?: { via?: string[] } }[];
};

type RawPage = { rooms?: RawChunk[]; next_batch?: string };

const MAX_DEPTH = 3;
const PAGE_LIMIT = 50;
const MAX_PAGES = 20;

const cache = new Map<string, Promise<HierarchyRoom[]>>();

const toRoom = (chunk: RawChunk): HierarchyRoom => ({
  roomId: chunk.room_id,
  name: chunk.name,
  topic: chunk.topic,
  avatarUrl: chunk.avatar_url,
  alias: chunk.canonical_alias,
  memberCount: chunk.num_joined_members ?? 0,
  joinRule: chunk.join_rule ?? "public",
  roomType: chunk.room_type,
  isSpace: chunk.room_type === "m.space",
  worldReadable: chunk.world_readable ?? false,
  allowedRooms: chunk.allowed_room_ids ?? [],
  children: (chunk.children_state ?? [])
    .filter((child) => Array.isArray(child.content?.via) && child.content.via.length)
    .map((child) => ({ roomId: child.state_key, via: child.content!.via! })),
});

const fetchHierarchy = async (session: Session, spaceId: string) => {
  const collected: HierarchyRoom[] = [];
  let from: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await sessionRequest<RawPage>(session, {
      base: baseURL.MATRIX_V1(session.homeserver),
      endpoint: `rooms/${encodeURIComponent(spaceId)}/hierarchy`,
      method: "GET",
      query: { max_depth: MAX_DEPTH, limit: PAGE_LIMIT, suggested_only: false, from },
    });

    collected.push(...(response.rooms ?? []).map(toRoom));
    from = response.next_batch;
    if (!from) break;
  }

  return collected;
};

export const getHierarchy = (session: Session, spaceId: string, refresh = false) => {
  const cached = cache.get(spaceId);
  if (cached && !refresh) return cached;

  const request = fetchHierarchy(session, spaceId);
  cache.set(spaceId, request);
  request.catch(() => cache.delete(spaceId));
  return request;
};

const withVia = (path: string, via: string[]) =>
  via.length ? `${path}?${via.map((server) => `server_name=${encodeURIComponent(server)}`).join("&")}` : path;

const membershipRequest = (action: "join" | "knock") =>
  (session: Session, roomIdOrAlias: string, via: string[] = []) =>
    sessionRequest<{ room_id: string }>(session, {
      endpoint: withVia(`${action}/${encodeURIComponent(roomIdOrAlias)}`, via),
      method: "POST",
      body: {},
    });

export const joinRoom = membershipRequest("join");

export const knockRoom = membershipRequest("knock");
