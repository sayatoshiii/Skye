import { fieldBase } from "../../stores/presence";
import { sessionRequest } from "../session";
import type { Session } from "../types";
import { uploadBytes } from "./attachments";
import { withAuth, type PasswordPrompt } from "./auth";

export { withAuth, type PasswordPrompt };

export const BANNER_FIELD = "chat.skye.banner";

export type Device = {
  device_id: string;
  display_name?: string;
  last_seen_ip?: string;
  last_seen_ts?: number;
  last_seen_user_agent?: string;
  "org.matrix.msc3852.last_seen_user_agent"?: string;
};

export type DeviceKind = "mobile" | "desktop" | "web" | "unknown";
export type ClientInfo = { name?: string; version?: string; url?: string };

export const clientInfo = (session: Session, deviceId: string) =>
  sessionRequest<ClientInfo>(session, { endpoint: `user/${encodeURIComponent(session.userId)}/account_data/io.element.matrix_client_information.${encodeURIComponent(deviceId)}`, method: "GET" }).catch(() => null);

export const deviceKind = (device: Device, client: ClientInfo | null): DeviceKind => {
  const hint = [device.last_seen_user_agent, device["org.matrix.msc3852.last_seen_user_agent"], client?.name, device.display_name].join(" ").toLowerCase();
  return /android|iphone|ipad|\bios\b|mobile|element x on (iphone|ipad|android)/.test(hint)
    ? "mobile"
    : /electron|tauri/.test(hint)
      ? "desktop"
      : client?.url || /firefox|chrome|chromium|safari|edge|opera|browser|\bweb\b|mozilla/.test(hint)
        ? "web"
        : /desktop|nheko|fractal|for linux|for windows|for mac|on mac|macos|linux|windows/.test(hint)
          ? "desktop"
          : "unknown";
};

export type AccountManagement = { uri: string; actions: string[] };

const metadata = (session: Session, path: string) =>
  sessionRequest<{ account_management_uri?: string; account_management_actions_supported?: string[] }>(session, { base: `${session.homeserver}/_matrix/client/${path}`, endpoint: "auth_metadata", method: "GET" });

export const accountManagement = (session: Session): Promise<AccountManagement | null> =>
  metadata(session, "v1/")
    .catch(() => metadata(session, "unstable/org.matrix.msc2965/"))
    .then((value) => (value.account_management_uri ? { uri: value.account_management_uri, actions: value.account_management_actions_supported ?? [] } : null))
    .catch(() => null);

export const manageLink = (manage: AccountManagement, wanted: string[], deviceId?: string) => {
  const action = wanted.find((name) => manage.actions.includes(name));
  const url = new URL(manage.uri);
  action && url.searchParams.set("action", action);
  action && deviceId && url.searchParams.set("device_id", deviceId);
  return url.toString();
};


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

export type ThreePid = { medium: "email" | "msisdn" | string; address: string; added_at?: number };



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
