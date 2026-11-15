import { writable } from "svelte/store";
import type { MediaSource } from "../matrix/utilities/media";

export type LightboxItem = { source: MediaSource; mimetype: string; name: string; w?: number; h?: number };

export const lightbox = writable<LightboxItem | null>(null);
