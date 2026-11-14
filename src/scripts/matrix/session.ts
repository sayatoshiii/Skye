import { API, baseURL, matrixRequest } from "../api/client";
import type { Session } from "./types";

const STORAGE_KEYS = {
  homeserver: "homeserver",
  accessToken: "access_token",
  deviceId: "device_id",
  userId: "user_id",
  refreshToken: "refresh_token",
} as const;

const hasStorage = () => typeof localStorage !== "undefined";

export const saveSession = (session: Session) => {
  if (!hasStorage()) return;

  localStorage.setItem(STORAGE_KEYS.homeserver, session.homeserver);
  localStorage.setItem(STORAGE_KEYS.accessToken, session.accessToken);
  localStorage.setItem(STORAGE_KEYS.deviceId, session.deviceId);
  localStorage.setItem(STORAGE_KEYS.userId, session.userId);

  if (session.refreshToken)
    localStorage.setItem(STORAGE_KEYS.refreshToken, session.refreshToken);
};

export const loadSession = (
  fallbackHomeserver = "https://matrix.org",
): Session | null => {
  if (!hasStorage()) return null;

  const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
  const userId = localStorage.getItem(STORAGE_KEYS.userId);
  const deviceId = localStorage.getItem(STORAGE_KEYS.deviceId);

  if (!accessToken || !userId || !deviceId) return null;

  return {
    homeserver:
      localStorage.getItem(STORAGE_KEYS.homeserver) ?? fallbackHomeserver,
    accessToken,
    userId,
    deviceId,
    refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken) ?? undefined,
  };
};

export const clearSession = () => {
  if (!hasStorage()) return;

  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
};

export const isLoggedIn = () => loadSession() !== null;

export const logout = async (session: Session | null = loadSession()) => {
  if (session) {
    await matrixRequest({
      base: baseURL.MATRIX(session.homeserver),
      endpoint: "logout",
      accessToken: session.accessToken,
      body: {},
    }).catch(() => undefined);
  }

  clearSession();
};

export const whoami = (session: Session) =>
  matrixRequest<{ user_id: string; device_id?: string; is_guest?: boolean }>({
    base: baseURL.MATRIX(session.homeserver),
    endpoint: "account/whoami",
    method: "GET",
    accessToken: session.accessToken,
  });

export const sessionRequest = <T>(
  session: Session,
  options: Omit<Parameters<typeof API>[0], "base" | "accessToken"> & {
    base?: string;
  },
) =>
  matrixRequest<T>({
    base: baseURL.MATRIX(session.homeserver),
    accessToken: session.accessToken,
    ...options,
  });
