export type Pt = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };
export type Brush = "pen" | "marker" | "highlighter" | "eraser";
export type ShapeKind = "rect" | "ellipse" | "line" | "arrow" | "step";
export type Align = "left" | "center" | "right";
export type FontId = "sans" | "serif" | "mono" | "hand" | "impact";

export type Stroke = { id: number; kind: "stroke"; brush: Exclude<Brush, "eraser">; colour: string; size: number; opacity: number; points: Pt[] };
export type BlurMode = "blur" | "pixelate";
export type Blur = { id: number; kind: "blur"; size: number; mode: BlurMode; strength: number; points: Pt[] };
export type Shape = { id: number; kind: "rect" | "ellipse" | "line" | "arrow"; a: Pt; b: Pt; colour: string; width: number; fill: boolean; fillOpacity?: number; dashed: boolean; shadow: boolean };
export type Step = { id: number; kind: "step"; at: Pt; colour: string; size: number };
export type Text = { id: number; kind: "text"; at: Pt; value: string; colour: string; font: FontId; size: number; bold: boolean; italic: boolean; underline: boolean; align: Align; background: boolean; backgroundColour?: string };
export type Obj = Stroke | Blur | Shape | Step | Text;

export const FONTS: Record<FontId, { label: string; css: string }> = {
  sans: { label: "Montserrat", css: "Montserrat, sans-serif" },
  serif: { label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  mono: { label: "Mono", css: "ui-monospace, 'Cascadia Code', monospace" },
  hand: { label: "Handwritten", css: "'Comic Neue', 'Comic Sans MS', cursive" },
  impact: { label: "Impact", css: "Impact, 'Anton', 'Arial Black', sans-serif" },
};

export const COLOURS = ["#ffffff", "#111318", "#ff5a6e", "#ff9c3f", "#ffd23f", "#5ad18a", "#3aa0ff", "#b07aff"];

const LINE = 1.25;
let measureCtx: CanvasRenderingContext2D | null = null;
const measurer = () => (measureCtx ??= document.createElement("canvas").getContext("2d")!);

export const fontOf = (o: Text) => `${o.italic ? "italic " : ""}${o.bold ? 700 : 500} ${o.size}px ${FONTS[o.font].css}`;

export const light = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
};

const textBox = (o: Text) => {
  const ctx = measurer();
  ctx.font = fontOf(o);
  const lines = (o.value || " ").split("\n");
  const widths = lines.map((line) => ctx.measureText(line).width);
  const w = Math.max(...widths, o.size * 0.5);
  const h = lines.length * o.size * LINE;
  const x = o.align === "left" ? o.at[0] : o.align === "center" ? o.at[0] - w / 2 : o.at[0] - w;
  return { lines, widths, rect: { x, y: o.at[1], w, h } };
};

const pad = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + n * 2, h: r.h + n * 2 });

const span = (points: Pt[]): Rect => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

export const bounds = (o: Obj): Rect =>
  o.kind === "stroke" || o.kind === "blur" ? pad(span(o.points), o.size / 2)
  : o.kind === "step" ? { x: o.at[0] - o.size, y: o.at[1] - o.size, w: o.size * 2, h: o.size * 2 }
  : o.kind === "text" ? pad(textBox(o).rect, o.background ? o.size * 0.3 : 0)
  : pad(span([o.a, o.b]), o.width / 2);

const segment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

export const hit = (o: Obj, p: Pt, slop: number) => {
  if (o.kind === "line" || o.kind === "arrow") return segment(p, o.a, o.b) <= o.width / 2 + slop;
  if (o.kind === "stroke" || o.kind === "blur") return o.points.some((q, i) => segment(p, o.points[i - 1] ?? q, q) <= o.size / 2 + slop);
  const r = pad(bounds(o), slop);
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
};

export const move = (o: Obj, dx: number, dy: number) => {
  const shift = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  if (o.kind === "stroke" || o.kind === "blur") o.points = o.points.map(shift);
  else if (o.kind === "step" || o.kind === "text") o.at = shift(o.at);
  else [o.a, o.b] = [shift(o.a), shift(o.b)];
};

