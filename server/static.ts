/**
 * Static file serving for the built app with security headers.
 * Never throws: malformed requests get 400/403 instead of crashing the process.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * The app loads scripts, styles, fonts and data only from itself. Recipe images are
 * hot-linked from the recipe sites, so images may come from any https origin.
 * Inline style attributes are used by React for progress bars, hence 'unsafe-inline' for styles only.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * The service worker caches recipe images from the recipe sites for offline use. Fetches made
 * inside a worker are governed by the worker script's own CSP (connect-src), so only the worker
 * scripts get https: in connect-src – the page itself stays limited to 'self'.
 */
export const WORKER_CONTENT_SECURITY_POLICY = "default-src 'self'; connect-src 'self' https:; img-src 'self' https: data: blob:; object-src 'none'"

const WORKER_SCRIPT = /^\/(sw\.js|workbox-[\w-]+\.js)$/

export function setSecurityHeaders(res: ServerResponse, pathname = '') {
  res.setHeader('Content-Security-Policy', WORKER_SCRIPT.test(pathname) ? WORKER_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
}

function fail(res: ServerResponse, status: number) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(status === 400 ? 'Bad request' : status === 405 ? 'Method not allowed' : 'Forbidden')
}

export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    setSecurityHeaders(res)
    return fail(res, 400)
  }
  setSecurityHeaders(res, pathname)
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405)
  if (pathname.includes('\0')) return fail(res, 400)
  // No dotfiles (.env, .git …) even if they ended up in the build output.
  if (pathname.split('/').some((seg) => seg.startsWith('.') && seg.length > 1)) return fail(res, 403)
  let file = normalize(join(root, pathname))
  if (file !== root && !file.startsWith(root + sep)) return fail(res, 403)
  try {
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html') // SPA fallback
  } catch {
    file = join(root, 'index.html')
  }
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => {
    if (!res.headersSent) fail(res, 404)
    else res.destroy()
  })
  stream.pipe(res)
}
