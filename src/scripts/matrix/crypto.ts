import {
  BackupDecryptionKey,
  DecryptionSettings,
  DeviceId as WasmDeviceId,
  DeviceLists as WasmDeviceLists,
  EncryptionAlgorithm,
  EncryptionSettings,
  HistoryVisibility,
  initAsync,
  KeysBackupRequest,
  OlmMachine,
  RequestType,
  RoomId as WasmRoomId,
  TrustRequirement,
  UserId as WasmUserId,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { sessionRequest } from "./session";
import type {
  CryptoHooks,
  CryptoSyncData,
  MatrixEvent,
  RoomId,
  RoomSummary,
  Session,
  UserId,
} from "./types";
import {
  assertBackupKey,
  backupError,
  fetchBackedUpKeys,
  getBackupInfo,
  resolveBackupKey,
  type BackupInfo,
} from "./utilities/backup";
import {
  createVerification,
  type VerificationState,
} from "./verification";

export type CryptoContext = {
  session: Session;
  getRoom: (roomId: RoomId) => RoomSummary | undefined;
  getMembers: (roomId: RoomId) => Promise<UserId[]>;
  onKeysReceived: (roomIds: RoomId[]) => void;
  onVerification: (state: VerificationState) => void;
  onStoreLocked: () => void;
};

export type RestoreProgress = { imported: number; total: number };

type OutgoingRequest = Awaited<ReturnType<OlmMachine["outgoingRequests"]>>[number];

const PASSPHRASE_PREFIX = "crypto_passphrase";
const STORE_SUFFIXES = ["matrix-sdk-crypto", "matrix-sdk-crypto-meta"];

let wasmReady: Promise<void> | null = null;

const loadWasm = () => (wasmReady ??= initAsync());

export const getStoreName = (session: Pick<Session, "userId" | "deviceId">) =>
  `skye-crypto-${session.userId}-${session.deviceId}`;

const passphraseKey = (session: Pick<Session, "userId" | "deviceId">) =>
  `${PASSPHRASE_PREFIX}:${session.userId}:${session.deviceId}`;

const randomPassphrase = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
};

const getPassphrase = (session: Session) => {
  const key = passphraseKey(session);
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = randomPassphrase();
  localStorage.setItem(key, created);
  return created;
};

const isKeyConflict = (outgoing: { type: RequestType }, error: unknown) =>
  outgoing.type === RequestType.KeysUpload &&
  String((error as Error)?.message ?? error).includes("already exists");

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

export const clearCryptoStore = async (
  session: Pick<Session, "userId" | "deviceId"> | null,
) => {
  if (!session || typeof localStorage === "undefined") return;

  localStorage.removeItem(passphraseKey(session));
  await Promise.all(
    STORE_SUFFIXES.map((suffix) =>
      deleteDatabase(`${getStoreName(session)}::${suffix}`),
    ),
  );
};

const HISTORY_VISIBILITY: Record<string, HistoryVisibility> = {
  invited: HistoryVisibility.Invited,
  joined: HistoryVisibility.Joined,
  shared: HistoryVisibility.Shared,
  world_readable: HistoryVisibility.WorldReadable,
};

const buildEncryptionSettings = (room: RoomSummary) => {
  const settings = new EncryptionSettings();
  const encryption = room.encryption ?? {};
  const visibility =
    room.state["m.room.history_visibility"]?.[""]?.content?.history_visibility;

  settings.algorithm = EncryptionAlgorithm.MegolmV1AesSha2;
  settings.historyVisibility =
    HISTORY_VISIBILITY[visibility] ?? HistoryVisibility.Shared;

  if (typeof encryption.rotation_period_ms === "number")
    settings.rotationPeriod = BigInt(encryption.rotation_period_ms) * 1000n;
  if (typeof encryption.rotation_period_msgs === "number")
    settings.rotationPeriodMessages = BigInt(encryption.rotation_period_msgs);

  return settings;
};

const createSerialQueue = () => {
  const tails: Record<string, Promise<unknown>> = {};

  return <T>(key: string, task: () => Promise<T>) => {
    const run = (tails[key] ?? Promise.resolve()).then(task, task);
    tails[key] = run.catch(() => undefined);
    return run;
  };
};

