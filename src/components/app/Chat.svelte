<script lang="ts">
  import { tooltip } from "../../scripts/misc/tooltip";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { canCopyMedia, copyMedia } from "../../scripts/misc/clipboard";
  import { portal } from "../../scripts/misc/portal";
  import EmojiText from "../ui/EmojiText.svelte";
  import Composer, { type Pending } from "./Composer.svelte";
  import { tick, untrack } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { canPin, canRedact, getPowerLevel } from "../../scripts/matrix/rooms";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { formatBytes, getUploadLimit, isInline, prepareAttachment, sanitiseFilename, uploadAttachment } from "../../scripts/matrix/utilities/attachments";
  import { downloadMedia } from "../../scripts/matrix/utilities/download";
  import { isMxc, type MediaSource } from "../../scripts/matrix/utilities/media";
  import { HTML_FORMAT, findLinks, stripReplyFallback, toPreviewLine } from "../../scripts/misc/formatting";
  import { MEDIA } from "../../scripts/settings/config";
  import { linkPreviewsEnabled, mediaSettings, setKeepImageMetadata, type MediaSettings } from "../../scripts/settings/media";
  import { toEntity } from "../../scripts/stores/entities";
  import { lightbox } from "../../scripts/stores/lightbox";
  import {
    canLoadOlder,
    currentRoom,
    currentTimeline,
    discardMessage,
    editRoomMessage,
    detached,
    canLoadNewer,
    jumpToEvent,
    loadNewerMessages,
    returnToPresent,
    pinMessage,
    unpinMessage,
    joinedMembers,
    loadOlderMessages,
    markRoomRead,
    redactMessage,
    restoreOpen,
    retryMessage,
    sendMessage,
    sendRoomMessage,
    sendRoomEvent,
    rooms,
    session,
    undecryptable,
    type ReplyTarget,
  } from "../../scripts/stores/matrix";
  import Avatar from "../ui/Avatar.svelte";
  import LinkPreview from "./media/LinkPreview.svelte";
  import MessageBody from "./media/MessageBody.svelte";
  import MessageMedia from "./media/MessageMedia.svelte";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";
  import PinnedMessages from "./PinnedMessages.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import LocationCard from "./media/LocationCard.svelte";
  import Poll from "./media/Poll.svelte";
  import { BEACON, BEACON_INFO, LOCATION_KEYS, POLL_END, POLL_START, formatCoordinates, getLocation, getPoll, pollEndContent, relatedTo, type GeoLocation } from "../../scripts/matrix/utilities/content";
  import { SYSTEM_ICONS, SYSTEM_TYPES, describeSystem, type MemberVerb, type SystemLine } from "../../scripts/matrix/utilities/system";
  import { navigation, openRoom, openRoomMenu } from "../../scripts/stores/navigation.svelte";
  import { openFullProfile, openMiniProfile } from "../../scripts/stores/profile";
  import { getScrollAnchor, persistScrollAnchors, setScrollAnchor, type ScrollAnchor } from "../../scripts/stores/scroll";

  let {
    onchannels,
    onmembers,
  }: { onchannels?: () => void; onmembers?: () => void } = $props();

  const GROUP_WINDOW = 5 * 60 * 1000;
  const LOAD_THRESHOLD = 240;
  const STICK_THRESHOLD = 120;
  const LONG_PRESS = 480;
  const SWIPE_REPLY = 64;
  const VISIBLE_TYPES = ["m.room.message", "m.room.encrypted", "m.sticker", ...LOCATION_KEYS, ...POLL_START, ...BEACON_INFO, ...SYSTEM_TYPES];
  const MEMBER_GROUP = 3;
  const MEMBER_VERBS: MemberVerb[] = ["joined", "left", "invited", "removed", "profile"];
  const MEDIA_TYPES = ["m.image", "m.video", "m.audio", "m.file"];

  const ICONS = {
    reply: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1",
    edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
    copy: "M9 9h10v10H9zM5 15V5h10",
    link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 4a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
    id: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16",
    delete: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
    retry: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4",
    download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
    open: "M14 4h6v6m0-6-8 8M10 5H5v14h14v-5",
    pin: "M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6",
    unpin: "M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6M4 4l16 16",
    end: "M6 6h12v12H6z",
    chevron: "m9 6 6 6-6 6",
  };

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  type Message = (typeof timelineMessages)[number];

  let draft = $state("");
  let timeline: HTMLElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let loadingOlder = $state(false);
  let stuck = true;
  let renderedRoomId: string | undefined;
  let pin: { eventId: string; offset: number } | null = null;
  let lockedOut = $state(false);
  let dismissedRoom: string | undefined = $state();
  let settings: MediaSettings | null = $state.raw(null);
  let pending: Pending[] = $state([]);
  let pendingCounter = 0;
  let dragDepth = $state(0);
  let dockHeight = $state(60);
  let replying: (ReplyTarget & { name: string }) | null = $state(null);
  let editing: { eventId: string; draft: string } | null = $state(null);
  let menu: { message: Message; x: number; y: number; link?: string } | null = $state(null);
  type ConfirmKind = "delete" | "pin" | "unpin" | "end_poll";
  let confirming: { kind: ConfirmKind; eventId: string } | null = $state(null);
  let confirmDialog: ConfirmDialog | undefined = $state();

  const CONFIRM_ACTIONS: Record<ConfirmKind, (eventId: string) => Promise<unknown>> = {
    delete: (eventId) => redactMessage(eventId),
    pin: (eventId) => pinMessage(eventId),
    unpin: (eventId) => unpinMessage(eventId),
    end_poll: (eventId) => endPoll(eventId),
  };

  const ask = (kind: ConfirmKind, eventId: string, event?: MouseEvent | KeyboardEvent) => {
    if (event?.shiftKey) return void CONFIRM_ACTIONS[kind](eventId).catch(() => undefined);
    confirming = { kind, eventId };
  };

  const endPoll = async (eventId: string) => {
    const message = timelineMessages.find((entry) => entry.eventId === eventId);
    if (!message || message.kind !== "poll") return;
    await sendRoomEvent(POLL_END[message.event.type === POLL_START[1] ? 1 : 0], pollEndContent(message.event, text("poll", "ended")));
  };

  const confirmAction = () => {
    if (confirming) CONFIRM_ACTIONS[confirming.kind](confirming.eventId).catch(() => undefined);
    confirmDialog?.dismiss();
  };
  let swipe: { id: string; dx: number } | null = $state(null);
  let pinsOpen = $state(false);
  let pinsButton: HTMLButtonElement | undefined = $state();
  let note: string | null = $state(null);
  let isDetached = $state(false);
  let farFromBottom = $state(false);
  let unseenAfter: string | null = $state(null);
  let loadingNewer = $state(false);
  let travel: "" | "out-down" | "in-top" | "out-up" | "in-bottom" = $state("");
  const TRAVEL_MS = 350;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const quick = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => undecryptable.subscribe((value) => (lockedOut = value)));
  $effect(() => detached.subscribe((value) => (isDetached = value)));
  $effect(() => mediaSettings.subscribe((value) => (settings = value)));
  $effect(() => () => pending.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)));

  const room = $derived($currentRoom && toEntity($currentRoom, $session?.userId));
  const ownUserId = $derived($session?.userId);
  const encrypted = $derived(!!$currentRoom?.encryption);
  const pinnedIds = $derived($currentRoom?.pinned ?? []);
  const pinnedSet = $derived(new Set(pinnedIds));
  const mayPin = $derived(!!$currentRoom && !!ownUserId && canPin($currentRoom, ownUserId));
  const previewsOn = $derived(!!settings && !!$currentRoom && linkPreviewsEnabled(settings, $currentRoom.roomId, encrypted));

  $effect(() => {
    $currentRoom?.roomId;
    untrack(() => {
      replying = null;
      editing = null;
      menu = null;
      pinsOpen = false;
      unseenAfter = null;
      farFromBottom = false;
    });
  });

  const getSender = (userId: string) => {
    const member = $currentRoom?.members[userId] ?? $joinedMembers[$currentRoom?.roomId ?? ""]?.[userId];

    return {
      name: member?.displayName ?? userId,
      avatar: member?.avatarUrl,
      powerLevel: $currentRoom ? getPowerLevel($currentRoom, userId) : 0,
    };
  };

  const resolveName = (userId: string) => getSender(userId).name;

  const SYSTEM_KINDS = ["system", "members"];

  const isChained = (previous?: { sender: string; ts: number; kind: string }, message?: { sender: string; ts: number; kind: string }) =>
    !!previous && !!message && !SYSTEM_KINDS.includes(previous.kind) && !SYSTEM_KINDS.includes(message.kind) && previous.sender === message.sender && message.ts - previous.ts < GROUP_WINDOW;

  type Kind = "redacted" | "fallback" | "media" | "sticker" | "text" | "notice" | "emote" | "location" | "poll" | "server" | "system" | "members";
  type Described = { kind: Kind; body: string; system?: SystemLine; location?: GeoLocation | null; live?: boolean };

  const relations = $derived.by(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of $currentTimeline) {
      const target = relatedTo(event);
      if (!target || event.content["m.relates_to"]?.rel_type !== "m.reference") continue;
      const list = map.get(target);
      list ? list.push(event) : map.set(target, [event]);
    }
    return map;
  });

  const callStart = (callId: string) =>
    $currentTimeline.find((event) => event.type === "m.call.invite" && event.content.call_id === callId);

  const mayModerate = (userId: string) => !!$currentRoom && canRedact($currentRoom, userId, "");

  const describeBeacon = (event: TimelineEvent): Described => {
    const info = event.content;
    const start = Number(info["org.matrix.msc3488.ts"] ?? info["m.ts"] ?? event.origin_server_ts);
    const live = !!info.live && start + Number(info.timeout ?? 0) > Date.now();
    const latest = (relations.get(event.event_id) ?? [])
      .filter((item) => BEACON.includes(item.type) && !item.redacted)
      .sort((a, b) => b.origin_server_ts - a.origin_server_ts)[0];
    const location = latest ? getLocation(latest.content) : null;
    const description = typeof info.description === "string" && info.description.trim() ? info.description.trim() : undefined;

    return { kind: "location", body: description ?? "", location: location && { ...location, description }, live };
  };

  const describe = (event: TimelineEvent): Described | null => {
    if (SYSTEM_TYPES.includes(event.type)) {
      if (event.redacted) return null;
      const system = describeSystem(event, resolveName, callStart);
      return system && { kind: "system", body: "", system };
    }
    if (event.redacted) return { kind: "redacted", body: text("chat", "redacted") };
    if (event.decryptionFailed || event.type === "m.room.encrypted")
      return { kind: "fallback", body: text("chat", "encrypted") };
    if (event.type === "m.sticker") return { kind: "sticker", body: String(event.content.body ?? "") };
    if (POLL_START.includes(event.type)) return getPoll(event) ? { kind: "poll", body: "" } : { kind: "fallback", body: text("poll", "unavailable") };
    if (BEACON_INFO.includes(event.type)) return describeBeacon(event);

    const { msgtype, body } = event.content;
    if (LOCATION_KEYS.includes(event.type) || msgtype === "m.location") {
      const location = getLocation(event.content);
      if (location) return { kind: "location", body: String(body ?? ""), location };
    }
    if (msgtype === "m.key.verification.request")
      return { kind: "system", body: "", system: { icon: "shield", key: "verification", params: { actor: resolveName(event.sender) }, tone: "accent" } };
    if (typeof body !== "string") return { kind: "fallback", body: text("chat", "unsupported").replace("{type}", String(msgtype ?? event.type)) };
    if (MEDIA_TYPES.includes(msgtype)) return { kind: "media", body };
    if (msgtype === "m.text") return { kind: "text", body };
    if (msgtype === "m.notice") return { kind: "notice", body };
    if (msgtype === "m.emote") return { kind: "emote", body };
    if (msgtype === "m.server_notice") return { kind: "server", body };

    return { kind: "fallback", body: text("chat", "unsupported").replace("{type}", String(msgtype)) };
  };

  const mentions = (content: Record<string, any>, userId?: string) => {
    if (!userId) return false;
    if (Array.isArray(content["m.mentions"]?.user_ids) && content["m.mentions"].user_ids.includes(userId)) return true;
    const html = content.format === HTML_FORMAT ? String(content.formatted_body ?? "") : "";
    return html.includes(`matrix.to/#/${userId}`) || html.includes(`matrix.to/#/${encodeURIComponent(userId)}`);
  };

  const baseMessages = $derived(
    $currentTimeline
      .filter((event) => VISIBLE_TYPES.includes(event.type))
      .flatMap((event) => {
        const described = describe(event);
        if (!described) return [];
        const replyTo = event.redacted ? undefined : (event.content["m.relates_to"]?.["m.in_reply_to"]?.event_id as string | undefined);
        const plain = described.kind === "text" || described.kind === "notice" || described.kind === "emote" || described.kind === "server";

        return {
          id: event.txnId ?? event.event_id,
          eventId: event.event_id,
          local: event.event_id.startsWith("~"),
          sender: event.sender,
          ts: event.origin_server_ts,
          edited: event.edited && !event.redacted,
          status: event.localStatus,
          txnId: event.txnId,
          content: event.content,
          replyTo,
          mentionsMe: event.sender !== ownUserId && !event.redacted && mentions(event.content, ownUserId),
          links: described.kind === "text" ? findLinks(replyTo ? stripReplyFallback(described.body) : described.body).slice(0, MEDIA.maxPreviewLinks) : [],
          plain,
          event,
          ...described,
          members: undefined as BaseMessage[] | undefined,
        };
      }),
  );

  type BaseMessage = (typeof baseMessages)[number];

  const foldMembers = (list: BaseMessage[]) => {
    const out: BaseMessage[] = [];
    let run: BaseMessage[] = [];
    const flush = () => {
      if (run.length >= MEMBER_GROUP) out.push({ ...run[0], id: `members:${run[0].id}`, kind: "members", members: run, ts: run.at(-1)!.ts });
      else out.push(...run);
      run = [];
    };
    for (const message of list) {
      if (message.kind === "system" && message.system?.verb) run.push(message);
      else {
        flush();
        out.push(message);
      }
    }
    flush();
    return out;
  };

  const timelineMessages = $derived(
    foldMembers(baseMessages)
      .map((message, index, all) => ({
        ...message,
        grouped: isChained(all[index - 1], message),
        last: !isChained(message, all[index + 1]),
      })),
  );

  const formatLine = (line: SystemLine) =>
    Object.entries(line.params).reduce((value, [key, param]) => value.replaceAll(`{${key}}`, param), text("system", line.key));

  const summarise = (members: BaseMessage[]) => {
    const counts = new Map<MemberVerb, number>();
    for (const member of members) if (member.system?.verb) counts.set(member.system.verb, (counts.get(member.system.verb) ?? 0) + 1);
    return MEMBER_VERBS.filter((verb) => counts.has(verb))
      .map((verb) => text("system", `summary_${verb}`).replace("{count}", String(counts.get(verb))))
      .join(", ");
  };

  const openUpgraded = (roomId: string) => {
    if ($rooms[roomId]) return openRoom(navigation.spaceId, roomId);
    window.open(`https://matrix.to/#/${encodeURIComponent(roomId)}`, "_blank", "noopener,noreferrer");
  };

  const pollEnded = (message: Message) =>
    (relations.get(message.eventId) ?? []).some((event) => POLL_END.includes(event.type) && (event.sender === message.sender || mayModerate(event.sender)));

  const findReply = (eventId: string) => $currentTimeline.find((event) => event.event_id === eventId);

  const formatTime = (ts: number) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ts);

  const scrollToBottom = async () => {
    await tick();
    timeline?.scrollTo({ top: timeline.scrollHeight });
  };

  const fillViewport = async () => {
    await tick();
    if (timeline && $canLoadOlder && timeline.scrollHeight <= timeline.clientHeight) loadOlder();
  };

  const loadOlder = async () => {
    if (!timeline || loadingOlder || !$canLoadOlder) return;

    loadingOlder = true;
    const fromBottom = timeline.scrollHeight - timeline.scrollTop;

    const loaded = await loadOlderMessages();
    await tick();

    if (timeline) timeline.scrollTop = timeline.scrollHeight - fromBottom;
    loadingOlder = false;
    if (loaded) fillViewport();
  };

  const loadNewer = async () => {
    if (loadingNewer || !isDetached) return;
    loadingNewer = true;
    const more = await loadNewerMessages();
    await tick();
    loadingNewer = false;
    if (more && timeline && timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < LOAD_THRESHOLD) loadNewer();
  };

  const newCount = $derived.by(() => {
    if (isDetached || unseenAfter === null) return 0;
    const index = timelineMessages.findIndex((message) => message.id === unseenAfter);
    return index === -1 ? 0 : timelineMessages.length - 1 - index;
  });

  const showPresent = $derived(isDetached || farFromBottom || newCount > 0);

  const jumpToPresent = async () => {
    pin = null;
    if (isDetached) {
      travel = "out-up";
      await pause(quick() ? 120 : TRAVEL_MS);
      returnToPresent();
      stuck = true;
      unseenAfter = null;
      farFromBottom = false;
      await tick();
      if (timeline) timeline.scrollTop = timeline.scrollHeight;
      travel = "in-bottom";
      markRoomRead();
      return;
    }
    stuck = true;
    unseenAfter = null;
    farFromBottom = false;
    await tick();
    timeline?.scrollTo({ top: timeline.scrollHeight, behavior: isDetached ? "auto" : "smooth" });
    markRoomRead();
  };

  const findEvent = (eventId: string) => timeline?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);

  const captureAnchor = () => {
    if (!timeline || !renderedRoomId) return;
    if (stuck && !isDetached) return setScrollAnchor(renderedRoomId, { bottom: true });
    const top = timeline.getBoundingClientRect().top;
    for (const item of timeline.querySelectorAll<HTMLElement>(":scope > li[data-event-id]")) {
      const offset = item.getBoundingClientRect().top - top;
      if (offset >= 0) return setScrollAnchor(renderedRoomId, { bottom: false, eventId: item.dataset.eventId!, offset });
    }
  };

  const applyPin = () => {
    const target = pin && findEvent(pin.eventId);
    if (!timeline || !pin || !target) return;
    timeline.scrollTop += target.getBoundingClientRect().top - timeline.getBoundingClientRect().top - pin.offset;
  };

  const unpin = () => (pin = null);

  const onresize = () => {
    if (!timeline || loadingOlder) return;
    if (stuck && !isDetached) timeline.scrollTop = timeline.scrollHeight;
    else if (pin) applyPin();
  };

  const restore = async (roomId: string, saved: Extract<ScrollAnchor, { bottom: false }>) => {
    await tick();
    if (renderedRoomId !== roomId) return;
    if (!findEvent(saved.eventId)) {
      const ok = await jumpToEvent(saved.eventId);
      await tick();
      if (renderedRoomId !== roomId) return;
      if (!ok || !findEvent(saved.eventId)) {
        stuck = true;
        return scrollToBottom().then(fillViewport);
      }
    }
    pin = { eventId: saved.eventId, offset: saved.offset };
    applyPin();
  };

  $effect(() => {
    const element = timeline;
    if (!element) return;
    const resize = new ResizeObserver(onresize);
    const watch = (nodes: Iterable<Node>) => {
      for (const node of nodes) if (node instanceof Element) resize.observe(node);
    };
    resize.observe(element);
    watch(element.children);
    const mutation = new MutationObserver((records) => records.forEach((record) => watch(record.addedNodes)));
    mutation.observe(element, { childList: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  });

  $effect(() => {
    window.addEventListener("pagehide", persistScrollAnchors);
    return () => window.removeEventListener("pagehide", persistScrollAnchors);
  });

  const onscroll = () => {
    if (!timeline) return;

    const distance = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    stuck = !isDetached && distance < STICK_THRESHOLD;
    farFromBottom = distance > timeline.clientHeight;
    if (stuck) unseenAfter = null;
    else if (!isDetached && unseenAfter === null) unseenAfter = timelineMessages.at(-1)?.id ?? null;
    if (timeline.scrollTop < LOAD_THRESHOLD) loadOlder();
    if (isDetached && distance < LOAD_THRESHOLD) loadNewer();
    if (stuck && document.visibilityState === "visible") markRoomRead();
    captureAnchor();
  };

  $effect(() => {
    const roomId = $currentRoom?.roomId;
    const latest = timelineMessages.at(-1)?.id;
    if (!roomId || !latest) return;

    if (renderedRoomId !== roomId) {
      persistScrollAnchors();
      renderedRoomId = roomId;
      stuck = true;
      pin = null;
      const saved = getScrollAnchor(roomId);
      if (saved && !saved.bottom) {
        stuck = false;
        restore(roomId, saved);
        return;
      }
    }

    if (loadingOlder || !stuck) return;

    scrollToBottom().then(fillViewport);
    if (document.visibilityState === "visible") queueMicrotask(() => markRoomRead(roomId));
  });

  $effect(() => {
    const read = () => document.visibilityState === "visible" && stuck && markRoomRead();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  });

  const addFiles = async (files: Iterable<File>) => {
    const active = $session;
    if (!active) return;
    const limit = await getUploadLimit(active);

    for (const file of files) {
      const item: Pending = {
        id: ++pendingCounter,
        file,
        progress: null,
        preview: isInline(file.type, "image") ? URL.createObjectURL(file) : undefined,
        error: file.size > limit ? text("media", "too_big").replace("{name}", sanitiseFilename(file.name)).replace("{limit}", formatBytes(limit)) : undefined,
      };
      pending.push(item);
    }
  };

  const removePending = (id: number) => {
    const item = pending.find((entry) => entry.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    pending = pending.filter((entry) => entry.id !== id);
  };

  const uploadPending = async (items: Pending[], roomId: string, roomEncrypted: boolean, reply?: ReplyTarget) => {
    const active = $session;
    if (!active) return;

    for (const item of items) {
      item.progress = 0;
      item.error = undefined;
      try {
        const prepared = await prepareAttachment(item.file, !settings?.keepImageMetadata);
        const content = await uploadAttachment(active, prepared, roomEncrypted, (value) => (item.progress = value));
        await sendRoomMessage(content, reply, roomId);
        removePending(item.id);
      } catch {
        item.progress = null;
        item.error = text("media", "upload_failed");
      }
    }
  };

  const send = () => {
    const body = draft.trim();
    const items = pending.filter((item) => !item.error && item.progress === null);
    if ((!body && !items.length) || !room) return;

    const reply = replying ? { eventId: replying.eventId, sender: replying.sender } : undefined;
    stuck = true;
    replying = null;

    if (isDetached) jumpToPresent();
    if (body) sendMessage(body, reply).catch(() => undefined);
    if (items.length) uploadPending(items, room.id, encrypted, body ? undefined : reply);

    draft = "";
  };

  const retry = (txnId?: string) => {
    if (txnId) retryMessage(txnId)?.catch(() => undefined);
  };

  const startReply = (message: Message) => {
    if (message.local) return;
    replying = { eventId: message.eventId, sender: message.sender, name: getSender(message.sender).name };
    composer?.focus();
  };

  const editableText = (message: Message) =>
    message.content["m.relates_to"]?.["m.in_reply_to"] ? stripReplyFallback(message.content.body ?? "") : String(message.content.body ?? "");

  const canEdit = (message: Message) =>
    message.sender === ownUserId && !message.local && (message.kind === "text" || message.kind === "emote" || message.kind === "notice");

  const startEdit = async (message: Message) => {
    editing = { eventId: message.eventId, draft: editableText(message) };
    await tick();
    const field = timeline?.querySelector<HTMLTextAreaElement>(".edit-field");
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  };

  const saveEdit = (message: Message) => {
    const value = editing?.draft.trim();
    editing = null;
    if (!value || value === editableText(message).trim()) return;
    editRoomMessage(message.eventId, value).catch(() => undefined);
    composer?.focus();
  };

  const oneditkey = (event: KeyboardEvent, message: Message) => {
    if (event.key === "Escape") {
      event.preventDefault();
      editing = null;
      composer?.focus();
    }
    if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
      event.preventDefault();
      saveEdit(message);
    }
  };

  const remove = (message: Message, event?: MouseEvent | KeyboardEvent) => ask("delete", message.eventId, event);

  const copy = (value: string) => navigator.clipboard?.writeText(value).catch(() => undefined);

  const mediaSource = (content: Record<string, any>): MediaSource => ({
    url: isMxc(content.url) ? content.url : undefined,
    file: isMxc(content.file?.url) ? content.file : undefined,
  });

  const menuItems = (message: Message, link?: string): MenuItem[] => {
    const items: MenuItem[] = [];
    const add = (id: string, label: string, icon: string, run: MenuItem["run"], danger = false) => items.push({ id, label, icon, run, danger });
    const failed = message.status === "failed";

    if (link) {
      add("open-link", text("context_menu", "open_link"), MENU_ICONS.open, () => window.open(link, "_blank", "noopener,noreferrer"));
      add("copy-link", text("context_menu", "copy_link"), MENU_ICONS.link, () => navigator.clipboard?.writeText(link).catch(() => undefined));
    }

    if (failed) {
      add("retry", text("chat", "retry"), ICONS.retry, () => retry(message.txnId));
      add("discard", text("chat", "discard"), ICONS.delete, () => message.txnId && discardMessage(message.txnId), true);
      return items;
    }

    if (!message.local && message.kind !== "redacted") add("reply", text("chat", "reply"), ICONS.reply, () => startReply(message));
    if (canEdit(message)) add("edit", text("chat", "edit"), ICONS.edit, () => startEdit(message));

    if (message.kind === "media") {
      const source = mediaSource(message.content);
      const mimetype = String(message.content.info?.mimetype ?? "");
      const name = sanitiseFilename(message.content.filename ?? message.content.body);
      if (message.content.msgtype === "m.image" && isInline(mimetype, "image"))
        add("open", text("chat", "open_media"), ICONS.open, () => lightbox.set({ source, mimetype, name, w: message.content.info?.w, h: message.content.info?.h }));
      const gif = mimetype === "image/gif" || !!message.content.info?.["fi.mau.gif"];
      const copyKind = gif ? "copy_gif" : mimetype.startsWith("video/") ? "copy_video" : mimetype.startsWith("image/") ? "copy_image" : null;
      if (copyKind && isInline(mimetype, mimetype.split("/")[0] as "image" | "video") && canCopyMedia(mimetype))
        add("copy-media", text("chat", copyKind), ICONS.copy, () => copyMedia(source, mimetype).catch(() => undefined));
      add("download", text("chat", "download"), ICONS.download, () => downloadMedia(source, name).catch(() => undefined));
    }

    if (message.location) {
      const location = message.location;
      add("coordinates", text("chat", "copy_coordinates"), ICONS.copy, () => copy(formatCoordinates(location, 6)));
    }
    if (message.kind === "poll" && !message.local && ownUserId && (message.sender === ownUserId || mayModerate(ownUserId)) && !pollEnded(message))
      add("end-poll", text("chat", "end_poll"), ICONS.end, (event) => ask("end_poll", message.eventId, event), true);

    if (message.plain) add("copy", text("chat", "copy_text"), ICONS.copy, () => copy(editableText(message)));
    if (!message.local && $currentRoom) {
      add("link", text("chat", "copy_link"), ICONS.link, () => copy(`https://matrix.to/#/${encodeURIComponent($currentRoom!.roomId)}/${encodeURIComponent(message.eventId)}`));
      add("id", text("chat", "copy_id"), ICONS.id, () => copy(message.eventId));
    }
    if (!message.local && message.kind !== "redacted" && mayPin)
      pinnedSet.has(message.eventId)
        ? add("unpin", text("chat", "unpin"), ICONS.unpin, (event) => ask("unpin", message.eventId, event))
        : add("pin", text("chat", "pin"), ICONS.pin, (event) => ask("pin", message.eventId, event));
    if (!message.local && message.kind !== "redacted" && $currentRoom && ownUserId && canRedact($currentRoom, ownUserId, message.sender))
      add("delete", text("chat", "delete"), ICONS.delete, (event) => remove(message, event), true);

    return items;
  };

  const openMenu = (message: Message, x: number, y: number, link?: string) => {
    if (editing?.eventId === message.eventId) return;
    menu = { message, x, y, link };
  };

  const oncontextmenu = (event: MouseEvent, message: Message) => {
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    event.preventDefault();
    const link = target.closest<HTMLAnchorElement>("a[href]")?.href ?? target.closest<HTMLElement>("[data-link]")?.dataset.link;
    if (!menu) openMenu(message, event.clientX, event.clientY, link);
  };

  let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; swiping: boolean } | null = null;

  const onpointerdown = (event: PointerEvent, message: Message) => {
    if (event.pointerType !== "touch" || editing) return;
    const timer = setTimeout(() => {
      press = null;
      swipe = null;
      openMenu(message, event.clientX, event.clientY);
    }, LONG_PRESS);
    press = { id: message.id, x: event.clientX, y: event.clientY, timer, swiping: false };
  };

  const onpointermove = (event: PointerEvent, message: Message) => {
    if (!press || press.id !== message.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(press.timer);
    if (!press.swiping && dx > 14 && Math.abs(dy) < 12 && !message.local) press.swiping = true;
    if (press.swiping) swipe = { id: message.id, dx: Math.max(0, Math.min(dx, SWIPE_REPLY * 1.4)) };
    else if (Math.abs(dy) > 12) press = null;
  };

  const onpointerup = (message: Message) => {
    if (press) clearTimeout(press.timer);
    if (swipe?.id === message.id && swipe.dx >= SWIPE_REPLY) startReply(message);
    press = null;
    swipe = null;
  };

  const jumpTo = (eventId: string) => {
    const target = timeline?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
  };

  const openProfile = (userId: string, element: HTMLElement) =>
    openMiniProfile(userId, element, "right", $currentRoom?.roomId);

  const onmentionclick = (event: MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.mention");
    const match = anchor?.href.match(/matrix\.to\/#\/(@[^/?]+)/);
    if (!anchor || !match) return;
    event.preventDefault();
    anchor.dataset.profileTrigger = "";
    openProfile(decodeURIComponent(match[1]), anchor);
  };

  const showNote = (value: string) => {
    clearTimeout(noteTimer);
    note = value;
    noteTimer = setTimeout(() => (note = null), 3200);
  };

  const jumpToMessage = async (eventId: string) => {
    pin = null;
    const loaded = () => timeline?.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
    stuck = false;

    if (!loaded()) {
      travel = "out-down";
      const [ok] = await Promise.all([jumpToEvent(eventId), pause(quick() ? 120 : TRAVEL_MS)]);
      await tick();
      if (!ok || !loaded()) {
        travel = "in-bottom";
        return showNote(text("chat", "too_far_back"));
      }
      loaded()?.scrollIntoView({ block: "center" });
      travel = "in-top";
    }

    stuck = false;
    jumpTo(eventId);
  };

  const onwindowkey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !room) return;
    const field = (event.target as HTMLElement).closest?.("input, textarea, [contenteditable]");
    const composerEmpty = event.target === composer && !draft;
    const busy = !!(menu || pinsOpen || confirming || editing || replying);

    if (event.key === "End" && (!field || composerEmpty) && showPresent) {
      event.preventDefault();
      jumpToPresent();
    }
    if (event.key === "Escape" && (!field || composerEmpty) && !busy && showPresent && !document.querySelector("[aria-modal=true], [role=dialog]")) {
      event.preventDefault();
      jumpToPresent();
    }
  };

  const editLast = () => {
    const last = timelineMessages.findLast((message) => canEdit(message));
    if (last) startEdit(last);
    return !!last;
  };

  const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");

  const ondragenter = (event: DragEvent) => {
    if (!hasFiles(event) || !room) return;
    event.preventDefault();
    dragDepth++;
  };

  const ondragover = (event: DragEvent) => {
    if (!hasFiles(event) || !room) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const ondragleave = (event: DragEvent) => {
    if (hasFiles(event)) dragDepth = Math.max(0, dragDepth - 1);
  };

  const ondrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    if (room) addFiles([...(event.dataTransfer?.files ?? [])]);
  };


  const roomLabel = $derived(room ? `${room.isDirect ? "" : "#"}${room.name}` : "");
</script>

<svelte:window onkeydown={onwindowkey} />

<section
  class="chat col min-0"
  style:--composer-space="{dockHeight + 24}px"
  {ondragenter}
  {ondragover}
  {ondragleave}
  {ondrop}
  aria-label={roomLabel}
>
  <header class="header row-nw align-centre gap-sm hairline-b">
    <button class="icon ghost press mobile-only" aria-label={text("navigation", "open_channels")} onclick={onchannels}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
    {#if room}
      {#if room.isDirect && room.directUserId}
        <h2 class="name md bold truncate">
          <button type="button" class="name-button ghost truncate" aria-label={text("user_profile", "open").replace("{name}", room.name)} onclick={() => room.directUserId && openFullProfile(room.directUserId, room.id)} oncontextmenu={(event) => { event.preventDefault(); openRoomMenu(room.id, event.clientX, event.clientY); }}><span class="faint">@</span><EmojiText text={room.name} /></button>
        </h2>
      {:else}
        {@const roomId = room.id}
        <h2 class="name md bold truncate">
          <button
            type="button"
            class="name-button ghost truncate"
            aria-haspopup="menu"
            onclick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openRoomMenu(roomId, rect.left, rect.bottom + 4);
            }}
            oncontextmenu={(event) => {
              event.preventDefault();
              openRoomMenu(roomId, event.clientX, event.clientY);
            }}
          >{#if room.isDirect}<span class="faint">@</span>{:else}<svg class="room-hash" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /></svg>{/if}<EmojiText text={room.name} /></button>
        </h2>
      {/if}
      {#if room.topic}
        <span class="topic sm muted truncate">{room.topic}</span>
      {/if}
    {/if}
    <span class="flex-max"></span>
    {#if room}
      <button
        class="icon pins-button ghost press"
        class:active={pinsOpen}
        aria-label={pinnedIds.length ? text("chat", "pins_count").replace("{count}", String(pinnedIds.length)) : text("chat", "pins")}
        aria-haspopup="dialog"
        aria-expanded={pinsOpen}
        use:tooltip={text("chat", "pins")}
        bind:this={pinsButton}
        onclick={() => (pinsOpen = !pinsOpen)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.pin} /></svg>
        {#if pinnedIds.length}<span class="pin-count xs bold" aria-hidden="true">{pinnedIds.length > 99 ? "99+" : pinnedIds.length}</span>{/if}
      </button>
    {/if}
    <button class="icon ghost press" aria-label={text("navigation", "open_members")} use:tooltip={text("navigation", "open_members")} onclick={onmembers}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-3.3 3.1-6 7-6s7 2.7 7 6v1H2v-1Zm15.5 1H22v-1c0-2.6-2.2-4.6-5-5 1.2 1.3 1.9 3 2 4.9V20h-1.5Z" />
      </svg>
    </button>
  </header>

  {#if room}
    {#if lockedOut && dismissedRoom !== room.id}
      <div class="decrypt-banner row-nw align-centre gap-sm sm" role="status">
        <span class="banner-text row-nw align-centre gap-sm min-0">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
          </svg>
          <span class="muted min-0">{text("encryption", "banner")}</span>
        </span>
        <span class="banner-controls row-nw align-centre gap-xs">
        <button type="button" class="banner-action ghost press bold" onclick={() => restoreOpen.set(true)}>{text("encryption", "banner_action")}</button>
        <button type="button" class="banner-close ghost press" aria-label={text("encryption", "dismiss")} onclick={() => (dismissedRoom = room.id)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        </span>
      </div>
    {/if}
    {#key room.id}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <ol class="timeline col flex-max min-0 travel-{travel || 'idle'}" bind:this={timeline} onanimationend={(event) => event.target === timeline && travel.startsWith("in") && (travel = "")} {onscroll} onclick={onmentionclick} onwheel={unpin} ontouchstart={unpin} onkeydown={unpin} onpointerdown={unpin}>
      {#if $canLoadOlder}
        <li class="history row centre" aria-busy="true">
          <span class="dots row-nw gap-sm" aria-label={text("chat", "loading_history")}><span></span><span></span><span></span></span>
        </li>
      {:else}
        <li class="beginning">
          <span class="hero row centre glow"><Avatar name={room.name} url={room.avatar} size="56px" radius="30%" /></span>
          <p class="lg bold">{text("chat", "beginning").replace("{room}", roomLabel)}</p>
          {#if room.topic}<p class="sm muted">{room.topic}</p>{/if}
          {#if !timelineMessages.length}<p class="sm faint">{text("chat", "no_messages")}</p>{/if}
        </li>
      {/if}
      {#each timelineMessages as message (message.id)}
        {@const sender = getSender(message.sender)}
        {@const offset = swipe?.id === message.id ? swipe.dx : 0}
        {#if message.kind === "system" && message.system}
          <li class="system row-nw align-centre gap-sm xs" data-event-id={message.eventId}>{@render systemLine(message.system, message.ts)}</li>
        {:else if message.kind === "members" && message.members}
          <li class="system members xs" data-event-id={message.eventId}>
            <details>
              <summary class="row-nw align-centre gap-sm">
                <span class="system-icon row centre" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={SYSTEM_ICONS.profile} /></svg></span>
                <span class="system-text min-0 muted">{summarise(message.members)}</span>
                <svg class="chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d={ICONS.chevron} /></svg>
                <time class="faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
              </summary>
              <ul class="member-list col">
                {#each message.members as item (item.id)}
                  {#if item.system}<li class="row-nw align-centre gap-sm" data-event-id={item.eventId}>{@render systemLine(item.system, item.ts)}</li>{/if}
                {/each}
              </ul>
            </details>
          </li>
        {:else}
        <li
          class="message row-nw"
          class:grouped={message.grouped && !message.replyTo}
          class:last={message.last}
          class:sending={message.status === "sending"}
          class:failed={message.status === "failed"}
          class:mentioned={message.mentionsMe}
          class:server={message.kind === "server"}
          class:menu-open={menu?.message.id === message.id}
          class:editing={editing?.eventId === message.eventId}
          data-event-id={message.eventId}
          oncontextmenu={(event) => oncontextmenu(event, message)}
          onpointerdown={(event) => onpointerdown(event, message)}
          onpointermove={(event) => onpointermove(event, message)}
          onpointerup={() => onpointerup(message)}
          onpointercancel={() => onpointerup(message)}
          style:translate={offset ? `${offset}px 0` : undefined}
        >
          {#if offset}
            <span class="swipe-cue row centre" class:armed={offset >= SWIPE_REPLY} style:opacity={Math.min(1, offset / SWIPE_REPLY)} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.reply} /></svg>
            </span>
          {/if}
          {#if message.replyTo}
            {@const original = findReply(message.replyTo)}
            {@const author = original ? getSender(original.sender) : null}
            <button
              type="button"
              class="reply-quote row-nw align-centre gap-sm ghost xs"
              aria-label={text("chat", "jump_to_reply")}
              onclick={() => message.replyTo && jumpToMessage(message.replyTo)}
            >
              <span class="connector" aria-hidden="true"></span>
              {#if original && author}
                <Avatar name={author.name} url={author.avatar} size="16px" radius="50%" />
                <span class="reply-name bold"><EmojiText text={author.name} /></span>
                <span class="reply-text truncate muted">{original.redacted ? text("chat", "redacted") : toPreviewLine(original.content) || text("chat", "encrypted")}</span>
              {:else}
                <span class="reply-text truncate faint">{text("chat", "reply_unavailable")}</span>
              {/if}
            </button>
          {/if}
          <div class="gutter">
            {#if message.grouped && !message.replyTo}
              <time class="hover-time xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
            {:else}
              <button type="button" class="author-avatar ghost press" data-profile-trigger aria-label={text("user_profile", "open").replace("{name}", sender.name)} onclick={(event) => openProfile(message.sender, event.currentTarget)}>
                <Avatar name={sender.name} url={sender.avatar} size="38px" radius="50%" />
              </button>
            {/if}
          </div>
          <div class="content col min-0">
            {#if !message.grouped || message.replyTo}
              <div class="meta row-nw align-centre gap-sm">
                <button type="button" class="sender md bold ghost" class:admin={sender.powerLevel >= 100} data-profile-trigger onclick={(event) => openProfile(message.sender, event.currentTarget)}><EmojiText text={sender.name} /></button>
                <time class="xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
                {#if message.kind === "notice"}<span class="bot-tag xs bold">{text("chat", "bot")}</span>{/if}
                {#if message.kind === "server"}<span class="bot-tag server-tag xs bold">{text("chat", "server_notice")}</span>{/if}
                {#if pinnedSet.has(message.eventId)}{@render pinMark()}{/if}
              </div>
            {:else if pinnedSet.has(message.eventId)}
              <span class="pin-float">{@render pinMark()}</span>
            {/if}
            {#if editing?.eventId === message.eventId}
              <div class="editor col gap-xs">
                <textarea
                  class="edit-field"
                  rows="1"
                  aria-label={text("chat", "edit")}
                  bind:value={editing.draft}
                  onkeydown={(event) => oneditkey(event, message)}
                  oninput={(event) => {
                    const field = event.currentTarget;
                    field.style.height = "auto";
                    field.style.height = `${field.scrollHeight}px`;
                  }}
                ></textarea>
                <span class="xs faint row-nw align-centre gap-sm">
                  {text("chat", "editing_hint")}
                  <button type="button" class="link-button ghost press xs bold" onclick={() => (editing = null)}>{text("chat", "cancel")}</button>
                  <button type="button" class="link-button accent ghost press xs bold" onclick={() => saveEdit(message)}>{text("chat", "save")}</button>
                </span>
              </div>
            {:else if message.kind === "media"}
              {#if message.content.msgtype !== "m.file" && message.content.body && message.content.filename && message.content.filename !== message.content.body}
                <p class="body selectable"><MessageBody content={message.content} {ownUserId} {resolveName} /></p>
              {/if}
              <MessageMedia content={message.content} sender={resolveName(message.sender)} ts={message.ts} />
            {:else if message.kind === "sticker"}
              <MessageMedia content={message.content} sticker />
            {:else if message.kind === "location"}
              <LocationCard location={message.location ?? null} live={message.live} label={message.live === undefined ? undefined : text("location", message.live ? "live_shared" : "live_ended")} />
            {:else if message.kind === "poll"}
              <Poll event={message.event} related={relations.get(message.eventId) ?? []} {ownUserId} mayEnd={mayModerate} />
            {:else if message.plain}
              <p class="body selectable {message.kind}">{#if message.kind === "emote"}<span class="emote-sender">* <EmojiText text={sender.name} /></span> {/if}<MessageBody content={message.content} {ownUserId} {resolveName} jumbo={message.kind !== "emote"} />{#if message.edited}<span class="edited xs faint"> {text("chat", "edited")}</span>{/if}</p>
            {:else}
              <p class="body selectable {message.kind}"><EmojiText text={message.body} /></p>
            {/if}
            {#each message.links as link (link)}
              <LinkPreview url={link} ts={message.ts} previews={previewsOn} />
            {/each}
            {#if message.status === "failed"}
              <p class="failure xs row-nw align-centre gap-sm">
                <span>{text("chat", "failed")}</span>
                <button type="button" class="retry ghost press xs bold" onclick={() => retry(message.txnId)}>{text("chat", "retry")}</button>
              </p>
            {/if}
          </div>
          {#if editing?.eventId !== message.eventId && !message.local}
            <div class="toolbar row-nw" role="toolbar" aria-label={text("chat", "actions")}>
              {#if message.kind !== "redacted"}
                <button type="button" class="tool ghost press" aria-label={text("chat", "reply")} use:tooltip={text("chat", "reply")} onclick={() => startReply(message)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.reply} /></svg>
                </button>
              {/if}
              {#if canEdit(message)}
                <button type="button" class="tool ghost press" aria-label={text("chat", "edit")} use:tooltip={text("chat", "edit")} onclick={() => startEdit(message)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.edit} /></svg>
                </button>
              {/if}
              <button
                type="button"
                class="tool ghost press"
                aria-label={text("chat", "more")}
                use:tooltip={text("chat", "more")}
                aria-haspopup="menu"
                onclick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(message, rect.right - 200, rect.bottom + 4);
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>
              </button>
            </div>
          {/if}
        </li>
        {/if}
      {/each}
      {#if isDetached && $canLoadNewer}
        <li class="history row centre" aria-busy="true">
          <span class="dots row-nw gap-sm" aria-label={text("chat", "loading_newer")}><span></span><span></span><span></span></span>
        </li>
      {/if}
    </ol>
    {/key}

    <div class="present-wrap row centre" class:shown={showPresent} inert={!showPresent}>
        <button type="button" class="present row-nw align-centre gap-sm sm bold press" class:fresh={newCount > 0} onclick={jumpToPresent}>
          {#if newCount > 0}
            <span>{text("chat", newCount === 1 ? "new_message" : "new_messages").replace("{count}", String(newCount))}</span>
            <span class="present-sep" aria-hidden="true">·</span>
            <span>{text("chat", "jump_short")}</span>
          {:else}
            <span>{isDetached ? text("chat", "viewing_older") : ""}{isDetached ? " · " : ""}{text("chat", "jump_present")}</span>
          {/if}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-6-6 6 6 6-6" /></svg>
        </button>
      </div>

    <Composer
      bind:draft
      bind:field={composer}
      bind:dockHeight
      label={text("chat", "composer").replace("{room}", roomLabel)}
      {replying}
      {pending}
      keepImageMetadata={settings?.keepImageMetadata}
      onsend={send}
      oncancelreply={() => (replying = null)}
      onfiles={addFiles}
      onremove={removePending}
      oneditlast={editLast}
      onmetadata={setKeepImageMetadata}
    />

    {#if dragDepth > 0}
      <div class="dropzone col centre gap-sm" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="32" height="32"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m-5 5 5-5 5 5M5 20h14" /></svg>
        <span class="md bold">{text("media", "drop")}</span>
      </div>
    {/if}
  {:else}
    <div class="empty col centre flex-max glow">
      <p class="muted md">{text("chat", "empty")}</p>
    </div>
  {/if}

  {#if pinsOpen && room}
    <PinnedMessages
      roomId={room.id}
      pinned={pinnedIds}
      anchor={pinsButton}
      canUnpin={mayPin}
      {ownUserId}
      {getSender}
      onjump={jumpToMessage}
      onunpin={(eventId, event) => ask("unpin", eventId, event)}
      onclose={() => (pinsOpen = false)}
    />
  {/if}

  {#if note}
    <div class="note sm row-nw align-centre gap-sm" role="status" use:portal>{note}</div>
  {/if}

  {#if menu}
    <MessageMenu items={menuItems(menu.message, menu.link)} x={menu.x} y={menu.y} label={text("chat", "actions")} onclose={() => (menu = null)} />
  {/if}

  {#if confirming}
    <ConfirmDialog
      bind:this={confirmDialog}
      title={text("chat", `${confirming.kind}_title`)}
      body={text("chat", `${confirming.kind}_body`)}
      cancelLabel={text("chat", "cancel")}
      confirmLabel={text("chat", confirming.kind)}
      tone={confirming.kind === "pin" ? "primary" : "danger"}
      onconfirm={confirmAction}
      onclose={() => (confirming = null)}
    />
  {/if}

</section>

{#snippet systemLine(line: SystemLine, ts: number)}
  <span class="system-icon row centre {line.tone ?? ''}" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={SYSTEM_ICONS[line.icon]} /></svg></span>
  <span class="system-text min-0 muted"><EmojiText text={formatLine(line)} />{#if line.detail}<span class="faint"> · <EmojiText text={line.detail} /></span>{/if}</span>
  {#if line.jump}{@const target = line.jump}<button type="button" class="system-link ghost press bold" onclick={() => jumpToMessage(target)}>{text("system", "jump")}</button>{/if}
  {#if line.room}{@const target = line.room}<button type="button" class="system-link ghost press bold" onclick={() => openUpgraded(target)}>{text("system", "go_to_room")}</button>{/if}
  <time class="faint" datetime={new Date(ts).toISOString()}>{formatTime(ts)}</time>
{/snippet}

{#snippet pinMark()}
  <span class="pin-mark" use:tooltip={text("chat", "pinned")} aria-label={text("chat", "pinned")} role="img">
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.pin} /></svg>
  </span>
{/snippet}

<style>
  .travel-out-down {
    animation: travel-out-down 350ms var(--azure-ease-fluid) forwards;
  }

  .travel-in-top {
    animation: travel-in-top 420ms var(--azure-ease-fluid);
  }

  .travel-out-up {
    animation: travel-out-up 350ms var(--azure-ease-fluid) forwards;
  }

  .travel-in-bottom {
    animation: travel-in-bottom 420ms var(--azure-ease-fluid);
  }

  @keyframes travel-out-down {
    to {
      opacity: 0;
      transform: translateY(18%);
      filter: blur(6px);
    }
  }

  @keyframes travel-in-top {
    from {
      opacity: 0;
      transform: translateY(-14%);
      filter: blur(6px);
    }
  }

  @keyframes travel-out-up {
    to {
      opacity: 0;
      transform: translateY(-18%);
      filter: blur(6px);
    }
  }

  @keyframes travel-in-bottom {
    from {
      opacity: 0;
      transform: translateY(14%);
      filter: blur(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .travel-out-down,
    .travel-out-up {
      animation: travel-fade-out 120ms linear forwards;
    }

    .travel-in-top,
    .travel-in-bottom {
      animation: travel-fade-in 160ms linear;
    }
  }

  @keyframes travel-fade-out {
    to {
      opacity: 0;
    }
  }

  @keyframes travel-fade-in {
    from {
      opacity: 0;
    }
  }

  .present-wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--composer-space) + env(safe-area-inset-bottom));
    z-index: var(--azure-z-sticky);
    pointer-events: none;
  }

  .present {
    height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-pill);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, var(--colours-surface-raised) 92%, transparent);
    backdrop-filter: blur(8px);
    box-shadow:
      0 10px 28px -12px black,
      0 0 22px -10px var(--colours-accent-glow);
    cursor: pointer;
    opacity: 0;
    translate: 0 10px;
    scale: 0.96;
    transition:
      opacity var(--azure-duration-md) var(--azure-ease-fluid),
      translate var(--azure-duration-glide) var(--azure-ease-fluid),
      scale var(--azure-duration-glide) var(--azure-ease-fluid),
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .present-wrap.shown .present {
    opacity: 1;
    translate: 0 0;
    scale: 1;
    pointer-events: auto;
  }

  .present:hover,
  .present:focus-visible {
    color: var(--colours-accent);
  }

  .present.fresh {
    color: white;
    border-color: transparent;
    background-color: var(--colours-accent);
  }

  .present-sep {
    opacity: 0.6;
  }

  .author-avatar {
    display: block;
    align-self: flex-start;
    height: fit-content;
    line-height: 0;
    border-radius: 50%;
  }

  button.sender:hover,
  button.sender:focus-visible {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .name-button {
    padding: 0;
    max-width: 100%;
    font: inherit;
    color: inherit;
  }

  .room-hash {
    flex: none;
    margin-right: var(--azure-spacing-sm);
    vertical-align: -5px;
    color: var(--colours-text-faint);
  }

  .name-button:hover,
  .name-button:focus-visible {
    text-decoration: underline;
    text-decoration-color: var(--colours-text-strong);
    text-underline-offset: 3px;
  }

  .pins-button {
    position: relative;
    color: var(--colours-text-faint);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .pins-button:hover,
  .pins-button.active {
    color: var(--colours-accent);
  }

  .pin-count {
    position: absolute;
    top: 3px;
    right: 1px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-pill);
    font-size: 10px;
    line-height: 1;
    color: var(--colours-background);
    background-color: var(--colours-accent);
    box-shadow: 0 0 10px -2px var(--colours-accent-glow);
  }

  .pin-mark {
    display: inline-grid;
    place-items: center;
    color: var(--colours-text-faint);
    rotate: 30deg;
  }

  .message:hover .pin-mark {
    color: var(--colours-accent);
  }

  .pin-float {
    position: absolute;
    top: 4px;
    right: var(--azure-spacing-lg);
  }

  .note {
    position: fixed;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    translate: -50% 0;
    z-index: var(--azure-z-popover);
    padding: var(--azure-spacing-sm) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-pill);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    color: var(--colours-text-strong);
    box-shadow:
      0 12px 32px -12px black,
      0 0 24px -12px var(--colours-accent-glow);
    animation: note-in var(--azure-duration-md) var(--azure-ease-spring);
  }

  @keyframes note-in {
    from {
      opacity: 0;
      translate: -50% 8px;
    }
  }

  .chat {
    --composer-space: 84px;

    height: 100%;
    position: relative;
    background-color: var(--colours-background);
  }

  .decrypt-banner {
    flex: none;
    flex-wrap: wrap;
    row-gap: var(--azure-spacing-xs);
    margin: var(--azure-spacing-sm) var(--azure-spacing-md) 0;
    padding: var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-sm) var(--azure-spacing-md);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    border: 1px solid color-mix(in oklab, var(--colours-accent) 22%, transparent);
    border-radius: var(--azure-radius-md);
    box-shadow: 0 0 24px -12px var(--colours-accent-glow);
    animation: banner-in var(--azure-duration-md) var(--azure-ease-out);
  }

  .banner-text {
    flex: 1 1 200px;
  }

  .banner-text svg {
    flex: none;
  }

  .banner-controls {
    flex: none;
    margin-left: auto;
  }

  .banner-action {
    flex: none;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    color: var(--colours-accent);
    background: none;
    text-underline-offset: 3px;
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .banner-action:hover,
  .banner-action:focus-visible {
    color: var(--colours-accent-strong);
    text-decoration: underline;
  }

  .banner-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--colours-text-muted);
    border-radius: var(--azure-radius-sm);
  }

  .banner-close:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @media (max-width: 767px) {
    .banner-action,
    .banner-close {
      min-height: var(--azure-touch);
    }

    .banner-close {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }


  .header {
    height: 52px;
    flex: none;
    box-sizing: content-box;
    padding: 0 var(--azure-spacing-md);
    padding-top: env(safe-area-inset-top);
  }

  .name {
    margin: 0;
    color: var(--colours-text-strong);
    flex: none;
    max-width: 50%;
  }

  .topic {
    margin-left: calc(var(--azure-spacing-md) - var(--azure-spacing-sm));
    padding-left: var(--azure-spacing-md);
    border-left: 1px solid var(--colours-outline-hairline);
  }

  .icon {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
  }

  .icon:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: var(--azure-spacing-lg) 0 calc(var(--composer-space) + env(safe-area-inset-bottom));
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    touch-action: pan-y;
    --fade-end: calc(var(--composer-space) * 0.55 + env(safe-area-inset-bottom));
    --fade-start: calc(var(--fade-end) + 48px);
    mask-image: linear-gradient(
      to top,
      transparent var(--fade-end),
      black var(--fade-start)
    );
  }

  .beginning {
    margin-top: auto;
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg) var(--azure-spacing-lg);
  }

  .hero {
    display: inline-flex;
  }

  .beginning p {
    margin: var(--azure-spacing-sm) 0 0;
  }

  .beginning .lg {
    color: var(--colours-text-strong);
  }

  .message {
    padding: var(--azure-spacing-sm) var(--azure-spacing-lg) 2px 0;
    margin: var(--azure-spacing-sm) var(--azure-spacing-sm) 0;
    border-radius: var(--azure-radius-md);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .message.grouped {
    padding-top: 2px;
    margin-top: 0;
  }

  .message.last {
    padding-bottom: var(--azure-spacing-sm);
  }

  .message:hover {
    background-color: var(--colours-surface-hover);
  }

  .gutter {
    width: 64px;
    flex: none;
    display: flex;
    justify-content: center;
    padding-top: 2px;
  }

  .hover-time {
    opacity: 0;
    line-height: 22px;
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .message:hover .hover-time {
    opacity: 1;
  }

  .sender {
    color: var(--colours-text-strong);
  }

  .sender.admin {
    color: var(--colours-accent-strong);
  }

  .body {
    margin: 0;
    font-size: var(--text-md);
    line-height: 22px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .history {
    margin-top: auto;
    padding: var(--azure-spacing-xl);
  }

  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    animation: pulse var(--azure-duration-glide) var(--azure-ease-in-out) infinite alternate;
  }

  .dots span:nth-child(2) {
    animation-delay: var(--azure-duration-fast);
  }

  .dots span:nth-child(3) {
    animation-delay: calc(var(--azure-duration-fast) * 2);
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }

  .message.sending .content {
    opacity: 0.5;
  }

  .notice {
    color: var(--colours-text-muted);
  }

  .bot-tag {
    padding: 0 5px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .message.server {
    border: 1px solid var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .system {
    margin: 2px var(--azure-spacing-sm) 0;
    padding: 2px var(--azure-spacing-lg) 2px 0;
    padding-inline-start: calc(38px + var(--azure-spacing-lg) - 22px);
    border-radius: var(--azure-radius-md);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .system:hover {
    background-color: var(--colours-surface-hover);
  }

  .system time {
    flex: none;
    opacity: 0;
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .system:hover time,
  .system:focus-within time {
    opacity: 1;
  }

  .system-icon {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--colours-text-faint);
  }

  .system-icon.accent {
    color: var(--colours-accent);
  }

  .system-icon.danger {
    color: var(--colours-danger);
  }

  .system-text {
    overflow-wrap: anywhere;
  }

  .system-link {
    flex: none;
    color: var(--colours-accent);
  }

  .system-link:hover {
    text-decoration: underline;
  }

  .members details {
    width: 100%;
  }

  .members summary {
    cursor: pointer;
    list-style: none;
  }

  .members summary::-webkit-details-marker {
    display: none;
  }

  .chevron {
    flex: none;
    color: var(--colours-text-faint);
    transition: rotate var(--azure-duration-fast) var(--azure-ease-out);
  }

  .members details[open] .chevron {
    rotate: 90deg;
  }

  .member-list {
    margin: 2px 0 0;
    padding: 0 0 0 var(--azure-spacing-lg);
    gap: 2px;
    list-style: none;
  }

  .member-list li:hover time {
    opacity: 1;
  }

  .emote {
    font-style: italic;
  }

  .emote-sender {
    font-weight: 600;
    color: var(--colours-text-strong);
  }

  .redacted,
  .fallback {
    font-style: italic;
    color: var(--colours-text-faint);
  }

  .failure {
    margin: 0;
    color: var(--colours-danger);
  }

  .retry {
    color: var(--colours-danger);
    text-decoration: underline;
  }

  .retry:hover {
    color: var(--colours-text-strong);
  }

  textarea {
    min-width: 0;
    width: 0;
    max-height: 40vh;
    padding: 9px 0;
    resize: none;
    border: 0;
    outline: none;
    background: none;
    font: inherit;
    font-size: var(--text-md);
    line-height: 20px;
    color: var(--colours-text-strong);
  }

  textarea::placeholder {
    color: var(--colours-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    padding: var(--azure-spacing-xl);
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 767px) {
    .mobile-only {
      display: grid;
    }

    .topic {
      display: none;
    }

    .icon {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    textarea {
      font-size: 16px;
    }

    .gutter {
      width: 56px;
    }
  }

  .message {
    position: relative;
    flex-wrap: wrap;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      translate var(--azure-duration-md) var(--azure-ease-spring);
  }

  .content {
    flex: 1 1 0;
  }

  .message.mentioned {
    background-color: color-mix(in oklab, var(--colours-warning) 9%, transparent);
    box-shadow: inset 2px 0 0 var(--colours-warning);
  }

  .message.mentioned:hover {
    background-color: color-mix(in oklab, var(--colours-warning) 13%, transparent);
  }

  .message.menu-open,
  .message.editing {
    background-color: var(--colours-surface-hover);
  }

  .message:global(.flash) {
    animation: flash 1.6s var(--azure-ease-out);
  }

  @keyframes flash {
    0%,
    30% {
      background-color: var(--colours-accent-soft);
      box-shadow: inset 2px 0 0 var(--colours-accent);
    }
  }

  .swipe-cue {
    position: absolute;
    left: -40px;
    top: 50%;
    width: 32px;
    height: 32px;
    margin-top: -16px;
    border-radius: 50%;
    color: var(--colours-text-muted);
    background-color: var(--colours-surface-raised);
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .swipe-cue.armed {
    color: var(--colours-accent);
    transform: scale(1.12);
    box-shadow: 0 0 18px -4px var(--colours-accent-glow);
  }

  .reply-quote {
    flex-basis: 100%;
    min-width: 0;
    margin: 0 0 2px;
    padding: 0 0 0 64px;
    position: relative;
    height: 20px;
    text-align: left;
    color: var(--colours-text-muted);
  }

  .reply-quote:not(:disabled):hover .reply-text,
  .reply-quote:not(:disabled):hover .reply-name {
    color: var(--colours-text-strong);
  }

  .reply-quote:disabled {
    cursor: default;
  }

  .connector {
    position: absolute;
    left: 32px;
    top: 10px;
    width: 26px;
    height: 12px;
    border-top: 2px solid var(--colours-outline-strong);
    border-left: 2px solid var(--colours-outline-strong);
    border-top-left-radius: var(--azure-radius-sm);
  }

  .reply-name {
    flex: none;
    color: var(--colours-text);
  }

  .reply-text {
    min-width: 0;
  }

  .toolbar {
    position: absolute;
    top: -14px;
    right: var(--azure-spacing-lg);
    padding: 2px;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 6px 18px -8px black;
    transform: translateY(2px);
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .message:hover .toolbar,
  .message:focus-within .toolbar,
  .message.menu-open .toolbar {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .tool {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .tool:hover {
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  .editor textarea {
    width: 100%;
    max-height: 40vh;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    border: 1px solid color-mix(in oklab, var(--colours-accent) 45%, transparent);
    background-color: var(--colours-surface-raised);
    box-shadow: 0 0 20px -10px var(--colours-accent-glow);
  }

  .link-button {
    color: var(--colours-text-muted);
  }

  .link-button:hover,
  .link-button.accent {
    color: var(--colours-accent);
  }

  .dropzone {
    position: absolute;
    inset: var(--azure-spacing-md);
    z-index: var(--azure-z-overlay);
    pointer-events: none;
    color: var(--colours-accent);
    border-radius: var(--azure-radius-lg);
    border: 2px dashed color-mix(in oklab, var(--colours-accent) 60%, transparent);
    background-color: color-mix(in oklab, var(--colours-background) 80%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: inset 0 0 60px -20px var(--colours-accent-glow);
    animation: fade-in var(--azure-duration-md) var(--azure-ease-out);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @media (pointer: coarse) {
    .message {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }

    .message :global(:is(.selectable, img.emoji)) {
      -webkit-user-select: none;
      user-select: none;
    }

    .toolbar {
      display: none;
    }
  }

  @media (max-width: 767px) {
    .reply-quote {
      padding-left: 56px;
    }

    .connector {
      left: 28px;
    }
  }
</style>
