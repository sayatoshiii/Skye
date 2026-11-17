export const pipSupported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;

export const pictureInPicture = (video?: HTMLVideoElement | null) =>
  void (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video?.requestPictureInPicture())?.catch(() => undefined);

export const idle = (node: HTMLElement, delay = 2500) => {
  let timer = 0;
  const wake = () => (node.classList.remove("idle"), clearTimeout(timer), (timer = window.setTimeout(() => node.classList.add("idle"), delay)));
  node.addEventListener("pointermove", wake);
  node.addEventListener("pointerdown", wake);
  wake();
  return { destroy: () => (clearTimeout(timer), node.removeEventListener("pointermove", wake), node.removeEventListener("pointerdown", wake)) };
};
