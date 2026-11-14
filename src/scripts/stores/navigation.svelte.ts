import { serverNameFromUserId } from "../matrix/discovery";
import { loadSession } from "../matrix/session";
import { getDirectRooms, getSpace, getSpaceRoomIds, homeServerName, rooms, spaces } from "./placeholder";

export const HOME = "home";
export const APP_BASE = "/app";

export type Pane = "channels" | "chat" | "members";

export const navigation = $state({
  spaceId: HOME,
  roomId: undefined as string | undefined,
  pane: "chat" as Pane,
});

const lastRoomPerSpace: Record<string, string> = {};

export const getDefaultRoom = (spaceId: string) => {
  if (lastRoomPerSpace[spaceId]) return lastRoomPerSpace[spaceId];
  if (spaceId === HOME) return getDirectRooms()[0]?.id;

  const space = getSpace(spaceId);
  return space ? getSpaceRoomIds(space)[0] : undefined;
};

type Routable = {
  id: string;
  alias?: string;
  directUserId?: string;
  directJoined?: boolean;
  createdAt?: number;
};

const getHomeServerName = () => {
  const userId = loadSession()?.userId;
  return userId ? serverNameFromUserId(userId) : homeServerName;
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

export const serialisePath = (spaceId: string, roomId?: string) =>
  [
    APP_BASE,
    spaceId === HOME ? HOME : toSegment(spaceId, spaces),
    roomId && toSegment(roomId, rooms),
  ]
    .filter(Boolean)
    .join("/");

export const parsePath = (pathname: string) => {
  const [spaceSegment, roomSegment] = pathname
    .replace(APP_BASE, "")
    .split("/")
    .filter(Boolean);

  const spaceId = spaceSegment === HOME ? HOME : fromSegment(spaceSegment, spaces);
  const roomId = fromSegment(roomSegment, rooms);

  const knownSpace = spaceId === HOME || spaces.some(({ id }) => id === spaceId);
  const resolvedSpace = knownSpace ? spaceId! : HOME;

  return {
    spaceId: resolvedSpace,
    roomId: roomId ?? getDefaultRoom(resolvedSpace),
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
