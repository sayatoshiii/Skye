import { get } from "svelte/store";
import { sessionRequest } from "./session";
import { getTimeline, session } from "../stores/matrix";
import type { TimelineEvent } from "./types";

export const HAS_TYPES = ["link", "image", "video", "file", "embed"] as const;
export type HasType = (typeof HAS_TYPES)[number];
export type DateRule = { kind: "before" | "after" | "on"; date: string };

export type SearchFilters = { senders: string[]; mentions: string[]; has: HasType[]; dates: DateRule[]; pinned: boolean | null };
export type SearchQuery = SearchFilters & { term: string };
export type SearchPage = { events: TimelineEvent[]; next: string | null; count?: number };

export const emptyFilters = (): SearchFilters => ({ senders: [], mentions: [], has: [], dates: [], pinned: null });
export const filterCount = (filters: SearchFilters) => filters.senders.length + filters.mentions.length + filters.has.length + filters.dates.length + +(filters.pinned !== null);
export const isBlank = (query: SearchQuery) => !query.term.trim() && !filterCount(query);

type SearchResponse = {
  search_categories?: { room_events?: { results?: { result: TimelineEvent }[]; next_batch?: string; count?: number } };
};

const URL_PATTERN = /https?:\/\/\S+/i;
const DAY = 86400000;

const HAS_TEST: Record<HasType, (content: Record<string, any>) => boolean> = {
  link: (content) => content.msgtype !== "m.image" && URL_PATTERN.test(String(content.body ?? "")),
  embed: (content) => URL_PATTERN.test(String(content.body ?? "")) || !!content["com.beeper.linkpreviews"]?.length,
  image: (content) => content.msgtype === "m.image",
  video: (content) => content.msgtype === "m.video",
  file: (content) => ["m.file", "m.audio"].includes(content.msgtype),
};

const dayStart = (date: string) => new Date(`${date}T00:00:00`).getTime();

const DATE_TEST: Record<DateRule["kind"], (ts: number, start: number) => boolean> = {
  before: (ts, start) => ts < start,
  after: (ts, start) => ts >= start + DAY,
  on: (ts, start) => ts >= start && ts < start + DAY,
};

const mentionsOf = (content: Record<string, any>) => [
  ...(content["m.mentions"]?.user_ids ?? []),
  ...[...String(content.formatted_body ?? "").matchAll(/matrix\.to\/#\/(@[^"'?<>\s]+)/g)].map((match) => decodeURIComponent(match[1])),
];

export const matchesQuery = (event: TimelineEvent, query: SearchQuery, pinned: Set<string> = new Set()) => {
  const content = event.content ?? {};
  const body = typeof content.body === "string" ? content.body : "";
  const mentioned = query.mentions.length ? mentionsOf(content) : [];
  return (
    ["m.room.message", "m.sticker"].includes(event.type) &&
    !event.redacted &&
    !event.decryptionFailed &&
    !content["m.new_content"] &&
    !!body &&
    (!query.senders.length || query.senders.includes(event.sender)) &&
    (!query.mentions.length || query.mentions.some((user) => mentioned.includes(user))) &&
    (!query.has.length || query.has.some((type) => HAS_TEST[type](content))) &&
    query.dates.every((rule) => DATE_TEST[rule.kind](event.origin_server_ts, dayStart(rule.date))) &&
    (query.pinned === null || pinned.has(event.event_id) === query.pinned) &&
    (!query.term.trim() || query.term.toLowerCase().split(/\s+/).filter(Boolean).every((word) => body.toLowerCase().includes(word)))
  );
};

export const searchServer = async (roomId: string, query: SearchQuery, next?: string | null, signal?: AbortSignal): Promise<SearchPage> => {
  const active = get(session);
  if (!active) throw new Error("No active Matrix session.");
  const urls = query.has.length && query.has.every((type) => type === "link" || type === "embed");
  const response = await sessionRequest<SearchResponse>(active, {
    endpoint: "search",
    method: "POST",
    query: next ? { next_batch: next } : undefined,
    signal,
    body: {
      search_categories: {
        room_events: {
          search_term: query.term.trim() || "*",
          keys: ["content.body"],
          order_by: "recent",
          filter: { rooms: [roomId], ...(query.senders.length ? { senders: query.senders } : {}), ...(urls ? { contains_url: true } : {}) },
        },
      },
    },
  });
  const events = response.search_categories?.room_events;
  return { events: (events?.results ?? []).map(({ result }) => result).filter(Boolean), next: events?.next_batch ?? null, count: events?.count };
};

export const searchLoaded = (roomId: string, query: SearchQuery, pinned?: Set<string>) =>
  getTimeline(roomId).getEvents().filter((event) => matchesQuery(event, query, pinned));

export const olderWalker = (roomId: string) => {
  let token: string | null | undefined;
  let list: TimelineEvent[] = [];
  const start = async () => {
    const timeline = getTimeline(roomId);
    const first = timeline.getEvents().find((event) => !event.txnId);
    token = first ? ((await timeline.loadContext(first.event_id as never, 0)).start ?? null) : null;
  };
  return {
    step: async (limit = 80) => {
      token === undefined && (await start());
      if (token === null) return { events: [] as TimelineEvent[], more: false };
      const page = await getTimeline(roomId).fetchPage(list, token!, "b", limit);
      const fresh = page.events.slice(0, page.events.length - list.length);
      list = page.events.slice(0, 400);
      token = page.token;
      return { events: fresh, more: token !== null };
    },
  };
};

export const canSearchOlder = (roomId: string) => getTimeline(roomId).getEvents().length > 0;

export const localpart = (userId: string) => userId.replace(/^@/, "").split(":")[0];