export const mapPoints = (o: Obj, map: (p: Pt) => Pt) => {
  if (o.kind === "stroke" || o.kind === "blur") o.points = o.points.map(map);
  else if (o.kind === "step" || o.kind === "text") o.at = map(o.at);
  else [o.a, o.b] = [map(o.a), map(o.b)];
};

const path = (ctx: CanvasRenderingContext2D, points: Pt[]) => {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  if (points.length === 1) return ctx.lineTo(points[0][0] + 0.01, points[0][1]);
  for (let i = 1; i < points.length - 1; i++) ctx.quadraticCurveTo(points[i][0], points[i][1], (points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2);
  ctx.lineTo(...points[points.length - 1]);
};

const blurCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

const obscured = (base: HTMLCanvasElement, mode: BlurMode, strength: number) => {
  const cache = blurCache.get(base) ?? new Map<string, HTMLCanvasElement>();
  blurCache.set(base, cache);
  const key = `${mode}:${strength}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const amount = (Math.max(base.width, base.height) / 1000) * strength;
  const out = Object.assign(document.createElement("canvas"), { width: base.width, height: base.height });
  const ctx = out.getContext("2d")!;
  if (mode === "blur") {
    ctx.filter = `blur(${amount * 0.4}px)`;
    const edge = amount * 1.2;
    ctx.drawImage(base, -edge, -edge, base.width + edge * 2, base.height + edge * 2);
  } else {
    const block = Math.max(2, amount * 0.6);
    const small = Object.assign(document.createElement("canvas"), { width: Math.ceil(base.width / block), height: Math.ceil(base.height / block) });
    small.getContext("2d")!.drawImage(base, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, out.width, out.height);
  }
  cache.size > 12 && cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
};

export const draw = (ctx: CanvasRenderingContext2D, o: Obj, base: HTMLCanvasElement, number = 0) => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (o.kind === "blur") {
    ctx.beginPath();
    o.points.forEach((p, i) => {
      const prev = o.points[i - 1] ?? p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / (o.size / 4)));
      for (let s = 1; s <= steps; s++) {
        const x = prev[0] + ((p[0] - prev[0]) * s) / steps;
        const y = prev[1] + ((p[1] - prev[1]) * s) / steps;
        ctx.moveTo(x + o.size / 2, y);
        ctx.arc(x, y, o.size / 2, 0, Math.PI * 2);
      }
    });
    ctx.clip();
    ctx.drawImage(obscured(base, o.mode ?? "pixelate", o.strength ?? 30), 0, 0);
  }

  if (o.kind === "stroke") {
    ctx.globalAlpha = o.brush === "highlighter" ? o.opacity * 0.45 : o.opacity;
    ctx.lineCap = o.brush === "highlighter" ? "square" : "round";
    ctx.strokeStyle = o.colour;
    ctx.lineWidth = o.size;
    path(ctx, o.points);
    ctx.stroke();
  }

  if (o.kind === "rect" || o.kind === "ellipse" || o.kind === "line" || o.kind === "arrow") {
    const [ax, ay] = o.a;
    const [bx, by] = o.b;
    ctx.strokeStyle = o.colour;
    ctx.fillStyle = `${o.colour}${Math.round((o.fillOpacity ?? 25) * 2.55).toString(16).padStart(2, "0")}`;
    ctx.lineWidth = o.width;
    o.dashed && ctx.setLineDash([o.width * 2.5, o.width * 2]);
    o.shadow && Object.assign(ctx, { shadowColor: "rgb(0 0 0 / 0.45)", shadowBlur: o.width * 3, shadowOffsetY: o.width });
    ctx.beginPath();
    if (o.kind === "rect") ctx.roundRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), Math.min(o.width * 1.5, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2));
    if (o.kind === "ellipse") ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
    if (o.kind === "line" || o.kind === "arrow") {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    if (o.fill && (o.kind === "rect" || o.kind === "ellipse")) ctx.fill();
    ctx.stroke();
    if (o.kind === "arrow") {
      const angle = Math.atan2(by - ay, bx - ax);
      const head = Math.min(Math.max(o.width * 4, 10), Math.hypot(bx - ax, by - ay) * 0.6);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bx - head * Math.cos(angle - 0.5), by - head * Math.sin(angle - 0.5));
      ctx.lineTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(angle + 0.5), by - head * Math.sin(angle + 0.5));
      ctx.stroke();
    }
  }

  if (o.kind === "step") {
    Object.assign(ctx, { shadowColor: "rgb(0 0 0 / 0.35)", shadowBlur: o.size * 0.4, shadowOffsetY: o.size * 0.08 });
    ctx.fillStyle = o.colour;
    ctx.beginPath();
    ctx.arc(o.at[0], o.at[1], o.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = o.size * 0.14;
    ctx.strokeStyle = light(o.colour) ? "#111318" : "#ffffff";
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `700 ${o.size * (number > 9 ? 0.85 : 1.05)}px Montserrat, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), o.at[0], o.at[1] + o.size * 0.06);
  }

  if (o.kind === "text") {
    const { lines, widths, rect } = textBox(o);
    if (o.background) {
      ctx.fillStyle = o.backgroundColour ?? o.colour;
      ctx.beginPath();
      ctx.roundRect(...(Object.values(pad(rect, o.size * 0.3)) as [number, number, number, number]), o.size * 0.3);
      ctx.fill();
    }
    ctx.font = fontOf(o);
    ctx.fillStyle = o.background && !o.backgroundColour ? (light(o.colour) ? "#111318" : "#ffffff") : o.colour;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.textAlign = o.align;
    ctx.textBaseline = "middle";
    o.background || Object.assign(ctx, { shadowColor: "rgb(0 0 0 / 0.35)", shadowBlur: o.size * 0.15, shadowOffsetY: o.size * 0.04 });
    lines.forEach((line, i) => {
      const y = o.at[1] + o.size * LINE * (i + 0.5);
      ctx.fillText(line, o.at[0], y);
      if (!o.underline || !widths[i]) return;
      const left = o.align === "left" ? o.at[0] : o.align === "center" ? o.at[0] - widths[i] / 2 : o.at[0] - widths[i];
      ctx.lineWidth = Math.max(1, o.size * 0.07);
      ctx.beginPath();
      ctx.moveTo(left, y + o.size * 0.55);
      ctx.lineTo(left + widths[i], y + o.size * 0.55);
      ctx.stroke();
    });
  }

  ctx.restore();
};

