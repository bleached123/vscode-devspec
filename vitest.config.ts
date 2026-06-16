import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Co-located unit tests: src/**/*.test.ts. The extension host and webview
    // bundles never import these, so they cost nothing at runtime.
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/webview/**"],
    },
  },
});
