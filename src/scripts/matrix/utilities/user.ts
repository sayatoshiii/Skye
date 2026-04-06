import type { User } from "matrix-js-sdk";
import { Client } from "../client";
import { getAuthenticatedMedia } from "./media";

const userCache: Record<
  string,
  {
    timeout?: number;
    avatar?: string;
    info?: User;
  }
> = {};

const CACHE_TIMEOUT = 60 * 1000;

export const isUserCacheTimeoutActive = (id: string) =>
  Date.now() - (userCache?.[id]?.timeout ?? 0) < CACHE_TIMEOUT;

export const getUser = (
  id: string = Client.getUserId()!,
  forceUpdate?: boolean,
) => {
  const cache = userCache?.[id];
  let info = cache?.info;

  if (!forceUpdate) if (isUserCacheTimeoutActive(id)) return info;

  if (info) return info;

  info = Client.getUser(id)!;

  if (!userCache?.[id]) userCache[id] = {};
  userCache[id].info = info!;

  return info;
};

export const getUserAvatar = async (
  id: string,
  avatarUrl?: string,
  params?: Parameters<typeof getAuthenticatedMedia>[1],
  forceUpdate?: boolean,
) => {
  const cache = userCache?.[id];
  const avatar = cache?.avatar;

  if (!forceUpdate) if (isUserCacheTimeoutActive(id)) return avatar;

  if (!avatarUrl) {
    const user = getUser(id);
    if (!user?.avatarUrl) return;

    avatarUrl = user.avatarUrl;
  }

  const media = (await getAuthenticatedMedia(
    avatarUrl!,
    params,
    true,
  )) as string;

  if (!userCache?.[id]) userCache[id] = {};

  userCache[id].avatar = media;
  userCache[id].timeout = Date.now();

  return media;
};
