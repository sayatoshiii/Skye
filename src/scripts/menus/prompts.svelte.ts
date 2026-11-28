import { get } from "svelte/store";
import { leaveRoom } from "../matrix/utilities/membership";
import { session } from "../stores/matrix";
import { navigateAwayFrom } from "../stores/navigation.svelte";

export type PromptKind = "leave" | "delete" | "leave-space" | "sync-roles" | "unsync-roles";

export const prompt = $state<{ current: { kind: PromptKind; id: string } | null; busy: boolean }>({ current: null, busy: false });

export const ask = (kind: PromptKind, id: string) => (prompt.current = { kind, id });

export const askLeave = (roomId: string, event?: MouseEvent | KeyboardEvent) => {
  const active = get(session);
  if (!event?.shiftKey || !active) return ask("leave", roomId);
  leaveRoom(active, roomId).then(() => navigateAwayFrom([roomId]), () => ask("leave", roomId));
};
