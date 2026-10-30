import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  cacheDir: "node_modules/.vite-qa",
  optimizeDeps: { entries: ["tests/ui/*.html", "tests/auth-continuity.html"] },
  plugins: [
    {
      name: "local-fixture-only",
      enforce: "pre",
      resolveId(source, importer) {
        if(source==='firebase/firestore' && importer?.replace(/\\/g,'/').endsWith('/src/feedback.tsx'))
          return resolve('tests/ui/feedback-firestore.ts');
        if (
          source === "./service" &&
          importer?.replace(/\\/g, "/").includes("/src/")
        )
          return resolve("tests/ui/app-service.ts");
      },
    },
    react(),
  ],
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
