import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      DATABASE_URL: "file:./test.db",
      JWT_SECRET: "test-only-R7!mQ2#vL9@xP4$kN8&cW5-z",
    },
  },
});
