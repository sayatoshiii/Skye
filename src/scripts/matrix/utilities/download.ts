import { sanitiseFilename } from "./attachments";
import { getMediaBlob, type MediaSource } from "./media";

export const downloadMedia = async (source: MediaSource, name: string | undefined) => {
  const blob = await getMediaBlob(source, "application/octet-stream");
  const link = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = link;
  anchor.download = sanitiseFilename(name);
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(link), 30_000);
};
