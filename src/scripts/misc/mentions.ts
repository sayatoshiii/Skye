import { toMatrixTo } from "../matrix/utilities/links";

export type MentionTarget = { kind: "user" | "room" | "everyone"; id: string; label: string; via?: string[] };
export type Pill = MentionTarget & { from: number; to: number };

export const composerMentions: { insert?: (target: MentionTarget) => void } = {};

const USER_LINK = /^https:\/\/matrix\.to\/#\/(@[^/?]+)\/?$/;
const ROOM_LINK = /^https:\/\/matrix\.to\/#\/([#!][^/?]+)\/?(?:\?(.*))?$/;

export const pillText = (target: MentionTarget) =>
  target.kind === "everyone" ? "@room" : `${target.kind === "room" ? "#" : "@"}${target.label}`;

export const mentionLink = (target: MentionTarget) =>
  target.kind === "user" ? `https://matrix.to/#/${target.id}` : toMatrixTo(target.id, target.via);

export const parseMentionLink = (href: string | null | undefined): Omit<MentionTarget, "label"> | null => {
  if (!href) return null;
  const user = href.match(USER_LINK);
  if (user) return { kind: "user", id: decodeURIComponent(user[1]) };
  const room = href.match(ROOM_LINK);
  if (!room) return null;
  const via = [...new URLSearchParams(room[2] ?? "").getAll("via")];
  return { kind: "room", id: decodeURIComponent(room[1]), via };
};

export const shiftPills = (pills: Pill[], before: string, after: string) => {
  if (!pills.length || before === after) return pills;
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const oldEnd = before.length - end;
  const delta = after.length - before.length;
  return pills.flatMap((pill) =>
    pill.to <= start ? [pill] : pill.from >= oldEnd ? [{ ...pill, from: pill.from + delta, to: pill.to + delta }] : [],
  );
};

export const trimPills = (draft: string, pills: Pill[]) => {
  const lead = draft.length - draft.trimStart().length;
  const body = draft.trim();
  return {
    body,
    pills: pills
      .map((pill) => ({ ...pill, from: pill.from - lead, to: pill.to - lead }))
      .filter((pill) => pill.from >= 0 && pill.to <= body.length && body.slice(pill.from, pill.to) === pillText(pill)),
  };
};

const escapeMarkdown = (value: string) => value.replace(/[\\`*_~|[\]()<>#!]/g, "\\$&");

export const pillMarkdown = (body: string, pills: Pill[]) => {
  let result = "";
  let at = 0;
  for (const pill of [...pills].sort((a, b) => a.from - b.from)) {
    if (pill.from < at || pill.kind === "everyone") continue;
    result += body.slice(at, pill.from) + `[${escapeMarkdown(pill.label)}](${mentionLink(pill)})`;
    at = pill.to;
  }
  return result + body.slice(at);
};

export const mentionsOf = (pills: Pill[], extra: string[] = []) => {
  const users = [...new Set([...pills.filter((pill) => pill.kind === "user").map((pill) => pill.id), ...extra])];
  return { user_ids: users, ...(pills.some((pill) => pill.kind === "everyone") ? { room: true } : {}) };
};

export const recoverPills = (value: string, content: Record<string, any>): Pill[] => {
  const pills: Pill[] = [];
  if (typeof content?.formatted_body === "string") {
    const html = new DOMParser().parseFromString(content.formatted_body, "text/html");
    let at = 0;
    for (const anchor of html.querySelectorAll("a[href]")) {
      const target = parseMentionLink(anchor.getAttribute("href"));
      const label = anchor.textContent?.replace(/^[@#]/, "") ?? "";
      if (!target || !label) continue;
      const text = pillText({ ...target, label });
      const from = value.indexOf(text, at);
      if (from < 0) continue;
      pills.push({ ...target, label, from, to: from + text.length });
      at = from + text.length;
    }
  }
  const everyone = content?.["m.mentions"]?.room === true ? value.search(/(^|\s)@room\b/) : -1;
  if (everyone >= 0) {
    const from = value.indexOf("@room", everyone);
    pills.push({ kind: "everyone", id: "@room", label: "room", from, to: from + 5 });
  }
  return pills;
};

export const mentionsUser = (content: Record<string, any>, userId: string, names: string[] = []) => {
  const mentions = content?.["m.mentions"];
  if (mentions && typeof mentions === "object")
    return (Array.isArray(mentions.user_ids) && mentions.user_ids.includes(userId)) || mentions.room === true;
  const html = typeof content?.formatted_body === "string" ? content.formatted_body : "";
  if (html.includes(`matrix.to/#/${userId}`) || html.includes(`matrix.to/#/${encodeURIComponent(userId)}`)) return true;
  const body = typeof content?.body === "string" ? content.body.toLowerCase() : "";
  return [userId, ...names].some((name) => !!name && body.includes(name.toLowerCase()));
};
