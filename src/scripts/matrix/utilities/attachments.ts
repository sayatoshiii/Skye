import { baseURL } from "../../api/client";
import { MEDIA } from "../../settings/config";
import { sessionRequest } from "../session";
import type { Session } from "../types";
import type { EncryptedFile } from "./media";

export type MediaKind = "image" | "video" | "audio" | "file";

export type PreparedAttachment = {
  file: File;
  name: string;
  mimetype: string;
  kind: MediaKind;
  info: Record<string, any>;
  thumbnail?: Blob;
  thumbnailInfo?: Record<string, any>;
};

export type UploadProgress = (fraction: number) => void;

let uploadLimit: Promise<number> | null = null;

export const getUploadLimit = (session: Session) =>
  (uploadLimit ??= sessionRequest<{ "m.upload.size"?: number }>(session, {
    base: baseURL.MATRIX_V1(session.homeserver),
    endpoint: "media/config",
    method: "GET",
  })
    .then((config) => config["m.upload.size"] ?? MEDIA.fallbackUploadLimit)
    .catch(() => {
      uploadLimit = null;
      return MEDIA.fallbackUploadLimit;
    }));

export const isInline = (mimetype: string | undefined, kind: MediaKind) => {
  const type = (mimetype ?? "").split(";")[0].trim().toLowerCase();
  if (kind === "image") return (MEDIA.inlineImageTypes as readonly string[]).includes(type);
  if (kind === "video") return type.startsWith("video/") || (MEDIA.inlineVideoTypes as readonly string[]).includes(type);
  if (kind === "audio") return (MEDIA.inlineAudioTypes as readonly string[]).includes(type);
  return false;
};

export const getKind = (mimetype: string): MediaKind => {
  if (isInline(mimetype, "image")) return "image";
  if (isInline(mimetype, "video")) return "video";
  if (isInline(mimetype, "audio")) return "audio";
  return "file";
};

export const sanitiseFilename = (name: string | undefined) => {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, MEDIA.filenameLength);

  return cleaned || "download";
};

export const formatBytes = (bytes: number | undefined) => {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
};

const withTimeout = <T>(promise: Promise<T>) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Media probe timed out.")), MEDIA.probeTimeout),
    ),
  ]);

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed."))), type, quality),
  );

const drawScaled = (source: CanvasImageSource, width: number, height: number, max = MEDIA.thumbnail) => {
  const scale = Math.min(1, max.width / width, max.height / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const makeThumbnail = async (source: CanvasImageSource, width: number, height: number, opaque: boolean) => {
  const canvas = drawScaled(source, width, height);
  const type = opaque ? "image/jpeg" : "image/png";
  const blob = await toBlob(canvas, type, MEDIA.thumbnail.quality);

  return { blob, info: { w: canvas.width, h: canvas.height, mimetype: type, size: blob.size } };
};

const stripJpeg = async (file: File, bitmap: ImageBitmap) => {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  const blob = await toBlob(canvas, "image/jpeg", MEDIA.jpegQuality);

  return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
};

const probeImage = async (file: File, stripMetadata: boolean): Promise<PreparedAttachment> => {
  const bitmap = await withTimeout(createImageBitmap(file));
  const { width, height } = bitmap;

  try {
    const upload = stripMetadata && file.type === "image/jpeg" ? await stripJpeg(file, bitmap) : file;
    const big = width > MEDIA.thumbnail.width || height > MEDIA.thumbnail.height;
    const thumbnail = big && file.type !== "image/gif"
      ? await makeThumbnail(bitmap, width, height, file.type === "image/jpeg").catch(() => null)
      : null;

    return {
      file: upload,
      name: file.name,
      mimetype: upload.type,
      kind: "image",
      info: { mimetype: upload.type, size: upload.size, w: width, h: height },
      thumbnail: thumbnail?.blob,
      thumbnailInfo: thumbnail?.info,
    };
  } finally {
    bitmap.close();
  }
};

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ogv: "video/ogg", "3gp": "video/3gpp",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav",
};

export const typeOf = (file: File) => {
  const type = file.type && file.type !== "application/octet-stream" ? file.type : EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""];
  return type && type !== file.type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
};

const unprobedVideo = (file: File): PreparedAttachment => ({
  file,
  name: file.name,
  mimetype: file.type,
  kind: "video",
  info: { mimetype: file.type, size: file.size },
});

const probeVideo = async (file: File): Promise<PreparedAttachment> => {
  const link = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Video could not be read."));
        video.src = link;
      }),
    );

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = video.onseeked = () => resolve();
        setTimeout(resolve, 1500);
        video.currentTime = 0.001;
      });
    }
    const thumbnail = width && height && video.readyState >= 2
      ? await makeThumbnail(video, width, height, true).catch(() => null)
      : null;

    return {
      file,
      name: file.name,
      mimetype: file.type,
      kind: "video",
      info: {
        mimetype: file.type,
        size: file.size,
        w: width || undefined,
        h: height || undefined,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
      },
      thumbnail: thumbnail?.blob,
      thumbnailInfo: thumbnail?.info,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(link);
  }
};

