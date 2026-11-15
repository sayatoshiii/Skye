import { get, writable } from "svelte/store";
import { sessionRequest } from "../matrix/session";
import { registerNotesHook, session } from "./matrix";

export const NOTES_TYPE = "chat.skye.notes";

const SAVE_DELAY = 600;

export const notes = writable<Record<string, string>>({});

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const endpoint = (userId: string) =>
  `user/${encodeURIComponent(userId)}/account_data/${NOTES_TYPE}`;

export const applyNotes = (events: { type: string; content?: Record<string, unknown> }[]) => {
  const event = events.findLast((candidate) => candidate.type === NOTES_TYPE);
  if (!event?.content) return;

  notes.set(
    Object.fromEntries(
      Object.entries(event.content).filter(([, value]) => typeof value === "string"),
    ) as Record<string, string>,
  );
};

registerNotesHook((events) => applyNotes(events));

const persist = async () => {
  const active = get(session);
  if (!active) return;

  await sessionRequest(active, {
    endpoint: endpoint(active.userId),
    method: "PUT",
    body: get(notes),
  }).catch((error) => console.warn("Skye could not save notes", error));
};

export const setNote = (userId: string, text: string) => {
  notes.update((current) => {
    const next = { ...current };
    if (text.trim()) next[userId] = text;
    else delete next[userId];
    return next;
  });

  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, SAVE_DELAY);
};
