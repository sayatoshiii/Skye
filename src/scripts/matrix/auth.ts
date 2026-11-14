import { API, baseURL, createMatrixError, matrixRequest } from "../api/client";
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

export type RegistrationFlow = { stages: string[] };

export type RegistrationChallenge = {
  session?: string;
  flows?: RegistrationFlow[];
  completed?: string[];
  params?: Record<string, unknown>;
};

export type RegistrationResult =
  | { kind: "registered"; session: Session }
  | { kind: "needs_token" }
  | { kind: "unsupported"; stages: string[]; session?: string; fallbackURL?: string };

export const SUPPORTED_REGISTRATION_STAGES = [
  "m.login.dummy",
  "m.login.registration_token",
];

const isSupportedStage = (stage: string, completed: string[]) =>
  completed.includes(stage) || SUPPORTED_REGISTRATION_STAGES.includes(stage);

const pickRegistrationFlow = (
  flows: RegistrationFlow[],
  completed: string[],
  hasToken: boolean,
) => {
  const supported = flows
    .filter((flow) => flow.stages.every((stage) => isSupportedStage(stage, completed)))
    .sort((a, b) => a.stages.length - b.stages.length);

  return (
    supported.find(
      (flow) =>
        hasToken ||
        completed.includes("m.login.registration_token") ||
        !flow.stages.includes("m.login.registration_token"),
    ) ?? supported[0]
  );
};

const postRegister = async (homeserver: string, body: Record<string, unknown>) => {
  const response = await API({
    base: baseURL.MATRIX(homeserver),
    endpoint: "register",
    query: { kind: "user" },
    body,
  });
  const payload = await response.json().catch(() => ({}));

  if (response.ok) return { done: payload as LoginResponse };
  if (response.status === 401 && Array.isArray(payload.flows))
    return { challenge: payload as RegistrationChallenge };

  throw createMatrixError(
    response.status,
    payload,
    response.headers.get("Retry-After"),
  );
};

export const getRegistrationFallbackURL = (
  homeserver: string,
  stage: string,
  session?: string,
) =>
  baseURL.MATRIX(homeserver) +
  `auth/${encodeURIComponent(stage)}/fallback/web` +
  (session ? `?session=${encodeURIComponent(session)}` : "");

export const registerAccount = async (
  homeserver: string,
  username: string,
  password: string,
  options: {
    token?: string;
    session?: string;
    deviceName?: string;
    persist?: boolean;
  } = {},
): Promise<RegistrationResult> => {
  const base = {
    username,
    password,
    initial_device_display_name: options.deviceName ?? "Skye",
  };
  const finish = (response: LoginResponse): RegistrationResult => {
    const session = toSession(homeserver, response);
    if (options.persist ?? true) saveSession(session);
    return { kind: "registered", session };
  };

  let step = await postRegister(
    homeserver,
    options.session ? { ...base, auth: { session: options.session } } : base,
  );
  if (step.done) return finish(step.done);

  const flows = step.challenge?.flows ?? [];
  const completed = step.challenge?.completed ?? [];
  const flow = pickRegistrationFlow(flows, completed, Boolean(options.token));

  if (!flow) {
    const stages = [
      ...new Set(
        (flows[0]?.stages ?? []).filter((stage) => !isSupportedStage(stage, completed)),
      ),
    ];
    const session = step.challenge?.session;
    return {
      kind: "unsupported",
      stages,
      session,
      fallbackURL: stages[0]
        ? getRegistrationFallbackURL(homeserver, stages[0], session)
        : undefined,
    };
  }

  if (
    flow.stages.includes("m.login.registration_token") &&
    !completed.includes("m.login.registration_token") &&
    !options.token
  )
    return { kind: "needs_token" };

  for (const stage of flow.stages) {
    const challenge = step.challenge;
    if (!challenge || challenge.completed?.includes(stage)) continue;

    step = await postRegister(homeserver, {
      ...base,
      auth: {
        type: stage,
        session: challenge.session,
        ...(stage === "m.login.registration_token" ? { token: options.token } : {}),
      },
    });

    if (step.done) return finish(step.done);
  }

  throw createMatrixError(401, { errcode: "M_UNAUTHORIZED" });
};
