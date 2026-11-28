import { sessionRequest } from "../session";
import { ROLES_EVENT } from "./power";
import { sendState } from "./state";
import type { PowerLevels, RoomId, Session, UserId } from "../types";
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
      { type: ROLES_EVENT, state_key: "", content: { roles: [], sync: true } },
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
    await sendState(session, spaceId, "m.space.child", { via, suggested: true }, roomId);
  }

  return spaceId;
};

export type RoomBlueprint = {
  parentId: RoomId;
  name: string;
  type?: string;
  power: PowerLevels;
  hidden: boolean;
  encrypted: boolean;
  history: RoomHistory;
};

export type RoomHistory = "shared" | "invited" | "joined";

export const createRoomIn = async (session: Session, { parentId, name, type, power, hidden, encrypted, history }: RoomBlueprint) => {
  const via = [serverOf(session.userId)];
  const roomId = await create(session, {
    name,
    preset: "private_chat",
    visibility: "private",
    ...(type ? { creation_content: { type } } : {}),
    power_level_content_override: power,
    initial_state: [
      { type: "m.space.parent", state_key: parentId, content: { via, canonical: true } },
      { type: "m.room.join_rules", state_key: "", content: hidden ? { join_rule: "invite" } : { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: parentId }] } },
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: history } },
      ...(encrypted ? [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }] : []),
    ],
  });
  await sendState(session, parentId, "m.space.child", { via }, roomId);
  return roomId;
};

export type ClosureStep = "unlist" | "lock" | "remove" | "leave";

export type Closure = { roomId: RoomId; parents: RoomId[]; members: UserId[]; reason: string };


export const closeRoom = async (session: Session, { roomId, parents, members, reason }: Closure, onstep: (step: ClosureStep) => void) => {
  onstep("unlist");
  await Promise.all(parents.map((parentId) => sendState(session, parentId, "m.space.child", {}, roomId)));
  onstep("lock");
  await sendState(session, roomId, "m.room.join_rules", { join_rule: "invite" });
  onstep("remove");
  const removals = await Promise.allSettled(
    members.map((userId) => sessionRequest(session, { endpoint: `rooms/${encodeURIComponent(roomId)}/kick`, method: "POST", body: { user_id: userId, reason } })),
  );
  onstep("leave");
  await sessionRequest(session, { endpoint: `rooms/${encodeURIComponent(roomId)}/leave`, method: "POST", body: {} });
  await sessionRequest(session, { endpoint: `rooms/${encodeURIComponent(roomId)}/forget`, method: "POST", body: {} }).catch(() => undefined);
  return removals.filter((result) => result.status === "rejected").length;
};
