import { describe, expect, it } from 'vitest'
import { getIngredient } from '../src/domain/ingredients'
import { computeRecipeNutrition, resolveGrams } from '../src/domain/nutrition'
import { buildIngredientList, buildRecipeIngredient } from '../src/domain/recipeIngredients'
import { aggregateShoppingList, formatShoppingAmount, type ShoppingLineInput } from '../src/domain/shoppingList'
import { fineliLookup } from './helpers'

const ctx = () => ({ fineli: fineliLookup() })
const ing = (line: string) => buildRecipeIngredient(line, ctx())
const grams = (line: string) => {
  const i = ing(line)
  return resolveGrams(i, getIngredient(i.canonicalId), i.fineliId ? fineliLookup().get(i.fineliId) : undefined)
}

describe('gram resolution (unit conversion to mass)', () => {
  it('uses exact mass units', () => {
    expect(grams('500 g broilerin fileesuikaleita')).toMatchObject({ grams: 500, method: 'mass', confidence: 1 })
    expect(grams('0,5 kg perunoita').grams).toBe(500)
  })

  it('converts volumes with Fineli household weights', () => {
    expect(grams('2 dl kevytmaitoa')).toMatchObject({ grams: 200, method: 'volume-fineli' })
    // Fineli: 1 rkl olive oil = 13.5 g (not 15 g)
    expect(grams('2 rkl oliiviöljyä')).toMatchObject({ grams: 27, method: 'unit-fineli' })
    expect(grams('1 dl vehnäjauhoja').grams).toBe(65)
  })

  it('converts pieces with standard weights', () => {
    expect(grams('1 sipuli').grams).toBe(55)
    expect(grams('3 kananmunaa')).toMatchObject({ grams: 165, method: 'piece-dictionary' })
    expect(grams('1 iso sipuli').grams).toBe(200)
  })

  it('converts packages', () => {
    expect(grams('1 pkt tomaattimurskaa')).toMatchObject({ grams: 390, method: 'unit-dictionary' })
    expect(grams('2 tlk (à 400 g) tomaattimurskaa')).toMatchObject({ grams: 800, method: 'per-unit', confidence: 1 })
    expect(grams('1 pkt taco seasoning').grams).toBe(25)
  })

  it('flags rough guesses and unquantified lines', () => {
    const g = grams('1 pll jotain kastiketta')
    expect(g.confidence).toBeLessThanOrEqual(0.5)
    expect(grams('suolaa')).toMatchObject({ grams: null, method: 'unquantified' })
  })

  it('manual weight overrides everything', () => {
    const i = { ...ing('1 pkt jotain'), gramsOverride: 123 }
    expect(resolveGrams(i, undefined, undefined).grams).toBe(123)
  })
})

describe('nutrition calculation', () => {
  it('computes per-100g × grams / 100', () => {
    const milk = fineliLookup().get(684)!
    const recipe = { servings: 1, ingredients: [ing('2 dl kevytmaitoa')] }
    const n = computeRecipeNutrition(recipe, fineliLookup())
    expect(n.total.energyKcal).toBeCloseTo(milk.nutrients.energyKcal! * 2, 5)
    expect(n.total.protein).toBeCloseTo(milk.nutrients.protein! * 2, 5)
  })

  it('aggregates ingredients and divides per serving', () => {
    const recipe = { servings: 4, ingredients: buildIngredientList(['500 g broilerin fileesuikaleita', '2 rkl oliiviöljyä', '1 sipuli', 'suolaa'], ctx()) }
    const n = computeRecipeNutrition(recipe, fineliLookup())
    const chicken = fineliLookup().get(11565)!.nutrients
    const oil = fineliLookup().get(536)!.nutrients
    const onion = fineliLookup().get(335)!.nutrients
    const expected = chicken.energyKcal! * 5 + oil.energyKcal! * 0.27 + onion.energyKcal! * 0.55
    expect(n.total.energyKcal).toBeCloseTo(expected, 3)
    expect(n.perServing.energyKcal).toBeCloseTo(expected / 4, 3)
    expect(n.coverage).toMatchObject({ total: 4, confident: 3, unquantified: 1 })
    expect(n.coverage.confidentShare).toBe(1)
  })

  it('scales nutrition with servings', () => {
    const recipe = { servings: 4, ingredients: [ing('400 g naudan jauhelihaa')] }
    const n4 = computeRecipeNutrition(recipe, fineliLookup())
    const n2 = computeRecipeNutrition(recipe, fineliLookup(), 2)
    expect(n2.total.energyKcal).toBeCloseTo(n4.total.energyKcal / 2, 5)
    expect(n2.perServing.energyKcal).toBeCloseTo(n4.perServing.energyKcal, 5)
  })

  it('reports unmatched ingredients instead of inventing values', () => {
    const recipe = { servings: 1, ingredients: [ing('100 g xyzzyä')] }
    const n = computeRecipeNutrition(recipe, { get: () => undefined, all: () => [] })
    expect(n.total.energyKcal).toBe(0)
    expect(n.coverage.unmatched).toBe(1)
  })

  it('salt comes from Fineli NaCl (mg -> g)', () => {
    const n = computeRecipeNutrition({ servings: 1, ingredients: [ing('10 g suolaa')] }, fineliLookup())
    expect(n.total.salt).toBeGreaterThan(9)
    expect(n.total.salt).toBeLessThan(10.1)
  })
})

