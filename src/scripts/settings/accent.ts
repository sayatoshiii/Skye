export const ACCENT_STORAGE_KEY = "skye:accent";

export const accentPresets = {
  sky: "#3aa0ff",
  pink: "#de1073",
  cyan: "#22c3d6",
  turquoise: "#1fbfa5",
} as const;

export type AccentPreset = keyof typeof accentPresets;

export const DEFAULT_ACCENT = accentPresets.sky;

export const isHexColour = (value: string) =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

export const getAccent = () => {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return stored && isHexColour(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
};

export const applyAccent = (colour: string) =>
  document.documentElement.style.setProperty("--colours-accent", colour);

export const setAccent = (colour: string) => {
  if (!isHexColour(colour)) return false;

  applyAccent(colour);

  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, colour);
  } catch {}

  return true;
};

export const getAccentPreset = (colour: string) =>
  (Object.entries(accentPresets).find(
    ([, value]) => value.toLowerCase() === colour.toLowerCase(),
  )?.[0] as AccentPreset | undefined) ?? "custom";
