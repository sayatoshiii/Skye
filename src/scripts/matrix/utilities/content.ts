import type { TimelineEvent } from "../types";

export type Geo = { lat: number; long: number; uncertainty?: number };
export type GeoLocation = Geo & { description?: string };
export type PollAnswer = { id: string; text: string };
export type Poll = {
  question: string;
  answers: PollAnswer[];
  maxSelections: number;
  disclosed: boolean;
  unstable: boolean;
};

export const POLL_START = ["m.poll.start", "org.matrix.msc3381.poll.start"];
export const POLL_RESPONSE = ["m.poll.response", "org.matrix.msc3381.poll.response"];
export const POLL_END = ["m.poll.end", "org.matrix.msc3381.poll.end"];
export const BEACON_INFO = ["m.beacon_info", "org.matrix.msc3672.beacon_info"];
export const BEACON = ["m.beacon", "org.matrix.msc3672.beacon"];
export const LOCATION_KEYS = ["m.location", "org.matrix.msc3488.location"];
export const CALL_MEMBER = ["org.matrix.msc3401.call.member", "m.call.member"];

export const parseGeo = (uri: unknown): Geo | null => {
  if (typeof uri !== "string") return null;
  const match = uri.trim().match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?((?:;[^;]*)*)$/i);
  if (!match) return null;
  const lat = Number(match[1]);
  const long = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(long) || Math.abs(lat) > 90 || Math.abs(long) > 180) return null;
  const uncertainty = Number(match[3].match(/;u=(\d+(?:\.\d+)?)/i)?.[1]);

  return { lat, long, uncertainty: Number.isFinite(uncertainty) ? uncertainty : undefined };
};

const locationBlock = (content: Record<string, any>) =>
  LOCATION_KEYS.map((key) => content[key]).find((value) => value && typeof value === "object") as Record<string, any> | undefined;

export const getLocation = (content: Record<string, any>): GeoLocation | null => {
  const block = locationBlock(content);
  const geo = parseGeo(block?.uri) ?? parseGeo(content.geo_uri);
  if (!geo) return null;
  const description = block?.description ?? (content.msgtype === "m.location" ? undefined : content.body);

  return { ...geo, description: typeof description === "string" && description.trim() ? description.trim() : undefined };
};

export const formatCoordinates = (geo: Geo, digits = 5) => `${geo.lat.toFixed(digits)}, ${geo.long.toFixed(digits)}`;

export const osmLink = (geo: Geo) =>
  `https://www.openstreetmap.org/?mlat=${geo.lat.toFixed(6)}&mlon=${geo.long.toFixed(6)}#map=16/${geo.lat.toFixed(6)}/${geo.long.toFixed(6)}`;

export const tilePosition = (geo: Geo, zoom: number) => {
  const scale = 2 ** zoom;
  const rad = (geo.lat * Math.PI) / 180;
  const x = ((geo.long + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;

  return { x, y };
};

const extensibleText = (value: any): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value["m.text"])) return String(value["m.text"].find((entry: any) => !entry.mimetype || entry.mimetype === "text/plain")?.body ?? value["m.text"][0]?.body ?? "");
  if (typeof value["m.text"] === "string") return value["m.text"];
  if (typeof value["org.matrix.msc1767.text"] === "string") return value["org.matrix.msc1767.text"];
  if (typeof value.body === "string") return value.body;
  return "";
};

export const getPoll = (event: TimelineEvent): Poll | null => {
  const unstable = event.type === "org.matrix.msc3381.poll.start";
  const block = event.content["m.poll"] ?? event.content["org.matrix.msc3381.poll.start"];
  if (!block || typeof block !== "object" || !Array.isArray(block.answers)) return null;

  const answers = block.answers
    .map((answer: any) => ({ id: String(answer?.["m.id"] ?? answer?.id ?? ""), text: extensibleText(answer) }))
    .filter((answer: PollAnswer) => answer.id && answer.text)
    .slice(0, 20);
  if (!answers.length) return null;

  const max = Number(block.max_selections);

  return {
    question: extensibleText(block.question) || extensibleText(event.content),
    answers,
    maxSelections: Number.isInteger(max) && max > 0 ? Math.min(max, answers.length) : 1,
    disclosed: !String(block.kind ?? "m.disclosed").endsWith("undisclosed"),
    unstable,
  };
};

