export type ScrollAnchor = { bottom: true } | { bottom: false; eventId: string; offset: number };

const KEY = "skye.scroll";
const LIMIT = 100;

const load = (): Map<string, ScrollAnchor> => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return new Map(raw ? JSON.parse(raw) : []);
  } catch {
    return new Map();
  }
};

let anchors: Map<string, ScrollAnchor> | null = null;
const all = () => (anchors ??= load());

export const getScrollAnchor = (roomId: string) => all().get(roomId);

export const setScrollAnchor = (roomId: string, anchor: ScrollAnchor) => {
  const map = all();
  map.delete(roomId);
  map.set(roomId, anchor);
  while (map.size > LIMIT) map.delete(map.keys().next().value!);
};

export const persistScrollAnchors = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...all()]));
  } catch {}
};
