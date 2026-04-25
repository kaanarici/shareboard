import { defineConfig, type Connect, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * TanStack Start dev CSS resolves Fontsource to absolute `/node_modules/@fontsource-variable/.../*.woff2`
 * URLs, but Vite does not serve that tree to the browser. Serve those .woff2 files only (avoids
 * rewriting `url()` to `/@fs/...`, which Tailwind v4’s CSS transform rejects).
 */
function fontsourceNodeModulesWoff2DevServer(): Plugin {
  const allowRoot = path.resolve(projectRoot, "node_modules/@fontsource-variable");
  return {
    name: "fontsource-node-modules-woff2",
    apply: "serve",
    configureServer(server) {
      // Must run *before* Vite's static/transform pipeline, which 404s bare `/node_modules/...` paths.
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const pathname = req.url?.split("?")[0] ?? "";
        if (!pathname.startsWith("/node_modules/@fontsource-variable/") || !pathname.endsWith(".woff2")) {
          next();
          return;
        }
        const filePath = path.resolve(projectRoot, pathname.slice(1));
        if (!filePath.startsWith(allowRoot)) {
          next();
          return;
        }
        void fs
          .readFile(filePath)
          .then((data) => {
            res.setHeader("Content-Type", "font/woff2");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            if (req.method === "HEAD") {
              res.end();
            } else {
              res.end(data);
            }
          })
          .catch(() => {
            next();
          });
      };
      (server.middlewares as { stack: { route: string; handle: Connect.NextHandleFunction }[] }).stack.unshift(
        { route: "", handle: handler }
      );
    },
  };
}

export default defineConfig({
  server: { port: 3000 },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
    },
  },
  // Packages that don't ship clean ESM (CSS imports, CJS-in-ESM files, etc.) must be
  // bundled through Vite's SSR pipeline instead of loaded by Node's native ESM loader.
  ssr: {
    noExternal: ["youtube-transcript", "react-tweet"],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    // Nitro emits the server bundle consumed by TanStack Start's deployment adapters.
    nitro(),
    fontsourceNodeModulesWoff2DevServer(),
    viteReact(),
  ],
});
