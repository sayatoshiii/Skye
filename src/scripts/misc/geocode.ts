type Props = { name?: string; street?: string; housenumber?: string; locality?: string; district?: string; city?: string; county?: string; state?: string; country?: string };
type Feature = { properties: Props; geometry: { coordinates: [number, number] } };

const cache = new Map<string, Promise<string | null>>();
const SPACING = 600;
let queue: Promise<unknown> = Promise.resolve();

const language = () => (["en", "de", "fr", "it"].find((code) => navigator.language.startsWith(code)) ?? "en");

const request = (path: string, params: Record<string, string>) =>
  fetch(`https://photon.komoot.io/${path}?${new URLSearchParams({ lang: language(), ...params })}`).then((response) => (response.ok ? response.json() : Promise.reject())) as Promise<{ features?: Feature[] }>;

const photon = (path: string, params: Record<string, string>) => {
  const turn = queue.then(() => request(path, params));
  queue = turn.catch(() => undefined).then(() => new Promise((done) => setTimeout(done, SPACING)));
  return turn;
};

export const nameOf = ({ name, street, housenumber, locality, district, city, county, state, country }: Props) => {
  const road = street && [housenumber, street].filter(Boolean).join(" ");
  const area = city ?? locality ?? district ?? county ?? state;
  const parts = [name ?? road ?? locality, area, !name && !road && !area ? country : undefined].filter((part, index, all): part is string => !!part && all.indexOf(part) === index);
  return parts.length ? parts.join(", ") : (country ?? null);
};

const labelOf = (props: Props) => [nameOf(props), props.country].filter((part, index, all) => !!part && all.indexOf(part) === index).join(", ");

export const placeAt = (lat: number, long: number) => {
  const key = `${lat.toFixed(4)},${long.toFixed(4)}`;
  const found = cache.get(key) ?? photon("reverse", { lat: String(lat), lon: String(long), limit: "1" }).then((value) => (value.features?.[0] ? nameOf(value.features[0].properties) : null), () => (cache.delete(key), null));
  cache.set(key, found);
  return found;
};

export const searchPlaces = (query: string) =>
  photon("api", { q: query, limit: "5" })
    .then((value) => (value.features ?? []).map(({ properties, geometry }) => ({ lat: geometry.coordinates[1], long: geometry.coordinates[0], label: labelOf(properties), name: nameOf(properties) ?? labelOf(properties) })))
    .catch(() => []);
