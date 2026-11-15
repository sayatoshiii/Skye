const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export const formatAgo = (milliseconds: number, units = UNITS) => {
  const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: "auto" });
  const seconds = Math.round(milliseconds / 1000);
  const [unit, size] = units.find(([, size]) => seconds >= size) ?? ["second", 1];
  return formatter.format(-Math.round(seconds / size), unit);
};
