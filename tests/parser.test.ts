import { describe, expect, it } from 'vitest'
import { parseDurationMinutes, parseIngredientLine, parseNumber, parseServings, splitAmountText } from '../src/domain/ingredientParser'
import { cleanIngredientName, lemmaCandidates, normalizeKey } from '../src/domain/finnish'

describe('parseNumber', () => {
  it.each([
    ['2', 2],
    ['2,5', 2.5],
    ['2.5', 2.5],
    ['1/2', 0.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['1 ½', 1.5],
    ['1 1/2', 1.5],
    ['¾', 0.75],
  ])('%s -> %d', (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected)
  })
})

describe('parseIngredientLine – Finnish recipe lines', () => {
  it('2 dl kevytmaitoa', () => {
    const p = parseIngredientLine('2 dl kevytmaitoa')
    expect(p).toMatchObject({ quantity: 2, unit: 'dl', name: 'kevytmaitoa' })
  })

  it('500 g broilerin fileesuikaleita', () => {
    expect(parseIngredientLine('500 g broilerin fileesuikaleita')).toMatchObject({ quantity: 500, unit: 'g', name: 'broilerin fileesuikaleita' })
  })

  it('1 sipuli (no unit)', () => {
    expect(parseIngredientLine('1 sipuli')).toMatchObject({ quantity: 1, unit: null, name: 'sipuli' })
  })

  it('2 rkl oliiviöljyä', () => {
    expect(parseIngredientLine('2 rkl oliiviöljyä')).toMatchObject({ quantity: 2, unit: 'rkl', name: 'oliiviöljyä' })
  })

  it('1 pkt tomaattimurskaa', () => {
    expect(parseIngredientLine('1 pkt tomaattimurskaa')).toMatchObject({ quantity: 1, unit: 'pkt', name: 'tomaattimurskaa' })
  })

  it('3 kananmunaa', () => {
    expect(parseIngredientLine('3 kananmunaa')).toMatchObject({ quantity: 3, unit: null, name: 'kananmunaa' })
  })

  it('per-package weight: 2 tlk (à 400 g) tomaattimurskaa esim. Mutti', () => {
    const p = parseIngredientLine('2 tlk (à 400 g) tomaattimurskaa esim. Mutti')
    expect(p).toMatchObject({ quantity: 2, unit: 'tlk', perUnitGrams: 400, name: 'tomaattimurskaa' })
    expect(p.note).toContain('Mutti')
  })

  it('explicit mass for a volume line: 2 dl (100 g) juustoraastetta', () => {
    expect(parseIngredientLine('2 dl (100 g) Valio punaleima-emmentaljuustoraastetta')).toMatchObject({
      quantity: 2,
      unit: 'dl',
      explicitGrams: 100,
      name: 'punaleima-emmentaljuustoraastetta',
    })
  })

  it('drained weight: 145 g (1 prk, à 285/145 g) aurinkokuivattuja tomaatteja paloina öljyssä', () => {
    const p = parseIngredientLine('145 g (1 prk,  à 285/145 g) aurinkokuivattuja tomaatteja paloina öljyssä')
    expect(p).toMatchObject({ quantity: 145, unit: 'g', name: 'aurinkokuivattuja tomaatteja', explicitGrams: null })
    expect(p.note).toContain('öljyssä')
  })

  it('half a bag with package size: ½ pussia (à 150 g) Valio mozzarella raastetta', () => {
    expect(parseIngredientLine('½ pussia (à 150 g) Valio mozzarella raastetta')).toMatchObject({
      quantity: 0.5,
      unit: 'ps',
      perUnitGrams: 150,
      name: 'mozzarella raastetta',
    })
  })

  it('package weight without "à": 1 pkt (400 g) Pirkka naudan jauhelihaa', () => {
    expect(parseIngredientLine('1 pkt (400 g) Pirkka naudan jauhelihaa')).toMatchObject({ unit: 'pkt', perUnitGrams: 400, name: 'naudan jauhelihaa' })
  })

  it('ranges: 1–2 valkosipulinkynttä implies clove unit', () => {
    expect(parseIngredientLine('1–2 valkosipulinkynttä')).toMatchObject({ quantity: 1, quantityMax: 2, unit: 'kynsi' })
  })

  it('size words: 1 iso sipuli', () => {
    expect(parseIngredientLine('1 iso sipuli')).toMatchObject({ quantity: 1, size: 'L', name: 'sipuli' })
  })

  it('unquantified: suolaa ja pippuria', () => {
    expect(parseIngredientLine('suolaa ja pippuria')).toMatchObject({ quantity: null, name: 'suolaa' })
  })

  it('quantity at the end: Rainbow kanafileesuikale 300 g', () => {
    expect(parseIngredientLine('Rainbow kanafileesuikale 300 g')).toMatchObject({ quantity: 300, unit: 'g', name: 'kanafileesuikale' })
  })

  it('unit without number: ripaus suolaa', () => {
    expect(parseIngredientLine('ripaus suolaa')).toMatchObject({ quantity: 1, unit: 'hyppysellinen' })
  })

  it('keeps the original line untouched', () => {
    expect(parseIngredientLine('  - 2 dl  kevytmaitoa ').raw).toBe('2 dl kevytmaitoa')
  })

  it('splits amount text for display', () => {
    expect(splitAmountText('2 tlk (à 400 g) tomaattimurskaa')).toEqual({ amount: '2 tlk', rest: '(à 400 g) tomaattimurskaa' })
    expect(splitAmountText('suolaa')).toEqual({ amount: '', rest: 'suolaa' })
  })
})

