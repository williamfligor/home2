import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.eval.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: [["default", { summary: false }]],
  },
});
