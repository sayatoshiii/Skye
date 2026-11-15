import { baseURL } from "../../api/client";
import { MEDIA } from "../../settings/config";
import { sessionRequest } from "../session";
import type { Session } from "../types";

export type LinkPreview = {
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
};

const cache = new Map<string, Promise<LinkPreview | null>>();

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const getLinkPreview = (session: Session, url: string, ts: number) => {
  const cached = cache.get(url);
  if (cached) return cached;

  const request = sessionRequest<Record<string, unknown>>(session, {
    base: baseURL.MATRIX_V1(session.homeserver),
    endpoint: "media/preview_url",
    method: "GET",
    query: { url, ts },
  })
    .then((og): LinkPreview | null => {
      const image = text(og["og:image"]);
      const preview = {
        siteName: text(og["og:site_name"]),
        title: text(og["og:title"]),
        description: text(og["og:description"]),
        image: image?.startsWith("mxc://") ? image : undefined,
        imageWidth: number(og["og:image:width"]),
        imageHeight: number(og["og:image:height"]),
      };

      return preview.title || preview.description ? preview : null;
    })
    .catch(() => null);

  if (cache.size >= MEDIA.previewCacheSize) cache.delete(cache.keys().next().value!);
  cache.set(url, request);
  return request;
};
