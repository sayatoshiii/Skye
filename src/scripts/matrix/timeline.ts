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

export const threadRootOf = (event: MatrixEvent) =>
  event.content?.["m.relates_to"]?.rel_type === "m.thread"
    ? (event.content["m.relates_to"].event_id as EventId | undefined)
    : undefined;

export type ThreadSummary = {
  count: number;
  latest?: TimelineEvent;
  participated?: boolean;
};

export const bundledThread = (event: MatrixEvent): ThreadSummary | undefined => {
  const bundled = event.unsigned?.["m.relations"]?.["m.thread"];
  return bundled && {
    count: Number(bundled.count ?? 0),
    latest: bundled.latest_event,
    participated: !!bundled.current_user_participated,
  };
};

export const createTimeline = ({
  session,
  roomId,
  crypto = {},
  pageSize = 30,
}: TimelineOptions) => {
  const emitter = createEmitter<TimelineEvents>();
  let events: TimelineEvent[] = [];
  let backToken: string | null | undefined;
  let paginating: Promise<boolean> | null = null;
  const pendingEdits: Record<EventId, TimelineEvent> = {};
  const pendingRedactions = new Set<EventId>();
  const redactedIds = new Set<EventId>();

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

  const decryptOne = async (event: MatrixEvent): Promise<TimelineEvent> => {
    const timelineEvent = event as TimelineEvent;

    if (event.type !== "m.room.encrypted" || !crypto.decryptEvent)
      return timelineEvent;

    const clearEvent = await Promise.resolve(
      crypto.decryptEvent(event, roomId),
    ).catch(() => null);

    const relation = clearEvent?.content?.["m.relates_to"] ?? event.content?.["m.relates_to"];

    return clearEvent
      ? {
          ...timelineEvent,
          type: clearEvent.type,
          content: relation ? { ...clearEvent.content, "m.relates_to": relation } : clearEvent.content,
          clearEvent,
        }
      : { ...timelineEvent, decryptionFailed: true };
  };

  const decrypt = async (event: MatrixEvent): Promise<TimelineEvent> => {
    const clear = await decryptOne(event);
    const thread = clear.unsigned?.["m.relations"]?.["m.thread"];
    if (!thread?.latest_event) return clear;

    const latest = await decryptOne({ ...thread.latest_event, room_id: thread.latest_event.room_id ?? roomId });
    return {
      ...clear,
      unsigned: { ...clear.unsigned, "m.relations": { ...clear.unsigned!["m.relations"], "m.thread": { ...thread, latest_event: latest } } },
    };
  };

  const redactLocal = (target: TimelineEvent) => {
    const relation = target.content?.["m.relates_to"];
    redactedIds.add(target.event_id);
    target.redacted = true;
    target.content = relation ? { "m.relates_to": relation } : {};
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
        : targetId && pendingRedactions.add(targetId) && redactedIds.add(targetId);
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
        events[echoIndex] = settle({ ...event, txnId, localStatus: "sent" });
        continue;
      }

      if (findEvent(event.event_id)) continue;
      if (absorb(event)) continue;

      events.push(settle(event));
    }

    notify();
  };

  const paginateBackwards = async (limit = pageSize) => {
    if (paginating) return paginating;
    if (backToken === null) return false;

    paginating = fetchOlder(limit);
    return paginating;
  };

  const fetchOlder = async (limit: number) => {
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
      backToken =
        !response.chunk.length || response.end === backToken
          ? null
          : (response.end ?? null);
      notify();

      return backToken !== null;
    } finally {
      paginating = null;
    }
  };

  let retrying: Promise<void> | null = null;
  let retryAgain = false;

  const redecrypt = async () => {
    do {
      retryAgain = false;
      let changed = false;

      for (const stale of events.filter((event) => event.decryptionFailed)) {
        const event = await decrypt(
          Object.assign({}, stale, { decryptionFailed: undefined }),
        );
        if (event.decryptionFailed) continue;

        changed = true;
        const index = events.findIndex(
          (existing) => existing.event_id === stale.event_id,
        );
        if (index === -1) continue;

        if (absorb(event)) events.splice(index, 1);
        else events[index] = settle(event);
      }

      if (changed) notify();
    } while (retryAgain);
  };

  const retryDecryption = () => {
    if (!events.some((event) => event.decryptionFailed))
      return Promise.resolve();

    if (retrying) {
      retryAgain = true;
      return retrying;
    }

    retrying = redecrypt().finally(() => (retrying = null));
    return retrying;
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

    const replacing = isReplacement(echo);
    if (replacing) {
      const target = findEvent(content["m.relates_to"].event_id);
      if (target) applyEdit(target, echo);
    } else events.push(echo);
    notify();

    try {
      const encrypted =
        (await crypto.encryptEvent?.(type, content, roomId)) ?? null;
      const [sendType, sendContent] = encrypted
        ? [encrypted.type, encrypted.content]
        : [type, content];

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
    redactedIds.add(eventId);
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

  const fetchEvent = async (eventId: EventId) => {
    const loaded = findEvent(eventId);
    if (loaded) return loaded;

    const raw = await request<MatrixEvent>({
      endpoint: `${roomPath}/event/${encodeURIComponent(eventId)}`,
      method: "GET",
    });
    return settle(await decrypt({ ...raw, room_id: raw.room_id ?? roomId }));
  };

  const foldInto = async (list: TimelineEvent[], raws: MatrixEvent[], prepend: boolean) => {
    const fresh: TimelineEvent[] = [];
    const known = new Set(list.map((event) => event.event_id));
    const all = () => [...list, ...fresh];

    for (const raw of raws) {
      const event = await decrypt({ ...raw, room_id: raw.room_id ?? roomId });
      if (known.has(event.event_id)) continue;
      known.add(event.event_id);

      if (event.type === "m.room.redaction") {
        const target = all().find((candidate) => candidate.event_id === (event.redacts ?? event.content.redacts));
        if (target) redactLocal(target);
        continue;
      }

      if (isReplacement(event)) {
        const target = all().find((candidate) => candidate.event_id === event.content["m.relates_to"].event_id);
        if (target) applyEdit(target, event);
        continue;
      }

      if (event.unsigned?.redacted_because) redactLocal(event);
      fresh.push(event);
    }

    return prepend ? [...fresh, ...list] : [...list, ...fresh];
  };

  const loadContext = async (eventId: EventId, limit = 30) => {
    const response = await request<{
      start?: string;
      end?: string;
      event: MatrixEvent;
      events_before?: MatrixEvent[];
      events_after?: MatrixEvent[];
    }>({
      endpoint: `${roomPath}/context/${encodeURIComponent(eventId)}`,
      method: "GET",
      query: { limit },
    });

    const ordered = [...(response.events_before ?? [])].reverse().concat(response.event, response.events_after ?? []);

    return {
      events: await foldInto([], ordered, false),
      start: response.start ?? null,
      end: response.end ?? null,
    };
  };

  const fetchPage = async (list: TimelineEvent[], from: string, dir: "b" | "f", limit = pageSize) => {
    const response = await request<MessagesResponse>({
      endpoint: `${roomPath}/messages`,
      method: "GET",
      query: { dir, from, limit },
    });
    const chunk = dir === "b" ? [...response.chunk].reverse() : response.chunk;

    return {
      events: await foldInto(list, chunk, dir === "b"),
      chunkIds: response.chunk.map((event) => event.event_id as EventId),
      token: !response.chunk.length || response.end === from ? null : (response.end ?? null),
    };
  };

  const adoptOlder = (older: TimelineEvent[], token: string | null) => {
    const known = new Set(events.map((event) => event.event_id));
    events = [...older.filter((event) => !known.has(event.event_id)), ...events];
    backToken = token;
    notify();
  };

  const hasEvent = (eventId: EventId) => !!findEvent(eventId);

  const fetchRelations = async (eventId: EventId, relType = "m.reference", limit = 200) => {
    const response = await matrixRequest<{ chunk: MatrixEvent[] }>({
      base: baseURL.MATRIX_V1(session.homeserver),
      accessToken: session.accessToken,
      endpoint: `${roomPath}/relations/${encodeURIComponent(eventId)}/${encodeURIComponent(relType)}`,
      method: "GET",
      query: { limit },
    });

    return await Promise.all(response.chunk.map((raw) => decrypt({ ...raw, room_id: raw.room_id ?? roomId })));
  };

  const fetchThread = async (rootId: EventId, list: TimelineEvent[], from?: string | null, limit = pageSize) => {
    const response = await matrixRequest<{ chunk: MatrixEvent[]; next_batch?: string }>({
      base: baseURL.MATRIX_V1(session.homeserver),
      accessToken: session.accessToken,
      endpoint: `${roomPath}/relations/${encodeURIComponent(rootId)}/m.thread`,
      method: "GET",
      query: { dir: "b", limit, ...(from ? { from } : {}) },
    });

    return {
      events: await foldInto(list, [...response.chunk].reverse(), true),
      next: response.next_batch ?? null,
    };
  };

  const fetchThreads = async (from?: string | null, limit = pageSize) => {
    const response = await matrixRequest<{ chunk: MatrixEvent[]; next_batch?: string }>({
      base: baseURL.MATRIX_V1(session.homeserver),
      accessToken: session.accessToken,
      endpoint: `${roomPath}/threads`,
      method: "GET",
      query: { limit, ...(from ? { from } : {}) },
    });

    return {
      events: await Promise.all(response.chunk.map((raw) => decrypt({ ...raw, room_id: raw.room_id ?? roomId }).then(settle))),
      next: response.next_batch ?? null,
    };
  };

  const setPinned = (pinned: EventId[]) =>
    request({
      endpoint: `${roomPath}/state/m.room.pinned_events`,
      method: "PUT",
      body: { pinned },
    });

  const sendReadReceipt = (eventId: EventId) =>
    request({
      endpoint: `${roomPath}/receipt/m.read/${encodeURIComponent(eventId)}`,
      body: {},
    });

  const sendTyping = (typing: boolean, timeout = 5000) =>
    request({
      endpoint: `${roomPath}/typing/${encodeURIComponent(session.userId)}`,
      method: "PUT",
      body: typing ? { typing, timeout } : { typing },
    });

  return {
    roomId,
    appendLive,
    sendTyping,
    paginateBackwards,
    sendEvent,
    sendMessage,
    editMessage,
    redact,
    retry,
    discard,
    sendReadReceipt,
    fetchEvent,
    setPinned,
    loadContext,
    fetchPage,
    adoptOlder,
    hasEvent,
    fetchRelations,
    fetchThread,
    fetchThreads,
    isRedacted: (eventId: EventId) => redactedIds.has(eventId),
    retryDecryption,
    on: emitter.on,
    getEvents: () => [...events],
    canPaginate: () => backToken !== null,
  };
};

export type TimelineHandle = ReturnType<typeof createTimeline>;
