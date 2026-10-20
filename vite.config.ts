import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shareTargetSwSource } from "./src/lib/share-target-sw-source.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function writeShareTargetServiceWorker(): Plugin {
  const write = async () => {
    await fs.writeFile(path.join(projectRoot, "public/share-sw.js"), shareTargetSwSource());
  };
  return {
    name: "share-target-sw",
    async buildStart() {
      await write();
    },
    async configureServer() {
      await write();
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
  ssr: {
    noExternal: ["react-tweet"],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    writeShareTargetServiceWorker(),
    viteReact(),
  ],
});
