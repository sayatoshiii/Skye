import { writable } from "svelte/store";
import { getLocalisedText } from "../accessibility/language/translation";

export type ToastIcon = "copy" | "link" | "id" | "pin" | "unpin" | "check" | "trash" | "save" | "hide" | "show" | "leave";
export type ToastTone = "danger" | "success" | "accent" | "neutral";
export type Toast = { id: number; text: string; icon: ToastIcon; tone: ToastTone };

export const currentToast = writable<Toast | null>(null);

let count = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export const toast = (text: string, { icon = "check", tone = "neutral" }: { icon?: ToastIcon; tone?: ToastTone } = {}) => {
  clearTimeout(timer);
  currentToast.set({ id: ++count, text, icon, tone });
  timer = setTimeout(() => currentToast.set(null), 1800);
};

export const toastKey = (key: string, options?: { icon?: ToastIcon; tone?: ToastTone }) =>
  toast(getLocalisedText(undefined, "toast", key) as string, options);

const fallbackCopy = (value: string) => {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, value.length);
  const ok = document.execCommand("copy");
  area.remove();
  return ok ? Promise.resolve() : Promise.reject();
};

export const writeClipboard = (value: string) =>
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(value).catch(() => fallbackCopy(value)) : fallbackCopy(value);

export const copied = (value: string, key = "copied", icon: ToastIcon = "copy") =>
  writeClipboard(value).then(() => toastKey(key, { icon }), () => undefined);
