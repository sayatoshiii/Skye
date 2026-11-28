import { BackupDecryptionKey } from "@matrix-org/matrix-sdk-crypto-wasm";
import { deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api/key-passphrase.js";
import { decodeRecoveryKey, encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import decryptAESSecretStorageItem from "matrix-js-sdk/lib/utils/decryptAESSecretStorageItem.js";
import encryptAESSecretStorageItem from "matrix-js-sdk/lib/utils/encryptAESSecretStorageItem.js";
import { isMatrixError } from "../../api/client";
import { sessionRequest } from "../session";
import type { Session } from "../types";

export const MEGOLM_BACKUP_ALGORITHM = "m.megolm_backup.v1.curve25519-aes-sha2";
const SECRET_STORAGE_ALGORITHM = "m.secret_storage.v1.aes-hmac-sha2";
const BACKUP_SECRET = "m.megolm_backup.v1";

export type BackupInfo = {
  algorithm: string;
  auth_data: {
    public_key: string;
    signatures?: Record<string, Record<string, string>>;
    private_key_salt?: string;
    private_key_iterations?: number;
    private_key_bits?: number;
  };
  count?: number;
  etag?: string;
  version: string;
};

type PassphraseInfo = {
  algorithm: string;
  salt: string;
  iterations: number;
  bits?: number;
};

type SecretStorageKeyInfo = {
  algorithm: string;
  iv?: string;
  mac?: string;
  passphrase?: PassphraseInfo;
};

type EncryptedSecret = {
  encrypted?: Record<string, { iv: string; ciphertext: string; mac: string }>;
};

export type BackupErrorCode =
  | "no_backup"
  | "unsupported"
  | "invalid_key"
  | "wrong_key"
  | "no_secret";

export type BackupError = Error & { code: BackupErrorCode };

export const backupError = (code: BackupErrorCode): BackupError =>
  Object.assign(new Error(code), { code });

export const isBackupError = (error: unknown): error is BackupError =>
  error instanceof Error && "code" in error;

const trimEquals = (value: string) => value.replace(/=+$/, "");

export const getAccountData = <T>(session: Session, type: string) =>
  sessionRequest<T>(session, {
    endpoint: `user/${encodeURIComponent(session.userId)}/account_data/${encodeURIComponent(type)}`,
    method: "GET",
  }).catch((error) => {
    if (isMatrixError(error, "M_NOT_FOUND")) return null;
    throw error;
  });

export const getBackupInfo = (session: Session) =>
  sessionRequest<BackupInfo>(session, {
    endpoint: "room_keys/version",
    method: "GET",
  }).catch((error) => {
    if (isMatrixError(error, "M_NOT_FOUND")) return null;
    throw error;
  });

const decodeKey = (secret: string) => {
  try {
    return decodeRecoveryKey(secret.trim());
  } catch {
    throw backupError("invalid_key");
  }
};

const deriveFromPassphrase = (secret: string, info?: PassphraseInfo) => {
  if (!info || info.algorithm !== "m.pbkdf2") throw backupError("unsupported");
  return deriveRecoveryKeyFromPassphrase(
    secret,
    info.salt,
    info.iterations,
    info.bits ?? 256,
  );
};

const matchesKeyInfo = async (key: Uint8Array<ArrayBuffer>, info: SecretStorageKeyInfo) => {
  if (!info.iv || !info.mac) return true;

  const check = await encryptAESSecretStorageItem(
    "\0".repeat(32),
    key,
    "",
    info.iv,
  );

  return trimEquals(check.mac) === trimEquals(info.mac);
};

const unlockKey = async (secret: string, info: SecretStorageKeyInfo) => {
  const direct = await Promise.resolve().then(() => decodeKey(secret)).catch(() => null);
  const derived = () => Promise.resolve().then(() => (info.passphrase ? deriveFromPassphrase(secret, info.passphrase) : null)).catch(() => null);
  for (const candidate of [() => direct, derived]) {
    const key = await candidate();
    if (key && (await matchesKeyInfo(key, info))) return key;
  }
  throw backupError("wrong_key");
};

const toBackupKey = (bytes: Uint8Array) => {
  try {
    return BackupDecryptionKey.fromBase64(
      btoa(String.fromCharCode(...bytes)),
    );
  } catch {
    throw backupError("invalid_key");
  }
};

export const assertBackupKey = (key: BackupDecryptionKey, backup: BackupInfo) => {
  if (key.megolmV1PublicKey.publicKeyBase64 !== backup.auth_data.public_key)
    throw backupError("wrong_key");
  return key;
};

const fromSecretStorage = async (
  session: Session,
  secret: string,
  usePassphrase: boolean,
) => {
  const defaultKey = await getAccountData<{ key?: string }>(
    session,
    "m.secret_storage.default_key",
  );
  if (!defaultKey?.key) return null;

  const keyId = defaultKey.key;
  const keyInfo = await getAccountData<SecretStorageKeyInfo>(
    session,
    `m.secret_storage.key.${keyId}`,
  );
  if (!keyInfo) return null;
  if (keyInfo.algorithm !== SECRET_STORAGE_ALGORITHM)
    throw backupError("unsupported");

  const key = usePassphrase
    ? await deriveFromPassphrase(secret, keyInfo.passphrase)
    : decodeKey(secret);

  if (!(await matchesKeyInfo(key, keyInfo))) throw backupError("wrong_key");

  const stored = await getAccountData<EncryptedSecret>(session, BACKUP_SECRET);
  const payload = stored?.encrypted?.[keyId];
  if (!payload) throw backupError("no_secret");

  const backupKey = await decryptAESSecretStorageItem(
    payload,
    key,
    BACKUP_SECRET,
  ).catch(() => {
    throw backupError("wrong_key");
  });

  try {
    return BackupDecryptionKey.fromBase64(backupKey);
  } catch {
    throw backupError("invalid_key");
  }
};

const fromLegacyBackup = async (
  backup: BackupInfo,
  secret: string,
  usePassphrase: boolean,
) => {
  if (!usePassphrase) return toBackupKey(decodeKey(secret));

  const { private_key_salt, private_key_iterations, private_key_bits } =
    backup.auth_data;
  if (!private_key_salt || !private_key_iterations)
    throw backupError("wrong_key");

  return toBackupKey(
    await deriveFromPassphrase(secret, {
      algorithm: "m.pbkdf2",
      salt: private_key_salt,
      iterations: private_key_iterations,
      bits: private_key_bits,
    }),
  );
};

export const resolveBackupKey = async (
  session: Session,
  backup: BackupInfo,
  secret: string,
  usePassphrase: boolean,
) => {
  if (backup.algorithm !== MEGOLM_BACKUP_ALGORITHM)
    throw backupError("unsupported");

  const stored = await fromSecretStorage(session, secret, usePassphrase).catch(
    async (error) => {
      if (!isBackupError(error) || error.code !== "wrong_key" || usePassphrase)
        throw error;
      return null;
    },
  );

  return assertBackupKey(
    stored ?? (await fromLegacyBackup(backup, secret, usePassphrase)),
    backup,
  );
};

export type BackedUpSession = {
  first_message_index: number;
  forwarded_count: number;
  is_verified: boolean;
  session_data: { ephemeral: string; ciphertext: string; mac: string };
};

export type BackedUpKeys = {
  rooms?: Record<string, { sessions?: Record<string, BackedUpSession> }>;
};

export const fetchBackedUpKeys = (session: Session, version: string) =>
  sessionRequest<BackedUpKeys>(session, {
    endpoint: "room_keys/keys",
    method: "GET",
    query: { version },
  });

const CROSS_SIGNING_SECRETS = ["m.cross_signing.master", "m.cross_signing.self_signing", "m.cross_signing.user_signing"] as const;

const putAccountData = (session: Session, type: string, body: Record<string, unknown>) =>
  sessionRequest(session, {
    endpoint: `user/${encodeURIComponent(session.userId)}/account_data/${encodeURIComponent(type)}`,
    method: "PUT",
    body,
  });

export const hasSecretStorage = async (session: Session) => {
  const defaultKey = await getAccountData<{ key?: string }>(session, "m.secret_storage.default_key");
  return !!defaultKey?.key && !!(await getAccountData<SecretStorageKeyInfo>(session, `m.secret_storage.key.${defaultKey.key}`));
};

export const createSecretStorage = async (session: Session, secrets: Record<string, string>) => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const keyId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const check = await encryptAESSecretStorageItem("\0".repeat(32), key, "");
  await putAccountData(session, `m.secret_storage.key.${keyId}`, { algorithm: SECRET_STORAGE_ALGORITHM, iv: check.iv, mac: check.mac });
  await Promise.all(
    Object.entries(secrets).map(async ([name, value]) =>
      putAccountData(session, name, { encrypted: { [keyId]: await encryptAESSecretStorageItem(value, key, name) } }),
    ),
  );
  await putAccountData(session, "m.secret_storage.default_key", { key: keyId });
  return encodeRecoveryKey(key) ?? "";
};

export const openSecretStorage = async (session: Session, secret: string) => {
  const defaultKey = await getAccountData<{ key?: string }>(session, "m.secret_storage.default_key");
  const keyId = defaultKey?.key ?? "";
  const keyInfo = keyId ? await getAccountData<SecretStorageKeyInfo>(session, `m.secret_storage.key.${keyId}`) : null;
  if (!keyInfo) throw backupError("no_secret");
  if (keyInfo.algorithm !== SECRET_STORAGE_ALGORITHM) throw backupError("unsupported");
  const key = await unlockKey(secret, keyInfo);
  const read = async (name: string) => {
    const payload = (await getAccountData<EncryptedSecret>(session, name))?.encrypted?.[keyId];
    return payload ? decryptAESSecretStorageItem(payload, key, name).catch(() => undefined) : undefined;
  };
  const [master, selfSigning, userSigning, backup] = await Promise.all([...CROSS_SIGNING_SECRETS, BACKUP_SECRET].map(read));
  return { master, selfSigning, userSigning, backup };
};

export const crossSigningSecrets = (keys: { master?: string; selfSigning?: string; userSigning?: string }) =>
  Object.fromEntries(
    CROSS_SIGNING_SECRETS.map((name, index) => [name, [keys.master, keys.selfSigning, keys.userSigning][index]]).filter((entry): entry is [string, string] => !!entry[1]),
  );

export const BACKUP_SECRET_NAME = BACKUP_SECRET;
