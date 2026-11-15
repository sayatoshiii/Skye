export type EmbedMatch = {
  provider: string;
  name: string;
  src: string;
  portrait: boolean;
  referrerPolicy: ReferrerPolicy;
};

type Provider = {
  id: string;
  name: string;
  hosts: string[];
  portrait?: boolean;
  referrerPolicy?: ReferrerPolicy;
  build: (url: URL) => string | null;
};

const segment = (url: URL, index: number) =>
  url.pathname.split("/").filter(Boolean)[index];

const safeId = (value: string | null | undefined) =>
  value && /^[\w-]+$/.test(value) ? value : null;

const youtube = (id: string | null, start?: string | null) =>
  id
    ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&origin=${encodeURIComponent(location.origin)}${start && /^\d+$/.test(start) ? `&start=${start}` : ""}`
    : null;

export const EMBED_PROVIDERS: Provider[] = [
  {
    id: "youtube",
    name: "YouTube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"],
    referrerPolicy: "strict-origin",
    build: (url) => {
      const start = url.searchParams.get("t")?.replace(/s$/, "");
      if (url.hostname === "youtu.be") return youtube(safeId(segment(url, 0)), start);
      if (url.pathname === "/watch") return youtube(safeId(url.searchParams.get("v")), start);
      if (["shorts", "live", "embed"].includes(segment(url, 0) ?? "")) return youtube(safeId(segment(url, 1)), start);
      return null;
    },
  },
  {
    id: "youtube_shorts",
    name: "YouTube Shorts",
    hosts: [],
    portrait: true,
    referrerPolicy: "strict-origin",
    build: () => null,
  },
  {
    id: "tiktok",
    name: "TikTok",
    hosts: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
    portrait: true,
    build: (url) => {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1` : null;
    },
  },
  {
    id: "instagram",
    name: "Instagram",
    hosts: ["instagram.com", "www.instagram.com"],
    portrait: true,
    build: (url) => {
      const kind = segment(url, 0);
      const id = safeId(segment(url, 1));
      return id && ["p", "reel", "reels", "tv"].includes(kind ?? "")
        ? `https://www.instagram.com/${kind === "reels" ? "reel" : kind}/${id}/embed/`
        : null;
    },
  },
  {
    id: "twitter",
    name: "X",
    hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
    build: (url) => {
      const id = url.pathname.match(/\/status\/(\d+)\/video\//)?.[1];
      return id ? `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true` : null;
    },
  },
  {
    id: "bluesky",
    name: "Bluesky",
    hosts: ["bsky.app"],
    build: () => null,
  },
  {
    id: "vimeo",
    name: "Vimeo",
    hosts: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
    build: (url) => {
      const id = url.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1` : null;
    },
  },
  {
    id: "twitch",
    name: "Twitch",
    hosts: ["clips.twitch.tv", "twitch.tv", "www.twitch.tv", "m.twitch.tv"],
    build: (url) => {
      const slug =
        url.hostname === "clips.twitch.tv"
          ? segment(url, 0)
          : segment(url, 1) === "clip" ? segment(url, 2) : null;
      return safeId(slug)
        ? `https://clips.twitch.tv/embed?clip=${slug}&parent=${encodeURIComponent(location.hostname)}&autoplay=true`
        : null;
    },
  },
  {
    id: "streamable",
    name: "Streamable",
    hosts: ["streamable.com", "www.streamable.com"],
    build: (url) => {
      const id = safeId(segment(url, 0) === "e" ? segment(url, 1) : segment(url, 0));
      return id ? `https://streamable.com/e/${id}?autoplay=1` : null;
    },
  },
  {
    id: "reddit",
    name: "Reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com"],
    build: (url) => {
      const path = url.pathname.match(/^\/r\/\w+\/comments\/\w+(?:\/[\w-]*)?/)?.[0];
      return path ? `https://embed.reddit.com${path}/?embed=true` : null;
    },
  },
];

export const findEmbed = (href: string): EmbedMatch | null => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const provider = EMBED_PROVIDERS.find((entry) => entry.hosts.includes(url.hostname.toLowerCase()));
  const src = provider?.build(url);
  if (!provider || !src) return null;

  const shorts = provider.id === "youtube" && segment(url, 0) === "shorts";
  const effective = shorts ? EMBED_PROVIDERS.find((entry) => entry.id === "youtube_shorts")! : provider;

  return {
    provider: provider.id,
    name: effective.name,
    src,
    portrait: !!effective.portrait,
    referrerPolicy: effective.referrerPolicy ?? "no-referrer",
  };
};

export const EMBED_ALLOW = "fullscreen; picture-in-picture; encrypted-media; autoplay";
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";
