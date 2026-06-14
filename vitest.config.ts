import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      ".cache/**",
      ".pnpm-store/**",
      ".worktrees/**",
      "coverage/**",
      "dist/**",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["tests/**"],
      reporter: ["text", "lcov", "json-summary", "cobertura"],
      reportsDirectory: "coverage",
    },
  },
});
