import { isMatrixError } from "../../api/client";
import { fieldBase } from "../../stores/presence";
import { sessionRequest } from "../session";
import type { Session } from "../types";
import { uploadBytes } from "./attachments";

export const BANNER_FIELD = "chat.skye.banner";

export type Device = {
  device_id: string;
  display_name?: string;
  last_seen_ip?: string;
  last_seen_ts?: number;
};

export type PasswordPrompt = () => Promise<string | null>;

const profilePath = (session: Session, field: string) =>
  `profile/${encodeURIComponent(session.userId)}/${field}`;

export const setDisplayName = (session: Session, displayname: string) =>
  sessionRequest(session, { endpoint: profilePath(session, "displayname"), method: "PUT", body: { displayname } });

export const setAvatarUrl = (session: Session, avatar_url: string) =>
  sessionRequest(session, { endpoint: profilePath(session, "avatar_url"), method: "PUT", body: { avatar_url } });

export const setBanner = (session: Session, kind: "stable" | "unstable", value: string | null) =>
  sessionRequest(session, {
    base: fieldBase(session, kind),
    endpoint: profilePath(session, BANNER_FIELD),
    method: value ? "PUT" : "DELETE",
    body: value ? { [BANNER_FIELD]: value } : undefined,
  });

export const uploadImage = (session: Session, blob: Blob, name: string) =>
  uploadBytes(session, blob, blob.type || "image/png", name);

export const listDevices = (session: Session) =>
  sessionRequest<{ devices?: Device[] }>(session, { endpoint: "devices", method: "GET" }).then((response) =>
    (response.devices ?? []).sort((a, b) => (b.last_seen_ts ?? 0) - (a.last_seen_ts ?? 0)),
  );

export const renameDevice = (session: Session, deviceId: string, display_name: string) =>
  sessionRequest(session, { endpoint: `devices/${encodeURIComponent(deviceId)}`, method: "PUT", body: { display_name } });

type Request = { endpoint: string; method: "POST" | "DELETE"; body: Record<string, unknown> };

export type ThreePid = { medium: "email" | "msisdn" | string; address: string; added_at?: number };

const passwordAuth = (session: Session, password: string, flow?: string) => ({
  type: "m.login.password",
  identifier: { type: "m.id.user", user: session.userId },
  password,
  session: flow,
});

export const withAuth = async (session: Session, request: Request, askPassword: PasswordPrompt) => {
  try {
    return await sessionRequest(session, request);
  } catch (error) {
    if (!isMatrixError(error) || error.status !== 401 || !Array.isArray(error.body.flows)) throw error;
    const password = await askPassword();
    return password === null
      ? null
      : sessionRequest(session, { ...request, body: { ...request.body, auth: passwordAuth(session, password, error.body.session as string | undefined) } });
  }
};

export const deleteDevice = (session: Session, deviceId: string, askPassword: PasswordPrompt) =>
  withAuth(session, { endpoint: `devices/${encodeURIComponent(deviceId)}`, method: "DELETE", body: {} }, askPassword);

export const deleteDevices = (session: Session, devices: string[], askPassword: PasswordPrompt) =>
  withAuth(session, { endpoint: "delete_devices", method: "POST", body: { devices } }, askPassword);

export const listThreepids = (session: Session) =>
  sessionRequest<{ threepids?: ThreePid[] }>(session, { endpoint: "account/3pid", method: "GET" }).then((response) => response.threepids ?? []);

export const changePassword = (session: Session, current: string, next: string) =>
  withAuth(session, { endpoint: "account/password", method: "POST", body: { new_password: next, logout_devices: false } }, () => Promise.resolve(current));

export const deactivateAccount = (session: Session, password: string) =>
  withAuth(session, { endpoint: "account/deactivate", method: "POST", body: { erase: false } }, () => Promise.resolve(password));
