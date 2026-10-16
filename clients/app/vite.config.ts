import { defineConfig } from "vite";

// The launcher page bundled into the app. Tauri serves it in production and expects the
// dev server on a fixed port.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
