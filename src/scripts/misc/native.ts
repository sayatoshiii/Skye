export const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const embedPort: Promise<number> = native ? import("@tauri-apps/api/core").then(({ invoke }) => invoke<number>("embed_port")).catch(() => 0) : Promise.resolve(0);

export const wrapEmbed = (src: string, port: number) => (port ? `http://localhost:${port}/embed#${encodeURIComponent(src)}` : src);

const EXTERNAL = /^(https?:|mailto:)/;

native &&
  typeof document !== "undefined" &&
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const external = !event.defaultPrevented && !!anchor && EXTERNAL.test(anchor.href) && !anchor.href.startsWith("https://matrix.to/") && (anchor.target === "_blank" || new URL(anchor.href).origin !== location.origin);
      external && (event.preventDefault(), import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(anchor!.href)).catch(() => undefined));
    },
  );
