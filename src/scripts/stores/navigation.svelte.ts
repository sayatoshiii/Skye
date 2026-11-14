import { get } from "svelte/store";
import { serverNameFromUserId } from "../matrix/discovery";
import { getOrphanRooms } from "../matrix/rooms";
import { loadSession } from "../matrix/session";
import type { SpaceTree } from "../matrix/types";
import { toEntity } from "./entities";
import { directMessages, rooms, spaces } from "./matrix";

export const HOME = "home";
export const APP_BASE = "/app";

export type Pane = "channels" | "chat" | "members";

export const navigation = $state({
  spaceId: HOME,
  roomId: undefined as string | undefined,
  pane: "chat" as Pane,
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

export const serialisePath = (spaceId: string, roomId?: string) => {
  const entities = getEntities();

  return [
    APP_BASE,
    spaceId === HOME ? HOME : toSegment(spaceId, entities),
    roomId && toSegment(roomId, entities),
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

  return {
    spaceId: resolvedSpace,
    roomId: knownRoom ?? getDefaultRoom(resolvedSpace),
  };
};

export const openRoom = (spaceId: string, roomId?: string, push = true) => {
  roomId ??= getDefaultRoom(spaceId);

  navigation.spaceId = spaceId;
  navigation.roomId = roomId;
  if (roomId) lastRoomPerSpace[spaceId] = roomId;

  if (push) history.pushState(null, "", serialisePath(spaceId, roomId));
};

export const syncFromLocation = () => {
  const { spaceId, roomId } = parsePath(location.pathname);
  openRoom(spaceId, roomId, false);
  history.replaceState(null, "", serialisePath(spaceId, roomId));
};
