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
  vite: {
    plugins: [appFallback()],
    optimizeDeps: {
      exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
    },
  },
});
