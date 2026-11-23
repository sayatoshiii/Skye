<script lang="ts" module>
  import type { Obj as EditorObj, Rect as EditorRect } from "../../../scripts/misc/image-editor";
  export type EditorSession = { history: { base: HTMLCanvasElement; crop: EditorRect; objects: EditorObj[] }[]; index: number; unit: number; nextId: number; ratio: string };
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly, slide } from "svelte/transition";
  import ColourPicker from "../../ui/ColourPicker.svelte";
  import { cubicOut } from "svelte/easing";
  import { tooltip } from "../../../scripts/misc/tooltip";
  import { portal } from "../../../scripts/misc/portal";
  import { dismissible } from "../../../scripts/misc/dismiss.svelte";
  import { openEntityMenu } from "../../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import { sanitiseFilename, formatBytes } from "../../../scripts/matrix/utilities/attachments";
  import LoadingDots from "../../ui/LoadingDots.svelte";
  import { COLOURS, FONTS, light, bounds, drawAll, fitRatio, hit, mapPoints, move, render, transformed, type Align, type BlurMode, type Brush, type FontId, type Obj, type Pt, type Rect, type Shape, type ShapeKind, type Text } from "../../../scripts/misc/image-editor";

  type Props = { file: File; session?: EditorSession; onsave: (file: File, session: EditorSession) => void; onclose: () => void };
  let { file, session, onsave, onclose }: Props = $props();

  type Tool = "select" | "hand" | "crop" | "draw" | "text" | "shapes" | "blur";
  type Entry = { base: HTMLCanvasElement; crop: Rect; objects: Obj[] };
  type Drag =
    | { kind: "pan"; x: number; y: number }
    | { kind: "eyedrop" }
    | { kind: "paint"; o: Obj & { points: Pt[] } }
    | { kind: "erase"; changed: boolean }
    | { kind: "create"; o: Shape }
    | { kind: "move"; o: Obj; last: Pt; moved: boolean }
    | { kind: "handle"; o: Shape; end: "a" | "b" }
    | { kind: "crop"; mode: string; start: Pt; from: Rect };

  const text = (key: string) => getLocalisedText(undefined, "image_editor", key) as string;

  const I = {
    close: "M6 6l12 12M18 6 6 18",
    chev: "m6 9 6 6 6-6",
    bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
    left: "M4 6h16M4 10h10M4 14h16M4 18h10",
    center: "M4 6h16M7 10h10M4 14h16M7 18h10",
    right: "M4 6h16M10 10h10M4 14h16M10 18h10",
    background: "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM8 15l4-8 4 8M9.5 12.5h5",
    pen: "M16 3l5 5L8 21H3v-5zM13 6l5 5",
    marker: "M14 4l6 6-8 8H8l-2-2v-4zM6 16l-3 5h6",
    highlighter: "M9 11l-6 6v3h3l6-6M9 11l4-4 4 4-4 4zM13 7l3-3 4 4-3 3",
    eraser: "M7 20h12M5 15l9-9a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-8 8H8zM9 11l5 5",
    rotate: "M20 9a8 8 0 1 0-1 7M20 4v5h-5",
    flip: "M12 3v18M9 7 4 17h5zM15 7l5 10h-5z",
    rect: "M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    ellipse: "M4 12a8 6 0 1 0 16 0a8 6 0 1 0-16 0",
    line: "M5 19 19 5",
    arrow: "M5 19 19 5M10 5h9v9",
    step: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M10.5 9.5 12.5 8v8",
    fill: "M5 5h14v14H5zM5 12l7-7M5 19 19 5M12 19l7-7",
    dashed: "M4 12h3M10.5 12h3M17 12h3",
    shadow: "M6 4h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h10a2 2 0 0 0 2-2V8",
    select: "M5 3l14 7.5-6.2 1.7L10 18.5z",
    forward: "M12 20V8M7 13l5-5 5 5M5 4h14",
    backward: "M12 4v12M7 11l5 5 5-5M5 20h14",
    hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 6.5a1.5 1.5 0 0 1 3 0V12M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14.2a1.5 1.5 0 0 1 2.4-1.8L8 14",
    crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
    draw: "M16 3l5 5L8 21H3v-5zM13 6l5 5",
    text: "M5 6V4h14v2M12 4v16M9 20h6",
    shapes: "M5 11h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM11 8a5 5 0 1 0 10 0a5 5 0 1 0-10 0",
    blur: "M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12zM9 15h.01M12 12h.01M15 15h.01M12 18h.01",
    undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
    redo: "m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
    minus: "M6 12h12",
    plus: "M12 6v12M6 12h12",
    eyedrop: "M19 5a2.8 2.8 0 0 0-4 0l-2 2-1-1-1.5 1.5 6 6L18 12l-1-1 2-2a2.8 2.8 0 0 0 0-4zM12.5 9.5 5 17v2h2l7.5-7.5",
    delete: "M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
    fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  };

  const TOOLS: Tool[] = ["select", "hand", "crop", "draw", "text", "shapes", "blur"];
  const BRUSHES: Brush[] = ["pen", "marker", "highlighter", "eraser"];
  const BRUSH_SIZE = { pen: 4, marker: 12, highlighter: 26, eraser: 0 };
  const SHAPES: ShapeKind[] = ["rect", "ellipse", "line", "arrow", "step"];
  const TEXT_SIZES = [16, 24, 32, 48, 64, 96, 128];
  const RATIOS: [string, number | null | "original"][] = [["free", null], ["original", "original"], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["9:16", 9 / 16]];
  const SHAPE_KINDS = ["rect", "ellipse", "line", "arrow", "step"];

  let tool: Tool = $state("draw");
  let base: HTMLCanvasElement | null = $state.raw(null);
  let crop: Rect = $state.raw({ x: 0, y: 0, w: 1, h: 1 });
  let objects: Obj[] = [];
  let history: Entry[] = $state.raw([]);
  let index = $state(0);
  let rev = $state(0);
  let selected: number | null = $state(null);
  let editing: number | null = $state(null);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let ratio: string = $state("free");
  let brush: Brush = $state("pen");
  let pen = $state({ colour: COLOURS[2], size: 4, opacity: 1 });
  let type = $state({ colour: "#ffffff", font: "sans" as FontId, size: 48, bold: true, italic: false, underline: false, align: "center" as Align, background: false, backgroundColour: "#111318" });
  let shape: ShapeKind = $state("arrow");
  let ink = $state({ colour: COLOURS[2], width: 6, fill: false, fillOpacity: 25, dashed: false, shadow: true, step: 22 });
  let blurSize = $state(40);
  let blurMode: BlurMode = $state("blur");
  let blurStrength = $state(30);
  let pop: string | null = $state(null);
  let custom = $state(false);
  let dropping = $state(false);
  let saving = $state(false);
  let failed = $state(false);
  let cursor = $state("");
  let spaceHeld = $state(false);
  let unit = 1;
  let nextId = 1;
  let result: File | null = null;
  let editValue = "";

  let canvas: HTMLCanvasElement | undefined = $state();
  let frameEl: HTMLDivElement | undefined = $state();
  let textField: HTMLTextAreaElement | undefined = $state();
  let frame = $state.raw({ x: 0, y: 0, w: 1, h: 1 });
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  const exit = dismissible(() => (result ? onsave(result, { history, index, unit, nextId, ratio }) : onclose()));
  const name = $derived(sanitiseFilename(file.name));
  const sel = $derived.by(() => {
    void rev;
    const id = selected;
    return objects.find((o) => o.id === id);
  });
  const editingObj = $derived.by(() => {
    void rev;
    const id = editing;
    return objects.find((o) => o.id === id) as Text | undefined;
  });
  const ratioValue = $derived.by(() => {
    const value = RATIOS.find(([id]) => id === ratio)?.[1] ?? null;
    return value === "original" ? (base ? base.width / base.height : null) : value;
  });

  const mod = getLocalisedText(undefined, "format", /Mac|iPhone|iPad/.test(navigator.userAgent) ? "mod_mac" : "mod") as string;
  const tip = (label: string, ...keys: string[]) => (keys.length ? `${label} ${keys.map((key) => `[[${key === "mod" ? mod : key}]]`).join(" ")}` : label);
  const TOOL_KEYS: Record<Tool, string> = { select: "V", hand: "H", crop: "C", draw: "D", text: "T", shapes: "S", blur: "B" };

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const snapshot = (): Entry => ({ base: base!, crop, objects: structuredClone(objects) });

  const commit = () => {
    history = [...history.slice(0, index + 1), snapshot()].slice(-100);
    index = history.length - 1;
    rev++;
  };

  const restore = (entry: Entry) => {
    base = entry.base;
    crop = entry.crop;
    objects = structuredClone(entry.objects);
    selected = editing = null;
    rev++;
  };

  const undo = () => index > 0 && restore(history[--index]);
  const redo = () => index < history.length - 1 && restore(history[++index]);
  const reset = () => history.length > 1 && (restore(history[0]), commit());

  onMount(() => {
    if (session) {
      ({ history, index, unit, nextId, ratio } = session);
      return restore(history[index]);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      unit = Math.max(img.naturalWidth, img.naturalHeight) / 1000;
      base = canvas;
      crop = { x: 0, y: 0, w: canvas.width, h: canvas.height };
      history = [snapshot()];
      URL.revokeObjectURL(url);
    };
    img.onerror = () => ((failed = true), URL.revokeObjectURL(url));
    img.src = url;
  });

  const region = (): Rect => (tool === "crop" && base ? { x: 0, y: 0, w: base.width, h: base.height } : crop);

  const view = () => {
    const r = region();
    const s = Math.min(frame.w / r.w, frame.h / r.h) * zoom;
    return { r, s, ox: frame.x + frame.w / 2 - (r.w * s) / 2 + panX, oy: frame.y + frame.h / 2 - (r.h * s) / 2 + panY };
  };

  const toBase = (x: number, y: number): Pt => {
    const v = view();
    return [(x - v.ox) / v.s + v.r.x, (y - v.oy) / v.s + v.r.y];
  };

  const toScreen = (p: Pt): Pt => {
    const v = view();
    return [(p[0] - v.r.x) * v.s + v.ox, (p[1] - v.r.y) * v.s + v.oy];
  };

  let raf = 0;
  const paint = () => (raf ||= requestAnimationFrame(() => ((raf = 0), paintNow())));

  const paintNow = () => {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !base) return;
    const dpr = devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const v = view();
    const k = 1 / v.s;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * (v.ox - v.r.x * v.s), dpr * (v.oy - v.r.y * v.s));
    ctx.imageSmoothingQuality = "high";

    const clip = tool === "crop" ? { x: 0, y: 0, w: base.width, h: base.height } : crop;
    ctx.save();
    Object.assign(ctx, { shadowColor: "rgb(0 0 0 / 0.5)", shadowBlur: 40 * dpr, shadowOffsetY: 12 * dpr, fillStyle: "#000" });
    ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.drawImage(base, 0, 0);
    drawAll(ctx, objects, base, editing ?? undefined);
    ctx.restore();

    if (tool === "crop") {
      const { x, y, w: cw, h: ch } = crop;
      ctx.fillStyle = "rgb(0 0 0 / 0.55)";
      ctx.beginPath();
      ctx.rect(0, 0, base.width, base.height);
      ctx.rect(x, y, cw, ch);
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgb(255 255 255 / 0.35)";
      ctx.lineWidth = k;
      ctx.beginPath();
      [1, 2].forEach((n) => {
        ctx.moveTo(x + (cw * n) / 3, y);
        ctx.lineTo(x + (cw * n) / 3, y + ch);
        ctx.moveTo(x, y + (ch * n) / 3);
        ctx.lineTo(x + cw, y + (ch * n) / 3);
      });
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 * k;
      ctx.strokeRect(x, y, cw, ch);
      const len = Math.min(22 * k, cw / 3, ch / 3);
      ctx.lineWidth = 4 * k;
      ctx.lineCap = "round";
      ctx.beginPath();
      [[x, y, 1, 1], [x + cw, y, -1, 1], [x, y + ch, 1, -1], [x + cw, y + ch, -1, -1]].forEach(([cx, cy, dx, dy]) => {
        ctx.moveTo(cx + dx * len, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * len);
      });
      ctx.stroke();
    }

    if (sel && editing !== sel.id) {
      const b = bounds(sel);
      ctx.strokeStyle = "#3aa0ff";
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([4 * k, 4 * k]);
      if (sel.kind !== "line" && sel.kind !== "arrow") ctx.strokeRect(b.x - 6 * k, b.y - 6 * k, b.w + 12 * k, b.h + 12 * k);
      ctx.setLineDash([]);
      if ("a" in sel)
        [sel.a, sel.b].forEach((p) => {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 6 * k, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.stroke();
        });
    }
  };

  $effect(() => {
    void [tool, zoom, panX, panY, frame, crop, base, selected, editing, rev, innerWidth, innerHeight];
    paint();
  });

  $effect(() => {
    if (!frameEl) return;
    const node = frameEl;
    const measure = () => {
      const r = node.getBoundingClientRect();
      frame = { x: r.left, y: r.top, w: Math.max(1, r.width), h: Math.max(1, r.height) };
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(node);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!canvas) return;
    const node = canvas;
    node.addEventListener("wheel", onwheel, { passive: false });
    return () => node.removeEventListener("wheel", onwheel);
  });

  $effect(() => {
    addEventListener("keydown", onkeydown, true);
    addEventListener("keyup", onkeyup, true);
    return () => (removeEventListener("keydown", onkeydown, true), removeEventListener("keyup", onkeyup, true));
  });

  $effect(() => () => (cancelAnimationFrame(raf), cancelAnimationFrame(tween)));

  let tween = 0;

  const glide = (to: { zoom: number; panX: number; panY: number }) => {
    cancelAnimationFrame(tween);
    const from = { zoom, panX, panY };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 200);
      const e = 1 - Math.pow(1 - t, 4);
      zoom = from.zoom + (to.zoom - from.zoom) * e;
      panX = from.panX + (to.panX - from.panX) * e;
      panY = from.panY + (to.panY - from.panY) * e;
      tween = t < 1 ? requestAnimationFrame(step) : 0;
    };
    tween = requestAnimationFrame(step);
  };

  let target = { zoom: 1, panX: 0, panY: 0 };

  const zoomTo = (next: number, cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2, smooth = true) => {
    const base = smooth && tween ? target : { zoom, panX, panY };
    const r = region();
    const fitScale = Math.min(frame.w / r.w, frame.h / r.h);
    const s0 = fitScale * base.zoom;
    const ox = frame.x + frame.w / 2 - (r.w * s0) / 2 + base.panX;
    const oy = frame.y + frame.h / 2 - (r.h * s0) / 2 + base.panY;
    const z = clamp(next, 0.25, 8);
    const s = fitScale * z;
    const p = [(cx - ox) / s0, (cy - oy) / s0];
    target = { zoom: z, panX: cx - p[0] * s - frame.x - frame.w / 2 + (r.w * s) / 2, panY: cy - p[1] * s - frame.y - frame.h / 2 + (r.h * s) / 2 };
    if (smooth) return glide(target);
    cancelAnimationFrame(tween);
    tween = 0;
    ({ zoom, panX, panY } = target);
  };

  const fit = (smooth = true) => {
    target = { zoom: 1, panX: 0, panY: 0 };
    smooth ? glide(target) : (cancelAnimationFrame(tween), (tween = 0), (zoom = 1), (panX = 0), (panY = 0));
  };

  const onwheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.shiftKey) return void (halt(), (panX -= event.deltaY || event.deltaX), (target = { zoom, panX, panY }));
    const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomTo(zoom * Math.exp(-step * 0.0015), event.clientX, event.clientY, false);
  };

  const syncFrom = (o: Obj) => {
    if (o.kind === "text") type = { colour: o.colour, font: o.font, size: Math.round(o.size / unit), bold: o.bold, italic: o.italic, underline: o.underline, align: o.align, background: o.background, backgroundColour: o.backgroundColour ?? (light(o.colour) ? "#111318" : "#ffffff") };
    if (o.kind === "step") ((shape = "step"), (ink.colour = o.colour), (ink.step = Math.round(o.size / unit)));
    if ("a" in o) ((shape = o.kind), (ink = { ...ink, colour: o.colour, width: Math.round(o.width / unit), fill: o.fill, fillOpacity: o.fillOpacity ?? 25, dashed: o.dashed, shadow: o.shadow }));
  };

  const select = (o?: Obj) => {
    selected = o?.id ?? null;
    o && syncFrom(o);
  };

  const applyText = (done = true) => {
    const o = sel?.kind === "text" ? sel : editingObj;
    if (!o) return;
    Object.assign(o, { ...type, size: type.size * unit });
    rev++;
    done && editing === null && commit();
    editing !== null && queueMicrotask(() => textField?.focus());
  };

  const applyInk = (done = true) => {
    if (!sel) return;
    if (sel.kind === "step") Object.assign(sel, { colour: ink.colour, size: ink.step * unit });
    else if ("a" in sel) Object.assign(sel, { colour: ink.colour, width: ink.width * unit, fill: ink.fill, fillOpacity: ink.fillOpacity, dashed: ink.dashed, shadow: ink.shadow });
    else return;
    rev++;
    done && commit();
  };

  const topHit = (p: Pt, kinds: string[]) => {
    const slop = 8 / view().s;
    return objects.findLast((o) => kinds.includes(o.kind) && hit(o, p, slop));
  };

  const layerAt = $derived.by(() => {
    void rev;
    const at = sel ? objects.indexOf(sel) : -1;
    return { top: at === objects.length - 1, bottom: at <= 0 };
  });

  const layer = (o: Obj, to: "forward" | "backward" | "front" | "back") => {
    const at = objects.indexOf(o);
    const next = to === "front" ? objects.length - 1 : to === "back" ? 0 : clamp(at + (to === "forward" ? 1 : -1), 0, objects.length - 1);
    if (at < 0 || next === at) return;
    objects.splice(at, 1);
    objects.splice(next, 0, o);
    commit();
  };

  const remove = (id: number) => {
    objects = objects.filter((o) => o.id !== id);
    selected === id && (selected = null);
    commit();
  };

  const startEdit = (o: Text) => {
    selected = editing = o.id;
    editValue = o.value;
    syncFrom(o);
    requestAnimationFrame(() => textField?.focus());
  };

  const finishEdit = () => {
    const o = editingObj;
    editing = null;
    if (!o) return;
    if (!o.value.trim()) return void ((objects = objects.filter((x) => x.id !== o.id)), (selected = null), rev++, editValue && commit());
    commit();
  };

  const setTool = (next: Tool) => {
    if (next === tool) return;
    finishEdit();
    selected = null;
    pop = null;
    (next === "crop" || tool === "crop") && fit(false);
    tool = next;
  };

  const setRatio = (id: string) => {
    ratio = id;
    if (!base || !ratioValue) return;
    crop = fitRatio(base.width, base.height, ratioValue);
    commit();
  };

  const turn = (rotate: boolean) => {
    if (!base) return;
    const { width: W, height: H } = base;
    const map = (p: Pt): Pt => (rotate ? [H - p[1], p[0]] : [W - p[0], p[1]]);
    const a = map([crop.x, crop.y]);
    const b = map([crop.x + crop.w, crop.y + crop.h]);
    objects.forEach((o) => mapPoints(o, map));
    base = transformed(base, W, H, rotate);
    crop = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    rotate && ratio !== "free" && ratio !== "original" && (ratio = RATIOS.find(([, value]) => typeof value === "number" && Math.abs(value - crop.w / crop.h) < 0.01)?.[0] ?? "free");
    commit();
  };

  const cropMode = (p: Pt, slop: number) => {
    const { x, y, w, h } = crop;
    const inX = p[0] > x - slop && p[0] < x + w + slop;
    const inY = p[1] > y - slop && p[1] < y + h + slop;
    const mode = (Math.abs(p[1] - y) < slop && inX ? "n" : "") + (Math.abs(p[1] - y - h) < slop && inX ? "s" : "") + (Math.abs(p[0] - x) < slop && inY ? "w" : "") + (Math.abs(p[0] - x - w) < slop && inY ? "e" : "");
    if (mode && !(ratioValue && mode.length === 1)) return mode;
    return p[0] > x && p[0] < x + w && p[1] > y && p[1] < y + h ? "move" : null;
  };

  const CURSORS: Record<string, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", move: "move" };

  const resizeCrop = (mode: string, from: Rect, dx: number, dy: number) => {
    if (!base) return;
    const { width: W, height: H } = base;
    const min = Math.max(16, unit * 24);
    if (mode === "move") return void (crop = { ...from, x: clamp(from.x + dx, 0, W - from.w), y: clamp(from.y + dy, 0, H - from.h) });
    let [l, t, r, b] = [from.x, from.y, from.x + from.w, from.y + from.h];
    mode.includes("w") && (l = clamp(l + dx, 0, r - min));
    mode.includes("e") && (r = clamp(r + dx, l + min, W));
    mode.includes("n") && (t = clamp(t + dy, 0, b - min));
    mode.includes("s") && (b = clamp(b + dy, t + min, H));
    if (ratioValue) {
      let w = r - l;
      let h = w / ratioValue;
      const room = mode.includes("n") ? b : H - t;
      h > room && ((h = room), (w = h * ratioValue));
      mode.includes("w") ? (l = r - w) : (r = l + w);
      mode.includes("n") ? (t = b - h) : (b = t + h);
    }
    crop = { x: l, y: t, w: r - l, h: b - t };
  };

  let drag: Drag | null = null;
  const pointers = new Map<number, Pt>();
  let pinch: { distance: number; zoom: number; x: number; y: number } | null = null;

  const halt = () => (cancelAnimationFrame(tween), (tween = 0));

  const panDrag = (event: PointerEvent): Drag => ({ kind: "pan", x: event.clientX, y: event.clientY });

  const midpoint = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
  };

  const onpointerdown = (event: PointerEvent) => {
    if (!base || !canvas) return;
    event.preventDefault();
    if (eyedropping && event.button === 0) return void (canvas.setPointerCapture(event.pointerId), (drag = { kind: "eyedrop" }), eyedrop(event));
    pop = null;
    editing !== null && finishEdit();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);

    if (pointers.size === 2) {
      drag?.kind === "paint" && (objects = objects.filter((o) => o !== (drag as { o: Obj }).o));
      drag = null;
      const m = midpoint();
      pinch = { distance: m.distance, zoom, x: m.x, y: m.y };
      return;
    }
    halt();
    if (event.button === 1 || (event.button === 0 && (spaceHeld || tool === "hand"))) return void (drag = panDrag(event));
    if (event.button !== 0) return;

    const p = toBase(event.clientX, event.clientY);
    const slop = 8 / view().s;

    if (tool === "crop") {
      const mode = cropMode(p, slop * 1.5);
      return void (drag = mode ? { kind: "crop", mode, start: p, from: crop } : panDrag(event));
    }

    if (tool === "draw" && brush === "eraser") return void ((drag = { kind: "erase", changed: false }), erase(p));

    if (tool === "draw" || tool === "blur") {
      const o: Obj & { points: Pt[] } = tool === "blur" ? { id: nextId++, kind: "blur", size: blurSize * unit, mode: blurMode, strength: blurStrength, points: [p] } : { id: nextId++, kind: "stroke", brush: brush as Exclude<Brush, "eraser">, colour: pen.colour, size: pen.size * unit, opacity: pen.opacity, points: [p] };
      objects.push(o);
      drag = { kind: "paint", o };
      return paint();
    }

    if (tool === "text") {
      const o = topHit(p, ["text"]);
      if (o) return void (select(o), (drag = { kind: "move", o, last: p, moved: false }));
      if (selected !== null) return void (selected = null);
      const t: Text = { id: nextId++, kind: "text", at: [p[0], p[1] - (type.size * unit * 1.25) / 2], value: "", ...type, size: type.size * unit };
      objects.push(t);
      return startEdit(t);
    }

    if (tool === "select") {
      if (sel && "a" in sel) {
        const end = (["a", "b"] as const).find((key) => Math.hypot(sel[key][0] - p[0], sel[key][1] - p[1]) < slop * 1.5);
        if (end) return void (drag = { kind: "handle", o: sel, end });
      }
      const o = topHit(p, ["stroke", "blur", "text", ...SHAPE_KINDS]);
      return void (o ? (select(o), (drag = { kind: "move", o, last: p, moved: false })) : (selected = null));
    }

    if (sel && "a" in sel) {
      const end = (["a", "b"] as const).find((key) => Math.hypot(sel[key][0] - p[0], sel[key][1] - p[1]) < slop * 1.5);
      if (end) return void (drag = { kind: "handle", o: sel, end });
    }
    const o = topHit(p, SHAPE_KINDS);
    if (o) return void (select(o), (drag = { kind: "move", o, last: p, moved: false }));
    if (shape === "step") {
      const step: Obj = { id: nextId++, kind: "step", at: p, colour: ink.colour, size: ink.step * unit };
      objects.push(step);
      selected = step.id;
      return commit();
    }
    const created: Shape = { id: nextId++, kind: shape, a: p, b: p, colour: ink.colour, width: ink.width * unit, fill: ink.fill, fillOpacity: ink.fillOpacity, dashed: ink.dashed, shadow: ink.shadow };
    objects.push(created);
    selected = created.id;
    drag = { kind: "create", o: created };
  };

  const erase = (p: Pt) => {
    const o = topHit(p, ["stroke"]);
    if (!o || drag?.kind !== "erase") return;
    objects = objects.filter((x) => x !== o);
    drag.changed = true;
    paint();
  };

  const constrain = (a: Pt, b: Pt, kind: string): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (kind === "rect" || kind === "ellipse") {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return [a[0] + Math.sign(dx || 1) * size, a[1] + Math.sign(dy || 1) * size];
    }
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return [a[0] + Math.cos(angle) * length, a[1] + Math.sin(angle) * length];
  };

  const onpointermove = (event: PointerEvent) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pinch && pointers.size === 2) {
      const m = midpoint();
      zoomTo(pinch.zoom * (m.distance / pinch.distance), m.x, m.y, false);
      panX += m.x - pinch.x;
      panY += m.y - pinch.y;
      pinch.x = m.x;
      pinch.y = m.y;
      return;
    }
    const p = base ? toBase(event.clientX, event.clientY) : ([0, 0] as Pt);

    if (!drag) {
      if (tool !== "crop" || !base) return void (cursor = spaceHeld ? "grab" : "");
      return void (cursor = CURSORS[cropMode(p, (8 / view().s) * 1.5) ?? ""] ?? "grab");
    }

    if (drag.kind === "eyedrop") return eyedrop(event);
    if (drag.kind === "pan") {
      panX += event.clientX - drag.x;
      panY += event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      return;
    }
    if (drag.kind === "crop") return resizeCrop(drag.mode, drag.from, p[0] - drag.start[0], p[1] - drag.start[1]);
    if (drag.kind === "erase") return erase(p);
    if (drag.kind === "paint") {
      const last = drag.o.points[drag.o.points.length - 1];
      Math.hypot(p[0] - last[0], p[1] - last[1]) > 1 / view().s && drag.o.points.push(p);
      return paint();
    }
    if (drag.kind === "create") drag.o.b = event.shiftKey ? constrain(drag.o.a, p, drag.o.kind) : p;
    if (drag.kind === "handle") drag.o[drag.end] = event.shiftKey ? constrain(drag.o[drag.end === "a" ? "b" : "a"], p, drag.o.kind) : p;
    if (drag.kind === "move") {
      move(drag.o, p[0] - drag.last[0], p[1] - drag.last[1]);
      drag.last = p;
      drag.moved = true;
    }
    paint();
  };

  const onpointerup = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) return void ((pinch = null), (drag = null), (target = { zoom, panX, panY }));
    const current = drag;
    drag = null;
    if (!current) return;
    if (current.kind === "create") {
      const o = current.o;
      if (Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) < 6 / view().s) o.b = [o.a[0] + 160 * unit, o.a[1] + (o.kind === "line" || o.kind === "arrow" ? 0 : 110 * unit)];
    }
    if (current.kind === "eyedrop") return void ((dropping = false), sel && (tool === "text" ? applyText() : tool === "shapes" && applyInk()));
    if (current.kind === "pan") return void (target = { zoom, panX, panY });
    if (current.kind === "crop") return commit();
    if (current.kind === "move" && !current.moved) return;
    if (current.kind === "erase" && !current.changed) return;
    commit();
  };

  const ondblclick = (event: MouseEvent) => {
    if (!base || tool === "crop") return;
    const o = topHit(toBase(event.clientX, event.clientY), ["text"]);
    if (o?.kind !== "text") return;
    setTool("text");
    startEdit(o);
  };

  const oncontextmenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!base) return;
    const o = topHit(toBase(event.clientX, event.clientY), tool === "text" ? ["text"] : tool === "shapes" ? SHAPE_KINDS : ["stroke", "blur", "text", ...SHAPE_KINDS]);
    if (!o)
      return openEntityMenu([
        { id: "editor-undo", label: text("undo"), icon: MENU_ICONS.reply, disabled: index === 0, run: undo },
        { id: "editor-redo", label: text("redo"), icon: MENU_ICONS.retry, disabled: index >= history.length - 1, run: redo },
        { id: "editor-fit", label: text("fit"), icon: MENU_ICONS.select, run: () => fit() },
        { id: "editor-reset", label: text("reset"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: history.length < 2, run: reset },
      ], event.clientX, event.clientY);
    select(o);
    const at = objects.indexOf(o);
    openEntityMenu([
      ...(o.kind === "text" ? [{ id: "editor-edit", label: text("edit_text"), icon: MENU_ICONS.edit, run: () => (setTool("text"), startEdit(o)) }] : []),
      { id: "editor-duplicate", label: text("duplicate"), icon: MENU_ICONS.copy, run: () => {
        const copy = { ...structuredClone(o), id: nextId++ };
        move(copy, 24 * unit, 24 * unit);
        objects.push(copy);
        selected = copy.id;
        commit();
      } },
      { id: "editor-forward", label: text("forward"), icon: MENU_ICONS.collapse, disabled: at === objects.length - 1, separated: true, run: () => layer(o, "forward") },
      { id: "editor-backward", label: text("backward"), icon: MENU_ICONS.expand, disabled: at === 0, run: () => layer(o, "backward") },
      { id: "editor-front", label: text("front"), icon: MENU_ICONS.collapse, disabled: at === objects.length - 1, run: () => layer(o, "front") },
      { id: "editor-back", label: text("back"), icon: MENU_ICONS.expand, disabled: at === 0, run: () => layer(o, "back") },
      { id: "editor-delete", label: text("delete"), icon: MENU_ICONS.delete, danger: true, separated: true, run: () => remove(o.id) },
    ], event.clientX, event.clientY);
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (exit.closing) return;
    const typing = event.target === textField;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => (event.preventDefault(), event.stopPropagation());

    if (typing) return void (event.key === "Escape" && (handled(), textField?.blur()));
    if (event.target instanceof HTMLInputElement && event.target.type !== "range") return;
    if (mod && key === "z") return void (handled(), event.shiftKey ? redo() : undo());
    if (mod && key === "y") return void (handled(), redo());
    if (mod && event.key === "Enter") return void (handled(), done());
    if ((event.key === "Delete" || event.key === "Backspace") && selected !== null) return void (handled(), remove(selected));
    if ((event.key === "]" || event.key === "[") && sel) return void (handled(), layer(sel, event.key === "]" ? (mod ? "front" : "forward") : mod ? "back" : "backward"));
    if (event.key === "Escape") return void (handled(), pop ? (pop = null) : selected !== null ? (selected = null) : close());
    if (event.key === " ") return void (handled(), (spaceHeld = true), (cursor = "grab"));
    if (mod) return;
    if (event.key === "+" || event.key === "=") return void (handled(), zoomTo(zoom * 1.25));
    if (event.key === "-") return void (handled(), zoomTo(zoom / 1.25));
    if (event.key === "0") return void (handled(), fit());
    const next = ({ v: "select", h: "hand", c: "crop", d: "draw", t: "text", s: "shapes", b: "blur" } as Record<string, Tool>)[key];
    next && (handled(), setTool(next));
  };

  const onkeyup = (event: KeyboardEvent) => event.key === " " && ((spaceHeld = false), (cursor = ""));

  const close = () => {
    result = null;
    exit.close();
  };

  const done = async () => {
    if (!base || saving) return;
    finishEdit();
    if (index === 0 && !session) return close();
    saving = true;
    result = await render(base, crop, objects, file).catch(() => null);
    saving = false;
    result ? exit.close() : (failed = true);
  };

  const editingView = $derived.by(() => {
    void rev;
    return editingObj && { ...editingObj };
  });

  const textScreen = $derived.by(() => {
    const o = editingView;
    if (!o) return null;
    void [zoom, panX, panY, frame, crop, tool];
    const [x, y] = toScreen(o.at);
    const s = view().s;
    return { x, y, s, size: o.size * s };
  });

  const outside = (node: HTMLElement) => {
    const handler = (event: PointerEvent) => !(event.target as Element).closest?.(".pop-wrap") && !(eyedropping && event.target === canvas) && (pop = null);
    addEventListener("pointerdown", handler, true);
    return { destroy: () => removeEventListener("pointerdown", handler, true) };
  };

  const eyedropping = $derived((pop === "colour" || pop === "backdrop") && custom && dropping);

  $effect(() => {
    if (!((pop === "colour" || pop === "backdrop") && custom)) dropping = false;
  });

  const grow = (node: HTMLElement, { duration = 320 } = {}) => {
    const { width, height } = node.getBoundingClientRect();
    return { duration, easing: cubicOut, css: (t: number) => `overflow: hidden; width: ${t * width}px; height: ${t * height}px; opacity: ${t}; margin-left: ${t * 15}px; padding-left: ${t * 15}px;` };
  };

  const eyedrop = (event: PointerEvent) => {
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const [r, g, b] = ctx.getImageData(Math.round(event.clientX * dpr), Math.round(event.clientY * dpr), 1, 1).data;
    const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    if (tool === "text") return void (pop === "backdrop" ? (type.backgroundColour = hex) : (type.colour = hex), applyText(false));
    if (tool === "shapes") return void ((ink.colour = hex), applyInk(false));
    pen.colour = hex;
    brush === "eraser" && (brush = "pen");
  };

  const togglePop = (id: string) => (pop = pop === id ? null : id);
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#snippet icon(d: string, size = 20)}
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" {d} /></svg>
{/snippet}

