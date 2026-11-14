import { baseURL, matrixRequest } from "../api/client";
import { createEmitter } from "../misc/events";
import type {
  CryptoHooks,
  EventId,
  MatrixEvent,
  MessagesResponse,
  RoomId,
  Session,
  TimelineEvent,
} from "./types";

export type TimelineEvents = {
  change: TimelineEvent[];
};

export type TimelineOptions = {
  session: Session;
  roomId: RoomId;
  crypto?: CryptoHooks;
  pageSize?: number;
};

let txnCounter = 0;

export const createTxnId = () =>
  `skye.${Date.now()}.${(txnCounter++).toString(36)}`;

const isReplacement = (event: MatrixEvent) =>
  event.content?.["m.relates_to"]?.rel_type === "m.replace";

export const createTimeline = ({
  session,
  roomId,
  crypto = {},
  pageSize = 30,
}: TimelineOptions) => {
  const emitter = createEmitter<TimelineEvents>();
  let events: TimelineEvent[] = [];
  let backToken: string | null | undefined;
  let paginating = false;
  const pendingEdits: Record<EventId, TimelineEvent> = {};
  const pendingRedactions = new Set<EventId>();

  const request = <T>(
    options: Omit<Parameters<typeof matrixRequest>[0], "base">,
  ) =>
    matrixRequest<T>({
      base: baseURL.MATRIX(session.homeserver),
      accessToken: session.accessToken,
      ...options,
    });

  const roomPath = `rooms/${encodeURIComponent(roomId)}`;

  const notify = () => emitter.emit("change", [...events]);

  const decrypt = async (event: MatrixEvent): Promise<TimelineEvent> => {
    const timelineEvent = event as TimelineEvent;

    if (event.type !== "m.room.encrypted" || !crypto.decryptEvent)
      return timelineEvent;

    const clearEvent = await Promise.resolve(
      crypto.decryptEvent(event, roomId),
    ).catch(() => null);

    return clearEvent
      ? {
          ...timelineEvent,
          type: clearEvent.type,
          content: clearEvent.content,
          clearEvent,
        }
      : { ...timelineEvent, decryptionFailed: true };
  };

  const redactLocal = (target: TimelineEvent) => {
    target.redacted = true;
    target.content = {};
  };

  const applyEdit = (target: TimelineEvent, edit: TimelineEvent) => {
    const newContent = edit.content["m.new_content"];
    if (!newContent || edit.sender !== target.sender) return;

    target.originalContent ??= target.content;
    target.content = { ...newContent };
    target.edited = true;
  };

  const findEvent = (eventId: EventId) =>
    events.find((event) => event.event_id === eventId);

  const absorb = (event: TimelineEvent) => {
    if (event.type === "m.room.redaction") {
      const targetId = event.redacts ?? event.content.redacts;
      const target = targetId ? findEvent(targetId) : undefined;
      target
        ? redactLocal(target)
        : targetId && pendingRedactions.add(targetId);
      return true;
    }

    if (isReplacement(event)) {
      const targetId = event.content["m.relates_to"].event_id as EventId;
      const target = findEvent(targetId);
      target ? applyEdit(target, event) : (pendingEdits[targetId] = event);
      return true;
    }

    return false;
  };

  const settle = (event: TimelineEvent) => {
    if (
      event.unsigned?.redacted_because ||
      pendingRedactions.has(event.event_id)
    ) {
      pendingRedactions.delete(event.event_id);
      redactLocal(event);
    }

    const edit = pendingEdits[event.event_id];
    if (edit) {
      applyEdit(event, edit);
      delete pendingEdits[event.event_id];
    }

    return event;
  };

  const appendLive = async (
    incoming: MatrixEvent[],
    limited = false,
    prevBatch?: string,
  ) => {
    if (limited) {
      events = [];
      backToken = prevBatch;
    } else if (backToken === undefined) backToken = prevBatch;

    for (const raw of incoming) {
      const event = await decrypt(raw);
      const txnId = event.unsigned?.transaction_id;
      const echoIndex = txnId
        ? events.findIndex((existing) => existing.txnId === txnId)
        : -1;

      if (echoIndex !== -1) {
        events[echoIndex] = settle({ ...event, localStatus: "sent" });
        continue;
      }

      if (findEvent(event.event_id)) continue;
      if (absorb(event)) continue;

      events.push(settle(event));
    }

    notify();
  };

  const paginateBackwards = async (limit = pageSize) => {
    if (paginating || backToken === null) return false;
    paginating = true;

    try {
      const response = await request<MessagesResponse>({
        endpoint: `${roomPath}/messages`,
        method: "GET",
        query: { dir: "b", from: backToken, limit },
      });
      const older: TimelineEvent[] = [];

      for (const raw of response.chunk) {
        const event = await decrypt(raw);
        if (findEvent(event.event_id) || absorb(event)) continue;
        older.unshift(settle(event));
      }

      events = [...older, ...events];
      backToken = response.end ?? null;
      notify();

      return backToken !== null;
    } finally {
      paginating = false;
    }
  };

  const sendEvent = async (type: string, content: Record<string, any>) => {
    const txnId = createTxnId();
    const echo: TimelineEvent = {
      type,
      content,
      event_id: `~${txnId}`,
      sender: session.userId,
      origin_server_ts: Date.now(),
      room_id: roomId,
      txnId,
      localStatus: "sending",
    };

    events.push(echo);
    notify();

    const encrypted =
      (await crypto.encryptEvent?.(type, content, roomId)) ?? null;
    const [sendType, sendContent] = encrypted
      ? [encrypted.type, encrypted.content]
      : [type, content];

    try {
      const { event_id } = await request<{ event_id: EventId }>({
        endpoint: `${roomPath}/send/${encodeURIComponent(sendType)}/${encodeURIComponent(txnId)}`,
        method: "PUT",
        body: sendContent,
      });
      const index = events.findIndex((event) => event.txnId === txnId);

      if (index !== -1 && events[index].localStatus === "sending")
        events[index] = { ...events[index], event_id, localStatus: "sent" };

      notify();
      return event_id;
    } catch (error) {
      const index = events.findIndex((event) => event.txnId === txnId);
      if (index !== -1)
        events[index] = { ...events[index], localStatus: "failed" };

      notify();
      throw error;
    }
  };

  const sendMessage = (body: string, msgtype = "m.text") =>
    sendEvent("m.room.message", { msgtype, body });

  const editMessage = (eventId: EventId, body: string, msgtype = "m.text") =>
    sendEvent("m.room.message", {
      msgtype,
      body: `* ${body}`,
      "m.new_content": { msgtype, body },
      "m.relates_to": { rel_type: "m.replace", event_id: eventId },
    });

  const redact = async (eventId: EventId, reason?: string) => {
    const target = findEvent(eventId);
    if (target) redactLocal(target);
    notify();

    return await request<{ event_id: EventId }>({
      endpoint: `${roomPath}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(createTxnId())}`,
      method: "PUT",
      body: reason ? { reason } : {},
    });
  };

  const retry = async (txnId: string) => {
    const index = events.findIndex((event) => event.txnId === txnId);
    if (index === -1) return;

    const [failed] = events.splice(index, 1);
    return await sendEvent(failed.type, failed.content);
  };

  const discard = (txnId: string) => {
    events = events.filter((event) => event.txnId !== txnId);
    notify();
  };

  const sendReadReceipt = (eventId: EventId) =>
    request({
      endpoint: `${roomPath}/receipt/m.read/${encodeURIComponent(eventId)}`,
      body: {},
    });

  return {
    roomId,
    appendLive,
    paginateBackwards,
    sendEvent,
    sendMessage,
    editMessage,
    redact,
    retry,
    discard,
    sendReadReceipt,
    on: emitter.on,
    getEvents: () => [...events],
    canPaginate: () => backToken !== null,
  };
};

export type TimelineHandle = ReturnType<typeof createTimeline>;
