import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  build: { target: "chrome108", chunkSizeWarningLimit: 1000 },
});
