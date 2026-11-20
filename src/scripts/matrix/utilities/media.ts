import { API, baseURL } from "../../api/client";
import { serialiseURIObject } from "../../misc/uri";
import { embedPort, native } from "../../misc/native";
import { loadSession } from "../session";
import type { Session } from "../types";
import { writable } from "svelte/store";

export const gstreamerMissing = writable(false);

export type MediaParams = {
  width?: number;
  height?: number;
  method?: "crop" | "scale";
  animated?: boolean;
  allow_redirect?: boolean;
};

const mediaCache: Record<string, Promise<string | undefined>> = {};

const MAX_CONCURRENT_MEDIA = 6;

let activeMedia = 0;
const mediaQueue: (() => void)[] = [];

const queueMedia = async <T>(task: () => Promise<T>) => {
  if (activeMedia >= MAX_CONCURRENT_MEDIA)
    await new Promise<void>((resolve) => mediaQueue.push(resolve));

  activeMedia++;

  try {
    return await task();
  } finally {
    activeMedia--;
    mediaQueue.shift()?.();
  }
};

export const isMxc = (url?: string): url is string =>
  !!url && url.startsWith("mxc://");

export const getAuthenticatedMedia = async (
  url: string,
  params?: MediaParams,
  asLink: boolean = false,
  session: Session | null = loadSession(),
) => {
  if (!session) throw new Error("No active Matrix session.");

  const [serverName, mediaId] = url.slice(6).split("/");
  const query = params ? `?${serialiseURIObject(params)}` : "";
  const kind = params?.width ? "thumbnail" : "download";

  const response = await API({
    base: baseURL.CUSTOM(session.homeserver, true),
    endpoint: `_matrix/client/v1/media/${kind}/${serverName}/${mediaId}${query}`,
    method: "GET",
    headers: {},
    accessToken: session.accessToken,
  });

  if (!response.ok)
    throw new Error("There was a problem accessing this mxc media.");

  const blob = await response.blob();

  return asLink ? URL.createObjectURL(blob) : blob;
};

const resolvedMedia = new Map<string, string>();

export const knownMediaLink = (url: string, size = 96) => resolvedMedia.get(`${url}:${size}`);

export const getMediaLink = (url: string, size = 96) =>
  (mediaCache[`${url}:${size}`] ??= queueMedia(
    () =>
      getAuthenticatedMedia(
        url,
        { width: size, height: size, method: "crop" },
        true,
      ) as Promise<string>,
  )
    .then((link) => (link && resolvedMedia.set(`${url}:${size}`, link), link))
    .catch(() => undefined));

export const getWideMediaLink = (url: string, width = 640, height = 240) =>
  (mediaCache[`${url}:${width}x${height}`] ??= queueMedia(
    () =>
      getAuthenticatedMedia(
        url,
        { width, height, method: "scale" },
        true,
      ) as Promise<string>,
  ).catch(() => undefined));

export type EncryptedFile = {
  url: string;
  key: { kty: string; key_ops: string[]; alg: string; k: string; ext: boolean };
  iv: string;
  hashes: Record<string, string>;
  v: string;
};

export type MediaSource = { url?: string; file?: EncryptedFile };

const blobCache: Record<string, Promise<Blob>> = {};
const linkCache: Record<string, { count: number; link: Promise<string> }> = {};

const decryptBlob = async (blob: Blob, file: EncryptedFile) => {
  const { Attachment, EncryptedAttachment } = await import(
    "@matrix-org/matrix-sdk-crypto-wasm"
  );
  const { loadWasm } = await import("../crypto");
  await loadWasm();

  const { v, key, iv, hashes } = file;
  const attachment = new EncryptedAttachment(
    new Uint8Array(await blob.arrayBuffer()),
    JSON.stringify({ v, key, iv, hashes }),
  );

  return Attachment.decrypt(attachment);
};

export const getSourceKey = (source: MediaSource) =>
  source.file?.url ?? source.url ?? "";

export const getMediaBlob = (source: MediaSource, mimetype: string) => {
  const mxc = getSourceKey(source);
  if (!isMxc(mxc)) return Promise.reject(new Error("Invalid media source."));

  return (blobCache[`${mxc}:${mimetype}`] ??= queueMedia(async () => {
    const raw = (await getAuthenticatedMedia(mxc)) as Blob;
    const bytes = source.file
      ? await decryptBlob(raw, source.file)
      : new Uint8Array(await raw.arrayBuffer());

    return new Blob([bytes as BlobPart], { type: mimetype });
  }).catch((error) => {
    delete blobCache[`${mxc}:${mimetype}`];
    throw error;
  }));
};

const seededLinks = new Map<string, string>();

export const seedMedia = (url: string | undefined, blob: Blob, mimetypes: string[], link?: string) => {
  if (!isMxc(url)) return;
  mimetypes.forEach((type) => (blobCache[`${url}:${type}`] = Promise.resolve(new Blob([blob], { type }))));
  if (link) seededLinks.set(url, link);
};

export const seededLink = (source: MediaSource | null) => (source ? seededLinks.get(getSourceKey(source)) : undefined);

const served = (mimetype: string) => native && /linux/i.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent) && /^(video|audio)\//.test(mimetype);

