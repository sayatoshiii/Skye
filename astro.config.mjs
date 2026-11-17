// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';

const APP_DEEP_LINK = /^\/app\/[^?#]+/;

/** @returns {import('vite').Plugin} */
const appFallback = () => {
  /** @param {import('vite').Connect.Server} middlewares */
  const rewrite = (middlewares) =>
    middlewares.use((request, _response, next) => {
      const [path, query = ""] = (request.url ?? "").split("?");
      if (APP_DEEP_LINK.test(path) && !path.startsWith("/app/_"))
        request.url = `/app/${query ? `?${query}` : ""}`;
      next();
    });

  return {
    name: "skye:app-fallback",
    enforce: "pre",
    configureServer: (server) => {
      rewrite(server.middlewares);
    },
    configurePreviewServer: (server) => {
      rewrite(server.middlewares);
    },
  };
};

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],
  devToolbar: { enabled: false },
  server: { host: process.env.TAURI_DEV_HOST || false },
  vite: {
    clearScreen: false,
    server: {
      hmr: process.env.TAURI_DEV_HOST
        ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 4322 }
        : undefined,
    },
    plugins: [appFallback()],
    optimizeDeps: {
      exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
      include: [
        "livekit-client",
        "highlight.js/lib/core",
        "highlight.js/lib/languages/javascript",
        "highlight.js/lib/languages/typescript",
        "highlight.js/lib/languages/json",
        "highlight.js/lib/languages/python",
        "highlight.js/lib/languages/rust",
        "highlight.js/lib/languages/go",
        "highlight.js/lib/languages/java",
        "highlight.js/lib/languages/c",
        "highlight.js/lib/languages/cpp",
        "highlight.js/lib/languages/csharp",
        "highlight.js/lib/languages/bash",
        "highlight.js/lib/languages/shell",
        "highlight.js/lib/languages/xml",
        "highlight.js/lib/languages/css",
        "highlight.js/lib/languages/scss",
        "highlight.js/lib/languages/sql",
        "highlight.js/lib/languages/yaml",
        "highlight.js/lib/languages/ini",
        "highlight.js/lib/languages/markdown",
        "highlight.js/lib/languages/diff",
        "highlight.js/lib/languages/kotlin",
        "highlight.js/lib/languages/swift",
        "highlight.js/lib/languages/php",
        "highlight.js/lib/languages/ruby",
        "highlight.js/lib/languages/lua",
        "highlight.js/lib/languages/dockerfile",
      ],
    },
  },
});
