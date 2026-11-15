import { MEDIA } from "../settings/config";

let observer: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();

const getObserver = () =>
  (observer ??= new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer?.unobserve(entry.target);
        callbacks.get(entry.target)?.();
        callbacks.delete(entry.target);
      }),
    { rootMargin: MEDIA.lazyMargin },
  ));

export const nearViewport = (node: Element, onvisible: () => void) => {
  callbacks.set(node, onvisible);
  getObserver().observe(node);

  return {
    destroy: () => {
      callbacks.delete(node);
      observer?.unobserve(node);
    },
  };
};
