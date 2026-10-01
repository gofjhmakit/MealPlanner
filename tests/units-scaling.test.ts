import { describe, expect, it } from 'vitest'
import { applyScaling, normalizeDisplayUnit, scaleIngredient } from '../src/domain/scaling'
import { buildRecipeIngredient } from '../src/domain/recipeIngredients'
import { convert, findUnit, formatMass, formatQuantity, formatVolume, toBase } from '../src/domain/units'

describe('unit registry', () => {
  it('recognizes Finnish unit forms', () => {
    expect(findUnit('dl')?.id).toBe('dl')
    expect(findUnit('tölkkiä')?.id).toBe('tlk')
    expect(findUnit('pussia')?.id).toBe('ps')
    expect(findUnit('ruokalusikallista')?.id).toBe('rkl')
    expect(findUnit('kerää')?.id).toBe('kera')
    expect(findUnit('sipulia')).toBeUndefined()
  })

  it('converts exact measures', () => {
    expect(convert(0.5, 'kg', 'g')).toBe(500)
    expect(convert(1, 'l', 'dl')).toBe(10)
    expect(convert(1, 'rkl', 'ml')).toBe(15)
    expect(convert(3, 'tl', 'rkl')).toBe(1)
    expect(toBase(2, 'dl')).toEqual({ kind: 'volume', value: 200 })
  })

  it('refuses nonsensical conversions', () => {
    expect(convert(1, 'dl', 'g')).toBeNull()
    expect(convert(1, 'kpl', 'g')).toBeNull()
    expect(convert(1, 'pkt', 'tlk')).toBeNull()
  })

  it('formats in Finnish kitchen style', () => {
    expect(formatQuantity(0.5)).toBe('½')
    expect(formatQuantity(1.5)).toBe('1 ½')
    expect(formatMass(1000)).toBe('1 kg')
    expect(formatMass(500)).toBe('500 g')
    expect(formatVolume(700)).toBe('7 dl')
    expect(formatVolume(1500)).toBe('1,5 l')
    expect(formatVolume(15)).toBe('1 rkl')
    expect(formatVolume(5)).toBe('1 tl')
    expect(formatVolume(966)).toBe('9,7 dl')
  })
})

describe('recipe scaling', () => {
  const ing = (line: string) => buildRecipeIngredient(line, {})

  it('scales 4 -> 6 servings linearly', () => {
    expect(scaleIngredient(ing('200 g broileria'), 6 / 4).amountText).toBe('300 g')
    expect(scaleIngredient(ing('2 dl kermaa'), 6 / 4).amountText).toBe('3 dl')
  })

  it('rounds counts to kitchen-friendly steps', () => {
    expect(scaleIngredient(ing('3 kananmunaa'), 0.5).amountText).toBe('1 ½')
    expect(scaleIngredient(ing('1 sipuli'), 1.3).amountText).toBe('1 ¼')
  })

  it('moves to a better unit when scaled', () => {
    expect(scaleIngredient(ing('6 dl maitoa'), 2).amountText).toBe('1,2 l')
    expect(normalizeDisplayUnit(6, 'tl')).toEqual({ quantity: 2, unit: 'rkl' })
  })

  it('scales ranges and package weights', () => {
    const s = scaleIngredient(ing('1-2 valkosipulinkynttä'), 2)
    expect(s.quantity).toBe(2)
    expect(s.quantityMax).toBe(4)
    expect(scaleIngredient(ing('2 dl (100 g) juustoraastetta'), 2).explicitGrams).toBe(200)
  })

  it('supports exceptions: fixed and sublinear rules', () => {
    expect(applyScaling(1, 3, 'fixed')).toBe(1)
    expect(applyScaling(1, 2, 'sublinear')).toBeCloseTo(Math.pow(2, 0.8))
    expect(applyScaling(1, 2, 'linear')).toBe(2)
    // salt defaults to sublinear scaling via the ingredient dictionary
    expect(ing('1 tl suolaa').scaling).toBe('sublinear')
  })

  it('leaves unquantified lines alone', () => {
    const s = scaleIngredient(ing('suolaa'), 2)
    expect(s.quantity).toBeNull()
  })
})
