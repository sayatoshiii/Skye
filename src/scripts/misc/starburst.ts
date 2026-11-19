import { reducedMotion, springFrames } from "./spring";

const COLOURS = ["#ffd56b", "#b58cff", "#ff8fc8", "#ffc83d", "#8fb8ff", "#d9a8ff", "#ffe9a8", "#ff9fe0"];
const FLUID = "cubic-bezier(0.32, 0.72, 0, 1)";

const burst = (node: HTMLElement) => {
  const rect = node.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  Array.from({ length: 8 }, (_, at) => {
    const spark = document.createElement("span");
    const angle = (at / 8) * Math.PI * 2 - Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    const reach = 24 + Math.random() * 8;
    const size = 8 + (at % 2) * 2;
    spark.style.cssText = `position:fixed;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;pointer-events:none;z-index:2147483647;background:${COLOURS[at]};filter:blur(0.3px);box-shadow:0 0 8px ${COLOURS[at]}88`;
    document.body.append(spark);
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    spark.animate([{ transform: "translate(0, 0) scale(0.4)" }, { transform: `translate(${dx}px, ${dy}px) scale(1)`, offset: 0.45 }, { transform: `translate(${dx * 1.12}px, ${dy * 1.12}px) scale(0.6)` }], { duration: 1100, delay: 120, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" });
    spark
      .animate([{ opacity: 0 }, { opacity: 0.95, offset: 0.08 }, { opacity: 0.95, offset: 0.4 }, { opacity: 0 }], { duration: 1100, delay: 120, easing: "cubic-bezier(0.33, 0, 0.67, 1)", fill: "backwards" })
      .finished.finally(() => spark.remove());
  });
};

const press = (icon: Element, to: number) => icon.animate([{ transform: "scale(1)" }, { transform: `scale(${to})` }], { duration: 120, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }).finished;

const release = (icon: Element, from: number, velocity: number, damping: number) => {
  const { duration, frames } = springFrames(0.45, damping, velocity, (value) => ({ transform: `scale(${from + (1 - from) * value})` }));
  icon.getAnimations().forEach((animation) => animation.cancel());
  icon.animate(frames, { duration, easing: "linear" });
};

export const starburst = (node: HTMLElement, on: boolean) => {
  let last = on;
  return {
    update: (next: boolean) => {
      if (next === last) return;
      last = next;
      const icon = node.querySelector("svg") ?? node;
      if (reducedMotion()) return;
      icon.getAnimations().forEach((animation) => animation.cancel());
      next
        ? (press(icon, 0.85).then(() => release(icon, 0.85, 43, 0.62), () => undefined), burst(node))
        : press(icon, 0.88).then(() => release(icon, 0.88, 0, 0.72), () => undefined);
    },
  };
};