const probeAudio = async (file: File): Promise<PreparedAttachment> => {
  const link = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  audio.preload = "metadata";

  try {
    const duration = await withTimeout(
      new Promise<number>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error("Audio could not be read."));
        audio.src = link;
      }),
    ).catch(() => NaN);

    return {
      file,
      name: file.name,
      mimetype: file.type,
      kind: "audio",
      info: {
        mimetype: file.type,
        size: file.size,
        duration: Number.isFinite(duration) ? Math.round(duration * 1000) : undefined,
      },
    };
  } finally {
    audio.removeAttribute("src");
    URL.revokeObjectURL(link);
  }
};

const asFile = (file: File): PreparedAttachment => ({
  file,
  name: file.name,
  mimetype: file.type || "application/octet-stream",
  kind: "file",
  info: { mimetype: file.type || "application/octet-stream", size: file.size },
});

export const prepareAttachment = async (original: File, stripMetadata: boolean) => {
  const file = typeOf(original);
  const kind = getKind(file.type);
  const probe =
    kind === "image" ? probeImage(file, stripMetadata)
    : kind === "video" ? probeVideo(file)
    : kind === "audio" ? probeAudio(file)
    : Promise.resolve(asFile(file));

  return probe.catch(() => (kind === "video" ? unprobedVideo(file) : asFile(file)));
};

const encryptBytes = async (bytes: Uint8Array) => {
  const { Attachment } = await import("@matrix-org/matrix-sdk-crypto-wasm");
  const { loadWasm } = await import("../crypto");
  await loadWasm();

  const encrypted = Attachment.encrypt(bytes);
  const data = encrypted.encryptedData;
  const info = JSON.parse(encrypted.mediaEncryptionInfo ?? "null");
  encrypted.free();

  if (!info) throw new Error("Attachment encryption failed.");
  return { data, info: info as Omit<EncryptedFile, "url"> };
};

export const uploadBytes = (
  session: Session,
  body: Blob,
  contentType: string,
  filename: string | undefined,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
) =>
  new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const query = filename ? `?filename=${encodeURIComponent(filename)}` : "";

    request.open("POST", `${session.homeserver}/_matrix/media/v3/upload${query}`);
    request.setRequestHeader("Authorization", `Bearer ${session.accessToken}`);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = (event) =>
      event.lengthComputable && onProgress?.(event.loaded / event.total);
    request.onload = () => {
      const response = JSON.parse(request.responseText || "{}");
      request.status >= 200 && request.status < 300 && response.content_uri
        ? resolve(response.content_uri)
        : reject(Object.assign(new Error(response.error ?? "Upload failed."), { errcode: response.errcode }));
    };
    request.onerror = () => reject(new Error("Upload failed."));
    request.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });

const uploadSource = async (
  session: Session,
  blob: Blob,
  mimetype: string,
  name: string,
  encrypted: boolean,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
) => {
  if (!encrypted) {
    const url = await uploadBytes(session, blob, mimetype, name, onProgress, signal);
    return { url };
  }

  const { data, info } = await encryptBytes(new Uint8Array(await blob.arrayBuffer()));
  const url = await uploadBytes(session, new Blob([data as BlobPart]), "application/octet-stream", undefined, onProgress, signal);
  return { file: { ...info, url } as EncryptedFile };
};

const MSGTYPES: Record<MediaKind, string> = {
  image: "m.image",
  video: "m.video",
  audio: "m.audio",
  file: "m.file",
};

export const uploadAttachment = async (
  session: Session,
  attachment: PreparedAttachment,
  encrypted: boolean,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
  extraInfo: Record<string, any> = {},
) => {
  const thumbnailShare = attachment.thumbnail ? 0.1 : 0;
  const thumbnail = attachment.thumbnail
    ? await uploadSource(session, attachment.thumbnail, attachment.thumbnailInfo?.mimetype, "thumbnail", encrypted, (value) => onProgress?.(value * thumbnailShare), signal).catch(() => null)
    : null;

  const main = await uploadSource(
    session,
    attachment.file,
    attachment.mimetype,
    attachment.name,
    encrypted,
    (value) => onProgress?.(thumbnailShare + value * (1 - thumbnailShare)),
    signal,
  );

  const info: Record<string, any> = { ...attachment.info, ...extraInfo };
  if (thumbnail?.url) info.thumbnail_url = thumbnail.url;
  if (thumbnail?.file) info.thumbnail_file = thumbnail.file;
  if (thumbnail) info.thumbnail_info = attachment.thumbnailInfo;

  return {
    msgtype: MSGTYPES[attachment.kind],
    body: attachment.name,
    filename: attachment.name,
    info,
    ...main,
  };
};
