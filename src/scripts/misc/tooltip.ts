export type TooltipPlacement = "top" | "bottom" | "left" | "right";
export type TooltipOptions = string | null | undefined | { text?: string | null; placement?: TooltipPlacement };

const DELAY = 400;
const WARM = 300;
const MARGIN = 8;
const GAP = 8;

let bubble: HTMLDivElement | null = null;
let label: HTMLSpanElement | null = null;
let owner: HTMLElement | null = null;
let timer = 0;
let hiddenAt = 0;
let counter = 0;

const ensure = () => {
  if (bubble) return bubble;
  bubble = document.createElement("div");
  bubble.className = "tooltip";
  bubble.id = "skye-tooltip";
  bubble.setAttribute("role", "tooltip");
  label = document.createElement("span");
  bubble.appendChild(label);
  document.body.appendChild(bubble);
  return bubble;
};

const fits = (rect: DOMRect, width: number, height: number, side: TooltipPlacement) => {
  if (side === "top") return rect.top - GAP - height >= MARGIN;
  if (side === "bottom") return rect.bottom + GAP + height <= innerHeight - MARGIN;
  if (side === "left") return rect.left - GAP - width >= MARGIN;
  return rect.right + GAP + width <= innerWidth - MARGIN;
};

const flips: Record<TooltipPlacement, TooltipPlacement[]> = {
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "right", "left"],
  left: ["left", "right", "top", "bottom"],
  right: ["right", "left", "top", "bottom"],
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const place = (node: HTMLElement, preferred: TooltipPlacement) => {
  const element = ensure();
  const rect = node.getBoundingClientRect();
  const { width, height } = element.getBoundingClientRect();
  const side = flips[preferred].find((option) => fits(rect, width, height, option)) ?? preferred;
  const vertical = side === "top" || side === "bottom";
  const x = vertical
    ? clamp(rect.left + rect.width / 2 - width / 2, MARGIN, innerWidth - MARGIN - width)
    : side === "left"
      ? rect.left - GAP - width
      : rect.right + GAP;
  const y = vertical
    ? side === "top"
      ? rect.top - GAP - height
      : rect.bottom + GAP
    : clamp(rect.top + rect.height / 2 - height / 2, MARGIN, innerHeight - MARGIN - height);
  const arrow = vertical ? rect.left + rect.width / 2 - x : rect.top + rect.height / 2 - y;
  element.dataset.side = side;
  element.style.setProperty("--tooltip-x", `${Math.round(x)}px`);
  element.style.setProperty("--tooltip-y", `${Math.round(y)}px`);
  element.style.setProperty("--tooltip-arrow", `${Math.round(clamp(arrow, 10, (vertical ? width : height) - 10))}px`);
};

const show = (node: HTMLElement, text: string, placement: TooltipPlacement) => {
  const element = ensure();
  owner = node;
  label!.textContent = text;
  element.classList.remove("open");
  element.classList.add("measure");
  place(node, placement);
  element.classList.remove("measure");
  void element.offsetWidth;
  element.classList.add("open");
};

const hide = (node: HTMLElement) => {
  clearTimeout(timer);
  if (owner !== node) return;
  owner = null;
  hiddenAt = performance.now();
  bubble?.classList.remove("open");
};

const normalise = (options: TooltipOptions) =>
  typeof options === "object" && options
    ? { text: options.text ?? "", placement: options.placement ?? "top" }
    : { text: options ?? "", placement: "top" as TooltipPlacement };

export const tooltip = (node: HTMLElement, options: TooltipOptions) => {
  let { text, placement } = normalise(options);
  const id = `skye-tooltip-${++counter}`;
  const description = document.createElement("span");
  description.id = id;
  description.hidden = true;
  description.textContent = text;
  node.appendChild(description);

  const sync = () => {
    description.textContent = text;
    const labelled = node.getAttribute("aria-label");
    if (text && labelled !== text) node.setAttribute("aria-describedby", id);
    else node.removeAttribute("aria-describedby");
  };
  sync();

  const schedule = () => {
    if (!text) return;
    clearTimeout(timer);
    const warm = owner !== null || performance.now() - hiddenAt < WARM;
    if (warm) show(node, text, placement);
    else timer = window.setTimeout(() => show(node, text, placement), DELAY);
  };

  const enter = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    schedule();
  };
  const leave = () => hide(node);
  const focus = () => {
    if (node.matches(":focus-visible")) schedule();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide(node);
  };

  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("pointerdown", leave);
  node.addEventListener("focus", focus);
  node.addEventListener("blur", leave);
  node.addEventListener("keydown", key);

  return {
    update: (next: TooltipOptions) => {
      ({ text, placement } = normalise(next));
      sync();
      if (owner !== node) return;
      if (!text) hide(node);
      else show(node, text, placement);
    },
    destroy: () => {
      hide(node);
      description.remove();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointerdown", leave);
      node.removeEventListener("focus", focus);
      node.removeEventListener("blur", leave);
      node.removeEventListener("keydown", key);
    },
  };
};
