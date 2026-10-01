import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { API_PATH, handleFetchRecipe } from './server/handler.ts'

/** Mounts the recipe fetch endpoint into the Vite dev/preview server (same handler as production). */
function recipeFetchApi(): Plugin {
  const mount = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith(API_PATH)) void handleFetchRecipe(req, res)
      else next()
    })
  }
  return { name: 'recipe-fetch-api', configureServer: mount, configurePreviewServer: mount }
}

// GitHub Pages and other sub-path hosting: BASE_PATH=/MealPlanner/ npm run build
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    recipeFetchApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Ateriasuunnittelija',
        short_name: 'Ateriat',
        description: 'Reseptit, ruokalista, ostoslista ja ravintosisältöarviot – Fineli-tietojen pohjalta.',
        lang: 'fi',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f7f5f0',
        theme_color: '#2f6b4f',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only Latin font subsets are needed for Finnish; other subsets load on demand if ever used.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'assets/*-latin-wght-*.woff2', 'assets/*-latin-ext-wght-*.woff2', 'data/*.json'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/\/api\//],
        runtimeCaching: [
          {
            // Recipe images from source sites: cache what the user has already seen.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'recipe-images', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, watch: { ignored: ['**/scratch/**', '**/research/**', '**/data/**'] } },
})
