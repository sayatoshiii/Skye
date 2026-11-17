export const zoomable = (node: HTMLElement, enabled: boolean) => {
  let on = enabled;
  let scale = 1;
  let x = 0;
  let y = 0;
  let drag: { x: number; y: number } | null = null;
  let moved = false;
  const apply = () => (node.style.setProperty("--zoom", String(scale)), node.style.setProperty("--pan-x", `${x}px`), node.style.setProperty("--pan-y", `${y}px`), node.classList.toggle("zoomed", scale > 1));
  const clamp = () => {
    const limitX = (node.clientWidth * (scale - 1)) / 2;
    const limitY = (node.clientHeight * (scale - 1)) / 2;
    x = Math.max(-limitX, Math.min(limitX, x));
    y = Math.max(-limitY, Math.min(limitY, y));
  };
  const wheel = (event: WheelEvent) => {
    if (!on) return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const next = Math.min(5, Math.max(1, scale * Math.exp(-event.deltaY * 0.0015)));
    const cx = event.clientX - rect.left - rect.width / 2;
    const cy = event.clientY - rect.top - rect.height / 2;
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
    clamp();
    apply();
  };
  const down = (event: PointerEvent) => void (on && scale > 1 && event.button === 0 && ((drag = { x: event.clientX - x, y: event.clientY - y }), (moved = false), node.classList.add("dragging")));
  const move = (event: PointerEvent) => {
    if (!drag) return;
    moved ||= Math.abs(event.clientX - drag.x - x) + Math.abs(event.clientY - drag.y - y) > 3;
    moved && !node.hasPointerCapture(event.pointerId) && node.setPointerCapture(event.pointerId);
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    clamp();
    apply();
  };
  const up = () => ((drag = null), node.classList.remove("dragging"));
  const click = (event: MouseEvent) => void (moved && (event.stopPropagation(), (moved = false)));
  const reset = () => ((scale = 1), (x = 0), (y = 0), apply());
  node.addEventListener("wheel", wheel, { passive: false });
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
  node.addEventListener("click", click, true);
  return {
    update: (next: boolean) => void ((on = next), !on && reset()),
    destroy: () => {
      node.removeEventListener("wheel", wheel);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("click", click, true);
    },
  };
};
