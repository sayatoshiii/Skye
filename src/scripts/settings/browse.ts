import { writable } from "svelte/store";
import { BROWSE_STORAGE_KEY } from "./config";

export type BrowseSettings = {
  introDismissed: boolean;
};

const defaults = (): BrowseSettings => ({ introDismissed: false });

const load = (): BrowseSettings => {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(BROWSE_STORAGE_KEY) ?? "{}") };
  } catch {
    return defaults();
  }
};

export const browseSettings = writable<BrowseSettings>(
  typeof localStorage === "undefined" ? defaults() : load(),
);

browseSettings.subscribe((value) => {
  try {
    localStorage.setItem(BROWSE_STORAGE_KEY, JSON.stringify(value));
  } catch {}
});

export const dismissBrowseIntro = () =>
  browseSettings.update((current) => ({ ...current, introDismissed: true }));
