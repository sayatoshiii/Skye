import {
  BackupDecryptionKey,
  OwnUserIdentity,
  Sas,
  UserId as WasmUserId,
  VerificationMethod,
  VerificationRequestPhase,
  type OlmMachine,
  type RoomMessageRequest,
  type ToDeviceRequest,
  type VerificationRequest,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { isBackupError } from "./utilities/backup";

export type VerificationPhase =
  | "idle"
  | "requesting"
  | "incoming"
  | "waiting"
  | "comparing"
  | "confirming"
  | "syncing"
  | "restoring"
  | "restored"
  | "cancelled"
  | "failed";

export type VerificationEmoji = { symbol: string; description: string };

export type VerificationProgress = { imported: number; total: number };

export type VerificationState = {
  phase: VerificationPhase;
  deviceId: string | null;
  emoji: VerificationEmoji[];
  progress: VerificationProgress;
  error: string | null;
};

type Outgoing = ToDeviceRequest | RoomMessageRequest;

export type VerificationContext = {
  userId: string;
  ready: Promise<OlmMachine | null>;
  send: (outgoing: Outgoing) => Promise<void>;
  flush: () => Promise<void>;
  restoreWithKey: (
    key: BackupDecryptionKey,
    onProgress: (progress: VerificationProgress) => void,
  ) => Promise<VerificationProgress>;
  onChange: (state: VerificationState) => void;
};

export const BACKUP_SECRET_NAME = "m.megolm_backup.v1";

const METHODS = [VerificationMethod.SasV1];
const SETTLED: VerificationPhase[] = ["idle", "restored", "cancelled", "failed"];

export const initialVerification: VerificationState = {
  phase: "idle",
  deviceId: null,
  emoji: [],
  progress: { imported: 0, total: 0 },
  error: null,
};

const errorCode = (cause: unknown) =>
  isBackupError(cause) ? cause.code : "generic";

export const createVerification = (context: VerificationContext) => {
  let state = initialVerification;
  let request: VerificationRequest | null = null;
  let sas: Sas | null = null;
  let starting = false;
  let accepting = false;
  let verified = false;
  let restoring = false;
  let tail: Promise<void> = Promise.resolve();
  const watched = new Set<string>();

  const emit = (patch: Partial<VerificationState>) => {
    state = { ...state, ...patch };
    context.onChange(state);
  };

  const own = () => new WasmUserId(context.userId);

  const sendIfAny = async (outgoing?: Outgoing) => {
    if (outgoing) await context.send(outgoing);
  };

  const fail = (cause: unknown) => {
    console.warn("Skye verification failed", cause);
    emit({ phase: "failed", emoji: [], error: errorCode(cause) });
  };

  const watch = (kind: string, target: VerificationRequest | Sas) => {
    const key = `${kind}:${target.flowId}`;
    if (watched.has(key)) return;
    watched.add(key);
    target.registerChangesCallback(async () => refresh());
  };

  const adopt = (next: VerificationRequest) => {
    request = next;
    sas = null;
    starting = accepting = verified = false;
    watch("request", next);
  };

  const adoptSas = (next: Sas) => {
    sas = next;
    watch("sas", next);
  };

  const restore = async (key: BackupDecryptionKey) => {
    if (restoring) return;
    restoring = true;
    emit({ phase: "restoring", error: null });

    try {
      const progress = await context.restoreWithKey(key, (next) =>
        emit({ progress: next }),
      );
      emit({ phase: "restored", progress });
    } catch (cause) {
      fail(cause);
    } finally {
      restoring = false;
    }
  };

  const receiveSecret = async (name: string, value: string) => {
    if (name !== BACKUP_SECRET_NAME) return;

    const machine = await context.ready;
    let key: BackupDecryptionKey;
    try {
      key = BackupDecryptionKey.fromBase64(value);
    } catch {
      return;
    }

    await machine?.deleteSecretsFromInbox(name);
    await restore(key);
  };

  const collectSecrets = async (machine: OlmMachine) => {
    const inbox = await machine.getSecretsFromInbox(BACKUP_SECRET_NAME);
    for (const value of inbox) await receiveSecret(BACKUP_SECRET_NAME, value);
    if (restoring || state.phase === "restored") return;

    const known = (await machine.getBackupKeys()).decryptionKey;
    if (known) await restore(known);
  };

  const onVerified = async () => {
    if (verified) return;
    verified = true;
    emit({ phase: "syncing", emoji: [], error: null });

    const machine = await context.ready;
    if (!machine) return;

    await machine.requestMissingSecretsIfNeeded();
    await context.flush();
    await collectSecrets(machine);
  };

  const step = async () => {
    if (!request) return;

    if (request.isCancelled() || sas?.isCancelled()) {
      if (!verified) emit({ phase: "cancelled", emoji: [] });
      return;
    }

    if (request.isDone() || sas?.isDone()) return onVerified();

    const deviceId = request.otherDeviceId?.toString() ?? state.deviceId;
    const phase = request.phase();

    if (phase === VerificationRequestPhase.Requested && !request.weStarted())
      return emit({ phase: "incoming", deviceId });

    if (phase === VerificationRequestPhase.Ready && request.weStarted() && !starting) {
      starting = true;
      const started = await request.startSas();
      if (started) {
        adoptSas(started[0]);
        await context.send(started[1]);
      }
    }

    if (!sas) {
      const flow = request.getVerification();
      if (flow instanceof Sas) adoptSas(flow);
    }

    if (!sas) return emit({ phase: "waiting", deviceId });

    if (!sas.weStarted() && !sas.hasBeenAccepted() && !accepting) {
      accepting = true;
      await sendIfAny(sas.accept());
    }

    if (sas.haveWeConfirmed())
      return emit({ phase: "confirming", deviceId, emoji: [] });

    const emoji = sas.canBePresented() ? sas.emoji() : undefined;
    if (!emoji) return emit({ phase: "waiting", deviceId });

    emit({
      phase: "comparing",
      deviceId,
      emoji: emoji.map(({ symbol, description }) => ({ symbol, description })),
    });
  };

  const refresh = () => {
    tail = tail.then(step).catch(fail);
    return tail;
  };

  const scan = async () => {
    const machine = await context.ready;
    if (!machine) return;

    if (request && !SETTLED.includes(state.phase)) return refresh();

    const incoming = machine
      .getVerificationRequests(own())
      .find(
        (candidate) =>
          !candidate.weStarted() &&
          candidate.phase() === VerificationRequestPhase.Requested &&
          candidate.flowId !== request?.flowId,
      );
    if (!incoming) return;

    adopt(incoming);
    emit({ ...initialVerification, phase: "incoming" });
    await refresh();
  };

  const start = async () => {
    emit({ ...initialVerification, phase: "requesting" });

    try {
      const machine = await context.ready;
      if (!machine) throw new Error("Encryption is unavailable.");

      let identity = await machine.getIdentity(own());
      if (!(identity instanceof OwnUserIdentity)) {
        await machine.updateTrackedUsers([own()]);
        await context.flush();
        identity = await machine.getIdentity(own());
      }
      if (!(identity instanceof OwnUserIdentity))
        return emit({ phase: "failed", error: "no_identity" });

      const [next, outgoing] = await identity.requestVerification(METHODS);
      adopt(next);
      await context.send(outgoing);
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const accept = async () => {
    if (!request) return;
    try {
      await sendIfAny(request.acceptWithMethods(METHODS));
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const confirm = async () => {
    if (!sas) return;
    try {
      const outgoing = await sas.confirm();
      for (const next of outgoing) await context.send(next);
      await context.flush();
      await refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  const cancel = async () => {
    const active = request;
    if (!active || SETTLED.includes(state.phase) || verified) return;
    try {
      await sendIfAny(sas?.cancel() ?? active.cancel());
    } catch (cause) {
      console.warn("Skye could not cancel verification", cause);
    }
    await refresh();
  };

  const clear = () => {
    if (restoring) return;
    request = null;
    sas = null;
    emit(initialVerification);
  };

  return { start, accept, confirm, cancel, clear, scan, receiveSecret };
};

export type VerificationHandle = ReturnType<typeof createVerification>;
