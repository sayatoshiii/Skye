const TRAVEL = 3;
const FLOOR = 0.95;

const pressed = (event: PointerEvent) => {
  const target = (event.target as Element | null)?.closest?.("button, [role=\"button\"], .press");
  if (!(target instanceof HTMLElement)) return;
  const { width, height } = target.getBoundingClientRect();
  target.style.setProperty("--press", String(Math.max(FLOOR, 1 - TRAVEL / Math.max(width, height, 1))));
};

typeof document !== "undefined" && document.addEventListener("pointerdown", pressed, { capture: true, passive: true });
