import { get, writable } from "svelte/store";
import { SETTINGS_STORAGE_KEY } from "./config";

export type MediaSettings = {
  linkPreviews: Record<string, boolean>;
  alwaysAllowEmbeds: Record<string, boolean>;
  keepImageMetadata: boolean;
};

const defaults = (): MediaSettings => ({
  linkPreviews: {},
  alwaysAllowEmbeds: {},
  keepImageMetadata: false,
});

const load = (): MediaSettings => {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}");
    return { ...defaults(), ...stored };
  } catch {
    return defaults();
  }
};

export const mediaSettings = writable<MediaSettings>(
  typeof localStorage === "undefined" ? defaults() : load(),
);

mediaSettings.subscribe((value) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  } catch {}
});

const patch = (change: (current: MediaSettings) => Partial<MediaSettings>) =>
  mediaSettings.update((current) => ({ ...current, ...change(current) }));

export const linkPreviewsEnabled = (
  settings: MediaSettings,
  roomId: string,
  encrypted: boolean,
) => settings.linkPreviews[roomId] ?? !encrypted;

export const setLinkPreviews = (roomId: string, enabled: boolean) =>
  patch((current) => ({
    linkPreviews: { ...current.linkPreviews, [roomId]: enabled },
  }));

export const setAlwaysAllowEmbed = (provider: string, allowed: boolean) =>
  patch((current) => ({
    alwaysAllowEmbeds: { ...current.alwaysAllowEmbeds, [provider]: allowed },
  }));

export const setKeepImageMetadata = (keep: boolean) =>
  patch(() => ({ keepImageMetadata: keep }));

export const getMediaSettings = () => get(mediaSettings);
