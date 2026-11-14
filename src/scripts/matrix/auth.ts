import { API, baseURL, matrixRequest } from "../api/client";
import { saveSession } from "./session";
import type { LoginFlow, LoginResponse, Session } from "./types";

export const login = async (user?: string, password?: string) => {
  const response = await API({
    base: baseURL.MATRIX("https://matrix.org"),
    endpoint: "login",
    body: {
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user,
      },
      password,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to sign-in!");
  }

  const { access_token, device_id, user_id } = await response.json();

  localStorage.setItem("access_token", access_token);
  localStorage.setItem("device_id", device_id);
  localStorage.setItem("user_id", user_id);
};

export const getAuthDetails = () => ({
  access_token: localStorage.getItem("access_token"),
  device_id: localStorage.getItem("device_id"),
  user_id: localStorage.getItem("user_id"),
});

export type AuthMethod = "password" | "sso" | "token" | "oidc";

export const getLoginFlows = async (homeserver: string) =>
  (
    await matrixRequest<{ flows: LoginFlow[] }>({
      base: baseURL.MATRIX(homeserver),
      endpoint: "login",
      method: "GET",
    })
  ).flows;

export const getAuthMethods = (flows: LoginFlow[]): AuthMethod[] =>
  flows.flatMap((flow): AuthMethod[] => {
    if (flow.type === "m.login.password") return ["password"];
    if (flow.type === "m.login.token") return ["token"];
    if (flow.type === "m.login.sso")
      return flow["org.matrix.msc3824.delegated_oidc_compatibility"]
        ? ["sso", "oidc"]
        : ["sso"];
    return [];
  });

const toSession = (homeserver: string, response: LoginResponse): Session => ({
  homeserver: response.well_known?.["m.homeserver"]?.base_url
    ? response.well_known["m.homeserver"].base_url.replace(/\/+$/, "")
    : homeserver,
  accessToken: response.access_token,
  userId: response.user_id,
  deviceId: response.device_id,
  refreshToken: response.refresh_token,
});

const completeLogin = async (
  homeserver: string,
  body: Record<string, unknown>,
  persist: boolean,
) => {
  const response = await matrixRequest<LoginResponse>({
    base: baseURL.MATRIX(homeserver),
    endpoint: "login",
    body: {
      initial_device_display_name: "Skye",
      ...body,
    },
  });
  const session = toSession(homeserver, response);

  if (persist) saveSession(session);

  return session;
};

export const loginWithPassword = (
  homeserver: string,
  user: string,
  password: string,
  options: { deviceId?: string; deviceName?: string; persist?: boolean } = {},
) =>
  completeLogin(
    homeserver,
    {
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
      device_id: options.deviceId,
      initial_device_display_name: options.deviceName ?? "Skye",
    },
    options.persist ?? true,
  );

export const getSSORedirectURL = (
  homeserver: string,
  redirectUrl: string,
  identityProviderId?: string,
) =>
  baseURL.MATRIX(homeserver) +
  `login/sso/redirect${identityProviderId ? `/${encodeURIComponent(identityProviderId)}` : ""}` +
  `?redirectUrl=${encodeURIComponent(redirectUrl)}`;

export const getLoginTokenFromURL = (url: string | URL = location.href) =>
  new URL(url).searchParams.get("loginToken");

export const loginWithToken = (
  homeserver: string,
  token: string,
  options: { deviceName?: string; persist?: boolean } = {},
) =>
  completeLogin(
    homeserver,
    {
      type: "m.login.token",
      token,
      initial_device_display_name: options.deviceName ?? "Skye",
    },
    options.persist ?? true,
  );

export type OIDCAuthProvider = {
  issuer: string;
  getAuthorisationURL: (redirectUrl: string) => Promise<string>;
  completeAuthorisation: (callbackUrl: string) => Promise<Session>;
};

const authProviders: Partial<Record<AuthMethod, OIDCAuthProvider>> = {};

export const registerAuthProvider = (
  method: AuthMethod,
  provider: OIDCAuthProvider,
) => {
  authProviders[method] = provider;
};

export const getAuthProvider = (method: AuthMethod) => authProviders[method];
