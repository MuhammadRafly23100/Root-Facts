import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'icons/apple-touch-icon.png', 'model/*'],
      manifest: {
        name: 'RootFacts — Deteksi Sayuran & Fun Fact AI',
        short_name: 'RootFacts',
        description:
          'Deteksi sayuran realtime dengan Computer Vision (TensorFlow.js) dan fun fact dari Generative AI (Transformers.js). Progressive Web App yang bisa dipasang & berjalan offline.',
        theme_color: '#10b981',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'id',
        icons: [
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache shell + model TensorFlow.js lokal (agar deteksi langsung offline).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,bin,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Runtime ONNX/WASM Transformers.js yang di-bundle lokal (>batas precache).
            // Di-cache saat pemakaian pertama agar AI tetap jalan offline sesudahnya.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-wasm',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Model Generative AI (bobot & konfigurasi) dari Hugging Face Hub.
            urlPattern: ({ url }) =>
              url.hostname.includes('huggingface.co') ||
              url.hostname.includes('hf.co') ||
              url.hostname.includes('cdn-lfs'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-models',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Runtime ONNX/WASM Transformers.js dari CDN jsDelivr.
            urlPattern: ({ url }) => url.hostname.includes('cdn.jsdelivr.net'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'transformers-runtime',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts — stylesheet.
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // Google Fonts — file font.
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Nonaktif saat dev; uji Service Worker via `npm run build` + `npm run preview`.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 3001,
    host: true,
  },
});
