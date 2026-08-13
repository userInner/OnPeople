import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Content-Security-Policy for packaged builds. The same dist/index.html is
// loaded by both the Electron shell (which otherwise ships no CSP) and the
// Tauri shell, so this must stay a superset of the Tauri header policy in
// src-tauri/tauri.conf.json; it only adds strictly tighter directives
// (object-src/base-uri/form-action) on top of it.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "connect-src 'self' ipc: http://ipc.localhost https://api.aibro.vip wss://api.aibro.vip",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' asset: data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "frame-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

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
    {
      // Only packaged builds get the CSP and lose the dev-only diagnostic
      // probe; the Vite dev server keeps its inline scripts for HMR.
      name: "onpeople-production-csp",
      apply: "build",
      transformIndexHtml(html) {
        const withoutProbe = html.replace(/\s*<script>[\s\S]*?<\/script>/, "");
        return withoutProbe.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`,
        );
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
    sourcemap: false,
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
