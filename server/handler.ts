/**
 * HTTP handler for GET /api/fetch-recipe?url=…
 *
 * The smallest possible backend: it only fetches allowlisted recipe pages and
 * returns their HTML. Parsing happens in the browser, so no recipe or personal
 * data is stored or logged on the server.
 *
 * Used both by the Vite dev server (middleware) and by server/index.ts in production.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FetchPageError, fetchRecipePage } from './fetchPage.ts'
import { FetchPolicyError } from './ssrf.ts'

export const API_PATH = '/api/fetch-recipe'

const RATE_LIMIT = 30 // requests
const RATE_WINDOW_MS = 60_000
const buckets = new Map<string, { count: number; reset: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS })
    if (buckets.size > 1000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
    return false
  }
  b.count++
  return b.count > RATE_LIMIT
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

export async function handleFetchRecipe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, { ok: false, code: 'method', message: 'Vain GET on sallittu.' })
  const ip = req.socket.remoteAddress ?? 'unknown'
  if (rateLimited(ip)) return send(res, 429, { ok: false, code: 'rate-limit', message: 'Liian monta pyyntöä – odota hetki.' })
  const params = new URL(req.url ?? '', 'http://localhost').searchParams
  const target = params.get('url')
  if (!target || target.length > 2048) return send(res, 400, { ok: false, code: 'invalid-url', message: 'Osoite puuttuu tai on liian pitkä.' })
  try {
    const page = await fetchRecipePage(target, { allowAnyHost: process.env.RECIPE_FETCH_ALLOW_ANY_HOST === '1' })
    send(res, 200, { ok: true, ...page })
  } catch (err) {
    if (err instanceof FetchPolicyError) return send(res, 403, { ok: false, code: err.code, message: err.message })
    if (err instanceof FetchPageError) {
      const status = err.code === 'timeout' ? 504 : err.code === 'too-large' ? 413 : 502
      return send(res, status, { ok: false, code: err.code, message: err.message, upstreamStatus: err.status })
    }
    send(res, 500, { ok: false, code: 'internal', message: 'Odottamaton virhe sivun haussa.' })
  }
}
