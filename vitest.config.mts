import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests must be deterministic: never hand leads to a local AI agent that happens to be running.
    env: { CUEWORK_AI_AGENT: "off" },
  },
});