describe('servings and durations', () => {
  it.each([
    ['4', 4],
    ['4, 4 annosta', 4],
    ['4 portion', 4],
    [['4', '4 annosta'], 4],
    [6, 6],
  ])('parseServings(%j)', (input, expected) => {
    expect(parseServings(input).servings).toBe(expected)
  })

  it.each([
    ['PT30M', 30],
    ['PT1H10M', 70],
    ['PT1H40M', 100],
    ['PT', null],
    ['15–30 min', 30],
    ['1 h 20 min', 80],
  ])('parseDurationMinutes(%s)', (input, expected) => {
    expect(parseDurationMinutes(input)).toBe(expected)
  })
})

describe('Finnish normalization', () => {
  it('generates base forms for inflected words', () => {
    expect(lemmaCandidates('kevytmaitoa')).toContain('kevytmaito')
    expect(lemmaCandidates('fileesuikaleita')).toContain('fileesuikale')
    expect(lemmaCandidates('tomaatteja')).toContain('tomaatti')
    expect(lemmaCandidates('kananmunaa')).toContain('kananmuna')
    expect(lemmaCandidates('voita')).toContain('voi')
    expect(lemmaCandidates('vettä')).toContain('vesi')
    expect(lemmaCandidates('valkosipulinkynttä')).toContain('valkosipulinkynsi')
    expect(lemmaCandidates('perunoita')).toContain('peruna')
    expect(lemmaCandidates('tortilloja')).toContain('tortilla')
    expect(lemmaCandidates('naudan')).toContain('nauta')
  })

  it('removes brands, examples and preparation notes', () => {
    expect(cleanIngredientName('Valio kevytmaitoa')).toEqual({ name: 'kevytmaitoa', note: null })
    expect(cleanIngredientName('tomaattimurskaa esim. Mutti').name).toBe('tomaattimurskaa')
    expect(cleanIngredientName('sipuli, hienonnettuna')).toEqual({ name: 'sipuli', note: 'hienonnettuna' })
    expect(cleanIngredientName('Gold&Green® rouhetta härkäpapu & herne').name).toBe('rouhetta härkäpapu')
  })

  it('normalizes equivalent spellings to the same key', () => {
    expect(normalizeKey('kevytmaitoa')).toBe(normalizeKey('Kevytmaito'))
    expect(normalizeKey('Valio kevytmaitoa')).toBe('kevytmaito')
  })
})
