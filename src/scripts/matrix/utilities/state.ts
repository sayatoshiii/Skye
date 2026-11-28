import { sessionRequest } from "../session";
import type { RoomId, Session } from "../types";

export const sendState = (session: Session, roomId: RoomId, type: string, content: Record<string, unknown>, stateKey = "") =>
  sessionRequest<{ event_id: string }>(session, {
    endpoint: `rooms/${encodeURIComponent(roomId)}/state/${type}/${encodeURIComponent(stateKey)}`,
    method: "PUT",
    body: content,
  });
