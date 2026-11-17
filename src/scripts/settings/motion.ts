export const MOTION_STORAGE_KEY = "skye:motion";

export const systemReducesMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const getMotionChoice = () => {
  try {
    return localStorage.getItem(MOTION_STORAGE_KEY) === "reduce";
  } catch {
    return false;
  }
};

export const reducesMotion = () =>
  systemReducesMotion() ||
  (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce");

export const setMotionChoice = (reduce: boolean) => {
  if (reduce) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  try {
    if (reduce) localStorage.setItem(MOTION_STORAGE_KEY, "reduce");
    else localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {}
};
