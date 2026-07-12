import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const outDir = (sub: string): string => resolve(import.meta.dirname, "out", sub);

// @lodestar/* workspace packages ship as TS source and must be BUNDLED (not
// externalized), or the runtime require() hits raw .ts. Derived from package.json
// so onboarding a new workspace dep needs no edit here.
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const workspaceDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@lodestar/"));

export default defineConfig({
  main: {
    // CJS output avoids Electron's ESM named-import interop gaps for `electron`.
    plugins: [externalizeDepsPlugin({ exclude: workspaceDeps })],
    build: {
      outDir: outDir("main"),
      lib: { entry: resolve(import.meta.dirname, "src/main/index.ts"), formats: ["cjs"] },
      rollupOptions: { output: { entryFileNames: "index.cjs" } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@lodestar/shared"] })],
    build: {
      outDir: outDir("preload"),
      // Sandboxed preloads must be CommonJS.
      lib: { entry: resolve(import.meta.dirname, "src/preload/index.ts"), formats: ["cjs"] },
      rollupOptions: { output: { entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    build: {
      outDir: outDir("renderer"),
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react()],
  },
});
