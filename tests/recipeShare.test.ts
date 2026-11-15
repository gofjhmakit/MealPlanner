import { describe, expect, it } from 'vitest'
import type { Recipe, RecipeIngredient } from '../src/domain/types'
import {
  createFrameCollector,
  decodeFrames,
  encodeRecipe,
  parseFrame,
  recipeToSharePayload,
  SINGLE_MAX_CHARS,
  type ParsedFrame,
} from '../src/share/recipeShare'
import { sharePayloadToRecipe } from '../src/share/importShare'
import { fineliLookup } from './helpers'

function ing(raw: string, extra: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: 'ing-' + raw,
    raw,
    group: null,
    quantity: null,
    unit: null,
    name: raw,
    confidence: 1,
    matchMethod: 'exact',
    userOverride: false,
    scaling: 'linear',
    optional: false,
    canonicalId: null,
    fineliId: null,
    ...extra,
  }
}

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'r1',
    title: 'Mummon pannukakku',
    description: 'Uunissa paistettava.',
    servings: 4,
    servingsText: null,
    prepTimeMin: 10,
    cookTimeMin: 30,
    totalTimeMin: 40,
    timeText: null,
    imageUrl: null,
    ingredients: [ing('2 dl vehnäjauhoja'), ing('5 dl maitoa'), ing('2 kananmunaa'), ing('ripaus suolaa', { group: 'Taikina' })],
    instructions: ['Sekoita ainekset.', 'Paista uunissa 225 °C noin 30 min.'],
    tags: ['jälkiruoka', 'tyyppi:dessert'],
    category: 'Jälkiruoat',
    cuisine: null,
    origin: 'user',
    sourceId: null,
    sourceUrl: null,
    sourceName: null,
    author: null,
    attribution: null,
    sourceNutrition: null,
    importReport: null,
    inCollection: true,
    notes: 'Lapset tykkäsivät.',
    rating: 5,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** Deterministic high-entropy text, so "big" recipes really exceed one frame (real prose compresses, pure repeats collapse). */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
function noisyLines(n: number, seed = 7): string[] {
  const rnd = seeded(seed)
  const alpha = 'abcdefghijklmnopqrstuvwxyzåäö '
  return Array.from({ length: n }, (_, i) => {
    let line = `Vaihe ${i + 1}: `
    for (let k = 0; k < 90; k++) line += alpha[Math.floor(rnd() * alpha.length)]
    return line
  })
}

function collectAll(frames: string[]) {
  const collector = createFrameCollector()
  let payload
  for (const f of frames) {
    const r = collector.add(f)
    if (r.status === 'complete') payload = r.payload
    if (r.status === 'error') throw new Error('collector error: ' + r.message)
  }
  return payload
}

describe('recipe QR share – single frame', () => {
  it('encodes a normal recipe into one scannable frame', () => {
    const enc = encodeRecipe(makeRecipe())
    expect(enc.total).toBe(1)
    expect(enc.frames).toHaveLength(1)
    expect(enc.frames[0].startsWith('LR1.')).toBe(true)
    expect(enc.frames[0].length).toBeLessThan(SINGLE_MAX_CHARS + 40)
  })

  it('round-trips all authored fields through one frame', () => {
    const recipe = makeRecipe()
    const enc = encodeRecipe(recipe)
    const payload = collectAll(enc.frames)
    expect(payload).toBeDefined()
    expect(payload!.t).toBe(recipe.title)
    expect(payload!.i.map((x) => x.r)).toEqual(recipe.ingredients.map((x) => x.raw))
    expect(payload!.i[3].g).toBe('Taikina')
    expect(payload!.n).toEqual(recipe.instructions)
    expect(payload!.no).toBe('Lapset tykkäsivät.')
    // the auto "tyyppi:" tag is stripped; real tags are kept
    expect(payload!.tg).toEqual(['jälkiruoka'])
  })
})

