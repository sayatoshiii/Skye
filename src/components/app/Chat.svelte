<script lang="ts">
  import { reducesMotion } from "../../scripts/settings/motion";
  import { blur, fly, scale, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { backOut, cubicOut } from "svelte/easing";
  import KeyText from "../ui/KeyText.svelte";
  import { copied, toast, toastKey, type ToastIcon } from "../../scripts/stores/toast";
  import { tooltip } from "../../scripts/misc/tooltip";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { canCopyMedia, copyMedia } from "../../scripts/misc/clipboard";
  import { portal } from "../../scripts/misc/portal";
  import EmojiText from "../ui/EmojiText.svelte";
  import ReactionKey from "../ui/ReactionKey.svelte";
  import EditorField from "./EditorField.svelte";
  import Composer, { type Pending } from "./Composer.svelte";
  import { tick, untrack } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { roleIcon, roleIndex, roleOf } from "../../scripts/matrix/utilities/power";
  import { canPin, canRedact, getPowerLevel, getPredecessor, getTombstone } from "../../scripts/matrix/rooms";
  import { joinRoom } from "../../scripts/matrix/utilities/hierarchy";
  import { serverNameFromUserId } from "../../scripts/matrix/discovery";
  import RoomSettings from "./RoomSettings.svelte";
  import type { TimelineEvent } from "../../scripts/matrix/types";
  import { formatBytes, getUploadLimit, isInline, prepareAttachment, sanitiseFilename, uploadAttachment, type PreparedAttachment } from "../../scripts/matrix/utilities/attachments";
  import { seedMedia } from "../../scripts/matrix/utilities/media";
  import { downloadMedia } from "../../scripts/matrix/utilities/download";
  import { isMxc, type MediaSource } from "../../scripts/matrix/utilities/media";
  import { findLinks, stripReplyFallback, toPreviewLine } from "../../scripts/misc/formatting";
  import { mentionsUser, recoverPills, trimPills, type Pill } from "../../scripts/misc/mentions";
  import { MEDIA } from "../../scripts/settings/config";
  import { linkPreviewsEnabled, mediaSettings, setHideRedacted, setShowCallEvents, setKeepImageMetadata, type MediaSettings } from "../../scripts/settings/media";
  import { toEntity } from "../../scripts/stores/entities";
  import { lightbox } from "../../scripts/stores/lightbox";
  import { visibleTimeline } from "../../scripts/stores/ignored";
  import {
    canLoadOlder,
    synced,
    currentRoom,
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
    markAsRead,
    markUnread,
    unreadMarkers,
    unreadDivider,
    type UnreadDivider,
    redactMessage,
    restoreOpen,
    retryMessage,
    sendMessage,
    sendRoomMessage,
    sendRoomEvent,
    rooms,
    session,
    waitForRoom,
    undecryptable,
    readReceipts,
    sendReaction,
    sendTyping,
    typingUsers,
    type ReadReceipt,
    type ReplyTarget,
  } from "../../scripts/stores/matrix";
  import EmojiPicker from "./EmojiPicker.svelte";
  import GifPicker from "./GifPicker.svelte";
  import { favouriteGifs, favouriteLinkGif, isGifbox, rememberGifUpload, seedGifbox, shareGifbox, gifFromContent, gifFromLink, isGifContent, isGifLink, toggleFavouriteGif, type GifFavourite } from "../../scripts/settings/gifs";
  import { getLinkPreview } from "../../scripts/matrix/utilities/previews";
  import { quickEmoji, useEmoji } from "../../scripts/settings/emoji";
  import Avatar from "../ui/Avatar.svelte";
  import LinkPreview from "./media/LinkPreview.svelte";
  import MxcEmbed from "./media/MxcEmbed.svelte";
  import MessageBody from "./media/MessageBody.svelte";
  import MessageMedia from "./media/MessageMedia.svelte";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";
  import PinnedMessages from "./PinnedMessages.svelte";
  import SearchField, { type SearchMember } from "./SearchField.svelte";
  import SearchPanel from "./SearchPanel.svelte";
  import SearchFilters from "./SearchFilters.svelte";
  import { emptyFilters, isBlank, type SearchQuery } from "../../scripts/matrix/search";
  import ThreadPanel from "./ThreadPanel.svelte";
  import CallStage from "./CallStage.svelte";
  import { placeCall, leaveCall } from "../../scripts/stores/calls";
  import { joinable, voice, voicePrefs } from "../../scripts/stores/voice";
  import { SETTINGS_ICONS } from "../settings/icons";
  import ThreadSummary from "./ThreadSummary.svelte";
  import { bundledThread, threadRootOf, type ThreadSummary as Summary } from "../../scripts/matrix/timeline";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import { formatAgo } from "../../scripts/misc/time";
  import PeopleDialog, { type PeopleRow } from "./PeopleDialog.svelte";
  import { usermenu } from "../../scripts/misc/usermenu";
  import { entityText, menu as entityMenu } from "../../scripts/misc/entitymenu.svelte";
  import LocationCard from "./media/LocationCard.svelte";
  import LocationDialog from "./LocationDialog.svelte";
  import Poll from "./media/Poll.svelte";
  import PollDialog from "./PollDialog.svelte";
  import { BEACON, CALL_MEMBER, BEACON_INFO, LOCATION_KEYS, POLL_END, POLL_START, formatCoordinates, getLocation, getPoll, locationContent, osmLink, pollEndContent, pollStartContent, relatedTo, type GeoLocation } from "../../scripts/matrix/utilities/content";
  import { SYSTEM_ICONS, SYSTEM_TYPES, describeSystem, type MemberVerb, type SystemLine } from "../../scripts/matrix/utilities/system";
  import { handoff, navigation, openJoined, openRoom, openRoomMenu, openRoomSettings, openUserMenu, roomSettings } from "../../scripts/stores/navigation.svelte";
  import { openFullProfile, openMiniProfile } from "../../scripts/stores/profile";
  import Skeleton from "../ui/Skeleton.svelte";
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
  const SWIPE_EDIT = 140;
  const CALL_EVENT_TYPES = ["m.call.invite", "m.call.hangup", ...CALL_MEMBER];
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
    react: "M12 21a9 9 0 1 1 9-9M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 15v6m-3-3h6",
    chevron: "m9 6 6 6-6 6",
  };

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  type Message = (typeof timelineMessages)[number];

  let draft = $state("");
  let pills: Pill[] = $state([]);
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
  type Upload = { id: number; roomId: string; file: File; encrypted: boolean; reply?: ReplyTarget; extra?: Record<string, any>; prepared?: PreparedAttachment; content: Record<string, any> | null; preview?: string; still?: string; progress?: number; failed: boolean; done: boolean; controller: AbortController; ts: number };
  let uploads: Upload[] = $state([]);
  let uploadChain: Promise<unknown> = Promise.resolve();
  const quietUploads = new Set<string>();
  let dragDepth = $state(0);
  let dockHeight = $state(60);
  let replying: (ReplyTarget & { name: string }) | null = $state(null);
  let editing: { eventId: string; draft: string; pills: Pill[] } | null = $state(null);
  let menu: { message: Message; x: number; y: number; link?: string } | null = $state(null);
  type ConfirmKind = "delete" | "pin" | "unpin" | "end_poll";
  let confirming: { kind: ConfirmKind; eventId: string } | null = $state(null);
  let confirmDialog: ConfirmDialog | undefined = $state();

  const CONFIRM_ACTIONS: Record<ConfirmKind, (eventId: string) => Promise<unknown>> = {
    delete: (eventId) => redactMessage(eventId).then(() => toastKey("deleted", { icon: "trash", tone: "danger" })),
    pin: (eventId) => pinMessage(eventId).then(() => toastKey("pinned", { icon: "pin", tone: "accent" })),
    unpin: (eventId) => unpinMessage(eventId).then(() => toastKey("unpinned", { icon: "unpin", tone: "danger" })),
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
  let swiped: { id: string; size: number } | null = $state.raw(null);
  let pinsOpen = $state(false);
  let threadView: { rootId: string | null } | null = $state(null);
  let threadClosing = $state(false);
  let pinsButton: HTMLButtonElement | undefined = $state();
  let note: string | null = $state(null);
  let isDetached = $state(false);
  let farFromBottom = $state(false);
  let unseenAfter: string | null = $state(null);
  let loadingNewer = $state(false);
  let travel: "" | "out-down" | "in-top" | "out-up" | "in-bottom" = $state("");
  const TRAVEL_MS = 350;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const quick = reducesMotion;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let typingMap: Record<string, string[]> = $state.raw({});
  let receiptMap: Record<string, Record<string, ReadReceipt>> = $state.raw({});
  let quickKeys: string[] = $state.raw([]);
  const QUICK_TOOLBAR = 3;
  let reactionPicker: EmojiPicker | undefined = $state();
  let reacting: { eventId: string; anchor: HTMLElement } | null = $state.raw(null);
  let gifReply: { eventId: string; sender: string; anchor: HTMLElement } | null = $state.raw(null);
  const SEEN_LIMIT = 3;
  const TYPING_REFRESH = 4000;

  $effect(() => undecryptable.subscribe((value) => (lockedOut = value)));
  $effect(() => detached.subscribe((value) => (isDetached = value)));
  $effect(() => mediaSettings.subscribe((value) => (settings = value)));
  $effect(() => typingUsers.subscribe((value) => (typingMap = value)));
  $effect(() => readReceipts.subscribe((value) => (receiptMap = value)));
  $effect(() => quickEmoji.subscribe((value) => (quickKeys = value)));
  $effect(() => () => pending.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)));

  const room = $derived($currentRoom && toEntity($currentRoom, $session?.userId));

  const DRAFTS_KEY = "skye:drafts";
  const drafts: Record<string, { draft: string; pills: Pill[] }> = (() => {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
    } catch {
      return {};
    }
  })();
  let draftRoom: string | undefined;
  let saving: ReturnType<typeof setTimeout> | undefined;
  const keepDrafts = () => {
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {}
  };
  const stash = (id: string | undefined, value: string, marks: Pill[]) => id && (value.trim() ? (drafts[id] = { draft: value, pills: marks }) : delete drafts[id]);

  $effect(() => {
    const id = $currentRoom?.roomId;
    untrack(() => {
      if (id === draftRoom) return;
      stash(draftRoom, draft, pills);
      keepDrafts();
      draft = (id && drafts[id]?.draft) || "";
      pills = (id && drafts[id]?.pills) || [];
      draftRoom = id;
    });
  });

  $effect(() => {
    const value = draft;
    const marks = pills;
    untrack(() => draftRoom && (stash(draftRoom, value, marks), clearTimeout(saving), (saving = setTimeout(keepDrafts, 400))));
  });
  $effect(() => {
    const given = handoff.value;
    if (!given || $currentRoom?.roomId !== given.roomId) return;
    untrack(() => ((handoff.value = null), given.text.trim() && (draft = given.text), addFiles(given.files)));
  });
  let stagedFor = $state<string | null>(null);
  let chatOpen = $state(false);
  let stageActive = $state(false);
  let headerSpace = $state(57);
  let stagedRoom: string | undefined;
  const staged = $derived(!!room && stagedFor === room.id && stageActive);

  $effect(() => {
    const id = room?.id;
    id !== stagedRoom && ((stagedRoom = id), (stagedFor = id && $joinable.has(id) ? id : null), (chatOpen = false));
  });

  const tombstone = $derived($currentRoom ? getTombstone($currentRoom) : undefined);
  const predecessor = $derived($currentRoom ? getPredecessor($currentRoom) : undefined);
  const replacementJoined = $derived($rooms[tombstone?.replacement ?? ""]?.membership === "join");
  const predecessorJoined = $derived($rooms[predecessor ?? ""]?.membership === "join");
  let upgrading = $state(false);
  let upgradeFailed = $state(false);

  const openReplacement = (target: { replacement: string; sender: string }) => {
    if (replacementJoined) return openJoined(target.replacement);
    if (!$session || upgrading) return;
    upgrading = true;
    upgradeFailed = false;
    joinRoom($session, target.replacement, [serverNameFromUserId(target.sender)].filter(Boolean))
      .then(({ room_id }) => waitForRoom(room_id).then(() => openJoined(room_id)))
      .catch(() => (upgradeFailed = true))
      .finally(() => (upgrading = false));
  };

  const replacementItems = (target: { replacement: string; sender: string }) => () => [
    { id: "replacement-open", label: text("chat", replacementJoined ? "open_replacement" : "join_replacement"), icon: MENU_ICONS.open, disabled: upgrading, run: () => openReplacement(target) },
    { id: "replacement-copy", label: text("chat", "copy_replacement"), icon: MENU_ICONS.id, separated: true, run: () => copied(target.replacement) },
  ];

  const predecessorItems = (target: string) => () => [
    ...(predecessorJoined ? [{ id: "predecessor-open", label: text("chat", "open_predecessor"), icon: MENU_ICONS.open, run: () => openJoined(target) }] : []),
    { id: "predecessor-copy", label: text("chat", "copy_predecessor"), icon: MENU_ICONS.id, separated: predecessorJoined, run: () => copied(target) },
  ];
  const ownUserId = $derived($session?.userId);
  const encrypted = $derived(!!$currentRoom?.encryption);
  const pinnedIds = $derived($currentRoom?.pinned ?? []);
  const pinnedSet = $derived(new Set(pinnedIds));
  const mayPin = $derived(!!$currentRoom && !!ownUserId && canPin($currentRoom, ownUserId));
  const previewsOn = $derived(!!settings && !!$currentRoom && linkPreviewsEnabled(settings, $currentRoom.roomId, encrypted));

  const roomKey = $derived($currentRoom?.roomId);

  $effect(() => {
    roomKey;
    untrack(() => {
      replying = null;
      editing = null;
      menu = null;
      pinsOpen = false;
      searchQuery = { term: "", ...emptyFilters() };
      searchShown = null;
      filtersOpen = false;
      threadView = null;
      reacting = null;
      unseenAfter = null;
      farFromBottom = false;
    });
  });

  const roles = $derived(roleIndex($currentRoom));

  const getSender = (userId: string) => {
    const member = $currentRoom?.members[userId] ?? $joinedMembers[$currentRoom?.roomId ?? ""]?.[userId];

    return {
      name: member?.displayName ?? userId,
      avatar: member?.avatarUrl,
      powerLevel: $currentRoom ? getPowerLevel($currentRoom, userId) : 0,
      role: roleOf($currentRoom, userId, roles),
    };
  };

  const resolveName = (userId: string) => getSender(userId).name;
  const searchMembers: SearchMember[] = $derived(
    Object.entries({ ...($joinedMembers[$currentRoom?.roomId ?? ""] ?? {}), ...($currentRoom?.members ?? {}) })
      .filter(([, member]) => !member?.membership || member.membership === "join")
      .map(([id, member]) => ({ id, name: member?.displayName ?? id, avatar: member?.avatarUrl }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const runSearch = () => (searchShown = isBlank(searchQuery) ? null : $state.snapshot(searchQuery) as SearchQuery);
  const applyFilters = (filters: ReturnType<typeof emptyFilters>) => ((searchQuery = { ...searchQuery, ...filters }), runSearch());

  const SYSTEM_KINDS = ["system", "members"];

  const isChained = (previous?: { sender: string; ts: number; kind: string }, message?: { sender: string; ts: number; kind: string }) =>
    !!previous && !!message && !SYSTEM_KINDS.includes(previous.kind) && !SYSTEM_KINDS.includes(message.kind) && previous.sender === message.sender && message.ts - previous.ts < GROUP_WINDOW;

  type Kind = "redacted" | "fallback" | "media" | "sticker" | "text" | "notice" | "emote" | "location" | "poll" | "server" | "system" | "members";
  type Described = { kind: Kind; body: string; system?: SystemLine; location?: GeoLocation | null; live?: boolean };

  const relations = $derived.by(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of $visibleTimeline) {
      const target = relatedTo(event);
      if (!target || event.content["m.relates_to"]?.rel_type !== "m.reference") continue;
      const list = map.get(target);
      list ? list.push(event) : map.set(target, [event]);
    }
    return map;
  });

  const threads = $derived.by(() => {
    const map = new Map<string, Summary>();
    $visibleTimeline.forEach((event) => {
      const bundled = bundledThread(event);
      if (bundled) map.set(event.event_id, bundled);
    });
    $visibleTimeline.forEach((event) => {
      const root = threadRootOf(event);
      const current = root ? (map.get(root) ?? { count: 0 }) : undefined;
      if (!root || !current || event.redacted || (current.latest && event.origin_server_ts <= current.latest.origin_server_ts)) return;
      map.set(root, { count: current.count + 1, latest: event, participated: current.participated || event.sender === ownUserId });
    });
    return map;
  });

  const openThread = (rootId: string | null) => {
    pinsOpen = false;
    threadView = { rootId };
  };

  const threadItems = (rootId: string): MenuItem[] => [
    { id: "thread-open", label: text("chat", "open_thread"), icon: MENU_ICONS.thread, run: () => openThread(rootId) },
    { id: "thread-all", label: text("chat", "all_threads"), icon: MENU_ICONS.thread, run: () => openThread(null) },
    { id: "thread-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copy(messageLink(rootId), "link_copied", "link") },
  ];

  const threadsButtonItems = (): MenuItem[] => [
    { id: "threads-open", label: text("chat", threadView ? "close" : "threads"), icon: threadView ? MENU_ICONS.close : MENU_ICONS.thread, run: () => (threadView = threadView ? null : { rootId: null }) },
  ];

  const callSessions = $derived.by(() => {
    const sessions = new Map<string, { end?: number }>();
    const invites = new Map<string, string>();
    const active = new Set<string>();
    let open = "";
    $visibleTimeline.forEach((event) => {
      const member = CALL_MEMBER.includes(event.type);
      const live = member && Object.keys(event.content ?? {}).length > 0 && !(Array.isArray(event.content.memberships) && !event.content.memberships.length);
      const before = active.size;
      member && (live ? active.add(event.state_key ?? event.sender) : active.delete(event.state_key ?? event.sender));
      member && !before && active.size && ((open = event.event_id), sessions.set(open, {}));
      member && before && !active.size && open && sessions.set(open, { end: event.origin_server_ts });
      event.type === "m.call.invite" && typeof event.content.call_id === "string" && !invites.has(event.content.call_id) && (invites.set(event.content.call_id, event.event_id), sessions.set(event.event_id, {}));
      event.type === "m.call.hangup" && invites.has(event.content.call_id) && sessions.set(invites.get(event.content.call_id)!, { end: event.origin_server_ts });
    });
    return sessions;
  });
  const callSummary: boolean = $derived(!!$currentRoom?.isDirect && !(settings as MediaSettings | null)?.showCallEvents);

  const callStart = (callId: string) =>
    $visibleTimeline.find((event) => event.type === "m.call.invite" && event.content.call_id === callId);

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
      const session = callSummary ? callSessions.get(event.event_id) : undefined;
      const minutes = session?.end ? Math.max(1, Math.round((session.end - event.origin_server_ts) / 60000)) : 0;
      const system = session ? { icon: "call" as const, tone: "accent" as const, key: minutes ? (minutes === 1 ? "call_lasted_one" : "call_lasted") : "call_started", params: { actor: resolveName(event.sender), minutes: String(minutes) } } : describeSystem(event, resolveName, callStart);
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

  const mentions = (content: Record<string, any>, userId?: string) =>
    !!userId && mentionsUser(content, userId, [$currentRoom?.members[userId]?.displayName ?? ""]);

  let armed: string[] = $state([]);
  const arm = (id: string) => armed[1] !== id && (armed = [armed[1] ?? id, id]);
  const placed = new Map<string, { key: unknown[]; message: unknown }>();
  const baseMessages = $derived(
    $visibleTimeline
      .filter((event) => VISIBLE_TYPES.includes(event.type) && !(settings?.hideRedacted && event.redacted) && (settings?.showCallEvents || !CALL_EVENT_TYPES.includes(event.type) || (callSummary && callSessions.has(event.event_id))))
      .flatMap((event) => {
        const described = describe(event);
        if (!described) return [];
        const thread = threadRootOf(event);
        const replyTo = event.redacted || thread ? undefined : (event.content["m.relates_to"]?.["m.in_reply_to"]?.event_id as string | undefined);
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
          mentionsMe: !event.redacted && mentions(event.content, ownUserId),
          links: described.kind === "text" ? findLinks(replyTo ? stripReplyFallback(described.body) : described.body).slice(0, MEDIA.maxPreviewLinks) : [],
          plain,
          thread,
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
    foldMembers(baseMessages.filter((message: BaseMessage) => !message.thread))
      .map((message, index, all) => {
        const grouped = isChained(all[index - 1], message);
        const last = !isChained(message, all[index + 1]);
        const key = [message.event, message.event.content, message.status, message.event.redacted, message.members?.length, settings, grouped, last];
        const seen = placed.get(message.id);
        const next = seen && seen.key.every((part, at) => part === key[at]) ? (seen.message as typeof message & { grouped: boolean; last: boolean }) : { ...message, grouped, last };
        placed.set(message.id, { key, message: next });
        return next;
      }),
  );

  type ReactionGroup = { key: string; senders: string[]; own?: string; shortcode?: string };

  const reactions = $derived.by(() => {
    const map = new Map<string, ReactionGroup[]>();
    const seen = new Set<string>();
    for (const event of $visibleTimeline) {
      if (event.type !== "m.reaction" || event.redacted || event.localStatus === "failed") continue;
      const relation = event.content["m.relates_to"];
      if (relation?.rel_type !== "m.annotation" || typeof relation.key !== "string" || typeof relation.event_id !== "string") continue;
      const unique = `${relation.event_id}\n${relation.key}\n${event.sender}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      const groups = map.get(relation.event_id) ?? [];
      if (!groups.length) map.set(relation.event_id, groups);
      let group = groups.find((item) => item.key === relation.key);
      if (!group) groups.push((group = { key: relation.key, senders: [] }));
      group.senders.push(event.sender);
      if (!group.shortcode) {
        const code = event.content.shortcode ?? event.content["com.beeper.reaction.shortcode"];
        if (typeof code === "string" && code.trim()) group.shortcode = `:${code.trim().replace(/^:|:$/g, "")}:`;
      }
      if (event.sender === ownUserId) group.own = event.event_id;
    }
    return map;
  });

  const joinNames = (names: string[]) =>
    names.length < 2 ? (names[0] ?? "") : text("chat", "and").replace("{rest}", names.slice(0, -1).join(", ")).replace("{last}", names.at(-1)!);

  const seenLabel = (readers: string[]) =>
    readers.length <= 3
      ? text("chat", "seen_by").replace("{names}", joinNames(readers.map(resolveName)))
      : text("chat", `seen_crowd_${TYPING_CROWDS.findLastIndex((least) => readers.length >= least)}`);

  const keyLabel = (key: string, shortcode?: string) => (key.startsWith("mxc://") ? (shortcode ?? text("chat", "custom_emoji")) : key);

  const reactedLabel = (group: ReactionGroup) =>
    (group.senders.length <= 3
      ? text("chat", "reacted").replace("{names}", joinNames(group.senders.map(resolveName)))
      : text("chat", `react_crowd_${TYPING_CROWDS.findLastIndex((least) => group.senders.length >= least)}`)
    ).replace("{emoji}", keyLabel(group.key, group.shortcode));

  const toggleReaction = (eventId: string, key: string) => {
    const group = reactions.get(eventId)?.find((item) => item.key === key);
    if (group?.own) return void (group.own.startsWith("~") || redactMessage(group.own).catch(() => undefined));
    sendReaction(eventId, key, undefined, group?.shortcode?.slice(1, -1)).catch(() => undefined);
  };

  const pickReaction = (unicode: string) => {
    if (!reacting) return;
    useEmoji(unicode);
    if (!reactions.get(reacting.eventId)?.find((group) => group.key === unicode)?.own) toggleReaction(reacting.eventId, unicode);
  };

  const openReactions = (message: Message, anchor?: HTMLElement | null) => {
    const target = anchor ?? findEvent(message.eventId)?.querySelector<HTMLElement>(".react-tool") ?? findEvent(message.eventId);
    if (target && reacting?.anchor === target) return reactionPicker?.dismiss();
    if (target) reacting = { eventId: message.eventId, anchor: target };
  };

  const reactedWith = (eventId: string, key: string) => !!reactions.get(eventId)?.find((group) => group.key === key)?.own;

  const quickOptions = (message: Message) =>
    canReact(message) && matchMedia("(pointer: coarse)").matches
      ? quickKeys.map((key) => ({ key, active: reactedWith(message.eventId, key), run: () => toggleReaction(message.eventId, key) }))
      : undefined;

  const motion = (duration: number) => (reducesMotion() ? 0 : duration);
  const fresh = (ts?: number) => !!ts && Date.now() - ts < 8000;
  let settleAt = Infinity;
  const settled = () => performance.now() > settleAt;

  const reactionSeen = new Map<string, { count: number; own: boolean }>();

  const reactionMotion = (node: HTMLElement, state: { id: string; count: number; own: boolean }) => {
    const replay = (name: string, value: string) => {
      node.removeAttribute(name);
      void node.offsetWidth;
      node.setAttribute(name, value);
    };
    const apply = (next: { id: string; count: number; own: boolean }) => {
      const last = reactionSeen.get(next.id);
      reactionSeen.set(next.id, { count: next.count, own: next.own });
      if (!last) return;
      if (next.count !== last.count) {
        node.style.setProperty("--prev", `"${last.count}"`);
        replay("data-flip", next.count > last.count ? "up" : "down");
      }
      if (next.own !== last.own) replay("data-react", next.own ? "add" : "remove");
    };
    apply(state);
    return { update: apply };
  };

  let people: { kind: "reactions" | "seen"; message: Message; selected?: string } | null = $state(null);

  const seenFrom = (message: Message) => {
    const index = timelineMessages.findIndex((item) => item.id === message.id);
    if (index < 0) return [];
    const users = timelineMessages.slice(index).flatMap((item) => seenBy.get(item.id) ?? []);
    const receipts = ($currentRoom && receiptMap[$currentRoom.roomId]) || {};
    return users.sort((a, b) => (receipts[b]?.ts ?? 0) - (receipts[a]?.ts ?? 0)).map((userId) => ({ userId, ts: receipts[userId]?.ts }));
  };

  const personRow = (userId: string, detail?: string, removable = false): PeopleRow => {
    const sender = getSender(userId);
    return { userId, name: sender.name, avatar: sender.avatar, detail: detail ? `${userId} · ${detail}` : undefined, removable };
  };

  const peopleRows = $derived.by((): PeopleRow[] => {
    if (!people) return [];
    if (people.kind === "seen")
      return seenFrom(people.message).map(({ userId, ts }) => personRow(userId, ts ? text("chat", "seen_at").replace("{time}", formatAgo(Date.now() - ts)) : undefined));
    const group = reactions.get(people.message.eventId)?.find((item) => item.key === people!.selected);
    return (group?.senders ?? []).map((userId) => personRow(userId, undefined, userId === ownUserId && !!group?.own));
  });

  const peopleGroups = $derived(people?.kind === "reactions" ? (reactions.get(people.message.eventId) ?? []).map((group) => ({ key: group.key, count: group.senders.length, label: keyLabel(group.key, group.shortcode) })) : undefined);

  $effect(() => {
    if (people?.kind === "reactions" && peopleGroups && !peopleGroups.some((group) => group.key === people!.selected)) {
      if (peopleGroups.length) people.selected = peopleGroups[0].key;
      else people = null;
    }
  });

  const canReact = (message: Message) => !message.local && message.kind !== "redacted" && message.status !== "failed";

  const seenBy = $derived.by(() => {
    const result = new Map<string, string[]>();
    const users = $currentRoom ? receiptMap[$currentRoom.roomId] : undefined;
    if (!users) return result;
    const owner = new Map<string, string>();
    for (const message of timelineMessages) {
      owner.set(message.eventId, message.id);
      message.members?.forEach((item) => owner.set(item.eventId, message.id));
    }
    const position = new Map<string, string>();
    let last: string | undefined;
    for (const event of $visibleTimeline) {
      last = owner.get(event.event_id) ?? last;
      if (last) position.set(event.event_id, last);
    }
    for (const [userId, receipt] of Object.entries(users)) {
      const id = userId === ownUserId ? undefined : position.get(receipt.eventId);
      if (!id) continue;
      const list = result.get(id);
      list ? list.push(userId) : result.set(id, [userId]);
    }
    return result;
  });

  const typingIds = $derived(($currentRoom ? (typingMap[$currentRoom.roomId] ?? []) : []).filter((userId) => userId !== ownUserId));
  const typingNames = $derived(typingIds.map(resolveName));

  const TYPING_CROWDS = [4, 8, 15, 30, 60, 100, 200];

  const typingLabel = $derived(
    typingNames.length === 0
      ? ""
      : typingNames.length === 1
        ? text("chat", "typing_one").replace("{name}", typingNames[0])
        : typingNames.length === 2
          ? text("chat", "typing_two").replace("{first}", typingNames[0]).replace("{second}", typingNames[1])
          : typingNames.length === 3
            ? text("chat", "typing_three").replace("{first}", typingNames[0]).replace("{second}", typingNames[1]).replace("{third}", typingNames[2])
            : text("chat", `typing_crowd_${TYPING_CROWDS.findLastIndex((least) => typingNames.length >= least)}`),
  );

  let typingRoom: string | null = null;
  let typingSentAt = 0;

  const stopTyping = () => {
    if (!typingRoom) return;
    sendTyping(typingRoom, false);
    typingRoom = null;
    typingSentAt = 0;
  };

  $effect(() => {
    const value = draft;
    const roomId = $currentRoom?.roomId;
    untrack(() => {
      if (typingRoom && typingRoom !== roomId) stopTyping();
      if (!roomId || !value.trim() || document.activeElement !== composer) return stopTyping();
      if (typingRoom === roomId && Date.now() - typingSentAt < TYPING_REFRESH) return;
      typingRoom = roomId;
      typingSentAt = Date.now();
      sendTyping(roomId, true);
    });
  });

  $effect(() => {
    const field = composer;
    if (!field) return;
    field.addEventListener("blur", stopTyping);
    return () => field.removeEventListener("blur", stopTyping);
  });

  $effect(() => () => stopTyping());

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
    (getPoll(message.event)?.endsAt ?? Infinity) <= Date.now() ||
    (relations.get(message.eventId) ?? []).some((event) => POLL_END.includes(event.type) && (event.sender === message.sender || mayModerate(event.sender)));

  const findReply = (eventId: string) => $visibleTimeline.find((event) => event.event_id === eventId);

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

  const holdScroll = () => {
    const rows = [...(timeline?.querySelectorAll<HTMLElement>(":scope > li[data-event-id]") ?? [])];
    const box = timeline?.getBoundingClientRect();
    const middle = box ? box.top + box.height / 2 : 0;
    const keep = rows.find((row) => row.getBoundingClientRect().bottom > middle) ?? rows.at(-1);
    const from = keep?.getBoundingClientRect().top ?? 0;
    return () => keep?.isConnected && timeline && (timeline.scrollTop += keep.getBoundingClientRect().top - from);
  };

  const loadOlder = async () => {
    if (!timeline || loadingOlder || !$canLoadOlder) return;

    loadingOlder = true;
    const pinned = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 4;
    const restore = holdScroll();
    const loaded = await loadOlderMessages();
    await tick();
    pinned ? timeline && (timeline.scrollTop = timeline.scrollHeight) : restore();
    loadingOlder = false;
    holdRow();
    if (loaded) fillViewport();
  };

  const loadNewer = async () => {
    if (loadingNewer || !isDetached) return;
    loadingNewer = true;
    const restore = holdScroll();
    const more = await loadNewerMessages();
    await tick();
    restore();
    loadingNewer = false;
    if (more && timeline && timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < LOAD_THRESHOLD) loadNewer();
  };

  let markerMap: Record<string, { eventId: string }> = $state.raw({});
  let dividerTarget: UnreadDivider | null = $state.raw(null);
  let dividerSeen = $state(false);
  $effect(() => unreadMarkers.subscribe((value) => (markerMap = value)));
  $effect(() => unreadDivider.subscribe((value) => (dividerTarget = value)));

  const firstUnread = $derived.by(() => {
    const current = $currentRoom;
    if (!current) return null;
    const marker = markerMap[current.roomId];
    if (marker) return { eventId: marker.eventId, after: false, count: current.localUnread ?? 1, ts: undefined as number | undefined };
    if (dividerTarget?.roomId !== current.roomId) return null;
    return { eventId: dividerTarget.eventId, after: !!dividerTarget.after, count: dividerTarget.count ?? 1, ts: dividerTarget.ts };
  });

  const dividerMessageId = $derived.by(() => {
    if (!firstUnread) return null;
    const index = timelineMessages.findIndex((message) => message.eventId === firstUnread.eventId);
    if (index === -1) return null;
    return (firstUnread.after ? timelineMessages[index + 1] : timelineMessages[index])?.id ?? null;
  });

  const unreadStart = $derived.by(() => {
    const message = dividerMessageId ? timelineMessages.find((item) => item.id === dividerMessageId) : null;
    return message?.ts ?? firstUnread?.ts ?? null;
  });

  const sinceLabel = $derived.by(() => {
    if (!unreadStart) return "";
    const time = formatTime(unreadStart);
    if (new Date(unreadStart).toDateString() === new Date().toDateString()) return text("chat", "unread_since").replace("{time}", time);
    const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(unreadStart);
    return text("chat", "unread_since_day").replace("{date}", date).replace("{time}", time);
  });

  $effect(() => {
    void firstUnread?.eventId;
    void $currentRoom?.roomId;
    dividerSeen = false;
  });

  const showUnread = $derived(!!firstUnread && !dividerSeen && (firstUnread.after ? !!dividerTarget : true) && !(firstUnread.after && dividerMessageId === null && !timelineMessages.length));

  const jumpToUnread = () => {
    if (!firstUnread) return;
    jumpToMessage(firstUnread.eventId);
  };

  const liveRead = () => {
    const current = $currentRoom;
    if (!current) return;
    markRoomRead(current.roomId);
    if (!markerMap[current.roomId] && settled()) dividerSeen = true;
  };

  const readFromNotice = () => {
    dividerSeen = true;
    markAsRead();
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
      markAsRead();
      return;
    }
    stuck = true;
    unseenAfter = null;
    farFromBottom = false;
    await tick();
    timeline?.scrollTo({ top: timeline.scrollHeight, behavior: isDetached ? "auto" : "smooth" });
    markAsRead();
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

  let held: { row: HTMLElement; offset: number } | null = null;
  let holding = 0;
  const firstShown = (rows: HTMLElement[], top: number, low = 0, high = rows.length): HTMLElement | undefined =>
    low >= high ? rows[low] : rows[(low + high) >> 1].getBoundingClientRect().bottom > top ? firstShown(rows, top, low, (low + high) >> 1) : firstShown(rows, top, ((low + high) >> 1) + 1, high);
  const holdRow = () =>
    (holding ||= requestAnimationFrame(() => {
      holding = 0;
      const box = timeline?.getBoundingClientRect();
      const top = box?.top ?? 0;
      const row = firstShown([...(timeline?.querySelectorAll<HTMLElement>(":scope > li[data-event-id]") ?? [])], top + (box?.height ?? 0) / 2);
      held = row ? { row, offset: row.getBoundingClientRect().top - top } : null;
    }));

  const onresize = () => {
    if (!timeline) return;
    if (stuck && !isDetached) return void (timeline.scrollTop = timeline.scrollHeight);
    if (loadingOlder || loadingNewer) return;
    if (pin) applyPin();
    else if (held?.row.isConnected) timeline.scrollTop += held.row.getBoundingClientRect().top - timeline.getBoundingClientRect().top - held.offset;
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
    const wasStuck = stuck;
    stuck = !isDetached && distance < STICK_THRESHOLD;
    if (stuck && !wasStuck && document.hasFocus()) markAsRead();
    farFromBottom = distance > timeline.clientHeight;
    if (stuck) unseenAfter = null;
    else if (!isDetached && unseenAfter === null) unseenAfter = timelineMessages.at(-1)?.id ?? null;
    if (timeline.scrollTop < LOAD_THRESHOLD) loadOlder();
    if (isDetached && distance < LOAD_THRESHOLD) loadNewer();
    if (stuck && document.visibilityState === "visible") markRoomRead();
    holdRow();
    captureAnchor();
  };

  $effect(() => {
    const roomId = $currentRoom?.roomId;
    const latest = timelineMessages.at(-1)?.id;
    if (!roomId || !latest) return;

    if (renderedRoomId !== roomId) {
      persistScrollAnchors();
      renderedRoomId = roomId;
      settleAt = performance.now() + 1000;
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
    if (document.visibilityState === "visible" && document.hasFocus()) queueMicrotask(liveRead);
  });

  $effect(() => {
    const read = () => document.visibilityState === "visible" && document.hasFocus() && stuck && !isDetached && liveRead();
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("focus", read);
    };
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

  const findUpload = (id: number) => uploads.find((entry) => entry.id === id);

  const dropUpload = (id: number, done = false) => {
    const upload = findUpload(id);
    if (!upload) return;
    upload.done = done;
    upload.controller.abort();
    if (!done) [upload.preview, upload.still].forEach((link) => link && URL.revokeObjectURL(link));
    uploads = uploads.filter((entry) => entry.id !== id);
  };

  const runUpload = async (id: number) => {
    const active = $session;
    const upload = findUpload(id);
    if (!active || !upload) return;
    const controller = (upload.controller = new AbortController());
    upload.failed = false;
    upload.progress = 0;

    try {
      const prepared = upload.prepared ?? (await stageUpload(upload));
      if (controller.signal.aborted) return;
      const content = await uploadAttachment(active, prepared, upload.encrypted, (value) => (upload.progress = value), controller.signal, upload.extra);
      const media = content.file?.url ?? content.url;
      const types = (type: string) => [type, MEDIA.videoPlaybackTypes[type as keyof typeof MEDIA.videoPlaybackTypes]].filter(Boolean) as string[];
      seedMedia(media, prepared.file, types(prepared.mimetype), prepared.kind === "image" ? upload.preview : undefined);
      prepared.thumbnail && seedMedia(content.info.thumbnail_file?.url ?? content.info.thumbnail_url, prepared.thumbnail, types(prepared.thumbnailInfo?.mimetype ?? "image/jpeg"), upload.still ?? (prepared.kind === "image" ? upload.preview : undefined));
      media && quietUploads.add(media);
      gifUploads.has(id) && (rememberGifUpload(gifUploads.get(id)!, content), gifUploads.delete(id));
      const sending = sendRoomMessage(content, upload.reply, upload.roomId);
      dropUpload(id, true);
      await sending.catch(() => undefined);
    } catch {
      if (controller.signal.aborted) return;
      upload.failed = true;
      upload.progress = undefined;
    }
  };

  const stageUpload = async (upload: Upload) => {
    const prepared = await prepareAttachment(upload.file, !settings?.keepImageMetadata);
    upload.prepared = prepared;
    upload.preview ??= prepared.kind === "file" ? undefined : URL.createObjectURL(prepared.file);
    upload.still = prepared.kind === "video" && prepared.thumbnail ? URL.createObjectURL(prepared.thumbnail) : undefined;
    upload.content = { msgtype: `m.${prepared.kind}`, body: prepared.name, filename: prepared.name, info: { ...prepared.info, ...upload.extra, ...(prepared.thumbnailInfo ? { thumbnail_info: prepared.thumbnailInfo } : {}) } };
    return prepared;
  };

  const uploadPending = (items: Pending[], roomId: string, roomEncrypted: boolean, reply?: ReplyTarget) => {
    const staged = items.map((item, index) => {
      const upload: Upload = { id: item.id, roomId, file: item.file, encrypted: roomEncrypted, reply: index ? undefined : reply, extra: item.extra, content: null, preview: item.preview, failed: false, done: false, controller: new AbortController(), ts: Date.now() };
      uploads.push(upload);
      pending = pending.filter((entry) => entry.id !== item.id);
      const live = findUpload(upload.id)!;
      const ready = stageUpload(live).catch(() => ((live.failed = true), null));
      return () => ready.then((prepared) => prepared && findUpload(upload.id) && runUpload(upload.id));
    });
    staged.forEach((start) => (uploadChain = uploadChain.then(start)));
  };

  const uploadItems = (upload: Upload) => [
    ...(upload.failed ? [{ id: "upload-retry", label: text("media", "retry_upload"), icon: MENU_ICONS.retry, run: () => runUpload(upload.id) }] : []),
    { id: "upload-cancel", label: text("media", upload.failed ? "remove_upload" : "cancel_upload"), icon: MENU_ICONS.delete, danger: true, run: () => dropUpload(upload.id) },
  ];

  const collapse = (node: HTMLElement, { quiet }: { quiet: boolean }) => {
    const height = node.offsetHeight;
    return { duration: quiet ? 0 : motion(260), easing: cubicOut, css: (t: number) => `opacity: ${t}; height: ${t * height}px; scale: ${0.96 + t * 0.04}; overflow: hidden;` };
  };

  const send = () => {
    const body = draft.trim();
    const items = pending.filter((item) => !item.error && item.progress === null);
    if ((!body && !items.length) || !room) return;
    readFromNotice();

    const reply = replying ? { eventId: replying.eventId, sender: replying.sender } : undefined;
    stuck = true;
    replying = null;

    if (isDetached) jumpToPresent();
    const emote = /^\/me\s+\S/i.test(body);
    const cut = emote ? body.match(/^\/me\s+/i)![0].length : 0;
    const sent = trimPills(draft, pills).pills.map((pill) => ({ ...pill, from: pill.from - cut, to: pill.to - cut })).filter((pill) => pill.from >= 0);
    if (body) sendMessage(body.slice(cut), reply, sent, undefined, emote ? "m.emote" : "m.text").catch(() => undefined);
    if (items.length) uploadPending(items, room.id, encrypted, body ? undefined : reply);

    draft = "";
  };

  const gifUploads = new Map<number, string>();

  const sendGif = async (gif: GifFavourite, reply?: ReplyTarget) => {
    if (!room) return;
    readFromNotice();
    stuck = true;
    if (isDetached) jumpToPresent();
    const reuse = gif.kind === "mxc" ? gif : settings?.gifLinks ? null : gif.sent;
    if (reuse) return void sendRoomMessage({ msgtype: reuse.msgtype ?? "m.image", body: reuse.body, info: reuse.info, ...(reuse.url ? { url: reuse.url } : { file: reuse.file }) }, reply).catch(() => undefined);
    if (gif.kind !== "link") return;
    const linked = () => (isGifbox(gif.url) && gif.video && gif.full && gif.postId && seedGifbox(gif.url, { video: gif.video, full: gif.full, gif: gif.media, postId: gif.postId, image: gif.image, title: gif.title, w: gif.w ?? 1, h: gif.h ?? 1 }), shareGifbox(gif.postId), void sendMessage(gif.url, reply).catch(() => undefined));
    if (settings?.gifLinks) return linked();
    const from = gif.media ?? gif.full;
    const blob = from ? await fetch(from).then((response) => (response.ok ? response.blob() : null)).catch(() => null) : null;
    if (!blob || !/^(image|video)\//.test(blob.type)) return linked();
    shareGifbox(gif.postId);
    const stem = (gif.title ?? (gif.url.split("/").pop() ?? "gif").split(/[?#]/)[0].replace(/\.\w+$/, "")).trim() || "gif";
    await addFiles([new File([blob], `${stem}.${blob.type.split("/")[1]?.split(";")[0] ?? "gif"}`, { type: blob.type })]);
    const item = pending.at(-1);
    if (!item || item.error) return;
    item.extra = blob.type.startsWith("video/") ? { "fi.mau.gif": true, "fi.mau.loop": true, "fi.mau.autoplay": true, "fi.mau.hide_controls": true, "fi.mau.no_audio": true } : undefined;
    gifUploads.set(item.id, gif.id);
    uploadPending([item], room.id, encrypted, reply);
  };

  const sendComposerGif = (gif: GifFavourite) => {
    const reply = replying ? { eventId: replying.eventId, sender: replying.sender } : undefined;
    replying = null;
    sendGif(gif, reply);
  };

  let gifIds = $state.raw(new Set<string>());
  $effect(() => favouriteGifs.subscribe((value) => (gifIds = new Set(value.map((item) => item.id)))));

  const favouriteLink = (url: string, ts: number) =>
    favouriteLinkGif(url, async () => {
      const preview = $session ? await getLinkPreview($session, url, ts).catch(() => null) : null;
      return gifFromLink(url, preview?.image, preview?.imageWidth, preview?.imageHeight);
    });

  let pollOpen = $state(false);

  const createPoll = (question: string, answers: string[], disclosed: boolean, multiple: boolean, duration: number) =>
    sendRoomEvent(POLL_START[1], pollStartContent(question, answers, multiple ? answers.length : 1, disclosed, duration ? Date.now() + duration : undefined)).then(() => (stuck = true));

  let locating = $state(false);

  const shareLocation = () => (locating = true);

  const sendLocation = (location: GeoLocation, self: boolean) => {
    const roomId = room?.id;
    if (!roomId) return;
    stuck = true;
    sendRoomMessage(locationContent(location, location.description ?? text("location", self ? "my_location" : "pinned"), self), undefined, roomId).catch(() => undefined);
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
    const draft = editableText(message);
    editing = { eventId: message.eventId, draft, pills: recoverPills(draft, message.content) };
    await tick();
    const field = timeline?.querySelector<HTMLTextAreaElement>(".editor textarea");
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  };

  const SHEET = "cubic-bezier(0.32, 0.72, 0, 1)";
  const sheet = (t: number) => 1 - (1 - t) ** 3.2;

  const editClose = (node: HTMLElement) => {
    const { offsetTop: top, offsetLeft: left, offsetWidth: width } = node;
    return {
      duration: motion(240),
      easing: sheet,
      css: (t: number) =>
        `position:absolute;top:${top}px;left:${left}px;width:${width}px;pointer-events:none;opacity:${t};filter:blur(${(1 - t) * 4}px);translate:0 ${(1 - t) * -6}px;scale:${0.985 + t * 0.015}`,
    };
  };

  const closedAt = new Map<string, number>();
  const returning = (eventId: string) => performance.now() - (closedAt.get(eventId) ?? -Infinity) < 600;
  let lastEditKey: string | null = null;
  const editKey = $derived(editing?.eventId ?? null);

  $effect.pre(() => {
    const next = editKey;
    const previous = lastEditKey;
    lastEditKey = next;
    const ids = [previous, next].filter((id): id is string => !!id && previous !== next);
    previous && previous !== next && closedAt.set(previous, performance.now());
    const items = ids
      .map((id) => timeline?.querySelector<HTMLElement>(`li[data-event-id="${CSS.escape(id)}"]`))
      .filter((item): item is HTMLElement => !!item);
    const before = items.map((item) => item.offsetHeight);
    tick().then(() =>
      items.forEach((item, index) => {
        const after = item.offsetHeight;
        after !== before[index] &&
          !reducesMotion() &&
          item.animate([{ height: `${before[index]}px`, overflow: "clip" }, { height: `${after}px`, overflow: "clip" }], { duration: 320, easing: SHEET });
      }),
    );
  });

  const editedAt = new Map<string, number>();
  const justEdited = (eventId: string) => performance.now() - (editedAt.get(eventId) ?? -Infinity) < 1500;
  const seenBodies = new Map<string, string>();
  const bodyChanged = (id: string, key: string) => {
    const previous = seenBodies.get(id);
    seenBodies.set(id, key);
    return justEdited(id) || (previous !== undefined && previous !== key);
  };

  const saveEdit = (message: Message) => {
    const trimmed = editing ? trimPills(editing.draft, editing.pills) : null;
    const value = trimmed?.body;
    editing = null;
    if (!value || value === editableText(message).trim()) return;
    editedAt.set(message.eventId, performance.now());
    const replyTo = message.content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
    const replySender = replyTo ? findReply(replyTo)?.sender : undefined;
    const previous = message.content["m.mentions"]?.user_ids ?? [];
    editRoomMessage(message.eventId, value, trimmed!.pills, replySender && replySender !== ownUserId ? [replySender] : [], previous).catch(() => undefined);
    composer?.focus();
  };

  const oneditkey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    editing = null;
    composer?.focus();
  };

  const remove = (message: Message, event?: MouseEvent | KeyboardEvent) => ask("delete", message.eventId, event);

  const copy = (value: string, key?: string, icon?: ToastIcon) => copied(value, key, icon);

  const mediaSource = (content: Record<string, any>): MediaSource => ({
    url: isMxc(content.url) ? content.url : undefined,
    file: isMxc(content.file?.url) ? content.file : undefined,
  });

  const menuItems = (message: Message, link?: string): MenuItem[] => {
    const items: MenuItem[] = [];
    const add = (id: string, label: string, icon: string, run: MenuItem["run"], danger = false) => items.push({ id, label, icon, run, danger });
    const failed = message.status === "failed";

    if (link && isGifLink(link)) add("gif-favourite", text("gifs", gifIds.has(link) ? "unfavourite" : "favourite"), gifIds.has(link) ? MENU_ICONS.unstar : MENU_ICONS.star, () => favouriteLink(link, message.ts));

    if (link) {
      add("open-link", text("context_menu", "open_link"), MENU_ICONS.open, () => window.open(link, "_blank", "noopener,noreferrer"));
      add("copy-link", text("context_menu", "copy_link"), MENU_ICONS.link, () => copy(link, "link_copied", "link"));
    }

    if (failed) {
      add("retry", text("chat", "retry"), MENU_ICONS.retry, () => retry(message.txnId));
      add("discard", text("chat", "discard"), MENU_ICONS.delete, () => message.txnId && discardMessage(message.txnId), true);
      return items;
    }

    if (canReact(message)) add("react", text("chat", "add_reaction"), MENU_ICONS.react, () => openReactions(message));
    if (canReact(message) && reactions.get(message.eventId)?.length) add("reactions", text("chat", "view_reactions"), MENU_ICONS.reactions, () => (people = { kind: "reactions", message, selected: reactions.get(message.eventId)?.[0]?.key }));
    if (!message.local && seenFrom(message).length) add("seen", text("chat", "seen_by_menu"), MENU_ICONS.seen, () => (people = { kind: "seen", message }));
    if (!message.local && message.kind !== "redacted") add("reply", text("chat", "reply"), MENU_ICONS.reply, () => startReply(message));
    if (message.kind === "redacted") add("hide-redacted", text("chat", "hide_redacted"), MENU_ICONS.hide, () => setHideRedacted(true));
    if (canEdit(message)) add("edit", text("chat", "edit"), MENU_ICONS.edit, () => startEdit(message));
    if (!message.local && message.kind !== "redacted" && !SYSTEM_KINDS.includes(message.kind)) add("thread", text("chat", threads.has(message.eventId) ? "view_thread" : "create_thread"), MENU_ICONS.thread, () => openThread(message.eventId));

    if (message.kind === "media") {
      const source = mediaSource(message.content);
      const mimetype = String(message.content.info?.mimetype ?? "");
      const name = sanitiseFilename(message.content.filename ?? message.content.body);
      if (message.content.msgtype === "m.image" && isInline(mimetype, "image"))
        add("open", text("chat", "open_media"), MENU_ICONS.image, () => lightbox.set({ source, mimetype, name, w: message.content.info?.w, h: message.content.info?.h }));
      const gif = mimetype === "image/gif" || !!message.content.info?.["fi.mau.gif"];
      const copyKind = gif ? "copy_gif" : mimetype.startsWith("video/") ? "copy_video" : mimetype.startsWith("image/") ? "copy_image" : null;
      if (copyKind && isInline(mimetype, mimetype.split("/")[0] as "image" | "video") && canCopyMedia(mimetype))
        add("copy-media", text("chat", copyKind), MENU_ICONS.copy, () => copyMedia(source, mimetype).then(() => toastKey(copyKind === "copy_image" ? "image_copied" : "media_copied", { icon: "copy" }), () => undefined));
      if (isGifContent(message.content)) {
        const gif = gifFromContent(message.content);
        add("gif-favourite", text("gifs", gifIds.has(gif.id) ? "unfavourite" : "favourite"), gifIds.has(gif.id) ? MENU_ICONS.unstar : MENU_ICONS.star, () => toggleFavouriteGif(gif));
      }
      add("download", text("chat", "download"), MENU_ICONS.save, () => downloadMedia(source, name).then(() => toastKey("saved", { icon: "save", tone: "success" }), () => undefined));
    }

    if (message.location) {
      const location = message.location;
      add("open-maps", text("location", "open_osm"), MENU_ICONS.open, () => window.open(osmLink(location), "_blank", "noopener,noreferrer"));
      add("coordinates", text("chat", "copy_coordinates"), MENU_ICONS.copy, () => copy(formatCoordinates(location, 6), "coordinates_copied"));
    }
    const question = message.kind === "poll" ? getPoll(message.event)?.question : undefined;
    if (question) add("poll-question", entityText("copy_question"), MENU_ICONS.copy, () => copy(question));
    if (message.kind === "poll" && !message.local && ownUserId && (message.sender === ownUserId || mayModerate(ownUserId)) && !pollEnded(message))
      add("end-poll", text("chat", "end_poll"), MENU_ICONS.end, (event) => ask("end_poll", message.eventId, event), true);

    if (message.plain) add("copy", text("chat", "copy_text"), MENU_ICONS.copy, () => copy(editableText(message)));
    if (!message.local && $currentRoom) {
      add("link", text("chat", "copy_link"), MENU_ICONS.link, () => copy(`https://matrix.to/#/${encodeURIComponent($currentRoom!.roomId)}/${encodeURIComponent(message.eventId)}`, "link_copied", "link"));
      add("id", text("chat", "copy_id"), MENU_ICONS.id, () => copy(message.eventId, "message_id_copied", "id"));
      const roomId = $currentRoom.roomId;
      add("unread", text("chat", "mark_unread"), MENU_ICONS.unread, () => markUnread(roomId, message.eventId) && toastKey("marked_unread", { icon: "unread", tone: "accent" }));
    }
    if (!message.local && message.kind !== "redacted" && mayPin)
      pinnedSet.has(message.eventId)
        ? add("unpin", text("chat", "unpin"), MENU_ICONS.unpin, (event) => ask("unpin", message.eventId, event))
        : add("pin", text("chat", "pin"), MENU_ICONS.pin, (event) => ask("pin", message.eventId, event));
    if (!message.local && message.kind !== "redacted" && $currentRoom && ownUserId && canRedact($currentRoom, ownUserId, message.sender))
      add("delete", text("chat", "delete"), MENU_ICONS.delete, (event) => remove(message, event), true);

    return items;
  };

  const messageLink = (eventId: string) => `https://matrix.to/#/${encodeURIComponent($currentRoom?.roomId ?? "")}/${encodeURIComponent(eventId)}`;

  const replyItems = (eventId: string): MenuItem[] => [
    { id: "reply-jump", label: text("chat", "jump_to_reply"), icon: MENU_ICONS.jump, run: () => jumpToMessage(eventId) },
    { id: "reply-link", label: text("chat", "copy_link"), icon: MENU_ICONS.link, run: () => copy(messageLink(eventId), "link_copied", "link") },
    { id: "reply-id", label: text("chat", "copy_id"), icon: MENU_ICONS.id, run: () => copy(eventId, "message_id_copied", "id") },
  ];

  const reactionItems = (message: Message, group: ReactionGroup): MenuItem[] => [
    { id: "reaction-toggle", label: entityText(group.own ? "remove_reaction" : "add_reaction"), icon: group.own ? MENU_ICONS.close : MENU_ICONS.react, run: () => toggleReaction(message.eventId, group.key) },
    { id: "reaction-view", label: text("chat", "view_reactions"), icon: MENU_ICONS.reactions, run: () => (people = { kind: "reactions", message, selected: group.key }) },
    group.key.startsWith("mxc://")
      ? { id: "reaction-code", label: entityText("copy_shortcode"), icon: MENU_ICONS.copy, disabled: !group.shortcode, separated: true, run: () => copy(group.shortcode ?? "") }
      : { id: "reaction-emoji", label: entityText("copy_emoji"), icon: MENU_ICONS.copy, separated: true, run: () => copy(group.key) },
  ];

  const typingItems = (): MenuItem[] =>
    typingIds.map((userId) => ({ id: `typing-${userId}`, label: resolveName(userId), icon: MENU_ICONS.profile, run: () => openFullProfile(userId, $currentRoom?.roomId) }));

  const topicItems = (topic: string): MenuItem[] => [
    { id: "topic-copy", label: entityText("copy_topic"), icon: MENU_ICONS.copy, run: () => copy(topic) },
  ];

  const pinsItems = (): MenuItem[] => [
    { id: "pins-open", label: entityText("view_pins"), icon: MENU_ICONS.pin, run: () => (pinsOpen = true) },
    { id: "pins-latest", label: entityText("jump_latest_pin"), icon: MENU_ICONS.jump, disabled: !pinnedIds.length, run: () => pinnedIds.at(-1) && jumpToMessage(pinnedIds.at(-1)!) },
  ];

  const openMenu = (message: Message, x: number, y: number, link?: string) => {
    if (editing?.eventId === message.eventId) return;
    menu = { message, x, y, link };
  };

  const oncontextmenu = (event: MouseEvent, message: Message) => {
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    event.preventDefault();
    const mention = mentionOf(target);
    if (mention) return openUserMenu(mention, event.clientX, event.clientY, $currentRoom?.roomId);
    const link = target.closest<HTMLAnchorElement>("a[href]")?.href ?? target.closest<HTMLElement>("[data-link]")?.dataset.link;
    if (!menu) openMenu(message, event.clientX, event.clientY, link);
  };

  let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> | undefined; swiping: boolean } | null = null;

  const onpointerdown = (event: PointerEvent, message: Message) => {
    if (event.pointerType !== "touch" || editing) return;
    const mention = mentionOf(event.target);
    if (!mention && (event.target as HTMLElement).closest("[data-profile-trigger], .seen-avatar")) return;
    const nested = !mention && !!(event.target as HTMLElement).closest("[data-entity-menu]");
    const timer = nested ? undefined : setTimeout(() => {
      press = null;
      swipe = null;
      if (mention) return openUserMenu(mention, event.clientX, event.clientY, $currentRoom?.roomId);
      openMenu(message, event.clientX, event.clientY);
    }, LONG_PRESS);
    press = { id: message.id, x: event.clientX, y: event.clientY, timer, swiping: false };
  };

  const onpointermove = (event: PointerEvent, message: Message) => {
    if (!press || press.id !== message.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(press.timer);
    if (!press.swiping && dx < -14 && Math.abs(dx) > Math.abs(dy) * 2 && !message.local && message.kind !== "redacted") {
      press.swiping = true;
      swiped = { id: message.id, size: Math.round(Math.min(36, Math.max(26, (event.currentTarget as HTMLElement).offsetHeight - 12))) };
    }
    if (!press.swiping) {
      if (Math.abs(dy) > 12) press = null;
      return;
    }
    const next = Math.max(0, Math.min(-dx, canEdit(message) ? SWIPE_EDIT * 1.2 : SWIPE_REPLY * 1.4));
    const before = swipe?.id === message.id ? swipe.dx : 0;
    if (canEdit(message) && (before < SWIPE_EDIT) !== (next < SWIPE_EDIT)) navigator.vibrate?.(8);
    swipe = { id: message.id, dx: next };
  };

  const onpointerup = (message: Message) => {
    if (press) clearTimeout(press.timer);
    if (swipe?.id === message.id && swipe.dx >= SWIPE_REPLY) {
      navigator.vibrate?.(12);
      if (swipe.dx >= SWIPE_EDIT && canEdit(message)) startEdit(message);
      else startReply(message);
    }
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
    if (anchor?.dataset.roomId) {
      event.preventDefault();
      const id = anchor.dataset.roomId;
      const known = Object.values($rooms).find((room) => room.roomId === id || room.state["m.room.canonical_alias"]?.[""]?.content?.alias === id);
      return openUpgraded(known?.roomId ?? id);
    }
    const match = anchor?.href.match(/matrix\.to\/#\/(@[^/?]+)/);
    if (!anchor || !match) return;
    event.preventDefault();
    anchor.dataset.profileTrigger = "";
    openProfile(decodeURIComponent(match[1]), anchor);
  };

  const mentionOf = (target: EventTarget | null) => {
    const match = (target as HTMLElement | null)?.closest?.<HTMLAnchorElement>("a.mention")?.href.match(/matrix\.to\/#\/(@[^/?]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
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
    event.key === "Escape" && (event.target as HTMLElement).matches?.("button, a, [role=button], [role=treeitem]") && !(event.target as HTMLElement).closest(".chat, [role=dialog], [role=menu]") && (event.target as HTMLElement).blur();
    const field = (event.target as HTMLElement).closest?.("input, textarea, [contenteditable]");
    const composerEmpty = event.target === composer && !draft;
    const busy = !!(menu || pinsOpen || searchShown || filtersOpen || threadView || confirming || editing || replying);

    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }

    if (event.key === "End" && (!field || composerEmpty) && showPresent) {
      event.preventDefault();
      jumpToPresent();
    }
    if (event.key === "Escape" && !busy && showUnread && !document.querySelector("[aria-modal=true], [role=dialog]")) {
      event.preventDefault();
      readFromNotice();
    } else if (event.key === "Escape" && (!field || composerEmpty) && !busy && showPresent && !document.querySelector("[aria-modal=true], [role=dialog]")) {
      event.preventDefault();
      jumpToPresent();
    } else if (event.key === "Escape" && !busy && $currentRoom && markerMap[$currentRoom.roomId] && !document.querySelector("[aria-modal=true], [role=dialog]")) markAsRead();

    if (
      composer &&
      !field &&
      !editing &&
      !menu &&
      !event.altKey &&
      !event.isComposing &&
      !($voicePrefs.pushToTalk && !event.ctrlKey && !event.metaKey && event.code === $voicePrefs.pttKey) &&
      (event.ctrlKey || event.metaKey ? ["v", "c", "x", "a", "z", "y"].includes(event.key.toLowerCase()) : event.key.length === 1 || ["Enter", "Backspace", "Delete"].includes(event.key)) &&
      !((event.key === " " || event.key === "Enter") && (event.target as HTMLElement).closest?.("button, a, [role=button], [role=menuitem], select, summary")) &&
      !document.querySelector("[aria-modal=true], [role=dialog], [role=menu]") &&
      !matchMedia("(pointer: coarse)").matches &&
      !getSelection()?.toString()
    ) {
      if (event.key === "Enter") event.preventDefault();
      composer.focus({ preventScroll: true });
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
  class:threaded={(!!threadView && !threadClosing) || !!searchShown}
  class:searching={!!searchShown && !(threadView && !threadClosing)}
  class:staged
  class:chat-open={chatOpen}
  style:--header-space="{headerSpace}px"
  style:--pull="{Math.min(420, chatWidth * 0.45)}px"
  style:--search-room="{Math.max(220, headerWidth - 200)}px"
  bind:clientWidth={chatWidth}
  style:--composer-space="{dockHeight + 35}px"
  {ondragenter}
  {ondragover}
  {ondragleave}
  {ondrop}
  aria-label={roomLabel}
>
  <header class="header row-nw align-centre gap-sm hairline-b" bind:offsetHeight={headerSpace}>
    <button class="icon ghost press mobile-only" aria-label={text("navigation", "open_channels")} onclick={onchannels}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
    {#if room}
      {#if room.isDirect && room.directUserId}
        <h2 class="name md bold truncate">
          <button type="button" class="name-button ghost truncate" aria-label={text("user_profile", "open").replace("{name}", room.name)} onclick={() => room.directUserId && openFullProfile(room.directUserId, room.id)} oncontextmenu={(event) => { event.preventDefault(); openRoomMenu(room.id, event.clientX, event.clientY); }}><span class="faint">@</span><EmojiText text={room.name.replace(/^@/, "")} fade={false} /></button>
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
          >{#if room.isDirect}<span class="faint">@</span>{:else}<svg class="room-hash" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /></svg>{/if}<EmojiText text={room.isDirect ? room.name.replace(/^@/, "") : room.name} fade={false} /></button>
        </h2>
      {/if}
      {#if room.topic}
        {@const topic = room.topic}
        <span class="topic sm muted truncate" use:entityMenu={() => topicItems(topic)}>{room.topic}</span>
      {/if}
    {/if}
    <span class="flex-max"></span>
    {#if room?.isDirect}
      {@const callId = room.id}
      {@const inCall = $voice?.roomId === callId}
      <button
        class="icon ghost press call-button"
        class:active={inCall}
        aria-label={text("voice", inCall ? "disconnect" : "call")}
        use:tooltip={text("voice", inCall ? "disconnect" : "call")}
        onclick={() => (inCall ? leaveCall() : placeCall(callId))}
        use:entityMenu={() => [{ id: "dm-call", label: text("voice", inCall ? "disconnect" : "call"), icon: inCall ? SETTINGS_ICONS.hangup : SETTINGS_ICONS.call, danger: inCall, run: () => (inCall ? leaveCall() : placeCall(callId)) }]}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={inCall ? SETTINGS_ICONS.hangup : SETTINGS_ICONS.call} /></svg>
      </button>
    {/if}
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
        use:entityMenu={pinsItems}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.pin} /></svg>
        {#if pinnedIds.length}<span class="pin-count xs bold" aria-hidden="true">{pinnedIds.length > 99 ? "99+" : pinnedIds.length}</span>{/if}
      </button>
    {/if}
    {#if room}
      <button
        class="icon ghost press"
        class:active={!!threadView}
        aria-label={text("chat", "threads")}
        aria-expanded={!!threadView}
        use:tooltip={text("chat", "threads")}
        onclick={() => (threadView = threadView ? null : { rootId: null })}
        use:entityMenu={threadsButtonItems}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.thread} /></svg>
      </button>
    {/if}
    {#if room}
      {@const settingsId = room.id}
      <button
        class="icon ghost press"
        aria-label={text("chat", "room_settings")}
        aria-haspopup="dialog"
        use:tooltip={text("chat", "room_settings")}
        onclick={() => openRoomSettings(settingsId)}
        use:entityMenu={() => [{ id: "room-settings", label: text("chat", "room_settings"), icon: MENU_ICONS.settings, run: () => openRoomSettings(settingsId) }]}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={MENU_ICONS.settings} /></svg>
      </button>
    {/if}
    <button class="icon ghost press" aria-label={text("navigation", "open_members")} use:tooltip={text("navigation", "open_members")} onclick={onmembers}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-3.3 3.1-6 7-6s7 2.7 7 6v1H2v-1Zm15.5 1H22v-1c0-2.6-2.2-4.6-5-5 1.2 1.3 1.9 3 2 4.9V20h-1.5Z" />
      </svg>
    </button>
  </header>

  {#if room}
    <CallStage roomId={room.id} bind:active={stageActive} bind:chatOpen bind:staged={() => staged, (value) => (stagedFor = value ? room.id : null)} />
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
    <div class="timeline-mask col flex-max min-0">
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
          {#if predecessor}
            {@const target = predecessor}
            <p class="sm"><button type="button" class="predecessor ghost press row-nw align-centre gap-sm" disabled={!predecessorJoined} onclick={() => openJoined(target)} use:entityMenu={predecessorItems(target)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4 5 11h4v9h6v-9h4l-7-7Z" transform="rotate(180 12 12)" /></svg>
              {text("chat", "predecessor")}
            </button></p>
          {/if}
          {#if !timelineMessages.length}<p class="sm faint">{text("chat", "no_messages")}</p>{/if}
        </li>
      {/if}
      {#each timelineMessages as message (message.id)}
        {@const sender = getSender(message.sender)}
        {#if message.id === dividerMessageId}
          <li class="unread-divider" role="separator" aria-label={text("chat", "new")}><span class="unread-tag xs bold">{text("chat", "new")}</span></li>
        {/if}
        {@const offset = swipe?.id === message.id ? swipe.dx : 0}
        {#if message.kind === "system" && message.system}
          <li class="system row-nw align-centre gap-sm xs" data-event-id={message.eventId} use:entityMenu={() => (message.system?.icon === "call" || message.system?.icon === "hangup" ? [{ id: "call-events", label: getLocalisedText(undefined, "voice", (settings as MediaSettings | null)?.showCallEvents ? "events_hide" : "events_show") as string, icon: (settings as MediaSettings | null)?.showCallEvents ? MENU_ICONS.hide : MENU_ICONS.show, run: () => setShowCallEvents(!(settings as MediaSettings | null)?.showCallEvents) }] : [])}>{@render systemLine(message.system, message.ts)}</li>
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
          in:fly|global={{ y: 10, duration: fresh(message.ts) && !quietUploads.has(message.content.file?.url ?? message.content.url) ? motion(260) : 0, easing: cubicOut }}
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
          onpointerenter={() => arm(message.id)}
          onfocusin={() => arm(message.id)}
          oncontextmenu={(event) => oncontextmenu(event, message)}
          onpointerdown={(event) => onpointerdown(event, message)}
          onpointermove={(event) => onpointermove(event, message)}
          onpointerup={() => onpointerup(message)}
          onpointercancel={() => onpointerup(message)}
          class:swiping={!!offset}
          class:swiped={swiped?.id === message.id}
          style:--swipe={offset ? `${offset}px` : undefined}
          style:--cue={swiped?.id === message.id ? `${swiped.size}px` : undefined}
        >
          {#if swiped?.id === message.id}
            <span class="swipe-cue row centre" class:armed={offset >= SWIPE_REPLY} class:edit={offset >= SWIPE_EDIT && canEdit(message)} aria-hidden="true">
              <svg class="cue-reply" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.reply} /></svg>
              <svg class="cue-edit" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.edit} /></svg>
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
              use:entityMenu={() => replyItems(message.replyTo!)}
            >
              <span class="connector" aria-hidden="true"></span>
              {#if original && author}
                <Avatar name={author.name} url={author.avatar} size="16px" radius="50%" />
                <span class="reply-name bold" style:color={roleOf($currentRoom, original.sender, roles)?.color}><EmojiText text={author.name} /></span>
                {#if roleIcon(roleOf($currentRoom, original.sender, roles))}<span class="role-icon"><Avatar name={roleOf($currentRoom, original.sender, roles)?.name ?? ""} url={roleIcon(roleOf($currentRoom, original.sender, roles))} size="14px" radius="3px" /></span>{/if}
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
              <button type="button" class="author-avatar ghost press" data-profile-trigger use:usermenu={{ userId: message.sender, roomId: $currentRoom?.roomId }} aria-label={text("user_profile", "open").replace("{name}", sender.name)} onclick={(event) => openProfile(message.sender, event.currentTarget)}>
                <Avatar name={sender.name} url={sender.avatar} size="38px" radius="50%" />
              </button>
            {/if}
          </div>
          <div class="content col min-0">
            {#if !message.grouped || message.replyTo}
              <div class="meta row-nw align-centre gap-sm">
                <button type="button" class="sender md bold ghost" class:admin={sender.powerLevel >= 100 && !$currentRoom?.isDirect} style:color={sender.role?.color} data-profile-trigger use:usermenu={{ userId: message.sender, roomId: $currentRoom?.roomId }} onclick={(event) => openProfile(message.sender, event.currentTarget)}><EmojiText text={sender.name} /></button>
                {#if roleIcon(sender.role)}<span class="role-icon" use:tooltip={sender.role?.name}><Avatar name={sender.role?.name ?? ""} url={roleIcon(sender.role)} size="16px" radius="4px" /></span>{/if}
                <time class="xs faint" datetime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
                {#if message.kind === "notice"}<span class="bot-tag xs bold">{text("chat", "bot")}</span>{/if}
                {#if message.kind === "server"}<span class="bot-tag server-tag xs bold">{text("chat", "server_notice")}</span>{/if}
                {#if pinnedSet.has(message.eventId)}{@render pinMark()}{/if}
              </div>
            {:else if pinnedSet.has(message.eventId)}
              <span class="pin-float">{@render pinMark()}</span>
            {/if}
            {#if editing?.eventId === message.eventId}
              <div class="editor col gap-xs" out:editClose>
                <EditorField bind:value={editing.draft} bind:pills={editing.pills} label={text("chat", "edit")} variant="edit" onsubmit={() => saveEdit(message)} onkey={oneditkey} />
                <span class="edit-hint xs faint row-nw align-centre">
                  <span><KeyText text={text("chat", "editing_hint")} /></span>
                  <button type="button" class="link-button ghost press xs bold" onclick={() => (editing = null)}>{text("chat", "cancel")}</button>
                  <button type="button" class="link-button accent ghost press xs bold" onclick={() => saveEdit(message)}>{text("chat", "save")}</button>
                </span>
              </div>
            {:else if message.kind === "media"}
              {#if message.content.msgtype !== "m.file" && message.content.body && message.content.filename && message.content.filename !== message.content.body}
                <p class="body selectable"><MessageBody content={message.content} {ownUserId} {resolveName} onreact={canReact(message) ? (key) => reactedWith(message.eventId, key) || toggleReaction(message.eventId, key) : undefined} /></p>
              {/if}
              <MessageMedia content={message.content} sender={resolveName(message.sender)} ts={message.ts} />
            {:else if message.kind === "sticker"}
              <MessageMedia content={message.content} sticker />
            {:else if message.kind === "location"}
              <LocationCard location={message.location ?? null} live={message.live} label={message.live === undefined ? undefined : text("location", message.live ? "live_shared" : "live_ended")} />
            {:else if message.kind === "poll"}
              <Poll event={message.event} related={relations.get(message.eventId) ?? []} {ownUserId} mayEnd={mayModerate} />
            {:else if message.links.length === 1 && isGifbox(message.links[0]) && String(message.content.body ?? "").trim() === message.links[0]}
            {:else if message.plain}
              <div class="body-swap">
                {#key `${message.content.body ?? ""}\u0000${message.content.formatted_body ?? ""}`}
                  <p class="body selectable {message.kind}" in:blur|global={{ amount: 6, duration: bodyChanged(message.eventId, `${message.content.body ?? ""}\u0000${message.content.formatted_body ?? ""}`) || returning(message.eventId) ? motion(300) : 0, easing: sheet }} out:blur={{ amount: 6, duration: motion(180), easing: cubicOut }}>{#if message.kind === "emote"}<span class="emote-sender">* <EmojiText text={sender.name} /></span> {/if}<MessageBody content={message.content} {ownUserId} {resolveName} onreact={canReact(message) ? (key) => reactedWith(message.eventId, key) || toggleReaction(message.eventId, key) : undefined} jumbo={message.kind !== "emote"} />{#if message.edited}<span class="edited xs faint"> {text("chat", "edited")}</span>{/if}</p>
                {/key}
              </div>
            {:else}
              <p class="body selectable {message.kind}"><EmojiText text={message.body} /></p>
            {/if}
            {#each message.links as link (link)}
              {#if isMxc(link)}
                <MxcEmbed url={link} sender={message.sender} ts={message.ts} />
              {:else}
                <LinkPreview url={link} ts={message.ts} previews={previewsOn} />
              {/if}
            {/each}
            {#if message.status === "failed"}
              <p class="failure xs row-nw align-centre gap-sm">
                <span>{text("chat", "failed")}</span>
                <button type="button" class="retry ghost press xs bold" onclick={() => retry(message.txnId)}>{text("chat", "retry")}</button>
              </p>
            {/if}
            {#if canReact(message) && reactions.get(message.eventId)?.length}
              {@const groups = reactions.get(message.eventId) ?? []}
              <div class="reactions row align-centre gap-xs" transition:slide={{ duration: motion(220), easing: cubicOut }}>
                {#each groups as group (group.key)}
                  <button
                    type="button"
                    class="reaction row-nw align-centre gap-xs sm bold press"
                    class:own={!!group.own}
                    aria-pressed={!!group.own}
                    aria-label={reactedLabel(group)}
                    use:tooltip={reactedLabel(group)}
                    in:scale={{ start: 0.4, duration: motion(340), easing: backOut, opacity: 0 }}
                    out:scale={{ start: 0.5, duration: motion(180), easing: cubicOut, opacity: 0 }}
                    animate:flip={{ duration: motion(260), easing: cubicOut }}
                    use:reactionMotion={{ id: `${message.eventId}|${group.key}`, count: group.senders.length, own: !!group.own }}
                    onclick={() => toggleReaction(message.eventId, group.key)}
                    use:entityMenu={() => reactionItems(message, group)}
                  ><span class="reaction-key"><ReactionKey key={group.key} label={keyLabel(group.key, group.shortcode)} /></span><span class="reaction-count"><span class="reaction-now">{group.senders.length}</span></span></button>
                {/each}
                <button type="button" class="reaction reaction-add row centre press" aria-label={text("chat", "add_reaction")} use:tooltip={text("chat", "add_reaction")} aria-haspopup="dialog" onclick={(event) => openReactions(message, event.currentTarget)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.react} /></svg>
                </button>
              </div>
            {/if}
            {#if threads.get(message.eventId)?.count}
              {@const summary = threads.get(message.eventId)!}
              <ThreadSummary {summary} {getSender} items={() => threadItems(message.eventId)} onopen={() => openThread(message.eventId)} />
            {/if}
          </div>
          {#if (armed.includes(message.id) || menu?.message.id === message.id) && editing?.eventId !== message.eventId && !message.local}
            <div class="toolbar row-nw" role="toolbar" aria-label={text("chat", "actions")}>
              {#if canReact(message)}
                {#each quickKeys.slice(0, QUICK_TOOLBAR) as key (key)}
                  <button type="button" class="tool quick-tool ghost press" class:active={reactedWith(message.eventId, key)} aria-pressed={reactedWith(message.eventId, key)} aria-label={text("chat", "react_with").replace("{emoji}", key)} use:tooltip={text("chat", "react_with").replace("{emoji}", key)} onclick={() => toggleReaction(message.eventId, key)}><EmojiText text={key} /></button>
                {/each}
                <button type="button" class="tool react-tool ghost press" aria-label={text("chat", "add_reaction")} use:tooltip={text("chat", "add_reaction")} aria-haspopup="dialog" onclick={(event) => openReactions(message, event.currentTarget)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS.react} /></svg>
                </button>
              {/if}
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
        {@const readers = seenBy.get(message.id)}
        {#if readers?.length}
          <li class="seen row-nw align-centre" aria-label={seenLabel(readers)}>
            <span class="seen-stack row-nw align-centre" use:tooltip={{ text: seenLabel(readers), placement: "left" }} use:entityMenu={() => [{ id: "seen-view", label: text("chat", "seen_by_menu"), icon: MENU_ICONS.seen, run: () => (people = { kind: "seen", message }) }]}>
              {#each readers.slice(0, SEEN_LIMIT) as userId (userId)}
                {@const reader = getSender(userId)}
                <span class="seen-avatar" use:usermenu={{ userId, roomId: $currentRoom?.roomId }} in:scale|global={{ start: 0.4, duration: settled() ? motion(260) : 0, easing: backOut }} out:scale={{ start: 0.6, duration: motion(160), easing: cubicOut }} animate:flip={{ duration: motion(240), easing: cubicOut }}><Avatar name={reader.name} url={reader.avatar} size="16px" radius="50%" /></span>
              {/each}
              {#if readers.length > SEEN_LIMIT}<span class="seen-more xs bold">+{readers.length - SEEN_LIMIT}</span>{/if}
            </span>
          </li>
        {/if}
      {/each}
      {#if !isDetached}
        {@const shown = uploads.filter((upload) => upload.roomId === room?.id && upload.content)}
        {@const me = getSender(ownUserId ?? "")}
        {@const previous = timelineMessages.at(-1)}
        {#each shown as upload, index (upload.id)}
          {@const grouped = index > 0 || (!upload.reply && isChained(previous, { sender: ownUserId ?? "", ts: upload.ts, kind: "media" }))}
          <li
            class="message row-nw sending upload"
            class:grouped
            class:last={index === shown.length - 1}
            class:failed={upload.failed}
            in:fly|global={{ y: 10, duration: motion(260), easing: cubicOut }}
            out:collapse={{ quiet: upload.done }}
            use:entityMenu={() => uploadItems(upload)}
          >
            <div class="gutter">
              {#if grouped}
                <time class="hover-time xs faint" datetime={new Date(upload.ts).toISOString()}>{formatTime(upload.ts)}</time>
              {:else}
                <span class="author-avatar"><Avatar name={me.name} url={me.avatar} size="38px" radius="50%" /></span>
              {/if}
            </div>
            <div class="content col min-0">
              {#if !grouped}
                <div class="meta row-nw align-centre gap-sm">
                  <span class="sender md bold" style:color={me.role?.color}><EmojiText text={me.name} /></span>
                  <time class="xs faint" datetime={new Date(upload.ts).toISOString()}>{formatTime(upload.ts)}</time>
                </div>
              {/if}
              {#if upload.content}<MessageMedia content={upload.content} preview={upload.preview} still={upload.still} progress={upload.failed ? undefined : upload.progress} oncancel={() => dropUpload(upload.id)} />{/if}
              {#if upload.failed}
                <p class="failure xs row-nw align-centre gap-sm" transition:slide={{ duration: motion(200), easing: cubicOut }}>
                  <span>{text("media", "upload_failed")}</span>
                  <button type="button" class="retry ghost press xs bold" onclick={() => runUpload(upload.id)}>{text("media", "retry_upload")}</button>
                  <button type="button" class="retry ghost press xs bold" onclick={() => dropUpload(upload.id)}>{text("media", "remove_upload")}</button>
                </p>
              {/if}
            </div>
          </li>
        {/each}
      {/if}
      {#if isDetached && $canLoadNewer}
        <li class="history row centre" aria-busy="true">
          <span class="dots row-nw gap-sm" aria-label={text("chat", "loading_newer")}><span></span><span></span><span></span></span>
        </li>
      {/if}
    </ol>
    </div>
    {/key}

    <div class="unread-wrap row centre" class:shown={showUnread} inert={!showUnread}>
      <div class="present unread-notice row-nw align-centre gap-sm">
        <button type="button" class="unread-main row-nw align-centre gap-sm ghost press" aria-label={text("chat", "unread_jump")} onclick={jumpToUnread}>
          <span class="unread-icon row centre" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-6-6 6 6 6-6" /></svg></span>
          <span class="unread-lines col min-0">
            <span class="sm bold truncate">{text("chat", (firstUnread?.count ?? 1) === 1 ? "new_message" : "new_messages").replace("{count}", String(firstUnread?.count ?? 1))}</span>
            {#if sinceLabel}<span class="xs muted truncate">{sinceLabel}</span>{/if}
          </span>
        </button>
        <button type="button" class="unread-read ghost press xs bold" onclick={readFromNotice}>{text("chat", "mark_read")}</button>
      </div>
    </div>

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

    <div class="typing row-nw align-centre gap-sm xs" class:shown={!!typingLabel} aria-live="polite" use:entityMenu={typingIds.length ? typingItems : undefined}>
      {#if typingLabel}
        <span class="typing-dots row-nw align-centre" aria-hidden="true"><span></span><span></span><span></span></span>
        <span class="typing-text truncate muted"><EmojiText text={typingLabel} fade={false} /></span>
      {/if}
    </div>

    {#if tombstone}
      {@const target = tombstone}
      <div class="upgrade-banner row-nw align-centre gap-md" role="status" use:entityMenu={replacementItems(target)}>
        <span class="upgrade-icon row centre" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 3 4 11h5v10h6V11h5l-8-8Z" /></svg></span>
        <span class="col min-0 flex-max">
          <span class="sm bold">{text("chat", "upgraded")}</span>
          <span class="xs muted upgrade-hint"><span class="upgrade-line" class:shown={!upgradeFailed}>{target.body || text("chat", "upgraded_hint")}</span><span class="upgrade-line error" class:shown={upgradeFailed}>{text("chat", "replacement_failed")}</span></span>
        </span>
        <button type="button" class="upgrade-button press sm bold" disabled={upgrading} onclick={() => openReplacement(target)}>{text("chat", upgrading ? "joining_replacement" : replacementJoined ? "open_replacement" : "join_replacement")}</button>
      </div>
    {:else}
    <Composer
      bind:draft
      bind:field={composer}
      bind:pills
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
      onpoll={() => (pollOpen = true)}
      onlocation={shareLocation}
      ongif={sendComposerGif}
    />
    {/if}

    {#if locating}
      <LocationDialog onsend={sendLocation} onclose={() => (locating = false)} />
    {/if}

    {#if dragDepth > 0}
      <div class="dropzone col centre gap-sm" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="32" height="32"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m-5 5 5-5 5 5M5 20h14" /></svg>
        <span class="md bold">{text("media", "drop")}</span>
      </div>
    {/if}
  {:else if !$synced}
    <div class="flex-max min-0"><Skeleton kind="messages" count={7} /></div>
  {:else}
    <div class="empty col centre flex-max">
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

  {#if searchShown && room}
    <SearchPanel
      roomId={room.id}
      {encrypted}
      query={searchShown}
      pinned={pinnedIds}
      anchor={headerEl}
      {ownUserId}
      {getSender}
      onjump={jumpToMessage}
      onfilters={() => (filtersOpen = true)}
      onclose={() => (searchShown = null)}
    />
  {/if}

  {#if filtersOpen && room}
    <SearchFilters filters={searchQuery} members={searchMembers} onapply={applyFilters} onclose={() => (filtersOpen = false)} />
  {/if}

  {#if threadView && room}
    {#key room.id}
      <ThreadPanel
        roomId={room.id}
        rootId={threadView.rootId}
        events={$visibleTimeline}
        {encrypted}
        {ownUserId}
        keepImageMetadata={settings?.keepImageMetadata}
        {getSender}
        mayRedact={(event) => !!$currentRoom && !!ownUserId && canRedact($currentRoom, ownUserId, event.sender)}
        onopen={(rootId) => openThread(rootId)}
        onlist={() => openThread(null)}
        onjump={jumpToMessage}
        onremove={(eventId, event) => ask("delete", eventId, event)}
        onclose={() => (threadView = null)}
        bind:closing={threadClosing}
      />
    {/key}
  {/if}

  {#if note}
    <div class="note sm row-nw align-centre gap-sm" role="status" use:portal>{note}</div>
  {/if}

  {#if menu}
    <MessageMenu items={menuItems(menu.message, menu.link)} x={menu.x} y={menu.y} label={text("chat", "actions")} quick={quickOptions(menu.message)} quickLabel={text("emoji", "quick_reactions")} onclose={() => (menu = null)} />
  {/if}

  {#if reacting}
    {@const target = reacting}
    <EmojiPicker bind:this={reactionPicker} anchor={reacting.anchor} oninsert={pickReaction} onclose={() => (reacting = null)} ongif={() => (gifReply = { eventId: target.eventId, sender: findReply(target.eventId)?.sender ?? "", anchor: target.anchor })} />
  {/if}

  {#if gifReply}
    {@const target = gifReply}
    <GifPicker anchor={target.anchor} onpick={(gif) => sendGif(gif, { eventId: target.eventId, sender: target.sender })} onclose={() => (gifReply = null)} />
  {/if}

  {#if people}
    {@const target = people}
    <PeopleDialog
      title={text("chat", target.kind === "seen" ? "seen_by_menu" : "reactions_title")}
      rows={peopleRows}
      roomId={$currentRoom?.roomId}
      groups={peopleGroups}
      bind:selected={target.selected}
      onremove={() => target.selected && toggleReaction(target.message.eventId, target.selected)}
      onclose={() => (people = null)}
    />
  {/if}

  {#if roomSettings.roomId}
    {#key roomSettings.roomId}
      <RoomSettings roomId={roomSettings.roomId} onclose={() => (roomSettings.roomId = null)} />
    {/key}
  {/if}

  {#if pollOpen}
    <PollDialog onsubmit={createPoll} onclose={() => (pollOpen = false)} />
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

  .unread-wrap {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(52px + env(safe-area-inset-top) + var(--azure-spacing-sm));
    z-index: var(--azure-z-sticky);
    pointer-events: none;
  }

  .unread-wrap .present {
    height: auto;
    min-height: 44px;
    max-width: calc(100% - 2 * var(--azure-spacing-lg));
    padding: 4px 6px 4px 4px;
    translate: 0 -10px;
    cursor: default;
  }

  .unread-wrap.shown .present {
    opacity: 1;
    translate: 0 0;
    scale: 1;
    pointer-events: auto;
  }

  .unread-wrap .present:hover {
    color: var(--colours-text-strong);
  }

  .unread-main {
    min-width: 0;
    padding: 2px 8px 2px 2px;
    border-radius: var(--azure-radius-pill);
    text-align: left;
  }

  .unread-icon {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--colours-accent);
    background-color: var(--colours-accent-faint);
  }

  .unread-lines {
    line-height: 1.2;
  }

  .unread-read {
    flex: none;
    padding: 6px 10px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-text-muted);
  }

  .unread-read:hover,
  .unread-read:focus-visible {
    color: var(--colours-text-strong);
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

  :global(:where(section.chat > *)) {
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      visibility 0s linear 0s;
  }

  .chat.staged:not(.chat-open) > :global(*:not(header):not(.stage-slot):not(aside.thread)) {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      visibility 0s linear 420ms;
  }

  .chat {
    --composer-space: 95px;
    overflow: clip;
    --thread-width: min(420px, 45%);

    height: 100%;
    position: relative;
    background-color: var(--colours-background);
  }

  @media (min-width: 768px) {
    .chat,
    .chat > .present-wrap,
    .chat > .unread-wrap,
    .chat > .dropzone,
    .chat > :global(.composer) {
      transition-property: padding-right, right;
      transition-duration: var(--azure-duration-glide);
      transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
    }

    .chat.threaded {
      padding-right: var(--thread-width);
    }

    .chat > .header {
      transition: margin-right var(--azure-duration-glide) cubic-bezier(0.32, 0.72, 0, 1);
    }

    .chat.searching > .header {
      margin-right: calc(var(--pull) * -1);
    }

    .chat.threaded > .present-wrap,
    .chat.threaded > .unread-wrap,
    .chat.threaded > .typing,
    .chat.threaded > .dropzone,
    .chat.threaded > :global(.composer) {
      right: var(--thread-width);
    }
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
    isolation: isolate;
  }

  .timeline-mask {
    position: relative;
    isolation: isolate;
    --fade-end: calc(var(--composer-space) * 0.55 + env(safe-area-inset-bottom));
    --fade-start: calc(var(--fade-end) + 48px);
  }

  .timeline-mask::after {
    content: "";
    position: absolute;
    inset: auto 0 0;
    height: var(--fade-start);
    z-index: 2;
    pointer-events: none;
    background: linear-gradient(to top, var(--colours-background) var(--fade-end), transparent);
  }

  .beginning {
    margin-top: auto;
    padding: var(--azure-spacing-xl) var(--azure-spacing-lg) var(--azure-spacing-lg);
  }

  .hero {
    display: inline-flex;
  }

  .beginning p {
    margin: var(--azure-spacing-md) 0 0;
  }

  .predecessor {
    padding: 4px 8px;
    margin-left: -8px;
    border-radius: 6px;
    color: var(--colours-accent);
    transition: background-color 320ms cubic-bezier(0.32, 0.72, 0, 1), opacity 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .predecessor:hover:not(:disabled) {
    background-color: var(--colours-surface-hover);
  }

  .predecessor:disabled {
    opacity: 0.6;
  }

  .upgrade-banner {
    margin: 0 var(--azure-spacing-lg) var(--azure-spacing-lg);
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-surface-raised);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    animation: upgrade-in 520ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }

  .upgrade-icon {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 16%, transparent);
  }

  .upgrade-hint {
    display: grid;
  }

  .upgrade-line {
    grid-area: 1 / 1;
    opacity: 0;
    filter: blur(2px);
    transition: opacity 420ms cubic-bezier(0.32, 0.72, 0, 1), filter 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .upgrade-line.shown {
    opacity: 1;
    filter: none;
  }

  .upgrade-line.error {
    color: var(--colours-danger);
  }

  .upgrade-button {
    flex: none;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: 8px;
    color: white;
    border: 0;
    background-color: var(--colours-accent);
    transition: opacity 320ms cubic-bezier(0.32, 0.72, 0, 1), filter 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .upgrade-button:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .upgrade-button:disabled {
    opacity: 0.6;
  }

  @keyframes upgrade-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
      filter: blur(4px);
    }
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

  .role-icon {
    display: inline-flex;
    flex: none;
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

  .message.upload .content {
    transition: opacity var(--azure-duration-md) var(--azure-ease-out);
  }

  .message.upload.failed .content {
    opacity: 0.85;
  }

  .message.last:has(~ .upload) {
    padding-bottom: 2px;
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

  .unread-divider {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 1px;
    margin: var(--azure-spacing-md) var(--azure-spacing-sm);
    background-color: var(--colours-danger);
    list-style: none;
  }

  .unread-tag {
    position: relative;
    margin-left: 8px;
    padding: 0 6px 0 3px;
    border-radius: 0 4px 4px 0;
    font-size: 10px;
    line-height: 16px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: white;
    background-color: var(--colours-danger);
  }

  .unread-tag::before {
    content: "";
    position: absolute;
    inset: 0 100% 0 auto;
    width: 8px;
    background-color: inherit;
    clip-path: polygon(100% 0, 100% 100%, 0 50%);
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
      background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .content {
    flex: 1 1 0;
  }

  .message.mentioned {
    background-color: color-mix(in oklab, var(--colours-warning) 9%, transparent);
    box-shadow: inset 2px 0 0 var(--colours-warning);
    border-start-start-radius: 0;
    border-end-start-radius: 0;
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
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  }

  .swipe-cue {
    position: absolute;
    left: calc(100% + 2px - min(var(--swipe), var(--cue) + 14px));
    top: 50%;
    z-index: 1;
    pointer-events: none;
    display: grid;
    place-items: center;
    width: var(--cue);
    height: var(--cue);
    margin-top: calc(var(--cue) / -2);
    border-radius: 50%;
    color: var(--colours-text-muted);
    background-color: color-mix(in oklab, var(--colours-text-faint) 18%, var(--colours-surface));
    transition:
      color var(--azure-duration-fast) var(--azure-ease-out),
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  @property --swipe {
    syntax: "<length>";
    inherits: true;
    initial-value: 0px;
  }

  .message {
    --cue: 36px;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      --swipe 600ms linear(0, 0.016, 0.059, 0.122, 0.197, 0.28, 0.366, 0.452, 0.535, 0.613, 0.685, 0.75, 0.808, 0.859, 0.902, 0.938, 0.968, 0.991, 1.01, 1.024, 1.034, 1.041, 1.044, 1.046, 1.046, 1.044, 1.041, 1.038, 1.034, 1.031, 1.027, 1.023, 1.019, 1.016, 1.012, 1.01, 1.007, 1.005, 1.003, 1.002, 1);
  }

  .message > :not(.swipe-cue) {
    translate: calc(var(--swipe) * -1) 0;
  }

  .message.swiping {
    transition: none;
  }

  li.message.swiped.swiped {
    overflow-x: clip;
    background-color: transparent;
    box-shadow: none;
  }

  .swipe-cue svg {
    grid-area: 1 / 1;
    width: calc(var(--cue) * 0.5);
    height: calc(var(--cue) * 0.5);
    transition:
      opacity var(--azure-duration-fast) var(--azure-ease-out),
      rotate var(--azure-duration-md) var(--azure-ease-spring);
  }

  .swipe-cue .cue-edit,
  .swipe-cue.edit .cue-reply {
    opacity: 0;
    rotate: -45deg;
  }

  .swipe-cue.edit .cue-edit {
    opacity: 1;
    rotate: 0deg;
  }

  .swipe-cue.armed {
    color: white;
    background-color: var(--colours-accent);
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

    @starting-style {
      opacity: 0;
      transform: translateY(2px);
    }
  }

  .tool {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .reactions {
    flex-wrap: wrap;
    margin-top: var(--azure-spacing-xs);
  }

  .reaction {
    height: 32px;
    padding: 0 12px 0 9px;
    gap: 7px;
    border-radius: var(--azure-radius-pill);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface-raised);
    color: var(--colours-text-muted);
    cursor: pointer;
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .reaction:hover {
    background-color: var(--colours-surface-hover);
  }

  .reaction.own {
    color: var(--colours-accent);
    border-color: color-mix(in oklab, var(--colours-accent) 60%, transparent);
    background-color: color-mix(in oklab, var(--colours-accent) 14%, transparent);
  }

  .reaction-key {
    position: relative;
    display: inline-flex;
  }

  .reaction-key::after {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid var(--colours-accent);
    opacity: 0;
    scale: 0.6;
    pointer-events: none;
  }

  .reaction:global([data-flip="up"]) .reaction-key {
    animation: react-hop 420ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
  }

  .reaction:global([data-flip="down"]) .reaction-key {
    animation: react-dip 360ms ease-out both;
  }

  .reaction:global([data-react="add"]) .reaction-key::after {
    animation: react-ring 560ms ease-out both;
  }

  @keyframes react-hop {
    0% {
      translate: 0 0;
      scale: 1;
    }
    40% {
      translate: 0 -3px;
      scale: 1.1;
    }
    100% {
      translate: 0 0;
      scale: 1;
    }
  }

  @keyframes react-dip {
    0% {
      translate: 0 0;
    }
    40% {
      translate: 0 2px;
      scale: 0.92;
    }
    100% {
      translate: 0 0;
      scale: 1;
    }
  }

  @keyframes react-ring {
    0% {
      opacity: 0.55;
      scale: 0.6;
    }
    100% {
      opacity: 0;
      scale: 1.6;
    }
  }

  .reaction-key :global(img.emoji) {
    width: 20px;
    height: 20px;
    vertical-align: 0;
  }

  .reaction-count {
    position: relative;
    display: inline-grid;
    min-width: 1ch;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
  }

  .reaction-count::before {
    content: var(--prev, "");
    position: absolute;
    inset: 0;
    opacity: 0;
  }

  .reaction:global([data-flip]) .reaction-now {
    animation: count-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }

  .reaction:global([data-flip]) .reaction-count::before {
    animation: count-out 260ms ease-in both;
  }

  .reaction:global([data-flip="down"]) .reaction-now {
    --from: -100%;
  }

  .reaction:global([data-flip="down"]) .reaction-count::before {
    --to: 100%;
  }

  @keyframes count-in {
    from {
      translate: 0 var(--from, 100%);
      opacity: 0;
    }
    to {
      translate: 0 0;
      opacity: 1;
    }
  }

  @keyframes count-out {
    from {
      translate: 0 0;
      opacity: 1;
    }
    to {
      translate: 0 var(--to, -100%);
      opacity: 0;
    }
  }

  .reaction:global([data-react="add"]) .reaction-key {
    animation: react-add 520ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }

  .reaction:global([data-react="remove"]) .reaction-key {
    animation: react-remove 360ms ease-out both;
  }

  @keyframes react-add {
    0% {
      scale: 0.6;
      rotate: -14deg;
    }
    45% {
      scale: 1.22;
      rotate: 8deg;
    }
    70% {
      scale: 0.96;
      rotate: -3deg;
    }
    100% {
      scale: 1;
      rotate: 0deg;
    }
  }

  @keyframes react-remove {
    0% {
      scale: 1;
    }
    40% {
      scale: 0.82;
      translate: 0 1px;
    }
    100% {
      scale: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reaction:global([data-flip]) .reaction-now,
    .reaction:global([data-flip]) .reaction-count::before,
    .reaction:global([data-react]) .reaction-key,
    .reaction:global([data-flip]) .reaction-key,
    .reaction:global([data-react]) .reaction-key::after {
      animation: none;
    }
  }

  .reaction-add {
    width: 40px;
    padding: 0;
    color: var(--colours-text-faint);
    opacity: 0;
    transition: opacity var(--azure-duration-fast) var(--azure-ease-out);
  }

  .message:hover .reaction-add,
  .reaction-add:focus-visible {
    opacity: 1;
  }

  .reaction-add:hover {
    color: var(--colours-accent);
  }

  .seen {
    position: relative;
    height: 0;
    list-style: none;
    pointer-events: none;
  }

  .seen-stack {
    position: absolute;
    right: var(--azure-spacing-lg);
    bottom: 4px;
    padding-left: 4px;
    pointer-events: auto;
  }

  .seen-avatar {
    display: inline-flex;
    margin-left: -4px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--colours-surface);
    animation: seen-in var(--azure-duration-md) var(--azure-ease-fluid);
  }

  .seen-more {
    margin-left: 4px;
    color: var(--colours-text-faint);
  }

  @keyframes seen-in {
    from {
      opacity: 0;
      scale: 0.6;
    }
  }

  .typing {
    position: absolute;
    left: calc(var(--azure-spacing-lg) + var(--azure-spacing-sm));
    right: var(--azure-spacing-lg);
    bottom: calc(3px + env(safe-area-inset-bottom));
    height: 20px;
    z-index: var(--azure-z-sticky);
    pointer-events: none;
    opacity: 0;
    translate: 0 4px;
    transition:
      opacity var(--azure-duration-md) var(--azure-ease-fluid),
      translate var(--azure-duration-md) var(--azure-ease-fluid),
      right var(--azure-duration-glide) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .typing.shown {
    opacity: 1;
    translate: 0 0;
  }

  .typing-dots {
    gap: 3px;
  }

  .typing-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background-color: var(--colours-text-muted);
    animation: typing-bounce 1.2s var(--azure-ease-in-out) infinite;
  }

  .typing-dots span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .typing-dots span:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes typing-bounce {
    0%,
    60%,
    100% {
      opacity: 0.35;
      translate: 0 0;
    }
    30% {
      opacity: 1;
      translate: 0 -3px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .typing-dots span {
      animation-duration: 2.4s;
      translate: none;
    }
  }

  .quick-tool :global(img.emoji) {
    width: 18px;
    height: 18px;
    transition: scale var(--azure-duration-md) var(--azure-ease-spring);
  }

  .quick-tool:hover :global(img.emoji) {
    scale: 1.18;
  }

  .quick-tool.active {
    background-color: color-mix(in oklab, var(--colours-accent) 18%, transparent);
  }

  .tool:hover {
    color: var(--colours-accent);
    background-color: var(--colours-surface-hover);
  }

  @keyframes edit-open {
    from {
      opacity: 0;
      translate: 0 6px;
      scale: 0.985;
      filter: blur(4px);
    }
  }

  .body-swap {
    display: grid;
  }

  .body-swap > :global(*) {
    grid-area: 1 / 1;
  }

  .editor {
    animation: edit-open 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
    gap: var(--azure-spacing-sm);
    margin: var(--azure-spacing-xs) 0 var(--azure-spacing-sm);
  }

  .edit-hint {
    gap: var(--azure-spacing-md);
    padding: var(--azure-spacing-xs) var(--azure-spacing-xs) 0;
  }

  .edit-hint > span:first-child {
    margin-right: var(--azure-spacing-lg);
  }

  .edit-hint .link-button + .link-button {
    margin-left: var(--azure-spacing-xs);
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

    .reaction-add {
      opacity: 1;
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

  @media (pointer: coarse) {
    .message {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }

    .message :is(textarea, input) {
      -webkit-user-select: text;
      user-select: text;
    }
  }
</style>
