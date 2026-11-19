import { get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { getSourceKey, isMxc, type EncryptedFile } from "../matrix/utilities/media";
import { registerAccountDataHook, session } from "../stores/matrix";

export type GifFavourite =
  | { id: string; kind: "mxc"; msgtype?: string; url?: string; file?: EncryptedFile; info: Record<string, any>; body: string }
  | { id: string; kind: "link"; url: string; sent?: Record<string, any>; media?: string; video?: string; full?: string; postId?: string; image?: string; title?: string; w?: number; h?: number };

export type Gifbox = { video: string; full: string; gif?: string; postId: string; image?: string; title?: string; w: number; h: number };

const mp4 = typeof document === "undefined" || !!document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"');

export const GIF_TYPE = "chat.skye.gifs";

const GIF_HOSTS = /(^|\.)(tenor\.com|giphy\.com|klipy\.com|klipy\.co|gifbox\.me)$/i;
const GIF_FILE = /\.gif(?:$|[?#])/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export const isGifLink = (url: string) => GIF_FILE.test(url) || GIF_HOSTS.test(hostOf(url));

export const isDirectGif = (url: string) => GIF_FILE.test(url) || /^(media\d*|i)\.giphy\.com$|^static\.klipy\.com$|^media\.tenor\.com$/i.test(hostOf(url));

export const isGifContent = (content: Record<string, any>) =>
  (isMxc(content.url) || isMxc(content.file?.url)) &&
  ((["m.image", "m.file"].includes(content.msgtype) && String(content.info?.mimetype ?? "").split(";")[0].trim().toLowerCase() === "image/gif") || (content.msgtype === "m.video" && !!(content.info?.["fi.mau.gif"] || content["fi.mau.gif"])));

export const gifFromContent = (content: Record<string, any>): GifFavourite => ({
  id: getSourceKey({ url: content.url, file: content.file }),
  kind: "mxc",
  msgtype: content.msgtype === "m.video" ? "m.video" : "m.image",
  ...(isMxc(content.url) ? { url: content.url } : { file: content.file }),
  info: content.info ?? {},
  body: String(content.filename ?? content.body ?? "image.gif"),
});

export const isGifbox = (url: string) => /^https?:\/\/(www\.)?gifbox\.me\/view\//i.test(url);

const GIFBOX = "https://compat.gifbox.me/v2";
const GIFBOX_KEY = import.meta.env.PUBLIC_GIFBOX_KEY || "gbx_bElSPGYbiqpYn3X-8G7PezPGS2X0vrj4";

export const gifboxReady = !!GIFBOX_KEY;

const gifboxCall = (endpoint: string, params: Record<string, string>, signal?: AbortSignal) =>
  fetch(`${GIFBOX}/${endpoint}?${new URLSearchParams({ key: GIFBOX_KEY, client_key: "skye", locale: "en_GB", ...params })}`, { signal }).then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))));

const toGifbox = (post: Record<string, any>): (Gifbox & { url: string }) | null => {
  const formats = post?.media_formats ?? {};
  const video = (mp4 ? null : (formats.tinywebm ?? formats.webm)) ?? formats.tinymp4 ?? formats.mp4 ?? formats.loopedmp4;
  const gif = formats.gif ?? formats.mediumgif ?? formats.tinygif ?? formats.nanogif;
  return video?.url ? { url: String(post.itemurl ?? post.url), video: video.url, full: (formats.mp4 ?? video).url, ...(gif?.url ? { gif: gif.url } : {}), image: formats.preview?.url, title: post.title || post.content_description || undefined, w: Number(video.dims?.[0]) || 1, h: Number(video.dims?.[1]) || 1, postId: String(post.id) } : null;
};

export const searchGifbox = async (query: string, pos: string, signal?: AbortSignal) => {
  const body = await gifboxCall(query.trim() ? "search" : "featured", { limit: "24", media_filter: "preview,mp4,tinymp4,webm,tinywebm,gif,mediumgif,tinygif,nanogif", ...(query.trim() ? { q: query.trim() } : {}), ...(pos ? { pos } : {}) }, signal);
  return { next: String(body?.next ?? ""), results: ((body?.results ?? []) as Record<string, any>[]).map(toGifbox).filter((item): item is Gifbox & { url: string } => !!item).map((item) => gifFromGifbox(item.url, item)) };
};

const gifboxCache = new Map<string, Promise<Gifbox | null>>();

