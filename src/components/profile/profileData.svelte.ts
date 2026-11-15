import type { RoomMember, RoomSummary } from "../../scripts/matrix/types";
import { fetchProfileCard, type ExtendedProfile } from "../../scripts/matrix/utilities/profile";
import { joinedMembers, presenceDetails, rooms, session, type PresenceDetails } from "../../scripts/stores/matrix";
import { roleOf } from "../../scripts/stores/profile";

export const createProfileData = (target: () => { userId?: string; roomId?: string }) => {
  let allRooms: Record<string, RoomSummary> = $state.raw({});
  let loadedMembers: Record<string, Record<string, RoomMember>> = $state.raw({});
  let statuses: Record<string, PresenceDetails> = $state.raw({});
  let ownUserId: string | undefined = $state();
  let details: ExtendedProfile | null = $state.raw(null);
  let banner: string | undefined = $state();

  $effect(() => rooms.subscribe((value) => (allRooms = value)));
  $effect(() => joinedMembers.subscribe((value) => (loadedMembers = value)));
  $effect(() => presenceDetails.subscribe((value) => (statuses = value)));
  $effect(() => session.subscribe((value) => (ownUserId = value?.userId)));

  $effect(() => {
    const id = target().userId;
    details = null;
    banner = undefined;
    if (!id) return;

    let cancelled = false;
    fetchProfileCard(id).then((card) => {
      if (cancelled) return;
      details = card.profile;
      banner = card.banner;
    });

    return () => (cancelled = true);
  });

  const room = $derived(target().roomId ? allRooms[target().roomId!] : undefined);
  const member = $derived.by(() => {
    const { userId, roomId } = target();
    if (!userId) return undefined;
    return (roomId ? loadedMembers[roomId]?.[userId] : undefined) ?? room?.members[userId];
  });

  return {
    get userId() {
      return target().userId ?? "";
    },
    get room() {
      return room;
    },
    get ownUserId() {
      return ownUserId;
    },
    get isSelf() {
      return !!ownUserId && ownUserId === target().userId;
    },
    get displayName() {
      return member?.displayName ?? details?.displayName ?? target().userId ?? "";
    },
    get avatar() {
      return member?.avatarUrl ?? details?.avatarUrl;
    },
    get banner() {
      return banner;
    },
    get bio() {
      return details?.bio;
    },
    get status() {
      return target().userId ? statuses[target().userId!] : undefined;
    },
    get role() {
      return target().userId ? roleOf(room, target().userId!) : undefined;
    },
    get memberSince() {
      const userId = target().userId;
      const event = userId ? room?.state["m.room.member"]?.[userId] : undefined;
      return event?.content?.membership === "join" ? event.origin_server_ts : undefined;
    },
    get rooms() {
      return allRooms;
    },
  };
};

export type ProfileData = ReturnType<typeof createProfileData>;
