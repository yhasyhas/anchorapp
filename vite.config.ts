import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// Matches any Supabase project subdomain (auth / REST / storage all live under
// the same *.supabase.co host) — offline-sync.ts owns the offline data story,
// so the service worker must never cache these responses.
const SUPABASE_URL_PATTERN = /^https:\/\/[^/]+\.supabase\.co\/.*/i

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // We drive the update UX ourselves (see PwaUpdateToast) instead of letting
      // Workbox auto-reload: a silent forced reload could wipe an anchor task or
      // check-in reflection the user is mid-typing. `prompt` installs the new SW
      // in the background and waits for an explicit user action before activating it.
      registerType: "prompt",
      injectRegister: false,
      // public/manifest.json + the <link rel="manifest"> in index.html are already
      // in place (icons, name, theme colors) — don't generate/inject a second one.
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        // Push/notificationclick handlers, kept as a plain hand-written file (not
        // built from TS) and pulled into the generated sw.js via importScripts —
        // simpler than switching the whole plugin to injectManifest just for this.
        importScripts: ["push-sw.js"],
        // Offline SPA navigation: any route not already precached falls back to
        // the shell so react-router can take over once the app boots.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Supabase auth/session/REST/storage calls — never cache.
          {
            urlPattern: SUPABASE_URL_PATTERN,
            handler: "NetworkOnly",
            method: "GET",
          },
          {
            urlPattern: SUPABASE_URL_PATTERN,
            handler: "NetworkOnly",
            method: "POST",
          },
          {
            urlPattern: SUPABASE_URL_PATTERN,
            handler: "NetworkOnly",
            method: "PUT",
          },
          {
            urlPattern: SUPABASE_URL_PATTERN,
            handler: "NetworkOnly",
            method: "PATCH",
          },
          {
            urlPattern: SUPABASE_URL_PATTERN,
            handler: "NetworkOnly",
            method: "DELETE",
          },
          // /api/insights (Vercel Edge Function) — always live, never served from cache.
          {
            urlPattern: /^\/api\/insights/,
            handler: "NetworkOnly",
            method: "POST",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
