import { get } from "svelte/store";
import { serverNameFromUserId } from "../matrix/discovery";
import { getOrphanRooms } from "../matrix/rooms";
import { loadSession, sessionRequest } from "../matrix/session";
import type { SpaceTree } from "../matrix/types";
import { BROWSE_SEGMENT } from "../settings/config";
import { toEntity } from "./entities";
import { directMessages, getDirectRoomMap, rooms, spaces } from "./matrix";

export const HOME = "home";
export const APP_BASE = "/app";

export type Pane = "channels" | "chat" | "members";

export const navigation = $state({
  spaceId: HOME,
  roomId: undefined as string | undefined,
  pane: "chat" as Pane,
  browsing: false,
});

const lastRoomPerSpace: Record<string, string> = {};

export const getSpaceRoomIds = (tree: SpaceTree) => [
  ...tree.rooms.map(({ roomId }) => roomId),
  ...tree.categories.flatMap((category) => category.rooms.map(({ roomId }) => roomId)),
];

export const getHomeRoomIds = () => [
  ...get(directMessages).map(({ roomId }) => roomId),
  ...getOrphanRooms(get(rooms)).map(({ roomId }) => roomId),
];

const getSpaceTree = (spaceId: string) =>
  get(spaces).find((tree) => tree.space.roomId === spaceId);

export const getDefaultRoom = (spaceId: string) => {
  if (lastRoomPerSpace[spaceId]) return lastRoomPerSpace[spaceId];
  if (spaceId === HOME) return getHomeRoomIds()[0];

  const tree = getSpaceTree(spaceId);
  return tree ? getSpaceRoomIds(tree)[0] : undefined;
};

type Routable = {
  id: string;
  alias?: string;
  directUserId?: string;
  directJoined?: boolean;
  createdAt?: number;
};

const getEntities = (): Routable[] => {
  const ownUserId = loadSession()?.userId;
  return Object.values(get(rooms)).map((room) => toEntity(room, ownUserId));
};

const getHomeServerName = () => {
  const userId = loadSession()?.userId;
  return userId ? serverNameFromUserId(userId) : "";
};

const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replaceAll("%3A", ":").replaceAll("%21", "!").replaceAll("%40", "@");

const shortenAddress = (address: string) => {
  const [localpart, server] = address.slice(1).split(/:(.*)/s);
  return server === getHomeServerName() ? localpart : `${localpart}:${server}`;
};

const expandAddress = (sigil: string, short: string) =>
  `${sigil}${short.includes(":") ? short : `${short}:${getHomeServerName()}`}`;

export const getPrimaryDirect = (userId: string, entities: Routable[]) =>
  entities
    .filter((entity) => entity.directUserId === userId)
    .sort(
      (a, b) =>
        Number(b.directJoined ?? true) - Number(a.directJoined ?? true) ||
        (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity),
    )[0];

export const toSegment = (id: string, entities: Routable[]) => {
  const entity = entities.find((candidate) => candidate.id === id);

  if (entity?.alias) return encodeSegment(shortenAddress(entity.alias));
  if (entity?.directUserId && getPrimaryDirect(entity.directUserId, entities)?.id === id)
    return encodeSegment(`@${shortenAddress(entity.directUserId)}`);

  return encodeSegment(id);
};

export const fromSegment = (segment: string | undefined, entities: Routable[]) => {
  if (!segment) return;

  const decoded = decodeURIComponent(segment);
  if (decoded.startsWith("!")) return decoded;

  if (decoded.startsWith("@")) {
    const userId = expandAddress("@", decoded.slice(1));
    return getPrimaryDirect(userId, entities)?.id;
  }

  const alias = expandAddress("#", decoded);
  return entities.find((entity) => entity.alias === alias)?.id;
};

export const serialisePath = (spaceId: string, roomId?: string, browsing = false) => {
  const entities = getEntities();

  return [
    APP_BASE,
    spaceId === HOME ? HOME : toSegment(spaceId, entities),
    browsing && spaceId !== HOME ? BROWSE_SEGMENT : roomId && toSegment(roomId, entities),
  ]
    .filter(Boolean)
    .join("/");
};

export const parsePath = (pathname: string) => {
  const entities = getEntities();
  const [spaceSegment, roomSegment] = pathname
    .replace(APP_BASE, "")
    .split("/")
    .filter(Boolean);

  const spaceId = spaceSegment === HOME ? HOME : fromSegment(spaceSegment, entities);
  const roomId = fromSegment(roomSegment, entities);

  const knownSpace = spaceId === HOME || (!!spaceId && !!getSpaceTree(spaceId));
  const resolvedSpace = knownSpace ? spaceId! : HOME;
  const knownRoom = roomId && get(rooms)[roomId] ? roomId : undefined;
  const browsing = resolvedSpace !== HOME && roomSegment === BROWSE_SEGMENT;

  return {
    spaceId: resolvedSpace,
    roomId: browsing ? undefined : (knownRoom ?? getDefaultRoom(resolvedSpace)),
    browsing,
  };
};

const spaceFor = (spaceId: string, roomId: string) => {
  const trees = get(spaces);
  const inSpace = (id: string) => {
    const tree = trees.find((candidate) => candidate.space.roomId === id);
    return !!tree && (id === roomId || getSpaceRoomIds(tree).includes(roomId));
  };
  if (spaceId !== HOME && inSpace(spaceId)) return spaceId;
  if (spaceId === HOME && getHomeRoomIds().includes(roomId)) return HOME;
  return trees.find((tree) => tree.space.roomId === roomId || getSpaceRoomIds(tree).includes(roomId))?.space.roomId ?? (get(rooms)[roomId] ? HOME : spaceId);
};

