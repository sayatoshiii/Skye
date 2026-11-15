export type SpaceTemplate = {
  id: string;
  icon: string;
  rooms: string[];
};

export type SpaceAudience = "friends" | "community";

export type AudiencePreset = {
  id: SpaceAudience;
  icon: string;
  preset: "private_chat" | "public_chat";
  joinRule: "invite" | "public";
  encrypted: boolean;
};

export const OWN_SPACE: SpaceTemplate = { id: "own", icon: "2728", rooms: ["general"] };

export const SPACE_TEMPLATES: SpaceTemplate[] = [
  { id: "gaming", icon: "1f3ae", rooms: ["general", "clips-and-highlights", "looking-for-group"] },
  { id: "friends", icon: "1f465", rooms: ["general", "memes", "plans"] },
  { id: "study", icon: "1f4da", rooms: ["general", "homework-help", "resources"] },
  { id: "club", icon: "1f3eb", rooms: ["announcements", "general", "events"] },
];

export const SPACE_AUDIENCES: AudiencePreset[] = [
  { id: "friends", icon: "1f46b", preset: "private_chat", joinRule: "invite", encrypted: true },
  { id: "community", icon: "1f30d", preset: "public_chat", joinRule: "public", encrypted: false },
];

export const DEFAULT_AUDIENCE: SpaceAudience = "friends";
