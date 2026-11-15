export const DEFAULT_HOMESERVER = "matrix.org";

export const PENDING_SSO_HOMESERVER_KEY = "skye:sso-homeserver";

export const ROUTES = {
  app: "/app",
  login: "/account/login",
} as const;

export const MEDIA = {
  inlineImageTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"],
  inlineVideoTypes: ["video/mp4", "video/webm"],
  inlineAudioTypes: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm", "audio/wav"],
  thumbnail: { width: 800, height: 600, quality: 0.8 },
  jpegQuality: 0.92,
  display: { width: 400, height: 320 },
  stickerSize: 160,
  lazyMargin: "600px 0px",
  probeTimeout: 8000,
  fallbackUploadLimit: 50 * 1024 * 1024,
  maxPreviewLinks: 2,
  previewCacheSize: 200,
  filenameLength: 120,
} as const;

export const SETTINGS_STORAGE_KEY = "skye:media-settings";
export const BROWSE_STORAGE_KEY = "skye:browse-settings";

export const BROWSE_SEGMENT = "browse";