export const openRoom = (spaceId: string, roomId?: string, push = true) => {
  roomId ??= getDefaultRoom(spaceId);
  if (roomId) spaceId = spaceFor(spaceId, roomId);

  navigation.spaceId = spaceId;
  navigation.roomId = roomId;
  navigation.browsing = false;
  if (roomId) lastRoomPerSpace[spaceId] = roomId;

  if (push) history.pushState(null, "", serialisePath(spaceId, roomId));
};

export const openBrowse = (spaceId: string, push = true) => {
  if (spaceId === HOME) return openRoom(spaceId, undefined, push);

  navigation.spaceId = spaceId;
  navigation.roomId = undefined;
  navigation.browsing = true;
  navigation.pane = "chat";

  if (push) history.pushState(null, "", serialisePath(spaceId, undefined, true));
};

export const syncFromLocation = () => {
  const { spaceId, roomId, browsing } = parsePath(location.pathname);
  if (browsing) openBrowse(spaceId, false);
  else openRoom(spaceId, roomId, false);
  history.replaceState(null, "", serialisePath(spaceId, roomId, browsing));
};

const createDirect = async (userId: string) => {
  const session = loadSession();
  if (!session) throw new Error("No active Matrix session.");

  const { room_id } = await sessionRequest<{ room_id: string }>(session, {
    endpoint: "createRoom",
    method: "POST",
    body: {
      is_direct: true,
      invite: [userId],
      preset: "trusted_private_chat",
      initial_state: [
        { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
      ],
    },
  });

  const direct = getDirectRoomMap();
  await sessionRequest(session, {
    endpoint: `user/${encodeURIComponent(session.userId)}/account_data/m.direct`,
    method: "PUT",
    body: { ...direct, [userId]: [...(direct[userId] ?? []), room_id] },
  });

  return room_id;
};

export const openDirect = async (userId: string) => {
  const roomId = getPrimaryDirect(userId, getEntities())?.id ?? (await createDirect(userId));
  openRoom(HOME, roomId);
  navigation.pane = "chat";
  return roomId;
};

const getRoomIdsIn = (spaceId: string) => {
  if (spaceId === HOME) return getHomeRoomIds();
  const tree = getSpaceTree(spaceId);
  return tree ? getSpaceRoomIds(tree) : [];
};

export const findSpaceFor = (roomId: string) =>
  get(spaces).find((tree) => getSpaceRoomIds(tree).includes(roomId))?.space.roomId ?? HOME;

export const openJoined = (roomId: string) => {
  const room = get(rooms)[roomId];
  if (room?.isSpace) return openBrowse(roomId);
  openRoom(findSpaceFor(roomId), roomId);
  navigation.pane = "chat";
};

export const navigateAwayFrom = (roomIds: string[]) => {
  const gone = new Set(roomIds);
  Object.entries(lastRoomPerSpace).forEach(([spaceId, roomId]) => gone.has(roomId) && delete lastRoomPerSpace[spaceId]);

  const leavingSpace = gone.has(navigation.spaceId);
  if (!leavingSpace && !(navigation.roomId && gone.has(navigation.roomId))) return;

  const spaceId = leavingSpace ? HOME : navigation.spaceId;
  const next = getRoomIdsIn(spaceId).find((roomId) => !gone.has(roomId));

  if (next) return openRoom(spaceId, next);
  if (spaceId !== HOME) return openBrowse(spaceId);

  navigation.spaceId = HOME;
  navigation.roomId = undefined;
  navigation.browsing = false;
  history.pushState(null, "", serialisePath(HOME));
};

export const spaceMenu = $state<{ request: { spaceId: string; x: number; y: number; width?: number } | null }>({ request: null });

export const openSpaceMenu = (spaceId: string, x: number, y: number, width?: number) => {
  if (spaceId === HOME || spaceMenu.request) return;
  spaceMenu.request = { spaceId, x, y, width };
};

export const roomMenu = $state<{ request: { roomId: string; x: number; y: number } | null }>({ request: null });

export const openRoomMenu = (roomId: string, x: number, y: number) => {
  if (roomMenu.request) return;
  roomMenu.request = { roomId, x, y };
};

export const hasDirect = (userId: string) => !!getPrimaryDirect(userId, getEntities());

export const handoff = $state<{ value: { roomId: string; files: File[]; text: string } | null }>({ value: null });

export const directRoomOf = (userId: string) => getPrimaryDirect(userId, getEntities())?.id;

export const userMenu = $state<{
  request: { userId: string; x: number; y: number; roomId?: string } | null;
  confirm: { kind: "direct" | "kick" | "ban"; userId: string; roomId?: string } | null;
}>({ request: null, confirm: null });

export const openUserMenu = (userId: string, x: number, y: number, roomId?: string) => {
  if (userMenu.request) return;
  userMenu.request = { userId, x, y, roomId };
};

export const messageUser = (userId: string) => {
  if (hasDirect(userId)) return openDirect(userId);
  userMenu.confirm = { kind: "direct", userId };
};

export const roomSettings = $state<{ roomId: string | null }>({ roomId: null });

export const openRoomSettings = (roomId: string) => (roomSettings.roomId = roomId);
