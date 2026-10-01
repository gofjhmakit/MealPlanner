import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveStatic } from '../server/static'

const ROOT = join(import.meta.dirname, 'fixtures', 'static')
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => serveStatic(ROOT, req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

/** Raw request so malformed paths reach the server unmodified. */
async function raw(path: string, method = 'GET') {
  const { request } = await import('node:http')
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(`${base}/`, { method, path }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('static server hardening', () => {
  it('serves files and falls back to index.html for app routes', async () => {
    expect((await raw('/assets/app.js')).body).toContain('console.log')
    expect((await raw('/reseptit/abc')).body).toContain('<title>app</title>')
  })

  it('does not crash on malformed percent-encoding (regression: process exit)', async () => {
    expect((await raw('/%E0%A4%A')).status).toBe(400)
    expect((await raw('/')).status).toBe(200) // still alive
  })

  it('blocks traversal and dotfiles', async () => {
    const t = await raw('/../package.json')
    expect(t.body).not.toContain('"name"')
    expect((await raw('/%2e%2e/%2e%2e/package.json')).body).not.toContain('"name"')
    expect((await raw('/.secret')).status).toBe(403)
    expect((await raw('/assets/%00x')).status).toBe(400)
  })

  it('sends security headers', async () => {
    const r = await raw('/')
    expect(String(r.headers['content-security-policy'])).toContain("script-src 'self'")
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'")
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })

  it('gives only the service worker scripts https fetch access (offline image cache)', async () => {
    const { WORKER_CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY } = await import('../server/static')
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self';")
    expect(WORKER_CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https:")
    expect(String((await raw('/sw.js')).headers['content-security-policy'])).toBe(WORKER_CONTENT_SECURITY_POLICY)
    expect(String((await raw('/assets/app.js')).headers['content-security-policy'])).toBe(CONTENT_SECURITY_POLICY)
  })

  it('rejects unexpected methods', async () => {
    expect((await raw('/', 'POST')).status).toBe(405)
  })
})
