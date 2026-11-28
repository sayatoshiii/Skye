import type { MenuItem } from "../../components/app/MessageMenu.svelte";

export type MenuEntry<Key extends string> = {
  key: Key;
  group: string;
  when?: boolean;
  optional?: boolean;
  item: () => MenuItem | MenuItem[];
};

export type MenuExtra<Key extends string> = { after?: Key | "start"; items: MenuItem[] };

export type MenuOptions<Key extends string> = {
  omit?: Key[];
  only?: Key[];
  enable?: Key[];
  extra?: MenuExtra<Key>[];
};

const extras = <Key extends string>(extra: MenuExtra<Key>[], anchor: Key | "start") => extra.filter((part) => part.after === anchor).flatMap((part) => part.items);

export const compose = <Key extends string>(entries: MenuEntry<Key>[], { omit = [], only, enable = [], extra = [] }: MenuOptions<Key> = {}): MenuItem[] => {
  const kept = entries.filter((entry) => entry.when !== false && (!entry.optional || enable.includes(entry.key)) && !omit.includes(entry.key) && (!only || only.includes(entry.key)));
  const keys = new Set<string>(kept.map((entry) => entry.key));
  const head = extras(extra, "start");
  const body = kept.flatMap((entry, index) => {
    const items = [entry.item()].flat();
    const fresh = index > 0 && kept[index - 1].group !== entry.group;
    return [...items.map((item, position) => (position ? item : { ...item, separated: fresh || item.separated })), ...extras(extra, entry.key)];
  });
  const tail = extra.filter((part) => part.after !== "start" && !(part.after && keys.has(part.after))).flatMap((part) => part.items);
  const separate = (items: MenuItem[], before: boolean) => items.map((item, index) => (index || !before ? item : { ...item, separated: item.separated ?? true }));
  return [...head, ...separate(body, head.length > 0), ...separate(tail, head.length + body.length > 0)];
};
