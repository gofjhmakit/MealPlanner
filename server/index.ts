/**
 * Production server: serves the built app (dist/) and the recipe fetch endpoint.
 *   npm run build && npm start      -> http://localhost:4173
 * Environment: PORT, HOST (default 127.0.0.1 – local use only),
 *              RECIPE_FETCH_ALLOW_ANY_HOST=1, RECIPE_FETCH_EXTRA_DOMAINS=a.fi,b.fi
 */
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { API_PATH, handleFetchRecipe } from './handler.ts'
import { serveStatic, setSecurityHeaders } from './static.ts'

const ROOT = resolve(import.meta.dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 4173)
const HOST = process.env.HOST ?? '127.0.0.1'

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('dist/ puuttuu. Aja ensin: npm run build')
  process.exit(1)
}

createServer((req, res) => {
  try {
    if ((req.url ?? '').split('?')[0] === API_PATH) {
      setSecurityHeaders(res)
      handleFetchRecipe(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500
        res.end()
      })
      return
    }
    serveStatic(ROOT, req, res)
  } catch {
    // Last line of defence: a single bad request must never take the server down.
    if (!res.headersSent) res.statusCode = 500
    res.end()
  }
}).listen(PORT, HOST, () => {
  console.log(`Lautanen: http://${HOST}:${PORT}`)
})
