export const ZOOM_EVENT = "skye:zoom";

export const zoomBy = (node: Element | null | undefined, factor: number) => node?.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: factor }));

const KEYS: Record<string, number> = { "+": 1.25, "=": 1.25, "-": 0.8, "0": 0 };

export const zoomable = (node: HTMLElement, enabled: boolean) => {
  let on = enabled;
  let scale = 1;
  let x = 0;
  let y = 0;
  let drag: { x: number; y: number } | null = null;
  let pinch: { distance: number; scale: number } | null = null;
  let moved = false;
  const pointers = new Map<number, { x: number; y: number }>();
  const apply = () => (node.style.setProperty("--zoom", String(scale)), node.style.setProperty("--pan-x", `${x}px`), node.style.setProperty("--pan-y", `${y}px`), node.classList.toggle("zoomed", scale > 1));
  const clamp = () => {
    const limitX = (node.clientWidth * (scale - 1)) / 2;
    const limitY = (node.clientHeight * (scale - 1)) / 2;
    x = Math.max(-limitX, Math.min(limitX, x));
    y = Math.max(-limitY, Math.min(limitY, y));
  };
  const zoomAt = (next: number, clientX: number, clientY: number) => {
    const rect = node.getBoundingClientRect();
    const bounded = Math.min(5, Math.max(1, next));
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    x = cx - ((cx - x) * bounded) / scale;
    y = cy - ((cy - y) * bounded) / scale;
    scale = bounded;
    clamp();
    apply();
  };
  const reset = () => ((scale = 1), (x = 0), (y = 0), apply());
  const step = (event: Event) => {
    if (!on) return;
    const factor = (event as CustomEvent<number>).detail;
    const rect = node.getBoundingClientRect();
    factor ? zoomAt(scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2) : reset();
  };
  const wheel = (event: WheelEvent) => void (on && (event.preventDefault(), zoomAt(scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX, event.clientY)));
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const down = (event: PointerEvent) => {
    if (!on || event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointers.size === 2 && ((pinch = { distance: spread().distance, scale }), (drag = null), (moved = true), node.setPointerCapture(event.pointerId));
    pointers.size === 1 && scale > 1 && ((drag = { x: event.clientX - x, y: event.clientY - y }), (moved = false), node.classList.add("dragging"));
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const now = spread();
      return zoomAt(pinch.scale * (now.distance / Math.max(pinch.distance, 1)), now.x, now.y);
    }
    if (!drag) return;
    moved ||= Math.abs(event.clientX - drag.x - x) + Math.abs(event.clientY - drag.y - y) > 3;
    moved && !node.hasPointerCapture(event.pointerId) && node.setPointerCapture(event.pointerId);
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    clamp();
    apply();
  };
  const up = (event: PointerEvent) => (pointers.delete(event.pointerId), pointers.size < 2 && (pinch = null), !pointers.size && ((drag = null), node.classList.remove("dragging")));
  const click = (event: MouseEvent) => void (moved && (event.stopPropagation(), (moved = false)));
  const key = (event: KeyboardEvent) => void (on && event.key in KEYS && zoomBy(node, KEYS[event.key]));
  const listeners = [
    [ZOOM_EVENT, step],
    ["wheel", wheel, { passive: false }],
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", up],
    ["keydown", key],
    ["click", click, true],
  ] as [string, EventListener, AddEventListenerOptions | boolean | undefined][];
  listeners.forEach(([name, handler, options]) => node.addEventListener(name, handler, options));
  return {
    update: (next: boolean) => void ((on = next), !on && reset()),
    destroy: () => listeners.forEach(([name, handler, options]) => node.removeEventListener(name, handler, options)),
  };
};
