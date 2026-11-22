import { readable, writable } from "svelte/store";
import { getLocalisedText } from "../accessibility/language/translation";

const KEY = "skye.plainDates";
const DAY = 86400000;

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export const plainDates = writable(typeof localStorage === "undefined" ? false : read());

plainDates.subscribe((value) => {
  try {
    typeof localStorage !== "undefined" && (value ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY));
  } catch {}
});

export const clock = readable(Date.now(), (set) => {
  const timer = setInterval(() => set(Date.now()), 60000);
  return () => clearInterval(timer);
});

const text = (key: string) => getLocalisedText(undefined, "when", key) as string;
const fill = (key: string, values: Record<string, string | number> = {}) => Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text(key));

const time = (ts: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ts);
const weekday = (ts: number) => new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(ts);
const midnight = (ts: number) => new Date(new Date(ts).setHours(0, 0, 0, 0)).getTime();

export const exactDate = (ts: number) =>
  `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(ts)}, ${time(ts)}`;

const fancy = (plain: boolean, word: string, count: number, unit: "days" | "weeks" | "months" | "years") => (plain ? fill(unit, { n: count }) : text(word));

const label = (ts: number, plain: boolean, now: number) => {
  const days = Math.round((midnight(now) - midnight(ts)) / DAY);
  const months = Math.floor((now - ts) / (DAY * 30.44));
  const years = Math.floor((now - ts) / (DAY * 365.25));
  if (days <= 0) return fill("today", { time: time(ts) });
  if (days === 1) return fill("yesterday", { time: time(ts) });
  if (days === 2 && !plain) return fill("ereyesterday", { time: time(ts) });
  if (days < 7) return fill("weekday", { day: weekday(ts), time: time(ts) });
  if (days < 14) return text("week");
  if (days < 21) return fancy(plain, "fortnight", 2, "weeks");
  if (days < 30 || months < 1) return fill("weeks", { n: 3 });
  if (months < 2) return text("month");
  if (months < 3) return fill("months", { n: months });
  if (months < 5) return fancy(plain, "trimester", months, "months");
  if (months < 6) return fancy(plain, "semester", months, "months");
  if (months < 7) return text("half_year");
  if (years < 1) return fill("months", { n: months });
  if (years < 2) return text("year");
  if (years < 5) return fancy(plain, "biennium", years, "years");
  if (years < 10) return fancy(plain, "quinquennium", years, "years");
  if (years < 20) return text("decade");
  if (years < 25) return fancy(plain, "score", years, "years");
  if (years < 50) return text("quarter_century");
  if (years < 100) return text("half_century");
  if (years < 1000) return text("century");
  return text("millennium");
};

export const whenLabel = (ts: number, plain = false, now = Date.now()) => {
  const out = label(ts, plain, now);
  return out.charAt(0).toUpperCase() + out.slice(1);
};

export const isFancy = (ts: number, now = Date.now()) => whenLabel(ts, false, now) !== whenLabel(ts, true, now);