export const relatedTo = (event: TimelineEvent) => event.content?.["m.relates_to"]?.event_id as string | undefined;

export const getSelections = (event: TimelineEvent): string[] | null => {
  const value = event.content["m.selections"] ?? event.content["org.matrix.msc3381.poll.response"]?.answers;
  return Array.isArray(value) ? value.map(String) : null;
};

export type PollTally = {
  counts: Record<string, number>;
  total: number;
  mine: string[];
  ended: boolean;
  winners: string[];
};

export const tallyPoll = (
  poll: Poll,
  start: TimelineEvent,
  related: TimelineEvent[],
  ownUserId: string | undefined,
  mayEnd: (sender: string) => boolean,
): PollTally => {
  const end = related
    .filter((event) => POLL_END.includes(event.type) && !event.redacted && (event.sender === start.sender || mayEnd(event.sender)))
    .sort((a, b) => a.origin_server_ts - b.origin_server_ts)[0];
  const cutoff = end ? end.origin_server_ts : Infinity;
  const valid = new Set(poll.answers.map((answer) => answer.id));
  const latest = new Map<string, TimelineEvent>();

  for (const event of related) {
    if (!POLL_RESPONSE.includes(event.type) || event.redacted || event.localStatus === "failed") continue;
    if (event.origin_server_ts > cutoff) continue;
    const previous = latest.get(event.sender);
    if (!previous || previous.origin_server_ts <= event.origin_server_ts) latest.set(event.sender, event);
  }

  const counts: Record<string, number> = Object.fromEntries(poll.answers.map((answer) => [answer.id, 0]));
  let total = 0;
  let mine: string[] = [];

  for (const [sender, event] of latest) {
    const picks = getSelections(event);
    if (!picks || picks.some((pick) => !valid.has(pick))) continue;
    const chosen = [...new Set(picks)].slice(0, poll.maxSelections);
    if (!chosen.length) continue;
    chosen.forEach((pick) => counts[pick]++);
    total++;
    if (sender === ownUserId) mine = chosen;
  }

  const top = Math.max(0, ...Object.values(counts));

  return {
    counts,
    total,
    mine,
    ended: !!end,
    winners: end && top > 0 ? poll.answers.filter((answer) => counts[answer.id] === top).map((answer) => answer.id) : [],
  };
};

export const pollResponseContent = (start: TimelineEvent, answers: string[]) => ({
  "m.relates_to": { rel_type: "m.reference", event_id: start.event_id },
  "m.selections": answers,
  "org.matrix.msc3381.poll.response": { answers },
});

export const pollEndContent = (start: TimelineEvent, body: string) => ({
  "m.relates_to": { rel_type: "m.reference", event_id: start.event_id },
  "m.text": [{ body }],
  "org.matrix.msc1767.text": body,
  "org.matrix.msc3381.poll.end": {},
  body,
});

export const getWaveform = (content: Record<string, any>) => {
  const audio = content["org.matrix.msc1767.audio"] ?? content["m.audio"];
  const raw = audio?.waveform;
  const duration = Number(audio?.duration ?? content.info?.duration) || 0;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const numbers = raw.map(Number).filter(Number.isFinite);
  const peak = Math.max(1, ...numbers);

  return { samples: numbers.map((value) => Math.max(0, Math.min(1, value / peak))), duration };
};

export const resample = (samples: number[], bars: number) =>
  Array.from({ length: bars }, (_, index) => {
    const from = Math.floor((index * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((index + 1) * samples.length) / bars));
    const slice = samples.slice(from, to);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });

export const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");

  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};
