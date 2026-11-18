export const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const embedPort: Promise<number> = native ? import("@tauri-apps/api/core").then(({ invoke }) => invoke<number>("embed_port")).catch(() => 0) : Promise.resolve(0);

export const wrapEmbed = (src: string, port: number) => (port ? `http://127.0.0.1:${port}/embed#${encodeURIComponent(src)}` : src);
