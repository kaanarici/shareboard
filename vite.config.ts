import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

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
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
