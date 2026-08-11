import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tauri serves bundled assets from a custom protocol. Keep generated asset
  // URLs relative so the same build works for every native window route.
  base: "./",
  plugins: [
    react(),
    {
      name: "tauri-webkit-local-assets",
      enforce: "post",
      transformIndexHtml(html) {
        // WebKit treats `crossorigin` as an explicit CORS request. Tauri's
        // bundled custom protocol is already same-origin and does not need it.
        return html.split(" crossorigin").join("");
      },
    },
  ],
  root: ".",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: ["es2022", "chrome120", "safari15"],
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./frontend/src/test/setup.ts"],
    css: true,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
