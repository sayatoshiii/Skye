import { loadSession, sessionRequest } from "../session";
import type { UserId } from "../types";

export type ExtendedProfile = {
  userId: UserId;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  banner?: string;
};

const profileCache: Record<UserId, Promise<ExtendedProfile | null>> = {};

const readText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readBio = (value: unknown) =>
  readText(value) ??
  (Array.isArray(value)
    ? readText(value.find((entry) => entry?.mimetype === "text/plain" || !entry?.mimetype)?.body)
    : undefined);

export const fetchProfile = (userId: UserId) =>
  (profileCache[userId] ??= (async () => {
    const session = loadSession();
    if (!session) return null;

    const profile = await sessionRequest<Record<string, unknown>>(session, {
      endpoint: `profile/${encodeURIComponent(userId)}`,
      method: "GET",
    });

    return {
      userId,
      displayName: readText(profile.displayname),
      avatarUrl: readText(profile.avatar_url),
      bio: readBio(profile["m.bio"]) ?? readBio(profile["chat.skye.bio"]),
      banner: readText(profile["chat.skye.banner"]),
    } satisfies ExtendedProfile;
  })().catch(() => {
    delete profileCache[userId];
    return null;
  }));