describe('recipe QR share – multi frame', () => {
  const bigInstructions = noisyLines(60)
  const big = makeRecipe({ instructions: bigInstructions })

  it('splits a large recipe into several frames, all tagged with the same id and total', () => {
    const enc = encodeRecipe(big)
    expect(enc.total).toBeGreaterThan(1)
    for (const f of enc.frames) {
      const p = parseFrame(f)!
      expect(p).not.toBeNull()
      expect(p.id).toBe(enc.id)
      expect(p.total).toBe(enc.total)
    }
    expect(enc.frames.map((f) => parseFrame(f)!.seq)).toEqual(Array.from({ length: enc.total }, (_, i) => i + 1))
  })

  it('reassembles regardless of scan order', () => {
    const enc = encodeRecipe(big)
    const shuffled = [...enc.frames].reverse()
    const payload = collectAll(shuffled)
    expect(payload).toBeDefined()
    expect(payload!.n).toEqual(bigInstructions)
  })

  it('tolerates duplicate scans of the same frame (the real camera case)', () => {
    const enc = encodeRecipe(big)
    const withDupes = enc.frames.flatMap((f) => [f, f, f])
    const payload = collectAll(withDupes)
    expect(payload!.n).toEqual(bigInstructions)
  })

  it('preserves historical attribution / original text', () => {
    const recipe = makeRecipe({
      attribution: { license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', originalText: 'Taack hälften miölk...', originalYear: 1849, originalTitle: 'Pannkaka', changes: 'Käännetty nykykielelle', imageCredit: null, imageLicense: null, imageLicenseUrl: null },
    })
    const payload = collectAll(encodeRecipe(recipe).frames)!
    expect(payload.at).toEqual({ l: 'CC BY-SA 4.0', lu: 'https://creativecommons.org/licenses/by-sa/4.0/', ot: 'Taack hälften miölk...', oy: 1849, oti: 'Pannkaka', ch: 'Käännetty nykykielelle' })
  })
})

describe('frame parsing and collector robustness', () => {
  it('ignores anything that is not an LR1 frame', () => {
    expect(parseFrame('https://example.com/recipe')).toBeNull()
    expect(parseFrame('LR1.')).toBeNull()
    expect(parseFrame('LR1.abcd.0.3.xyz')).toBeNull() // seq 0 invalid
    expect(parseFrame('LR1.abcd.4.3.xyz')).toBeNull() // seq > total
    expect(parseFrame('')).toBeNull()
  })

  it('a live collector ignores foreign QR codes while scanning', () => {
    const enc = encodeRecipe(makeRecipe())
    const collector = createFrameCollector()
    expect(collector.add('WIFI:S:home;;').status).toBe('ignored')
    expect(collector.add('https://valio.fi').status).toBe('ignored')
    const r = collector.add(enc.frames[0])
    expect(r.status).toBe('complete')
  })

  it('restarts cleanly when a different recipe is scanned mid-way', () => {
    const a = encodeRecipe(makeRecipe({ instructions: noisyLines(60, 11) }))
    const b = encodeRecipe(makeRecipe({ title: 'Toinen resepti' }))
    expect(a.total).toBeGreaterThan(1)
    const collector = createFrameCollector()
    collector.add(a.frames[0]) // partial A
    const r = collector.add(b.frames[0]) // whole B appears → should finish B
    expect(r.status === 'complete' && r.payload.t).toBe('Toinen resepti')
  })

  it('reports incomplete when a frame is missing', () => {
    const enc = encodeRecipe(makeRecipe({ instructions: noisyLines(60, 13) }))
    expect(enc.total).toBeGreaterThan(1)
    const parsed = enc.frames.slice(0, -1).map((f) => parseFrame(f)!) as ParsedFrame[]
    expect(() => decodeFrames(parsed)).toThrowError(/Puuttuu|puuttuu/)
  })

  it('reports corrupt data when a chunk is damaged', () => {
    const enc = encodeRecipe(makeRecipe())
    const frame = parseFrame(enc.frames[0])!
    const damaged: ParsedFrame = { ...frame, chunk: frame.chunk.slice(0, -4) + 'AAAA' }
    expect(() => decodeFrames([damaged])).toThrow()
  })
})

describe('sharePayloadToRecipe', () => {
  it('rebuilds a usable recipe and re-matches ingredients against Fineli', () => {
    const original = makeRecipe()
    const payload = recipeToSharePayload(original)
    const rebuilt = sharePayloadToRecipe(payload, { fineli: fineliLookup() }, 2)
    expect(rebuilt.id).not.toBe(original.id) // fresh local recipe
    expect(rebuilt.origin).toBe('imported')
    expect(rebuilt.title).toBe(original.title)
    expect(rebuilt.instructions).toEqual(original.instructions)
    expect(rebuilt.ingredients).toHaveLength(original.ingredients.length)
    expect(rebuilt.ingredients[3].group).toBe('Taikina')
    expect(rebuilt.notes).toBe('Lapset tykkäsivät.')
    // at least the milk/flour/egg lines should match something in Fineli
    const matched = rebuilt.ingredients.filter((i) => i.fineliId !== null)
    expect(matched.length).toBeGreaterThan(0)
  })

  it('falls back to the default servings when none was shared', () => {
    const payload = recipeToSharePayload(makeRecipe({ servings: 4 }))
    delete payload.s
    const rebuilt = sharePayloadToRecipe(payload, { fineli: fineliLookup() }, 6)
    expect(rebuilt.servings).toBe(6)
  })

  it('full share → scan → import round trip (the real multi-frame path)', () => {
    const original = makeRecipe({ instructions: noisyLines(60, 21), notes: 'Isoäidin resepti' })
    const enc = encodeRecipe(original)
    expect(enc.total).toBeGreaterThan(1) // exercises the multi-frame reassembly
    // simulate a camera catching frames out of order, with repeats and a stray QR
    const scanned = ['https://example.com', ...[...enc.frames].reverse(), enc.frames[0]]
    const payload = collectAll(scanned)
    expect(payload).toBeDefined()
    const rebuilt = sharePayloadToRecipe(payload!, { fineli: fineliLookup() }, 2)
    expect(rebuilt.title).toBe(original.title)
    expect(rebuilt.instructions).toEqual(original.instructions)
    expect(rebuilt.notes).toBe('Isoäidin resepti')
    expect(rebuilt.ingredients.map((i) => i.raw)).toEqual(original.ingredients.map((i) => i.raw))
  })
})
