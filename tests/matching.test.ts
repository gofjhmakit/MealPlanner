import { describe, expect, it } from 'vitest'
import { INGREDIENTS } from '../src/domain/ingredients'
import { matchIngredient, searchFineli } from '../src/domain/matcher'
import { fineliLookup } from './helpers'

const ctx = () => ({ fineli: fineliLookup() })
const fineliName = (name: string) => {
  const m = matchIngredient(name, ctx())
  return m.fineliId !== null ? fineliLookup().get(m.fineliId)!.fi : null
}

describe('ingredient dictionary integrity', () => {
  it('every referenced Fineli food exists in the imported dataset', () => {
    const missing = INGREDIENTS.filter((i) => i.fineliId !== null && !fineliLookup().get(i.fineliId)).map((i) => `${i.id}:${i.fineliId}`)
    expect(missing).toEqual([])
  })

  it('ids are unique and confidences are in range', () => {
    const ids = INGREDIENTS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of INGREDIENTS) expect(i.fineliConfidence).toBeGreaterThan(0)
  })

  it('key Fineli mappings point at the expected foods', () => {
    const byId = new Map(INGREDIENTS.map((i) => [i.id, i]))
    const name = (id: string) => fineliLookup().get(byId.get(id)!.fineliId!)!.fi
    expect(name('milk-semi')).toMatch(/kevytmaito/i)
    expect(name('olive-oil')).toBe('Oliiviöljy')
    expect(name('olive')).toMatch(/^Oliivi,/)
    expect(name('egg')).toMatch(/Kananmuna/)
    expect(name('chicken-breast-strips')).toMatch(/Broileri, rintafilee/)
    expect(name('crushed-tomato')).toBe('Tomaattimurska')
    expect(name('wholegrain-pasta')).toMatch(/täysjyvä/i)
    expect(name('cream-cheese')).toMatch(/Tuorejuusto/)
  })
})

describe('ingredient normalization -> canonical ingredient', () => {
  it.each([
    ['kanasuikale', 'chicken-breast-strips'],
    ['broilerin suikale', 'chicken-breast-strips'],
    ['broilerin fileesuikaleita', 'chicken-breast-strips'],
    ['kanafileesuikale', 'chicken-breast-strips'],
    ['maitoa', 'milk'],
    ['kevytmaitoa', 'milk-semi'],
    ['rasvatonta maitoa', 'milk-skimmed'],
    ['spagettia', 'pasta'],
    ['täysjyväspagettia', 'wholegrain-pasta'],
    ['sipuli', 'onion'],
    ['oliiviöljyä', 'olive-oil'],
    ['tomaattimurskaa', 'crushed-tomato'],
    ['kananmunaa', 'egg'],
    ['voita', 'butter'],
    ['valkosipulinkynttä', 'garlic'],
    ['naudan jauhelihaa', 'beef-mince'],
    ['mozzarella raastetta', 'mozzarella'],
    ['kirsikkatomaatteja', 'cherry-tomato'],
    ['vettä', 'water'],
  ])('%s -> %s', (name, expected) => {
    expect(matchIngredient(name, ctx()).canonicalId).toBe(expected)
  })

  it('handles brand-prefixed product names (substitution to generic foods)', () => {
    expect(matchIngredient('Valio kevytmaito', ctx()).canonicalId).toBe('milk-semi')
    expect(matchIngredient('Rainbow kanafileesuikale', ctx()).canonicalId).toBe('chicken-breast-strips')
    expect(matchIngredient('Mutti tomaattimurska', ctx()).canonicalId).toBe('crushed-tomato')
    expect(matchIngredient('Fazer kauraleipä', ctx()).canonicalId).toBe('oat-bread')
  })

  it('keeps the original wording separate from the canonical name', () => {
    const m = matchIngredient('broilerin fileesuikaleita', ctx())
    expect(m.key).toBe('broileri fileesuikale')
    expect(m.explanation).toContain('Broilerin fileesuikale')
  })
})

describe('ingredient -> Fineli matching', () => {
  it('olive oil must not map to olives', () => {
    expect(fineliName('oliiviöljyä')).toBe('Oliiviöljy')
    expect(fineliName('oliiveja')).toMatch(/^Oliivi,/)
  })

  it('cream cheese must not map to milk', () => {
    expect(fineliName('tuorejuustoa')).toMatch(/^Tuorejuusto/)
    expect(fineliName('tuorejuustoa')).not.toMatch(/^Maito/)
  })

  it('wholegrain pasta prefers wholegrain pasta', () => {
    expect(fineliName('täysjyväpastaa')).toMatch(/täysjyvä/i)
    expect(fineliName('täysjyvämakaronia')).toMatch(/täysjyvä/i)
  })

  it('coconut milk and oat drink are not cow milk; peanut butter is not butter', () => {
    expect(matchIngredient('kookosmaitoa', ctx()).canonicalId).toBe('coconut-milk')
    expect(matchIngredient('kaurajuomaa', ctx()).canonicalId).toBe('oat-drink')
    expect(matchIngredient('maapähkinävoita', ctx()).canonicalId).toBe('peanut-butter')
    expect(matchIngredient('soijamaitoa', ctx()).canonicalId).toBe('soy-drink')
  })

  it('uses compound heads for unknown compounds with lower confidence', () => {
    const m = matchIngredient('luumutomaattikuutioita', ctx())
    expect(['tomato', 'crushed-tomato']).toContain(m.canonicalId)
    const z = matchIngredient('kesäkurpitsaraastetta', ctx())
    expect(z.canonicalId).toBe('zucchini')
    expect(z.method).toBe('compound-head')
    expect(z.confidence).toBeLessThan(0.9)
  })

  it('confidence levels follow the documented scale', () => {
    expect(matchIngredient('kevytmaitoa', ctx()).confidence).toBe(1)
    expect(matchIngredient('tuoretta basilikaa', ctx()).confidence).toBeGreaterThanOrEqual(0.9)
    expect(matchIngredient('taco seasoning', ctx()).confidence).toBeLessThanOrEqual(0.7)
    const unknown = matchIngredient('xyzzy-jauhe', ctx())
    expect(unknown.confidence).toBeLessThan(0.6)
  })

  it('falls back to searching Fineli names when the dictionary has no entry', () => {
    const m = matchIngredient('kvittenihilloa', ctx())
    expect(['fineli-search', 'compound-head', 'none']).toContain(m.method)
    const s = searchFineli(fineliLookup(), 'hapankaali')
    // Result may be null if Fineli has no such food; if found, the score is capped as a weak match.
    if (s) expect(s.score).toBeLessThanOrEqual(0.55)
  })

  it('user mappings override automatic matching', () => {
    const userMappings = new Map([['taco seasoning', { canonicalId: 'spice-mix', fineliId: 30 }]])
    const m = matchIngredient('taco seasoning', { fineli: fineliLookup(), userMappings })
    expect(m).toMatchObject({ method: 'user', fineliId: 30, confidence: 1 })
  })
})
