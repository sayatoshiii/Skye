import type { TransitionConfig } from "svelte/transition";

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export const readDuration = (token: string, fallback: number) => {
  if (prefersReducedMotion()) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.endsWith("ms") ? parsed : parsed * 1000;
};

export const fluid = (t: number) => {
  const p = 1 - t;
  return 1 - p * p * p * p;
};

export const reveal = (
  node: Element,
  { delay = 0, distance = 8 }: { delay?: number; distance?: number } = {},
): TransitionConfig => {
  const style = getComputedStyle(node);
  const height = parseFloat(style.height);
  const paddingTop = parseFloat(style.paddingTop);
  const paddingBottom = parseFloat(style.paddingBottom);
  const marginTop = parseFloat(style.marginTop);
  const marginBottom = parseFloat(style.marginBottom);
  const opacity = +style.opacity;

  return {
    delay,
    duration: readDuration("--azure-duration-glide", 520),
    easing: fluid,
    css: (t, u) =>
      `overflow: hidden;` +
      `height: ${t * height}px;` +
      `padding-top: ${t * paddingTop}px;` +
      `padding-bottom: ${t * paddingBottom}px;` +
      `margin-top: ${t * marginTop}px;` +
      `margin-bottom: ${t * marginBottom}px;` +
      `opacity: ${Math.min(1, t * 1.6) * opacity};` +
      `transform: translateY(${u * distance}px);`,
  };
};

export const lift = (
  node: Element,
  { direction = 1, blur = 6 }: { direction?: 1 | -1; blur?: number } = {},
): TransitionConfig => ({
  duration: readDuration("--azure-duration-slow", 420),
  easing: fluid,
  css: (t, u) =>
    `opacity: ${t};` +
    `transform: translateY(${u * direction * 0.6}em);` +
    `filter: blur(${u * blur}px);`,
});
