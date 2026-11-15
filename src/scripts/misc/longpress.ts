const LONG_PRESS = 480;
const SLOP = 10;

export const longpress = (node: HTMLElement, onpress: (x: number, y: number) => void) => {
  let handler = onpress;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin = { x: 0, y: 0 };
  let fired = false;

  const cancel = () => clearTimeout(timer);

  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    fired = false;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(10);
      handler(origin.x, origin.y);
    }, LONG_PRESS);
  };

  const move = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > SLOP) cancel();
  };

  const click = (event: MouseEvent) => {
    if (!fired) return;
    fired = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("click", click, true);

  return {
    update: (next: typeof onpress) => (handler = next),
    destroy: () => {
      cancel();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", cancel);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("click", click, true);
    },
  };
};
