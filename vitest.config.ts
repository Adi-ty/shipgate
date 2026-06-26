import { defineConfig } from "vitest/config";

// Real git subprocesses run inside the suites, so hooks that build throwaway
// repos need a generous timeout. Tests themselves stay fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
