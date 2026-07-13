import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Main-process + preload logic runs under Node (no DOM needed in Phase 0).
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", "out/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        // Runtime entry points: the app bootstrap, the React mount, and the
        // build-time theme preset are created/loaded only in the real Electron/
        // React runtime. Their wiring is proven end-to-end by the Playwright e2e
        // (boot/secrets/persist specs), not reachable by a Node unit test.
        "src/main/index.ts",
        "src/renderer/main.tsx",
        "src/renderer/theme/tailwind-preset.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
