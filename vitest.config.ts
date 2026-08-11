import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./frontend/src/test/setup.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "frontend/e2e/**",
        "scripts/**/*.test.mjs",
      ],
    },
  }),
);
