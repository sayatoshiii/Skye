import { sessionRequest } from "../session";
import type { Session } from "../types";
import { DEFAULT_AUDIENCE, SPACE_AUDIENCES, type SpaceAudience } from "../../settings/spaces";

export type SpaceBlueprint = {
  name: string;
  avatarUrl?: string;
  rooms: string[];
  audience?: SpaceAudience;
};

const serverOf = (userId: string) => userId.slice(userId.indexOf(":") + 1);

const create = (session: Session, body: Record<string, any>) =>
  sessionRequest<{ room_id: string }>(session, { endpoint: "createRoom", method: "POST", body }).then(({ room_id }) => room_id);

export const createSpace = async (session: Session, { name, avatarUrl, rooms, audience = DEFAULT_AUDIENCE }: SpaceBlueprint) => {
  const via = [serverOf(session.userId)];
  const settings = SPACE_AUDIENCES.find((entry) => entry.id === audience) ?? SPACE_AUDIENCES[0];
  const spaceId = await create(session, {
    name,
    preset: settings.preset,
    visibility: "private",
    creation_content: { type: "m.space" },
    power_level_content_override: { events_default: 100 },
    initial_state: [
      { type: "m.room.join_rules", state_key: "", content: { join_rule: settings.joinRule } },
      ...(avatarUrl ? [{ type: "m.room.avatar", state_key: "", content: { url: avatarUrl } }] : []),
    ],
  });

  for (const room of rooms) {
    const roomId = await create(session, {
      name: room,
      preset: "private_chat",
      visibility: "private",
      initial_state: [
        { type: "m.space.parent", state_key: spaceId, content: { via, canonical: true } },
        { type: "m.room.join_rules", state_key: "", content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] } },
        ...(settings.encrypted ? [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }] : []),
      ],
    });
    await sessionRequest(session, {
      endpoint: `rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(roomId)}`,
      method: "PUT",
      body: { via, suggested: true },
    });
  }

  return spaceId;
};
