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
      // Sandboxed preloads must be CommonJS. Two entries: the main-window bridge
      // and the overlay bridge (Step 2.10, exposes only the WS connection info).
      lib: {
        entry: {
          index: resolve(import.meta.dirname, "src/preload/index.ts"),
          overlay: resolve(import.meta.dirname, "src/preload/overlay.ts"),
        },
        formats: ["cjs"],
      },
      rollupOptions: { output: { entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    build: {
      outDir: outDir("renderer"),
      // Two HTML entries: the main app window and the transparent overlay window.
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/renderer/index.html"),
          overlay: resolve(import.meta.dirname, "src/renderer/overlay.html"),
        },
      },
    },
    plugins: [react()],
  },
});
