export type UserId = string;
export type RoomId = string;
export type EventId = string;
export type DeviceId = string;

export type Session = {
  homeserver: string;
  accessToken: string;
  userId: UserId;
  deviceId: DeviceId;
  refreshToken?: string;
};

export type WellKnown = {
  "m.homeserver": { base_url: string };
  "m.identity_server"?: { base_url: string };
  "org.matrix.msc2965.authentication"?: { issuer: string; account?: string };
  [key: string]: unknown;
};

export type ServerVersions = {
  versions: string[];
  unstable_features?: Record<string, boolean>;
};

export type IdentityProvider = {
  id: string;
  name: string;
  icon?: string;
  brand?: string;
};

export type LoginFlow =
  | { type: "m.login.password" }
  | { type: "m.login.token"; get_login_token?: boolean }
  | {
      type: "m.login.sso";
      identity_providers?: IdentityProvider[];
      "org.matrix.msc3824.delegated_oidc_compatibility"?: boolean;
    }
  | { type: string; [key: string]: unknown };

export type LoginResponse = {
  access_token: string;
  device_id: DeviceId;
  user_id: UserId;
  refresh_token?: string;
  expires_in_ms?: number;
  well_known?: WellKnown;
};

export type MatrixEvent<C = Record<string, any>> = {
  type: string;
  content: C;
  event_id?: EventId;
  sender?: UserId;
  origin_server_ts?: number;
  state_key?: string;
  room_id?: RoomId;
  redacts?: EventId;
  unsigned?: {
    age?: number;
    transaction_id?: string;
    redacted_because?: MatrixEvent;
    prev_content?: Record<string, any>;
    "m.relations"?: Record<string, any>;
  };
};

export type StateEvent<C = Record<string, any>> = MatrixEvent<C> & {
  state_key: string;
};

export type UnreadNotificationCounts = {
  notification_count?: number;
  highlight_count?: number;
  unread_count?: number;
  "org.matrix.msc2654.unread_count"?: number;
};

export type Timeline = {
  events: MatrixEvent[];
  limited?: boolean;
  prev_batch?: string;
};

export type JoinedRoomSync = {
  state?: { events: StateEvent[] };
  msc4354_sticky?: { events: MatrixEvent[] };
  timeline?: Timeline;
  ephemeral?: { events: MatrixEvent[] };
  account_data?: { events: MatrixEvent[] };
  unread_notifications?: UnreadNotificationCounts;
  unread_count?: number;
  "org.matrix.msc2654.unread_count"?: number;
  summary?: {
    "m.heroes"?: UserId[];
    "m.joined_member_count"?: number;
    "m.invited_member_count"?: number;
  };
};

export type InvitedRoomSync = {
  invite_state?: { events: StateEvent[] };
};

export type LeftRoomSync = {
  state?: { events: StateEvent[] };
  timeline?: Timeline;
};

export type DeviceLists = {
  changed?: UserId[];
  left?: UserId[];
};

export type SyncResponse = {
  next_batch: string;
  rooms?: {
    join?: Record<RoomId, JoinedRoomSync>;
    invite?: Record<RoomId, InvitedRoomSync>;
    leave?: Record<RoomId, LeftRoomSync>;
    knock?: Record<RoomId, InvitedRoomSync>;
  };
  account_data?: { events: MatrixEvent[] };
  presence?: { events: MatrixEvent[] };
  to_device?: { events: MatrixEvent[] };
  device_lists?: DeviceLists;
  device_one_time_keys_count?: Record<string, number>;
  device_unused_fallback_key_types?: string[];
};

export type SyncFilter = {
  room?: {
    state?: { lazy_load_members?: boolean; types?: string[] };
    timeline?: { limit?: number; lazy_load_members?: boolean };
    include_leave?: boolean;
  };
  presence?: { types?: string[]; not_types?: string[] };
  [key: string]: unknown;
};

export type SyncState =
  | "stopped"
  | "initialising"
  | "syncing"
  | "catching_up"
  | "reconnecting"
  | "error";

export type CryptoSyncData = {
  toDevice: MatrixEvent[];
  deviceLists: DeviceLists;
  oneTimeKeyCounts: Record<string, number>;
  unusedFallbackKeyTypes?: string[];
  nextBatch: string;
};

export type CryptoHooks = {
  onSync?: (data: CryptoSyncData) => Promise<void> | void;
  decryptEvent?: (
    event: MatrixEvent,
    roomId: RoomId,
  ) => Promise<MatrixEvent | null> | MatrixEvent | null;
  encryptEvent?: (
    type: string,
    content: Record<string, any>,
    roomId: RoomId,
  ) => Promise<MatrixEvent | null> | MatrixEvent | null;
};

export type SyncEvents = {
  sync: SyncResponse;
  state: SyncState;
  error: unknown;
  room_timeline: {
    roomId: RoomId;
    events: MatrixEvent[];
    limited: boolean;
    prevBatch?: string;
  };
  account_data: MatrixEvent[];
};

export type Membership = "join" | "invite" | "leave" | "ban" | "knock";

export type RoomMember = {
  userId: UserId;
  membership: Membership;
  displayName?: string;
  avatarUrl?: string;
};

export type PowerLevels = {
  users?: Record<UserId, number>;
  users_default?: number;
  events?: Record<string, number>;
  events_default?: number;
  state_default?: number;
  ban?: number;
  kick?: number;
  redact?: number;
  invite?: number;
  notifications?: { room?: number };
};

export type RoomSummary = {
  roomId: RoomId;
  membership: Membership;
  name?: string;
  topic?: string;
  avatarUrl?: string;
  roomType?: string;
  isSpace: boolean;
  isDirect: boolean;
  directUserId?: UserId;
  encryption?: Record<string, any>;
  children: RoomId[];
  parents: RoomId[];
  members: Record<UserId, RoomMember>;
  heroes: UserId[];
  joinedMemberCount?: number;
  powerLevels?: PowerLevels;
  notificationCount: number;
  highlightCount: number;
  unreadCount?: number;
  latestForeign?: { eventId: EventId; ts: number };
  readTs: number;
  readEventId?: EventId;
  fullyRead?: EventId;
  muted: boolean;
  mentionsOnly: boolean;
  localUnread?: number;
  lastActivity: number;
  pinned: EventId[];
  state: Record<string, Record<string, StateEvent>>;
};

export type SpaceCategory = {
  space: RoomSummary;
  rooms: RoomSummary[];
};

export type SpaceTree = {
  space: RoomSummary;
  rooms: RoomSummary[];
  categories: SpaceCategory[];
};

export type LocalEchoStatus = "sending" | "sent" | "failed";

export type TimelineEvent = MatrixEvent & {
  event_id: EventId;
  sender: UserId;
  origin_server_ts: number;
  localStatus?: LocalEchoStatus;
  txnId?: string;
  redacted?: boolean;
  edited?: boolean;
  originalContent?: Record<string, any>;
  decryptionFailed?: boolean;
  clearEvent?: MatrixEvent;
};

export type MessagesResponse = {
  start: string;
  end?: string;
  chunk: MatrixEvent[];
  state?: StateEvent[];
};
