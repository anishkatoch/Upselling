import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.BACKEND_URL || "http://localhost:8000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: true } },
  },
  build: {
    // FastAPI serves this folder directly - no Node process needed once this is built.
    outDir: "../src/upsell_poc/api/static",
    emptyOutDir: true,
  },
});
