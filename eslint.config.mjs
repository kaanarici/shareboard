import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([".output/**", "dist/**", "src/routeTree.gen.ts"]),
]);
