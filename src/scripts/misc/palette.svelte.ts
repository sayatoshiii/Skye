import { getMediaLink, isMxc } from "../matrix/utilities/media";

const SIZE = 24;
const vivid = (r: number, g: number, b: number) => {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const hue = !delta ? 0 : max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  const light = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  return `hsl(${Math.round((hue * 60 + 360) % 360)} ${Math.round(clamp(saturation, delta ? 0.45 : 0, 0.9) * 100)}% ${Math.round(clamp(light, 0.55, 0.7) * 100)}%)`;
};

const cache = new Map<string, Promise<string | null>>();

const channel = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

const luminance = (colour: string) => {
  const [hue, saturation, light] = (colour.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
  const [s, l] = [saturation / 100, light / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return 0.2126 * channel(f(0)) + 0.7152 * channel(f(8)) + 0.0722 * channel(f(4));
};

export const inkFor = (colour: string) => (1.05 / (luminance(colour) + 0.05) >= 2.5 ? "white" : "var(--colours-background)");

const measure = (link: string) =>
  new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SIZE, SIZE);
        const { data } = context.getImageData(0, 0, SIZE, SIZE);
        let red = 0;
        let green = 0;
        let blue = 0;
        let total = 0;
        for (let index = 0; index < data.length; index += 4) {
          const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (a < 128 || max < 40 || min > 225) continue;
          const saturation = max ? (max - min) / max : 0;
          const weight = saturation * saturation + 0.02;
          red += r * weight;
          green += g * weight;
          blue += b * weight;
          total += weight;
        }
        resolve(total ? vivid(red / total, green / total, blue / total) : null);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = link;
  });

const colourOf = (key: string, link: () => Promise<string | undefined>) => {
  let entry = cache.get(key);
  if (!entry) {
    entry = link().then((resolved) => (resolved ? measure(resolved) : null)).catch(() => null);
    cache.set(key, entry);
  }
  return entry;
};

export const profileColour = async (avatar?: string, banner?: string) => {
  if (banner) {
    const colour = await colourOf(banner, async () => banner);
    if (colour) return colour;
  }
  if (isMxc(avatar)) return colourOf(avatar, () => getMediaLink(avatar));
  return avatar?.startsWith("blob:") ? colourOf(avatar, async () => avatar) : null;
};

export const profileTint = (source: () => { avatar?: string; banner?: string }) => {
  let colour = $state<string | null>(null);

  $effect(() => {
    const { avatar, banner } = source();
    let live = true;
    void profileColour(avatar, banner).then((value) => live && (colour = value));
    return () => {
      live = false;
    };
  });

  return {
    get colour() {
      return colour;
    },
    get ink() {
      return colour ? inkFor(colour) : undefined;
    },
    get glow() {
      return colour ? `color-mix(in oklab, ${colour} 55%, transparent)` : undefined;
    },
  };
};
