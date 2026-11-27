import type { TransitionConfig } from "svelte/transition";
import { fluid, prefersReducedMotion, readDuration } from "../../components/auth/motion";

export type HazeOptions = { blur?: number; scale?: number; y?: number; delay?: number; duration?: number; easing?: (t: number) => number };

export const haze = (_node: Element, { blur = 12, scale = 0.98, y = 0, delay = 0, duration, easing = fluid }: HazeOptions = {}): TransitionConfig => ({
  delay,
  duration: prefersReducedMotion() ? 0 : (duration ?? readDuration("--azure-duration-glide", 520)),
  easing,
  css: (t, u) => `opacity: ${t}; filter: blur(${u * blur}px); translate: 0 ${u * y}px; scale: ${1 - u * (1 - scale)};`,
});

export const roll = (node: Element, { y = 16, ...options }: HazeOptions = {}): TransitionConfig => haze(node, { blur: 3, scale: 0.7, duration: 420, y, ...options });

export const drift = (node: HTMLElement, options: HazeOptions = {}): TransitionConfig => {
  const { top, left, width, height } = node.getBoundingClientRect();
  const parent = (node.offsetParent ?? node.parentElement)!.getBoundingClientRect();
  Object.assign(node.style, { position: "absolute", top: `${top - parent.top}px`, left: `${left - parent.left}px`, width: `${width}px`, height: `${height}px` });
  return haze(node, options);
};
