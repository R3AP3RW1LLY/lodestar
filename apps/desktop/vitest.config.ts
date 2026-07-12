import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Main-process + preload logic runs under Node (no DOM needed in Phase 0).
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", "out/**"],
  },
});
