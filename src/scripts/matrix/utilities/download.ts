import { native } from "../../misc/native";
import { sanitiseFilename } from "./attachments";
import { getMediaBlob, type MediaSource } from "./media";

const saveNative = async (blob: Blob, name: string) => {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_download", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-name": name } }).catch((error) => Promise.reject(new Error(String(error))));
};

export const downloadMedia = async (source: MediaSource | string, name: string | undefined) => {
  const blob = typeof source === "string" ? await fetch(source).then((response) => response.blob()) : await getMediaBlob(source, "application/octet-stream");
  if (native) return saveNative(blob, sanitiseFilename(name));
  const link = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = link;
  anchor.download = sanitiseFilename(name);
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(link), 30_000);
};
