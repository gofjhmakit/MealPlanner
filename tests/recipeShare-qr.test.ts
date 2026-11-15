/**
 * Integration: prove the *visual* pipeline, not just the byte codec. Render each
 * frame with the same library the app uses (qrcode), decode the pixels back with
 * the same scanner the app uses (jsQR), feed them through the collector, and
 * check the recipe survives. This is the deterministic stand-in for pointing a
 * phone at the screen.
 */
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import type { Recipe, RecipeIngredient } from '../src/domain/types'
import { createFrameCollector, encodeRecipe } from '../src/share/recipeShare'

function ing(raw: string): RecipeIngredient {
  return { id: 'i-' + raw, raw, group: null, quantity: null, unit: null, name: raw, confidence: 1, matchMethod: 'exact', userOverride: false, scaling: 'linear', optional: false, canonicalId: null, fineliId: null }
}

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'r1', title: 'Uunipannukakku', description: null, servings: 6, servingsText: null,
    prepTimeMin: 10, cookTimeMin: 30, totalTimeMin: 40, timeText: null, imageUrl: null,
    ingredients: [ing('6 dl maitoa'), ing('3 kananmunaa'), ing('3 dl vehnäjauhoja'), ing('1 tl suolaa')],
    instructions: ['Vatkaa munat ja maito.', 'Lisää jauhot ja suola.', 'Paista 225 °C noin 30 min.'],
    tags: [], category: null, cuisine: null, origin: 'user', sourceId: null, sourceUrl: null, sourceName: null,
    author: null, attribution: null, sourceNutrition: null, importReport: null, inCollection: true, notes: null,
    rating: null, createdAt: now, updatedAt: now, ...over,
  }
}

/** Render a frame string to an RGBA image the way a screen would show it. */
function renderFrame(text: string, scale = 6, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const dim = (n + quiet * 2) * scale
  const img = new Uint8ClampedArray(dim * dim * 4).fill(255)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.data[y * n + x]) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (quiet + x) * scale + dx
          const py = (quiet + y) * scale + dy
          const idx = (py * dim + px) * 4
          img[idx] = img[idx + 1] = img[idx + 2] = 0
        }
      }
    }
  }
  return { data: img, dim, version: qr.version }
}

function scan(text: string): string {
  const { data, dim } = renderFrame(text)
  const code = jsQR(data, dim, dim, { inversionAttempts: 'dontInvert' })
  if (!code) throw new Error('jsQR failed to decode frame')
  return code.data
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32)
}
function noisyLines(n: number, seed = 5): string[] {
  const rnd = seeded(seed)
  const alpha = 'abcdefghijklmnopqrstuvwxyzåäö '
  return Array.from({ length: n }, (_, i) => {
    let line = `Vaihe ${i + 1}: `
    for (let k = 0; k < 90; k++) line += alpha[Math.floor(rnd() * alpha.length)]
    return line
  })
}

describe('QR generate → scan round trip (real qrcode + jsQR)', () => {
  it('a single-frame recipe renders to a scannable code that decodes exactly', () => {
    const enc = encodeRecipe(makeRecipe())
    expect(enc.total).toBe(1)
    const decoded = scan(enc.frames[0])
    expect(decoded).toBe(enc.frames[0])
    const collector = createFrameCollector()
    const r = collector.add(decoded)
    expect(r.status).toBe('complete')
    expect(r.status === 'complete' && r.payload.t).toBe('Uunipannukakku')
  })

  it('every frame stays within the scannable QR version range', () => {
    const enc = encodeRecipe(makeRecipe({ instructions: noisyLines(60) }))
    expect(enc.total).toBeGreaterThan(1)
    for (const f of enc.frames) expect(renderFrame(f).version).toBeLessThanOrEqual(27)
  })

  it('a multi-frame recipe scans frame by frame and reassembles', () => {
    const instructions = noisyLines(60)
    const enc = encodeRecipe(makeRecipe({ instructions }))
    expect(enc.total).toBeGreaterThan(1)
    const collector = createFrameCollector()
    let payload
    // scan each rendered frame once, as the animation cycles through them
    for (const frame of enc.frames) {
      const res = collector.add(scan(frame))
      if (res.status === 'complete') payload = res.payload
    }
    expect(payload).toBeDefined()
    expect(payload!.n).toEqual(instructions)
    expect(payload!.i).toHaveLength(4)
  })
})