const chromium = () => native && /linux/i.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent);

const plays = (link: string, mimetype: string) =>
  new Promise<boolean>((done) => {
    const probe = document.createElement(mimetype.startsWith("audio") ? "audio" : "video");
    const finish = (ok: boolean) => (done(ok), probe.removeAttribute("src"), probe.load());
    probe.onloadedmetadata = () => finish(true);
    probe.onerror = () => finish(false);
    Object.assign(probe, { muted: true, preload: "metadata", src: link });
  });

const stream = async (blob: Blob, mimetype: string) => {
  const link = await serve(blob, mimetype);
  const info = link.startsWith("blob:") ? {} : await fetch(link.replace("/media/", "/info/")).then((response) => response.json()).catch(() => ({}));
  return info.duration ? link.replace("/media/", "/live/") : (info.error === "gstreamer" && gstreamerMissing.set(true), unserve(link), URL.createObjectURL(blob));
};

const playable = async (blob: Blob, mimetype: string, live = false, urgent = false) => {
  const link = URL.createObjectURL(blob);
  return !chromium() || !/^(video|audio)\//.test(mimetype) || (await plays(link, mimetype)) ? link : (URL.revokeObjectURL(link), live ? stream(blob, mimetype) : serve(blob, mimetype, true, urgent));
};

const converted = new Set<string>();

const serve = async (blob: Blob, mimetype: string, convert = false, urgent = false) => {
  const { invoke } = await import("@tauri-apps/api/core");
  const [port, id] = await Promise.all([embedPort, invoke<string>("media_put", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-type": mimetype } })]);
  const ready = convert ? await invoke("media_transcode", { id, urgent }).then(() => true, (error) => (String(error) === "gstreamer" && gstreamerMissing.set(true), false)) : true;
  const link = port && ready ? `http://localhost:${port}/media/${id}` : (unserve(`/${id}`), URL.createObjectURL(blob));
  convert && !urgent && !link.startsWith("blob:") && converted.add(link);
  return link;
};

const unserve = (link: string) => import("@tauri-apps/api/core").then(({ invoke }) => invoke("media_drop", { id: link.split("/").pop() }));

const KEEP_LIVE = 5 * 60_000;

export const acquireMediaLink = (source: MediaSource, mimetype: string, live = false, urgent = false) =>
  hold(`${getSourceKey(source)}:${mimetype}${live ? ":live" : ""}`, () => getMediaBlob(source, mimetype).then((blob) => (served(mimetype) ? serve(blob, mimetype) : playable(blob, mimetype, live, urgent))));

export const acquireRemoteVideo = (url: string) =>
  hold(`remote:${url}`, () => (chromium() ? fetch(url).then((response) => response.blob()).then((blob) => playable(blob, blob.type.startsWith("video/") ? blob.type : "video/mp4")) : Promise.resolve(url)));

export const remoteVideo = (node: HTMLVideoElement, url: string) => {
  let handle = acquireRemoteVideo(url);
  const apply = (current: typeof handle) => current.link.then((link) => void (handle === current && node.isConnected && ((node.src = link), node.autoplay && node.play().catch(() => undefined)))).catch(() => node.dispatchEvent(new Event("error")));
  apply(handle);
  return { update: (next: string) => (handle.release(), (handle = acquireRemoteVideo(next)), apply(handle)), destroy: () => handle.release() };
};

const hold = (key: string, make: () => Promise<string>) => {
  const entry = (linkCache[key] ??= { count: 0, link: make() });

  entry.count++;
  entry.link.catch(() => {
    if (linkCache[key] === entry) delete linkCache[key];
  });

  return {
    link: entry.link,
    release: () => {
      const drop = () => {
        if (entry.count > 0 || linkCache[key] !== entry) return;
        delete linkCache[key];
        delete blobCache[key];
        entry.link.then((link) => (link.startsWith("blob:") ? URL.revokeObjectURL(link) : unserve(link))).catch(() => undefined);
      };
      if (--entry.count > 0 || linkCache[key] !== entry) return;
      entry.link.then((link) => (converted.has(link) ? undefined : link.startsWith("blob:") ? drop() : setTimeout(drop, KEEP_LIVE)), drop);
    },
  };
};

export type MxcProbe = { mimetype: string; size: number; name: string };

const probeCache: Record<string, Promise<MxcProbe | null>> = {};

const fileName = (disposition: string | null) => decodeURIComponent(disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1] ?? disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? "");

export const probeMxc = (url: string, session: Session | null = loadSession()) =>
  (probeCache[url] ??= queueMedia(async () => {
    const [serverName, mediaId] = url.slice(6).split("/");
    const response = await API({ base: baseURL.CUSTOM(session!.homeserver, true), endpoint: `_matrix/client/v1/media/download/${serverName}/${mediaId}`, method: "GET", headers: {}, accessToken: session!.accessToken });
    response.body?.cancel().catch(() => undefined);
    return response.ok
      ? { mimetype: (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase(), size: Number(response.headers.get("content-length")) || 0, name: fileName(response.headers.get("content-disposition")) || mediaId }
      : null;
  }).catch(() => null));
