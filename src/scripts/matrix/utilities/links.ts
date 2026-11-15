export type RoomLink = {
  target: string;
  kind: "alias" | "id";
  via: string[];
};

const MATRIX_TO = /^(?:https?:\/\/)?(?:www\.)?matrix\.to\/#\/(.+)$/i;
const MATRIX_URI = /^matrix:(r|room|roomid)\/(.+)$/i;
const SERVER_NAME = /^[a-z0-9.\-]+(?::\d{1,5})?$|^\[[0-9a-f:.]+\](?::\d{1,5})?$/i;
const OPAQUE_ID = /^![A-Za-z0-9+/_\-]{20,}={0,2}$/;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const splitQuery = (value: string) => {
  const index = value.indexOf("?");
  return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index + 1)];
};

const readVia = (query: string) =>
  [...new URLSearchParams(query).getAll("via")]
    .map((server) => server.trim())
    .filter((server) => SERVER_NAME.test(server));

const isValidAddress = (address: string) => {
  const colon = address.indexOf(":");
  return colon > 1 && !/\s/.test(address) && SERVER_NAME.test(address.slice(colon + 1));
};

const toLink = (target: string, via: string[]): RoomLink | null => {
  if (target.startsWith("#")) return isValidAddress(target) ? { target, kind: "alias", via } : null;
  if (!target.startsWith("!")) return null;
  if (isValidAddress(target) || OPAQUE_ID.test(target)) return { target, kind: "id", via };
  return null;
};

export const parseRoomLink = (input: string): RoomLink | null => {
  const value = input.trim();
  if (!value) return null;

  const matrixTo = value.match(MATRIX_TO);
  if (matrixTo) {
    const [path, query] = splitQuery(matrixTo[1]);
    const [first] = path.split("/").filter(Boolean);
    return first ? toLink(decode(first), readVia(query)) : null;
  }

  const uri = value.match(MATRIX_URI);
  if (uri) {
    const [path, query] = splitQuery(uri[2]);
    const [first] = path.split("/").filter(Boolean);
    if (!first) return null;
    const sigil = uri[1].toLowerCase() === "roomid" ? "!" : "#";
    return toLink(`${sigil}${decode(first)}`, readVia(query));
  }

  const [plain, query] = splitQuery(value);
  const target = /^[#!]/.test(plain) ? plain : `#${plain}`;
  return toLink(decode(target), readVia(query));
};

export const toMatrixTo = (roomIdOrAlias: string, via: string[] = []) => {
  const base = `https://matrix.to/#/${encodeURIComponent(roomIdOrAlias)}`;
  if (roomIdOrAlias.startsWith("#") || !via.length) return base;
  return `${base}?${via.map((server) => `via=${encodeURIComponent(server)}`).join("&")}`;
};