export const drawAll = (ctx: CanvasRenderingContext2D, objects: Obj[], base: HTMLCanvasElement, skip?: number) => {
  let step = 0;
  for (const o of objects) {
    o.kind === "step" && step++;
    o.id !== skip && draw(ctx, o, base, step);
  }
};

export const transformed = (source: CanvasImageSource, w: number, h: number, turn: boolean) => {
  const out = Object.assign(document.createElement("canvas"), { width: turn ? h : w, height: turn ? w : h });
  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  turn ? ctx.rotate(Math.PI / 2) : ctx.scale(-1, 1);
  ctx.drawImage(source, -w / 2, -h / 2);
  return out;
};

export const fitRatio = (w: number, h: number, ratio: number | null): Rect => {
  if (!ratio) return { x: 0, y: 0, w, h };
  const cw = Math.min(w, h * ratio);
  const ch = cw / ratio;
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
};

export const EDITABLE = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/avif"];

export const render = async (base: HTMLCanvasElement, crop: Rect, objects: Obj[], file: File) => {
  const out = Object.assign(document.createElement("canvas"), { width: Math.round(crop.w), height: Math.round(crop.h) });
  const ctx = out.getContext("2d")!;
  ctx.translate(-crop.x, -crop.y);
  ctx.drawImage(base, 0, 0);
  drawAll(ctx, objects, base);
  const type = ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? file.type : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("render failed");
  const name = type === file.type ? file.name : file.name.replace(/\.[^.]+$/, "") + ".png";
  return new File([blob], name, { type, lastModified: Date.now() });
};