export const resolveGifbox = (url: string) => {
  const id = url.match(/gifbox\.me\/view\/([\w-]+)/i)?.[1] ?? "";
  const known = gifboxCache.get(id);
  if (known || !id || !gifboxReady) return known ?? Promise.resolve(null);
  const request = gifboxCall("posts", { ids: id }).then((body) => toGifbox(body?.results?.[0])).catch(() => (gifboxCache.delete(id), null));
  gifboxCache.set(id, request);
  return request;
};

export const seedGifbox = (url: string, box: Gifbox) => {
  const id = url.match(/gifbox\.me\/view\/([\w-]+)/i)?.[1];
  id && !gifboxCache.has(id) && gifboxCache.set(id, Promise.resolve(box));
};

export const shareGifbox = (postId?: string, query = "") => postId && gifboxReady && gifboxCall("registershare", { id: postId, ...(query ? { q: query } : {}) }).catch(() => undefined);

export const gifFromGifbox = (url: string, box: Gifbox): GifFavourite => ({ id: url, kind: "link", url, video: box.video, full: box.full, ...(box.gif ? { media: box.gif } : {}), postId: box.postId, w: box.w, h: box.h, ...(box.image ? { image: box.image } : {}), ...(box.title ? { title: box.title } : {}) });

export const gifFromLink = (url: string, image?: string, w?: number, h?: number): GifFavourite => ({
  id: url,
  kind: "link",
  url,
  ...(isDirectGif(url) ? { media: url } : {}),
  ...(image ? { image } : {}),
  ...(w && h ? { w, h } : {}),
});

const valid = (item: any): item is GifFavourite =>
  !!item && typeof item.id === "string" && (item.kind === "link" ? typeof item.url === "string" : item.kind === "mxc" && (isMxc(item.url) || isMxc(item.file?.url)));

export const favouriteGifs = writable<GifFavourite[]>([]);

let sent: string | null = null;
let inflight = 0;

registerAccountDataHook((events) => {
  const list = events.findLast((candidate) => candidate.type === GIF_TYPE)?.content?.favourites;
  if (!Array.isArray(list)) return;
  const echo = JSON.stringify(list) === sent;
  if (inflight && !echo) return;
  echo || favouriteGifs.set(list.filter(valid));
});

const save = () => {
  const active = get(session);
  sent = JSON.stringify(get(favouriteGifs));
  active &&
    (inflight++,
    sessionRequest(active, {
      endpoint: `user/${encodeURIComponent(active.userId)}/account_data/${GIF_TYPE}`,
      method: "PUT",
      body: { favourites: get(favouriteGifs) },
    })
      .catch((error) => console.warn("Skye could not save favourite GIFs", error))
      .finally(() => setTimeout(() => inflight--, 1500)));
};

export const isFavouriteGif = (id: string) => get(favouriteGifs).some((item) => item.id === id);

export const toggleFavouriteGif = (gif: GifFavourite) => {
  favouriteGifs.update((current) => (current.some((item) => item.id === gif.id) ? current.filter((item) => item.id !== gif.id) : [gif, ...current]));
  save();
};

export const rememberGifUpload = (id: string, content: Record<string, any>) => {
  if (!isFavouriteGif(id) || !(isMxc(content.url) || isMxc(content.file?.url))) return;
  favouriteGifs.update((current) => current.map((item) => (item.id === id && item.kind === "link" ? { ...item, sent: { msgtype: content.msgtype, body: content.body, info: content.info ?? {}, ...(content.url ? { url: content.url } : { file: content.file }) } } : item)));
  save();
};

export const favouriteLinkGif = async (url: string, fallback: () => Promise<GifFavourite>) => {
  if (isFavouriteGif(url)) return toggleFavouriteGif(gifFromLink(url));
  const box = isGifbox(url) ? await resolveGifbox(url) : null;
  toggleFavouriteGif(box ? gifFromGifbox(url, box) : await fallback());
};

export type GifCategory = { term: string; name: string; image: string };

let categories: Promise<GifCategory[]> | null = null;

export const gifboxCategories = () =>
  (categories ??= gifboxReady
    ? gifboxCall("categories", {})
        .then((body) => ((body?.tags ?? []) as Record<string, any>[]).filter((tag) => tag.searchterm).map((tag) => ({ term: String(tag.searchterm), name: String(tag.name ?? tag.searchterm).replace(/^#/, ""), image: String(tag.image ?? "") })))
        .catch(() => ((categories = null), []))
    : Promise.resolve([]));
