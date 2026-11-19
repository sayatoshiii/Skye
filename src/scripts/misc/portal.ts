const layer = () => (document.fullscreenElement ?? (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? document.body) as HTMLElement;

export const portal = (node: HTMLElement, target: HTMLElement = layer()) => {
  target.appendChild(node);

  return {
    destroy: () => node.remove(),
  };
};
