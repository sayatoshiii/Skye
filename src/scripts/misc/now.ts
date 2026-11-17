import { readable } from "svelte/store";

export const now = readable(Date.now(), (set) => {
  const timer = setInterval(() => set(Date.now()), 30000);
  return () => clearInterval(timer);
});
