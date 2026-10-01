/**
 * Fetch one recipe page with strict limits:
 *   - connection pinned to the SSRF-validated IP address
 *   - manual redirects (max 3), each re-validated
 *   - overall timeout, response size limit (after decompression), HTML content types only
 */
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import { validateTarget, type PolicyOptions } from './ssrf.ts'

export const FETCH_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
export const MAX_REDIRECTS = 3
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Ateriasuunnittelija/1.0 (personal recipe import)'

export class FetchPageError extends Error {
  code: 'timeout' | 'too-large' | 'bad-status' | 'not-html' | 'too-many-redirects' | 'network' | 'blocked'
  status?: number
  constructor(code: FetchPageError['code'], message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface FetchedPage {
  requestedUrl: string
  finalUrl: string
  status: number
  html: string
}

function decode(buffer: Buffer, contentType: string): string {
  const charset = contentType.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase()
  try {
    return new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

function requestOnce(
  target: Awaited<ReturnType<typeof validateTarget>>,
  signal: AbortSignal,
): Promise<{ res: IncomingMessage; body: Readable }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:'
    const req = (isHttps ? httpsRequest : httpRequest)(
      target.url,
      {
        method: 'GET',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'fi-FI,fi;q=0.9,en;q=0.6',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        // Pin the connection to the address that passed SSRF validation.
        lookup: (_host, _opts, cb) => cb(null, [{ address: target.address, family: target.family }]),
      },
      (res) => {
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
        let body: Readable = res
        if (enc === 'gzip') body = res.pipe(createGunzip())
        else if (enc === 'deflate') body = res.pipe(createInflate())
        else if (enc === 'br') body = res.pipe(createBrotliDecompress())
        resolve({ res, body })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function readLimited(body: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of body) {
    size += (chunk as Buffer).length
    if (size > limit) {
      body.destroy()
      throw new FetchPageError('too-large', 'Sivu on liian suuri tuotavaksi.')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function fetchRecipePage(inputUrl: string, policy: PolicyOptions = {}): Promise<FetchedPage> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let current = inputUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await validateTarget(current, policy)
      let response
      try {
        response = await requestOnce(target, controller.signal)
      } catch (err) {
        if (controller.signal.aborted) throw new FetchPageError('timeout', 'Sivun haku aikakatkaistiin (10 s).')
        throw new FetchPageError('network', `Sivun haku epäonnistui: ${(err as Error).message}`)
      }
      const { res, body } = response
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        current = new URL(res.headers.location, target.url).toString()
        continue
      }
      const contentType = String(res.headers['content-type'] ?? '')
      let buffer: Buffer
      try {
        buffer = await readLimited(body, MAX_RESPONSE_BYTES)
      } catch (err) {
        if (controller.signal.aborted) throw new FetchPageError('timeout', 'Sivun haku aikakatkaistiin (10 s).')
        throw err
      }
      const html = decode(buffer, contentType)
      // Bot-protection interstitial (not just a page that embeds a Turnstile form widget)
      const challenge =
        /<title>\s*(Just a moment|Attention Required|Access denied|Vercel Security Checkpoint)/i.test(html) ||
        ((status === 403 || status === 429 || status === 503) && /cf-chl|challenge-platform|vercel security checkpoint/i.test(html))
      if (challenge) {
        throw new FetchPageError('blocked', 'Sivusto estää automaattisen haun (bottisuojaus). Liitä sivun HTML käsin.', status)
      }
      if (status < 200 || status >= 300) throw new FetchPageError('bad-status', `Sivusto vastasi virhekoodilla ${status}.`, status)
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new FetchPageError('not-html', 'Osoite ei palauttanut HTML-sivua.')
      }
      return { requestedUrl: inputUrl, finalUrl: target.url.toString(), status, html }
    }
    throw new FetchPageError('too-many-redirects', 'Liian monta uudelleenohjausta.')
  } finally {
    clearTimeout(timer)
  }
}
