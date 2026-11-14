export type MockRoom = {
  id: string;
  alias?: string;
  name: string;
  topic?: string;
  avatar?: string;
  isDirect?: boolean;
  directUserId?: string;
  directJoined?: boolean;
  createdAt?: number;
  unread?: number;
  mentions?: number;
};

export type MockSpace = {
  id: string;
  alias?: string;
  name: string;
  topic?: string;
  avatar?: string;
  children: (MockSpace | string)[];
};

export type MockMember = {
  userId: string;
  displayName: string;
  avatar?: string;
  presence: "online" | "unavailable" | "offline";
  powerLevel: number;
};

export type MockMessage = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  ts: number;
};

const minutes = (count: number) => count * 60 * 1000;
const now = Date.now();

export const members: MockMember[] = [
  {
    userId: "@yumeko:skye.chat",
    displayName: "Yumeko",
    avatar: "/test/avatar/avatar_1.jpg",
    presence: "online",
    powerLevel: 100,
  },
  {
    userId: "@kirari:skye.chat",
    displayName: "Kirari",
    presence: "online",
    powerLevel: 50,
  },
  {
    userId: "@mary:skye.chat",
    displayName: "Mary",
    presence: "unavailable",
    powerLevel: 0,
  },
  {
    userId: "@ryota:skye.chat",
    displayName: "Ryota",
    presence: "online",
    powerLevel: 0,
  },
  {
    userId: "@itsuki:skye.chat",
    displayName: "Itsuki",
    presence: "offline",
    powerLevel: 0,
  },
  {
    userId: "@midari:skye.chat",
    displayName: "Midari",
    presence: "offline",
    powerLevel: 0,
  },
];

export const rooms: MockRoom[] = [
  {
    id: "!welcome:skye.chat", alias: "#welcome:skye.chat",
    name: "welcome",
    topic: "Say hi, read the rules, touch grass.",
  },
  {
    id: "!general:skye.chat", alias: "#general:skye.chat",
    name: "general",
    topic: "Anything goes. Mostly.",
    unread: 3,
  },
  {
    id: "!memes:skye.chat", alias: "#memes:skye.chat",
    name: "memes",
    topic: "Quality not guaranteed.",
    mentions: 1,
  },
  {
    id: "!frontend:skye.chat", alias: "#frontend:skye.chat",
    name: "frontend",
    topic: "Astro, Svelte and pixel pushing.",
  },
  {
    id: "!matrix:skye.chat", alias: "#matrix:skye.chat",
    name: "matrix-sdk",
    topic: "mxc pain and suffering.",
  },
  { id: "!lounge:skye.chat", alias: "#lounge:skye.chat", name: "lounge", topic: "Chill zone." },
  { id: "!art:skye.chat", alias: "#art:skye.chat", name: "art", topic: "Show us what you made." },
  { id: "!music:skye.chat", alias: "#music:skye.chat", name: "music", topic: "Now playing." },
  { id: "!dm-kirari:skye.chat", name: "Kirari", isDirect: true, directUserId: "@kirari:skye.chat", unread: 1 },
  { id: "!dm-mary:skye.chat", name: "Mary", isDirect: true, directUserId: "@mary:skye.chat" },
];

export const spaces: MockSpace[] = [
  {
    id: "!skye:skye.chat", alias: "#skye:skye.chat",
    name: "Skye",
    topic: "The Skye development space.",
    avatar: "/test/avatar/avatar_1.jpg",
    children: [
      {
        id: "!skye-info:skye.chat", alias: "#skye-info:skye.chat",
        name: "Information",
        children: ["!welcome:skye.chat"],
      },
      {
        id: "!skye-chat:skye.chat", alias: "#skye-chat:skye.chat",
        name: "Chat",
        children: ["!general:skye.chat", "!memes:skye.chat"],
      },
      {
        id: "!skye-dev:skye.chat", alias: "#skye-dev:skye.chat",
        name: "Development",
        children: ["!frontend:skye.chat", "!matrix:skye.chat"],
      },
    ],
  },
  {
    id: "!hangout:skye.chat", alias: "#hangout:skye.chat",
    name: "Hangout",
    children: [
      "!lounge:skye.chat",
      {
        id: "!hangout-creative:skye.chat", alias: "#hangout-creative:skye.chat",
        name: "Creative",
        children: ["!art:skye.chat", "!music:skye.chat"],
      },
    ],
  },
];

const script: [string, string, number][] = [
  ["@kirari:skye.chat", "morning everyone", 190],
  ["@kirari:skye.chat", "did anyone get the new build running?", 189],
  ["@ryota:skye.chat", "yeah, the swipe panes feel really nice on my phone", 180],
  ["@yumeko:skye.chat", "pushed the azure tokens, accent picker is in the profile footer", 120],
  ["@yumeko:skye.chat", "pick pink if you have taste", 119],
  ["@yumeko:skye.chat", "or sky if you're boring", 118],
  ["@mary:skye.chat", "sky is the default for a reason", 60],
  ["@kirari:skye.chat", "turquoise gang", 12],
  ["@ryota:skye.chat", "cyan supremacy, no further questions", 3],
];

export const messages: MockMessage[] = rooms.flatMap((room) =>
  script.map(([sender, body, ago], index) => ({
    id: `${room.id}-${index}`,
    roomId: room.id,
    sender,
    body,
    ts: now - minutes(ago),
  })),
);

export const homeServerName = "skye.chat";

export const getRoom = (id?: string) => rooms.find((room) => room.id === id);

export const getSpace = (id?: string) =>
  spaces.find((space) => space.id === id);

export const getMember = (userId: string) =>
  members.find((member) => member.userId === userId);

export const getRoomMessages = (roomId?: string) =>
  messages.filter((message) => message.roomId === roomId);

export const getSpaceRoomIds = (space: MockSpace): string[] =>
  space.children.flatMap((child) =>
    typeof child === "string" ? [child] : getSpaceRoomIds(child),
  );

export const getDirectRooms = () => rooms.filter((room) => room.isDirect);
