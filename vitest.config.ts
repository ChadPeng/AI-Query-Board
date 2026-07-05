import { defineConfig } from "vitest/config";

// Mirror the tsconfig "@/*" path alias so tests import modules the same way the
// app does. Node 20+ exposes import.meta.dirname.
export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
