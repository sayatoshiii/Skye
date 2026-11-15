import { get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { registerAccountDataHook, session } from "./matrix";

export const HIDDEN_ROOMS_TYPE = "chat.skye.hidden_rooms";

const SAVE_DELAY = 600;

export const hiddenRooms = writable<Record<string, string[]>>({});

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const endpoint = (userId: string) =>
  `user/${encodeURIComponent(userId)}/account_data/${HIDDEN_ROOMS_TYPE}`;

export const applyHiddenRooms = (events: { type: string; content?: Record<string, unknown> }[]) => {
  const event = events.findLast((candidate) => candidate.type === HIDDEN_ROOMS_TYPE);
  if (!event?.content) return;

  hiddenRooms.set(
    Object.fromEntries(
      Object.entries(event.content)
        .filter(([, value]) => Array.isArray(value))
        .map(([spaceId, value]) => [
          spaceId,
          (value as unknown[]).filter((roomId): roomId is string => typeof roomId === "string"),
        ]),
    ),
  );
};

registerAccountDataHook((events) => applyHiddenRooms(events));

const persist = async () => {
  const active = get(session);
  if (!active) return;

  await sessionRequest(active, {
    endpoint: endpoint(active.userId),
    method: "PUT",
    body: get(hiddenRooms),
  }).catch((error) => console.warn("Skye could not save hidden rooms", error));
};

export const setRoomsHidden = (spaceId: string, roomIds: string[], hidden: boolean) => {
  hiddenRooms.update((current) => {
    const next = new Set(current[spaceId] ?? []);
    roomIds.forEach((roomId) => (hidden ? next.add(roomId) : next.delete(roomId)));

    const result = { ...current };
    if (next.size) result[spaceId] = [...next];
    else delete result[spaceId];
    return result;
  });

  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, SAVE_DELAY);
};

export const isRoomHidden = (state: Record<string, string[]>, spaceId: string, roomId: string) =>
  state[spaceId]?.includes(roomId) ?? false;
