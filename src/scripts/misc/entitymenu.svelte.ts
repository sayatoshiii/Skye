import type { MenuItem } from "../../components/app/MessageMenu.svelte";
import { getLocalisedText } from "../accessibility/language/translation";
import { longpress } from "./longpress";

type Build = (() => MenuItem[]) | undefined;

export const entityMenu = $state<{ request: { items: MenuItem[]; x: number; y: number } | null }>({ request: null });

export const entityText = (...path: string[]) => getLocalisedText(undefined, "entity_menu", ...path) as string;

export const openEntityMenu = (items: MenuItem[], x: number, y: number) => {
  if (entityMenu.request || !items.length) return;
  entityMenu.request = { items, x, y };
};

export const menu = (node: HTMLElement, build: Build) => {
  let current = build;
  const open = (x: number, y: number) => current && openEntityMenu(current(), x, y);
  const oncontextmenu = (event: MouseEvent) => {
    const items = event.defaultPrevented ? [] : (current?.() ?? []);
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    openEntityMenu(items, event.clientX, event.clientY);
  };
  const press = longpress(node, open);
  node.dataset.entityMenu = "";
  node.addEventListener("contextmenu", oncontextmenu);

  return {
    update: (next: Build) => (current = next),
    destroy: () => {
      press.destroy();
      node.removeEventListener("contextmenu", oncontextmenu);
    },
  };
};

type Resolve = (target: Element) => MenuItem[] | undefined;

export const delegate = (node: HTMLElement, resolve: Resolve) => {
  let current = resolve;
  const oncontextmenu = (event: MouseEvent) => {
    const items = !event.defaultPrevented && event.target instanceof Element ? (current(event.target) ?? []) : [];
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    openEntityMenu(items, event.clientX, event.clientY);
  };
  const press = longpress(node, (x, y) => {
    const target = document.elementFromPoint(x, y);
    const items = target && node.contains(target) ? (current(target) ?? []) : [];
    openEntityMenu(items, x, y);
  });
  node.addEventListener("contextmenu", oncontextmenu);

  return {
    update: (next: Resolve) => (current = next),
    destroy: () => {
      press.destroy();
      node.removeEventListener("contextmenu", oncontextmenu);
    },
  };
};
