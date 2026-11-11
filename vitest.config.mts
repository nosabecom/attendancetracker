import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/convex/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
