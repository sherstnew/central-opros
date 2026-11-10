import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2}"] },
      includeAssets: [
        "icon.svg",
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        id: "/",
        name: "Отклик",
        short_name: "Отклик",
        lang: "ru",
        description: "Платные опросы и учёт участия",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#FAFAFA",
        theme_color: "#FAFAFA",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  test: {
    environment: "node",
    env: {
      MONGODB_URI: "",
      MONGODB_DB_NAME: "",
      NODE_ENV: "test",
      PROXYAPI_KEY: "",
      TELEGRAM_API_ID: "",
      TELEGRAM_API_HASH: "",
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
    },
  },
} as any);