{#snippet button(id: string, label: string, active: boolean, run: () => void, keys: string[] = [])}
  <button type="button" class="ib ghost press" class:on={active} aria-label={label} aria-pressed={active} use:tooltip={tip(label, ...keys)} onclick={run}>{@render icon(I[id as keyof typeof I])}</button>
{/snippet}

{#snippet colour(value: string, set: (value: string, done?: boolean) => void, id = "colour", label = text("colour"))}
  <div class="pop-wrap" use:outside>
    <button type="button" class="dd ghost press" aria-label={label} aria-expanded={pop === id} use:tooltip={label} onclick={() => togglePop(id)}>
      <span class="swatch" style:background={value}></span>{@render icon(I.chev, 14)}
    </button>
    {#if pop === id}
      <div class="pop glass palette row-nw" transition:fly={{ y: -6, duration: 220, easing: cubicOut }}>
        <div class="swatches">
        {#each COLOURS as option}
          <button type="button" class="dot press" class:on={option === value} style:background={option} aria-label={option} onclick={() => set(option)}></button>
        {/each}
        <button type="button" class="dot custom press" class:on={custom} aria-label={text("custom")} aria-expanded={custom} use:tooltip={text("custom")} onclick={() => (custom = !custom)}>{@render icon(I.plus, 14)}</button>
        </div>
        {#if custom}
          <div class="custom-panel col" transition:grow>
            <ColourPicker {value} onchange={set} />
            <button type="button" class="eyedrop ghost press row-nw align-centre" class:on={dropping} aria-pressed={dropping} onclick={() => (dropping = !dropping)}>{@render icon(I.eyedrop, 16)}<span class="xs">{text(dropping ? "eyedrop_active" : "eyedrop")}</span></button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet range(label: string, value: number, min: number, max: number, set: (value: number, done?: boolean) => void, suffix = "")}
  <label class="range row-nw align-centre">
    <span class="xs muted">{label}</span>
    <input type="range" {min} {max} {value} oninput={(event) => set(+event.currentTarget.value, false)} onchange={(event) => set(+event.currentTarget.value)} />
    <span class="num">{value}{suffix}</span>
  </label>
{/snippet}

<div class="editor" class:closing={exit.closing} inert={exit.closing} onanimationend={exit.onanimationend} role="dialog" aria-modal="true" aria-label={text("title")} use:portal>
  <div class="scrim"></div>
  <canvas
    bind:this={canvas}
    class="canvas"
    class:ready={!!base}
    style:cursor={eyedropping ? "copy" : cursor || (tool === "hand" ? "grab" : tool === "text" ? "text" : tool === "crop" ? "default" : "crosshair")}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
    {ondblclick}
    {oncontextmenu}
  ></canvas>
  <div class="frame" bind:this={frameEl}></div>

  {#if !base}
    <div class="centre-msg">{#if failed}<span class="sm muted">{text("load_failed")}</span>{:else}<LoadingDots label={text("loading")} />{/if}</div>
  {/if}

  {#if editingObj && editingView && textScreen}
    {@const o = editingView}
    {@const live = editingObj}
    <textarea
      bind:this={textField}
      class="text-input"
      class:boxed={o.background}
      rows="1"
      spellcheck="false"
      placeholder={text("placeholder")}
      value={o.value}
      style:left="{textScreen.x}px"
      style:top="{textScreen.y}px"
      style:font="{o.italic ? 'italic ' : ''}{o.bold ? 700 : 500} {textScreen.size}px / 1.25 {FONTS[o.font].css}"
      style:text-decoration={o.underline ? "underline" : "none"}
      style:text-align={o.align}
      style:--ink={o.colour}
      style:--on={o.backgroundColour ? o.colour : light(o.colour) ? "#111318" : "#ffffff"}
      style:--box={o.backgroundColour ?? o.colour}
      style:--pad="{o.background ? textScreen.size * 0.3 : 0}px"
      style:translate={o.align === "left" ? "0" : o.align === "center" ? "-50%" : "-100%"}
      oninput={(event) => (live.value = event.currentTarget.value)}
      onblur={finishEdit}
    ></textarea>
  {/if}

  <div class="corner top-left row-nw gap-sm">
    <div class="glass pill">{@render button("close", text("close"), false, close, ["Esc"])}</div>
    <div class="glass pill file row-nw align-centre">
      <span class="sm strong truncate">{name}</span>
      <span class="xs faint">{formatBytes(file.size)}</span>
    </div>
  </div>

  <div class="corner top-right row-nw gap-sm">
    <button type="button" class="btn ghost press" disabled={history.length < 2} onclick={reset}>{text("reset")}</button>
    <button type="button" class="btn primary press" disabled={!base || saving} use:tooltip={tip(text("done"), "mod", "Enter")} onclick={done}>{#if saving}<LoadingDots label={text("saving")} />{:else}{text("done")}{/if}</button>
  </div>

  <div class="toolbar-slot">
    {#if tool !== "hand"}
    {#key tool}
      <div class="toolbar glass row-nw align-centre" role="toolbar" tabindex="-1" onmousedown={(event) => !(event.target instanceof HTMLInputElement) && event.preventDefault()} in:fly={{ y: -8, duration: 320, delay: 60, easing: cubicOut }} out:fade={{ duration: 120 }}>
        {#if tool === "select"}
          {#if sel}
            {@render button("forward", text("forward"), false, () => layer(sel, "forward"), ["]"])}
            {@render button("backward", text("backward"), false, () => layer(sel, "backward"), ["["])}
            <span class="sep"></span>
            <button type="button" class="chip press" disabled={layerAt.top} onclick={() => layer(sel, "front")}>{text("front")}</button>
            <button type="button" class="chip press" disabled={layerAt.bottom} onclick={() => layer(sel, "back")}>{text("back")}</button>
            <span class="sep"></span>
            {@render button("delete", text("delete"), false, () => remove(sel.id), ["Del"])}
          {:else}
            <span class="xs muted hint">{text("select_hint")}</span>
          {/if}
        {:else if tool === "crop"}
          {#each RATIOS as [id]}
            <button type="button" class="chip press" class:on={ratio === id} onclick={() => setRatio(id)}>{id === "free" || id === "original" ? text(id) : id}</button>
          {/each}
          <span class="sep"></span>
          {@render button("rotate", text("rotate"), false, () => turn(true))}
          {@render button("flip", text("flip"), false, () => turn(false))}
        {:else if tool === "draw"}
          {@render colour(pen.colour, (value) => (pen.colour = value, brush === "eraser" && (brush = "pen")))}
          <span class="sep"></span>
          <div class="mobile-only row-nw">
            {#each BRUSHES as id}{@render button(id, text(id), brush === id, () => ((brush = id), id !== "eraser" && (pen.size = BRUSH_SIZE[id])))}{/each}
            <span class="sep"></span>
          </div>
          {@render range(text("size"), pen.size, 1, 60, (value) => (pen.size = value))}
          <span class="sep wide-only"></span>
          <span class="wide-only">{@render range(text("opacity"), Math.round(pen.opacity * 100), 10, 100, (value) => (pen.opacity = value / 100), "%")}</span>
          <span class="sep wide-only"></span>
          <span class="wide-only">{@render button("eraser", text("eraser"), brush === "eraser", () => (brush = brush === "eraser" ? "pen" : "eraser"))}</span>
        {:else if tool === "text"}
          {@render colour(type.colour, (value, finished = true) => ((type.colour = value), applyText(finished)))}
          <span class="sep"></span>
          <div class="pop-wrap" use:outside>
            <button type="button" class="dd ghost press font" aria-expanded={pop === "font"} onclick={() => togglePop("font")}>
              <span style:font-family={FONTS[type.font].css}>{FONTS[type.font].label}</span>{@render icon(I.chev, 14)}
            </button>
            {#if pop === "font"}
              <div class="pop glass list" transition:fly={{ y: -6, duration: 220, easing: cubicOut }}>
                {#each Object.entries(FONTS) as [id, font]}
                  <button type="button" class="item ghost press" class:on={type.font === id} style:font-family={font.css} onclick={() => ((type.font = id as FontId), (pop = null), applyText())}>{font.label}</button>
                {/each}
              </div>
            {/if}
          </div>
          <span class="sep"></span>
          <div class="pop-wrap" use:outside>
            <button type="button" class="dd ghost press" aria-label={text("size")} aria-expanded={pop === "size"} onclick={() => togglePop("size")}>
              <span class="num">{type.size}</span>{@render icon(I.chev, 14)}
            </button>
            {#if pop === "size"}
              <div class="pop glass list" transition:fly={{ y: -6, duration: 220, easing: cubicOut }}>
                {#each TEXT_SIZES as size}
                  <button type="button" class="item ghost press" class:on={type.size === size} onclick={() => ((type.size = size), (pop = null), applyText())}>{size}</button>
                {/each}
              </div>
            {/if}
          </div>
          <span class="sep"></span>
          {@render button("bold", text("bold"), type.bold, () => ((type.bold = !type.bold), applyText()))}
          {@render button("italic", text("italic"), type.italic, () => ((type.italic = !type.italic), applyText()))}
          {@render button("underline", text("underline"), type.underline, () => ((type.underline = !type.underline), applyText()))}
          <span class="sep"></span>
          {@render button(type.align, text("align"), false, () => ((type.align = type.align === "left" ? "center" : type.align === "center" ? "right" : "left"), applyText()))}
          {@render button("background", text("background"), type.background, () => ((type.background = !type.background), applyText()))}
          {#if type.background}{@render colour(type.backgroundColour, (value, finished = true) => ((type.backgroundColour = value), applyText(finished)), "backdrop", text("background_colour"))}{/if}
        {:else if tool === "shapes"}
          {#each SHAPES as id}{@render button(id, text(id), shape === id, () => ((shape = id), sel && sel.kind !== id && (selected = null)))}{/each}
          <span class="sep"></span>
          {@render colour(ink.colour, (value, finished = true) => ((ink.colour = value), applyInk(finished)))}
          <span class="sep"></span>
          {#if shape === "step"}
            {@render range(text("size"), ink.step, 10, 60, (value, finished = true) => ((ink.step = value), applyInk(finished)))}
          {:else}
            {@render range(text("width"), ink.width, 1, 30, (value, finished = true) => ((ink.width = value), applyInk(finished)))}
            <span class="sep"></span>
            {#if shape === "rect" || shape === "ellipse"}
              {@render button("fill", text("fill"), ink.fill, () => ((ink.fill = !ink.fill), applyInk()))}
              {#if ink.fill}{@render range(text("fill_opacity"), ink.fillOpacity, 5, 100, (value, finished = true) => ((ink.fillOpacity = value), applyInk(finished)), "%")}{/if}
            {/if}
            {@render button("dashed", text("dashed"), ink.dashed, () => ((ink.dashed = !ink.dashed), applyInk()))}
            {@render button("shadow", text("shadow"), ink.shadow, () => ((ink.shadow = !ink.shadow), applyInk()))}
          {/if}
        {:else if tool === "blur"}
          <button type="button" class="chip press" class:on={blurMode === "blur"} onclick={() => (blurMode = "blur")}>{text("soften")}</button>
          <button type="button" class="chip press" class:on={blurMode === "pixelate"} onclick={() => (blurMode = "pixelate")}>{text("pixelate")}</button>
          <span class="sep"></span>
          {@render range(text("strength"), blurStrength, 1, 100, (value) => (blurStrength = value))}
          <span class="sep"></span>
          {@render range(text("size"), blurSize, 10, 150, (value) => (blurSize = value))}
          <span class="xs faint hint wide-only">{text("blur_hint")}</span>
        {/if}
      </div>
    {/key}
    {/if}
  </div>

  <nav class="rail glass" aria-label={text("tools")}>
    {#each TOOLS as id}
      <button type="button" class="ib tool ghost press" class:on={tool === id} aria-label={text(id)} aria-pressed={tool === id} use:tooltip={{ text: tip(text(id), TOOL_KEYS[id]), placement: "right" }} onclick={() => setTool(id)}>{@render icon(I[id], 22)}</button>
    {/each}
  </nav>

  {#if tool === "draw"}
    <div class="brushes glass col" transition:fly={{ x: 16, duration: 320, easing: cubicOut }}>
      <span class="xs muted bold heading">{text("brushes")}</span>
      {#each BRUSHES.slice(0, 3) as id}
        <button type="button" class="brush col ghost press" class:on={brush === id} onclick={() => ((brush = id), (pen.size = BRUSH_SIZE[id]))}>
          <span class="xs">{text(id)}</span>
          <svg viewBox="0 0 190 26" aria-hidden="true">
            <path d={id === "highlighter" ? "M8 14h174" : "M8 17c30-13 50 4 80-5s60-9 94-2"} fill="none" stroke={pen.colour} stroke-opacity={id === "highlighter" ? 0.45 : 1} stroke-width={id === "pen" ? 3 : id === "marker" ? 9 : 16} stroke-linecap={id === "highlighter" ? "butt" : "round"} />
          </svg>
        </button>
      {/each}
    </div>
  {/if}

  <div class="corner bottom-right row-nw gap-sm">
    <div class="glass pill history">
      {@render button("undo", text("undo"), false, undo, ["mod", "Z"])}
      {@render button("redo", text("redo"), false, redo, ["mod", "Shift", "Z"])}
    </div>
    <div class="glass pill zoom">
      {@render button("minus", text("zoom_out"), false, () => zoomTo(zoom / 1.25), ["-"])}
      <button type="button" class="num ghost press zoom-value" aria-label={text("fit")} use:tooltip={tip(text("fit"), "0")} onclick={() => fit()}>{Math.round(zoom * 100)}%</button>
      {@render button("plus", text("zoom_in"), false, () => zoomTo(zoom * 1.25), ["+"])}
    </div>
  </div>
</div>

<style>
  .editor {
    --glass: hsla(242, 10%, 10%, 0.72);
    --panel-gap: var(--azure-spacing-lg);
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    color: var(--colours-text);
    user-select: none;
  }

  .editor.closing {
    animation: exit-fade var(--azure-duration-md) var(--azure-ease-out) forwards;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background-color: hsla(240, 10%, 2%, 0.8);
    backdrop-filter: blur(18px);
    animation: editor-veil var(--azure-duration-slow) var(--azure-ease-fluid);
  }

  .canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    opacity: 0;
    scale: 0.96;
    transition: opacity var(--azure-duration-slow) var(--azure-ease-fluid), scale var(--azure-duration-glide) var(--azure-ease-fluid);
  }

  .canvas.ready {
    opacity: 1;
    scale: 1;
  }

  .frame {
    position: absolute;
    inset: 132px 300px 84px 96px;
    pointer-events: none;
  }

  .centre-msg {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .glass {
    background: var(--glass);
    backdrop-filter: blur(22px) saturate(1.4);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
  }

  .corner,
  .rail,
  .toolbar-slot,
  .brushes {
    position: absolute;
    animation: editor-rise var(--azure-duration-glide) var(--azure-ease-fluid) backwards;
  }

  .top-left {
    top: calc(var(--panel-gap) + env(safe-area-inset-top));
    left: var(--panel-gap);
  }

  .top-right {
    top: calc(var(--panel-gap) + env(safe-area-inset-top));
    right: var(--panel-gap);
  }

  .bottom-right {
    bottom: calc(var(--panel-gap) + env(safe-area-inset-bottom));
    right: var(--panel-gap);
    animation-delay: 60ms;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--azure-radius-pill);
  }

  .file {
    gap: var(--azure-spacing-md);
    max-width: 320px;
    padding: 0 var(--azure-spacing-xl);
    height: 46px;
  }

  .strong {
    color: var(--colours-text-strong);
    font-weight: 500;
  }

  .ib {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: var(--azure-radius-pill);
    color: var(--colours-text-muted);
    transition: background-color var(--azure-duration-md) var(--azure-ease-out), color var(--azure-duration-md) var(--azure-ease-out);
  }

  .ib:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .ib.on {
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .btn {
    height: 46px;
    padding: 0 var(--azure-spacing-xl);
    border-radius: var(--azure-radius-pill);
    font-weight: 600;
    font-size: var(--text-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 92px;
    border: none;
    outline-offset: 2px;
    transition: background-color var(--azure-duration-md) var(--azure-ease-out), box-shadow var(--azure-duration-md) var(--azure-ease-out), color var(--azure-duration-md) var(--azure-ease-out), opacity var(--azure-duration-md) var(--azure-ease-out);
  }

  .btn.primary {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .btn.ghost {
    background: var(--glass);
    backdrop-filter: blur(22px);
    border: 1px solid var(--colours-outline-hairline);
  }

  .btn.primary:hover:not(:disabled) {
    background-color: var(--colours-accent-strong);
    box-shadow: 0 6px 20px var(--colours-accent-glow);
  }

  .btn.ghost:hover:not(:disabled) {
    color: var(--colours-text-strong);
    background-color: hsla(242, 10%, 16%, 0.8);
  }

  .zoom-value {
    transition: background-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .zoom-value:hover {
    background-color: var(--colours-surface-hover);
  }

  .btn:disabled {
    opacity: 0.5;
  }

  .toolbar-slot {
    z-index: 2;
    top: calc(76px + env(safe-area-inset-top));
    left: 50%;
    translate: -50% 0;
    display: grid;
    animation-delay: 40ms;
  }

  .toolbar {
    grid-area: 1 / 1;
    justify-self: center;
    gap: 2px;
    padding: 6px var(--azure-spacing-sm);
    border-radius: var(--azure-radius-lg);
    white-space: nowrap;
  }

  .toolbar.glass {
    position: relative;
    isolation: isolate;
    background: none;
    backdrop-filter: none;
  }

  .toolbar.glass::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--glass);
    backdrop-filter: blur(22px) saturate(1.4);
  }

  .pop.glass {
    background: hsla(242, 10%, 10%, 0.62);
    backdrop-filter: blur(28px) saturate(1.5);
  }

  .sep {
    width: 1px;
    height: 22px;
    margin: 0 var(--azure-spacing-sm);
    flex: none;
    background-color: var(--colours-outline-light);
  }

  .chip {
    border: none;
    background: none;
    height: 34px;
    padding: 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-pill);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--colours-text-muted);
    transition: background-color var(--azure-duration-md) var(--azure-ease-out), color var(--azure-duration-md) var(--azure-ease-out);
  }

  .chip:hover {
    color: var(--colours-text-strong);
  }

  .chip.on {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-active);
  }

  .pop-wrap {
    position: relative;
  }

  .dd {
    display: flex;
    align-items: center;
    gap: var(--azure-spacing-md);
    height: 38px;
    padding: 0 var(--azure-spacing-md) 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    color: var(--colours-text-strong);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .dd {
    transition: background-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .dd:hover {
    background-color: var(--colours-surface-hover);
  }

  .dd svg {
    color: var(--colours-text-muted);
  }

  .dd.font {
    min-width: 150px;
    justify-content: space-between;
  }

  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
  }

  .pop {
    position: absolute;
    top: calc(100% + 12px);
    left: 0;
    z-index: 2;
    border-radius: var(--azure-radius-md);
  }

  .palette {
    align-items: flex-start;
    padding: var(--azure-spacing-lg);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(3, 26px);
    gap: var(--azure-spacing-md);
    flex: none;
  }

  .dot {
    position: relative;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    transition: box-shadow var(--azure-duration-md) var(--azure-ease-out), scale var(--azure-duration-md) var(--azure-ease-spring);
  }

  .dot:hover {
    scale: 1.1;
  }

  .dot.on {
    box-shadow: 0 0 0 2px var(--colours-foreground), 0 0 0 4px #fff;
  }

  .custom {
    cursor: pointer;
    color: var(--colours-text-strong);
    background: conic-gradient(#ff5a6e, #ffd23f, #5ad18a, #3aa0ff, #b07aff, #ff5a6e);
  }

  .custom-panel {
    gap: var(--azure-spacing-sm);
    padding-left: 15px;
    margin-left: 15px;
    border-left: 1px solid var(--colours-outline-hairline);
    white-space: nowrap;
  }

  .eyedrop {
    gap: var(--azure-spacing-sm);
    height: 34px;
    padding: 0 var(--azure-spacing-md);
    border: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-muted);
    background: none;
    transition: background-color var(--azure-duration-md) var(--azure-ease-out), color var(--azure-duration-md) var(--azure-ease-out);
  }

  .eyedrop:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .eyedrop.on {
    color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 100%;
    padding: 6px;
  }

  .item {
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-sm);
    text-align: left;
    font-size: var(--text-md);
    color: var(--colours-text);
  }

  .item:hover,
  .item.on {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .range {
    gap: var(--azure-spacing-md);
    padding: 0 var(--azure-spacing-md);
  }

  .range input {
    width: 110px;
    accent-color: var(--colours-accent);
  }

  .num {
    min-width: 40px;
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--colours-text-strong);
  }

  .zoom-value {
    min-width: 58px;
    height: 38px;
    border-radius: var(--azure-radius-pill);
  }

  .hint {
    padding: 0 var(--azure-spacing-md);
  }

  .rail {
    top: 50%;
    left: var(--panel-gap);
    translate: 0 -50%;
    display: flex;
    flex-direction: column;
    gap: var(--azure-spacing-xs);
    padding: 6px;
    border-radius: var(--azure-radius-lg);
    animation-delay: 20ms;
  }

  .rail .ib {
    width: 46px;
    height: 46px;
    border-radius: var(--azure-radius-md);
  }

  .brushes {
    top: 132px;
    right: var(--panel-gap);
    width: 240px;
    gap: var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-lg);
    animation: none;
  }

  .heading {
    padding: var(--azure-spacing-xs) var(--azure-spacing-sm);
  }

  .brush {
    align-items: stretch;
    gap: var(--azure-spacing-xs);
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    color: var(--colours-text);
    text-align: left;
    transition: border-color var(--azure-duration-md) var(--azure-ease-out), background-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .brush:hover {
    background-color: var(--colours-surface-hover);
  }

  .brush.on {
    border-color: var(--colours-accent);
    background-color: var(--colours-accent-soft);
    color: var(--colours-text-strong);
  }

  .brush svg {
    width: 100%;
    height: 26px;
  }

  .text-input {
    position: absolute;
    z-index: 1;
    margin: calc(var(--pad) * -1);
    padding: var(--pad);
    min-width: 2ch;
    field-sizing: content;
    resize: none;
    overflow: hidden;
    border: none;
    outline: 1.5px dashed var(--colours-accent);
    outline-offset: 6px;
    border-radius: calc(var(--pad));
    color: var(--ink);
    caret-color: var(--colours-accent);
    background: transparent;
    white-space: pre;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  }

  .text-input.boxed {
    color: var(--on);
    background-color: var(--box);
    text-shadow: none;
  }

  .text-input::placeholder {
    color: color-mix(in oklab, var(--ink) 50%, transparent);
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 760px) {
    .editor {
      --panel-gap: var(--azure-spacing-md);
    }

    .frame {
      inset: calc(76px + env(safe-area-inset-top)) var(--azure-spacing-md) calc(156px + env(safe-area-inset-bottom));
    }

    .file,
    .zoom,
    .brushes,
    .wide-only {
      display: none;
    }

    .mobile-only {
      display: flex;
      align-items: center;
    }

    .top-left {
      right: auto;
    }

    .bottom-right {
      top: calc(var(--panel-gap) + env(safe-area-inset-top));
      bottom: auto;
      left: 50%;
      right: auto;
      translate: -50% 0;
    }

    .rail {
      top: auto;
      bottom: calc(var(--panel-gap) + env(safe-area-inset-bottom));
      left: var(--panel-gap);
      right: var(--panel-gap);
      translate: none;
      flex-direction: row;
      justify-content: space-around;
    }

    .rail .ib {
      width: 50px;
      height: 50px;
    }

    .toolbar-slot {
      top: auto;
      bottom: calc(84px + env(safe-area-inset-bottom));
      left: var(--panel-gap);
      right: var(--panel-gap);
      translate: none;
    }

    .toolbar {
      flex-wrap: wrap;
      justify-content: center;
      justify-self: stretch;
      row-gap: var(--azure-spacing-sm);
      white-space: normal;
    }

    .pop {
      top: auto;
      bottom: calc(100% + 12px);
    }

    .range input {
      width: 120px;
    }
  }

  @keyframes editor-veil {
    from {
      opacity: 0;
      backdrop-filter: blur(0);
    }
  }

  @keyframes editor-rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
</style>