describe('shopping list aggregation', () => {
  const line = (text: string, factor = 1, recipeId = 'r1'): ShoppingLineInput => ({ recipeId, recipeTitle: recipeId, ingredient: ing(text), factor })
  const aggregate = (lines: ShoppingLineInput[]) => aggregateShoppingList(lines, fineliLookup())
  const find = (items: ReturnType<typeof aggregate>, name: string) => items.find((i) => i.name === name)!

  it('merges the example from the specification', () => {
    const items = aggregate([
      line('200 g broilerin fileesuikaleita'), line('1 sipuli'), line('2 dl kuohukermaa'),
      line('300 g broilerin fileesuikaleita', 1, 'r2'), line('1 sipuli', 1, 'r2'), line('5 dl kuohukermaa', 1, 'r2'),
    ])
    expect(formatShoppingAmount(find(items, 'Broilerin fileesuikale').amount)).toBe('500 g')
    expect(formatShoppingAmount(find(items, 'Sipuli').amount)).toBe('2 kpl')
    expect(formatShoppingAmount(find(items, 'Kuohukerma').amount)).toBe('7 dl')
    expect(find(items, 'Kuohukerma').sources).toHaveLength(2)
  })

  it('combines mathematically equivalent units: 500 g + 0,5 kg = 1 kg', () => {
    const items = aggregate([line('500 g perunoita'), line('0,5 kg perunoita', 1, 'r2')])
    expect(formatShoppingAmount(items[0].amount)).toBe('1 kg')
  })

  it('combines dl, l, rkl for the same liquid', () => {
    const items = aggregate([line('2 dl kevytmaitoa'), line('1 l kevytmaitoa'), line('2 rkl kevytmaitoa')])
    expect(items).toHaveLength(1)
    expect(items[0].amount.volume).toBeCloseTo(1230)
  })

  it('converts pieces and grams of the same vegetable into pieces', () => {
    const items = aggregate([line('1 sipuli'), line('110 g sipulia')])
    expect(formatShoppingAmount(items[0].amount)).toBe('3 kpl')
  })

  it('does not convert without a reliable factor', () => {
    const items = aggregate([line('200 g jotain outoa'), line('1 pkt jotain outoa')])
    expect(formatShoppingAmount(items[0].amount)).toBe('200 g + 1 pkt')
  })

  it('scales by planned servings', () => {
    const items = aggregate([line('400 g naudan jauhelihaa', 0.5)])
    expect(formatShoppingAmount(items[0].amount)).toBe('200 g')
  })

  it('merges spelling variants through the canonical ingredient', () => {
    const items = aggregate([line('200 g kanasuikaleita'), line('300 g broilerin fileesuikaleita')])
    expect(items).toHaveLength(1)
    expect(items[0].amount.mass).toBe(500)
  })

  it('excludes water and groups by category', () => {
    const items = aggregate([line('7 dl vettä'), line('1 sipuli'), line('400 g naudan jauhelihaa')])
    expect(items.map((i) => i.name)).toEqual(['Sipuli', 'Naudan jauheliha'])
    expect(items.map((i) => i.category)).toEqual(['vegetables', 'meat_fish'])
  })

  it('applies user category overrides', () => {
    const items = aggregateShoppingList([line('1 sipuli')], fineliLookup(), new Map([['c:onion', 'frozen' as const]]))
    expect(items[0].category).toBe('frozen')
  })

  it('lists unquantified items without inventing an amount', () => {
    const items = aggregate([line('suolaa')])
    expect(formatShoppingAmount(items[0].amount)).toBe('tarpeen mukaan')
  })
})
