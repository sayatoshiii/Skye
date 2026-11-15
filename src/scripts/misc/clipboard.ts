import { getMediaBlob, type MediaSource } from "../matrix/utilities/media";

const canWrite = (type: string) =>
  typeof ClipboardItem !== "undefined" &&
  !!navigator.clipboard?.write &&
  ("supports" in ClipboardItem ? (ClipboardItem as any).supports(type) : type === "image/png");

const toPNG = async (blob: Blob) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
};

export const canCopyMedia = (mimetype: string) =>
  mimetype.startsWith("image/")
    ? canWrite("image/png")
    : canWrite(mimetype);

export const copyMedia = async (source: MediaSource, mimetype: string) => {
  const blob = await getMediaBlob(source, mimetype);
  const native = canWrite(mimetype);
  const payload = native ? blob : await toPNG(blob);
  const type = native ? mimetype : "image/png";

  await navigator.clipboard.write([new ClipboardItem({ [type]: payload })]);
};
