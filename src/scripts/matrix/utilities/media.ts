import { API, baseURL } from "../../api/client";
import { serialiseURIObject } from "../../misc/uri";
import { loadSession } from "../session";
import type { Session } from "../types";

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

export const getMediaLink = (url: string, size = 96) =>
  (mediaCache[`${url}:${size}`] ??= queueMedia(
    () =>
      getAuthenticatedMedia(
        url,
        { width: size, height: size, method: "crop" },
        true,
      ) as Promise<string>,
  ).catch(() => undefined));

export const getWideMediaLink = (url: string, width = 640, height = 240) =>
  (mediaCache[`${url}:${width}x${height}`] ??= queueMedia(
    () =>
      getAuthenticatedMedia(
        url,
        { width, height, method: "scale" },
        true,
      ) as Promise<string>,
  ).catch(() => undefined));
