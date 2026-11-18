import { native } from "./native";
import { getMediaBlob, type MediaSource } from "../matrix/utilities/media";

const canWrite = (type: string) =>
  typeof ClipboardItem !== "undefined" &&
  !!navigator.clipboard?.write &&
  ("supports" in ClipboardItem ? (ClipboardItem as any).supports(type) : type === "image/png");

const offscreen = typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype;

const toPNG = async (blob: Blob) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = offscreen ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
  bitmap.close();
  return offscreen
    ? (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
    : new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((png) => (png ? resolve(png) : reject(new Error("png"))), "image/png"));
};

export const canCopyMedia = (mimetype: string) =>
  mimetype.startsWith("image/")
    ? native || canWrite("image/png")
    : canWrite(mimetype);

const copyNative = async (blob: Blob) => {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("copy_image", new Uint8Array(await (await toPNG(blob)).arrayBuffer()));
};

export const copyMedia = async (source: MediaSource, mimetype: string) => {
  const blob = await getMediaBlob(source, mimetype);
  if (native && mimetype.startsWith("image/")) return copyNative(blob);
  const direct = canWrite(mimetype);
  const payload = direct ? blob : await toPNG(blob);
  const type = direct ? mimetype : "image/png";

  await navigator.clipboard.write([new ClipboardItem({ [type]: payload })]);
};
