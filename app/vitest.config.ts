import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": r("."),
      "@app": r("."),
      "@db": r("lib/db"),
      "@platforms": r("lib/platforms"),
    },
  },
});
