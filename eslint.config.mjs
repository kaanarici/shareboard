import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    ".output/**",
    "dist/**",
    "node_modules/**",
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
    "public/sw.js",
  ]),
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
    plugins: { ...config.plugins, "react-hooks": reactHooks },
    rules: {
      ...config.rules,
      // Selective subset: keep the classic hook checks; skip the React-19-era
      // `refs` and `set-state-in-effect` rules — they flag the intentional
      // latest-handler ref pattern used throughout this codebase.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // tsc handles unused variables; @typescript-eslint trips on type-only patterns.
      "@typescript-eslint/no-unused-vars": "off",
      // Empty catch blocks are an intentional best-effort pattern here.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  })),
]);