export const createCrypto = (context: CryptoContext) => {
  const { session } = context;
  const request = <T>(options: Parameters<typeof sessionRequest>[1]) =>
    sessionRequest<T>(session, options);
  const decryptionSettings = () =>
    new DecryptionSettings(TrustRequirement.Untrusted);
  const serialise = createSerialQueue();

  let closed = false;
  let processing: Promise<void> | null = null;
  let pending = false;

  const ready: Promise<OlmMachine | null> = loadWasm()
    .then(() =>
      OlmMachine.initialize(
        new WasmUserId(session.userId),
        new WasmDeviceId(session.deviceId),
        getStoreName(session),
        getPassphrase(session),
      ),
    )
    .then((machine) => {
      machine.registerRoomKeyUpdatedCallback(async (infos) => {
        context.onKeysReceived([
          ...new Set(infos.map((info) => info.roomId.toString())),
        ]);
      });
      machine.registerReceiveSecretCallback((name, value) =>
        verification.receiveSecret(name, value),
      );
      return machine;
    })
    .catch((error) => {
      console.error("Skye crypto failed to start", error);
      if (String(error).includes("aead")) context.onStoreLocked();
      return null;
    });

  const send = (outgoing: OutgoingRequest | KeysBackupRequest) => {
    switch (outgoing.type) {
      case RequestType.KeysUpload:
        return request({ endpoint: "keys/upload", body: outgoing.body });
      case RequestType.KeysQuery:
        return request({ endpoint: "keys/query", body: outgoing.body });
      case RequestType.KeysClaim:
        return request({ endpoint: "keys/claim", body: outgoing.body });
      case RequestType.SignatureUpload:
        return request({
          endpoint: "keys/signatures/upload",
          body: outgoing.body,
        });
      case RequestType.ToDevice: {
        const toDevice = outgoing as Extract<OutgoingRequest, { txn_id: string; event_type: string; room_id?: never }>;
        return request({
          endpoint: `sendToDevice/${encodeURIComponent(toDevice.event_type)}/${encodeURIComponent(toDevice.txn_id)}`,
          method: "PUT",
          body: toDevice.body,
        });
      }
      case RequestType.RoomMessage: {
        const message = outgoing as Extract<OutgoingRequest, { room_id: string }>;
        return request({
          endpoint: `rooms/${encodeURIComponent(message.room_id)}/send/${encodeURIComponent(message.event_type)}/${encodeURIComponent(message.txn_id)}`,
          method: "PUT",
          body: message.body,
        });
      }
      case RequestType.KeysBackup:
        return request({
          endpoint: "room_keys/keys",
          method: "PUT",
          query: { version: (outgoing as KeysBackupRequest).version },
          body: outgoing.body,
        });
      default:
        return Promise.reject(new Error(`Unknown request type ${outgoing.type}`));
    }
  };

  const sendAndMark = async (
    machine: OlmMachine,
    outgoing: OutgoingRequest | KeysBackupRequest,
  ) => {
    const response = await send(outgoing);
    if (outgoing.id)
      await machine.markRequestAsSent(
        outgoing.id,
        outgoing.type,
        JSON.stringify(response),
      );
  };

  const backUpKeys = async (machine: OlmMachine) => {
    if (!(await machine.isBackupEnabled())) return;

    for (
      let backup = await machine.backupRoomKeys();
      backup && !closed;
      backup = await machine.backupRoomKeys()
    )
      await sendAndMark(machine, backup);
  };

  const drain = async (machine: OlmMachine) => {
    do {
      pending = false;
      const requests = await machine.outgoingRequests();

      await Promise.all(
        requests.map((outgoing) =>
          sendAndMark(machine, outgoing).catch((error) => {
            console.warn("Skye crypto request failed", outgoing.type, error);
            if (isKeyConflict(outgoing, error)) context.onStoreLocked();
          }),
        ),
      );

      await backUpKeys(machine).catch((error) =>
        console.warn("Skye key backup failed", error),
      );
    } while (pending && !closed);
  };

  const processOutgoing = async () => {
    const machine = await ready;
    if (!machine || closed) return;

    if (processing) {
      pending = true;
      return processing;
    }

    processing = drain(machine).finally(() => (processing = null));
    return processing;
  };

  const onSync = async (data: CryptoSyncData) => {
    const machine = await ready;
    if (!machine || closed) return;

    const toUserIds = (ids?: UserId[]) =>
      (ids ?? []).map((id) => new WasmUserId(id));

    await machine.receiveSyncChanges(
      JSON.stringify(data.toDevice),
      new WasmDeviceLists(
        toUserIds(data.deviceLists.changed),
        toUserIds(data.deviceLists.left),
      ),
      new Map(Object.entries(data.oneTimeKeyCounts)),
      data.unusedFallbackKeyTypes
        ? new Set(data.unusedFallbackKeyTypes)
        : undefined,
      decryptionSettings(),
    );

    processOutgoing();
    await verification.scan();
  };

  const decryptEvent = async (
    event: MatrixEvent,
    roomId: RoomId,
  ): Promise<MatrixEvent | null> => {
    const machine = await ready;
    if (!machine || closed) return null;

    const decrypted = await machine.decryptRoomEvent(
      JSON.stringify({ ...event, room_id: roomId }),
      new WasmRoomId(roomId),
      decryptionSettings(),
    );
    const clear = JSON.parse(decrypted.event) as MatrixEvent;

    return { type: clear.type, content: clear.content ?? {} };
  };

  const shareRoomKey = (machine: OlmMachine, room: RoomSummary) =>
    serialise(room.roomId, async () => {
      const members = (await context.getMembers(room.roomId)).map(
        (id) => new WasmUserId(id),
      );

      await machine.updateTrackedUsers(members.map((id) => id.clone()));
      await processOutgoing();

      const claim = await machine.getMissingSessions(
        members.map((id) => id.clone()),
      );
      if (claim) await sendAndMark(machine, claim);

      const shares = await machine.shareRoomKey(
        new WasmRoomId(room.roomId),
        members,
        buildEncryptionSettings(room),
      );

      for (const share of shares) await sendAndMark(machine, share);
    });

  const encryptEvent = async (
    type: string,
    content: Record<string, any>,
    roomId: RoomId,
  ): Promise<MatrixEvent | null> => {
    const room = context.getRoom(roomId);
    if (!room?.encryption) return null;

    const machine = await ready;
    if (!machine || closed) throw new Error("Encryption is unavailable.");

    await shareRoomKey(machine, room);

    const encrypted = await serialise(roomId, () =>
      machine.encryptRoomEvent(
        new WasmRoomId(roomId),
        type,
        JSON.stringify(content),
      ),
    );

    processOutgoing();

    return { type: "m.room.encrypted", content: JSON.parse(encrypted) };
  };

  const enableBackup = async (
    machine: OlmMachine,
    key: BackupDecryptionKey,
    backup: BackupInfo,
  ) => {
    await machine.saveBackupDecryptionKey(key, backup.version);

    const verification = await machine.verifyBackup(backup).catch(() => null);
    if (!verification?.trusted()) return;

    await machine.enableBackupV1(backup.auth_data.public_key, backup.version);
    processOutgoing();
  };

  const restoreWithKey = async (
    key: BackupDecryptionKey,
    onProgress?: (progress: RestoreProgress) => void,
    known?: BackupInfo,
  ) => {
    const machine = await ready;
    if (!machine || closed) throw new Error("Encryption is unavailable.");

    const backup = known ?? (await getBackupInfo(session));
    if (!backup) throw backupError("no_backup");
    assertBackupKey(key, backup);

    const { rooms = {} } = await fetchBackedUpKeys(session, backup.version);
    const decrypted = new Map<WasmRoomId, Map<string, unknown>>();

    Object.entries(rooms).forEach(([roomId, { sessions = {} }]) => {
      const roomKeys = new Map<string, unknown>();

      Object.entries(sessions).forEach(([sessionId, data]) => {
        try {
          const { ephemeral, mac, ciphertext } = data.session_data;
          roomKeys.set(
            sessionId,
            JSON.parse(key.decryptV1(ephemeral, mac, ciphertext)),
          );
        } catch {
          return;
        }
      });

      if (roomKeys.size) decrypted.set(new WasmRoomId(roomId), roomKeys);
    });

    const roomIds = [...decrypted.keys()].map((id) => id.toString());
    const result = await machine.importBackedUpRoomKeys(
      decrypted,
      (progress, total) =>
        onProgress?.({ imported: Number(progress), total: Number(total) }),
      backup.version,
    );

    await enableBackup(machine, key, backup).catch((error) =>
      console.warn("Skye could not enable key backup", error),
    );

    context.onKeysReceived(roomIds);

    return {
      imported: Number(result.importedCount),
      total: Number(result.totalCount),
    };
  };

  const restoreFromBackup = async (
    secret: string,
    usePassphrase: boolean,
    onProgress?: (progress: RestoreProgress) => void,
  ) => {
    const backup = await getBackupInfo(session);
    if (!backup) throw backupError("no_backup");

    const key = await resolveBackupKey(session, backup, secret, usePassphrase);
    return restoreWithKey(key, onProgress, backup);
  };

  const verification = createVerification({
    userId: session.userId,
    ready,
    send: async (outgoing) => {
      const machine = await ready;
      if (!machine || closed) return;
      await sendAndMark(machine, outgoing);
      processOutgoing();
    },
    flush: async () => {
      await processOutgoing();
    },
    restoreWithKey,
    onChange: context.onVerification,
  });

  const hasBackup = async () => (await getBackupInfo(session)) !== null;

  const close = async () => {
    closed = true;
    const machine = await ready;
    await processing?.catch(() => undefined);
    machine?.close();
  };

  const hooks: CryptoHooks = { onSync, decryptEvent, encryptEvent };

  return {
    hooks,
    getMachine: () => ready,
    processOutgoing,
    restoreFromBackup,
    restoreWithKey,
    verification,
    hasBackup,
    close,
  };
};

export type CryptoHandle = ReturnType<typeof createCrypto>;
