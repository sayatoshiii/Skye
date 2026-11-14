import { baseURL, matrixRequest } from "../api/client";
import type { ServerVersions, WellKnown } from "./types";

export const normaliseHomeserver = (input: string) => {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const serverNameFromUserId = (userId: string) =>
  userId.slice(userId.indexOf(":") + 1);

export const getWellKnown = async (serverName: string) => {
  const response = await fetch(
    `${normaliseHomeserver(serverName)}/.well-known/matrix/client`,
  ).catch(() => null);

  if (!response?.ok) return null;

  return (await response.json().catch(() => null)) as WellKnown | null;
};

export const getServerVersions = (homeserver: string) =>
  matrixRequest<ServerVersions>({
    base: baseURL.MATRIX_VERSIONS(homeserver),
    endpoint: "versions",
    method: "GET",
  });

export const supportsVersion = (versions: ServerVersions, version: string) =>
  versions.versions.includes(version);

export const resolveHomeserver = async (serverNameOrUrl: string) => {
  const wellKnown = await getWellKnown(serverNameOrUrl);
  const homeserver = normaliseHomeserver(
    wellKnown?.["m.homeserver"]?.base_url ?? serverNameOrUrl,
  );
  const versions = await getServerVersions(homeserver);

  return {
    homeserver,
    versions,
    wellKnown,
    authIssuer: wellKnown?.["org.matrix.msc2965.authentication"]?.issuer,
  };
};
