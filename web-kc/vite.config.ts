import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The ntfy server only serves /static/*, /app.html and /sw.js from its embedded site
// (server.go staticRegex), so every built asset must live under static/.
export default defineConfig({
  build: {
    outDir: "build",
    assetsDir: "static/kc",
    sourcemap: false,
  },
  server: { port: 3000 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,mp3}"],
        globIgnores: ["config.js", "**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*"],
        // index.html is renamed to app.html when copied into server/site (see scripts/to-site.ts)
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((e) => (e.url === "index.html" ? { ...e, url: "app.html" } : e)),
          }),
        ],
      },
      // Production manifest is served by the Go server (handleWebManifest).
      manifest: false,
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: "node",
  },
} as any);
