import { get } from "svelte/store";
import type { MenuItem } from "../../components/app/MessageMenu.svelte";
import { getLocalisedText } from "../accessibility/language/translation";
import { session } from "../stores/matrix";
import { setUserVolume, toggleUserMute, volumeOf } from "../stores/voice";
import { MENU_ICONS } from "./icons";

const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

export const volumeItems = (userId: string): MenuItem[] =>
  [userId]
    .filter((id) => id !== get(session)?.userId)
    .flatMap((id) => [
      {
        id: "voice-volume",
        label: text("volume"),
        icon: MENU_ICONS.volume,
        separated: true,
        slider: { value: Math.round(volumeOf(id).volume * 100), min: 0, max: 200, step: 5, format: (value: number) => `${value}%`, input: (value: number) => setUserVolume(id, value / 100) },
        run: () => undefined,
      },
      {
        id: "voice-local-mute",
        label: text(volumeOf(id).muted ? "unmute_local" : "mute_local"),
        icon: volumeOf(id).muted ? MENU_ICONS.volume : MENU_ICONS.mute,
        selected: volumeOf(id).muted,
        run: () => toggleUserMute(id),
      },
    ]);
