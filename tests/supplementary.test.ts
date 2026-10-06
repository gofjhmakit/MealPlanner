import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { FineliStore, loadSupplementaryData } from '../src/db/bootstrap'
import { MealPlannerDB } from '../src/db/db'
import { INGREDIENTS } from '../src/domain/ingredients'
import { matchIngredient, searchSupplementary } from '../src/domain/matcher'
import { computeRecipeNutrition } from '../src/domain/nutrition'
import { buildRecipeIngredient } from '../src/domain/recipeIngredients'
import { foodSourceLabel, isSupplementaryFoodId, parseSupplementaryRef, SUPPLEMENTARY_SOURCES } from '../src/domain/supplementary'
import { fineliFoods, fineliLookup, fullFoodLookup, supplementaryFoods } from './helpers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const nameKey = (s: string) => s.toLowerCase().trim()

describe('supplementary dataset', () => {
  const foods = supplementaryFoods()

  it('has foods from both sources with ids in the supplementary range', () => {
    expect(foods.length).toBeGreaterThan(3000)
    for (const source of Object.keys(SUPPLEMENTARY_SOURCES)) expect(foods.some((f) => f.source === source)).toBe(true)
    for (const f of foods) {
      expect(isSupplementaryFoodId(f.id)).toBe(true)
      expect(f.sourceRef).toBeTruthy()
      expect(f.fi.trim()).not.toBe('')
    }
    expect(new Set(foods.map((f) => f.id)).size).toBe(foods.length)
  })

  it('contains no duplicate names, and nothing that Fineli already has', () => {
    const names = foods.map((f) => nameKey(f.fi))
    expect(new Set(names).size).toBe(names.length)
    const fineli = new Set(fineliFoods().map((f) => nameKey(f.fi)))
    expect(names.filter((n) => fineli.has(n))).toEqual([])
  })

  it('has plausible nutrient values', () => {
    for (const f of foods) {
      for (const [k, v] of Object.entries(f.nutrients)) {
        expect(Number.isFinite(v), `${f.fi} ${k}`).toBe(true)
        expect(v, `${f.fi} ${k}`).toBeGreaterThanOrEqual(0)
      }
      expect(f.nutrients.energyKcal).toBeLessThanOrEqual(902)
      expect((f.nutrients.protein ?? 0) + (f.nutrients.fat ?? 0) + (f.nutrients.carbohydrate ?? 0)).toBeLessThanOrEqual(101)
    }
  })

  it('meta file matches the foods file', () => {
    const meta = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'supplementary-meta.json'), 'utf8'))
    expect(meta.foodCount).toBe(foods.length)
    expect(meta.sources.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(foods.length)
  })

  it('every dictionary supplementary reference resolves', () => {
    const lookup = fullFoodLookup()
    const withRef = INGREDIENTS.filter((i) => i.supplementary)
    expect(withRef.length).toBeGreaterThan(5)
    for (const i of withRef) {
      const id = parseSupplementaryRef(i.supplementary!)
      expect(id, i.id).not.toBeNull()
      expect(lookup.get(id!), `${i.id} → ${i.supplementary}`).toBeDefined()
    }
  })
})

describe('Fineli first, supplementary as fallback', () => {
  const full = fullFoodLookup()

  it('keeps Fineli matches unchanged when Fineli has the food', () => {
    for (const name of ['tomaatti', 'kevytmaito', 'porkkana', 'fenkoli', 'hirvenpaisti', 'kaurahiutale']) {
      const before = matchIngredient(name, { fineli: fineliLookup() })
      const after = matchIngredient(name, { fineli: full })
      expect(after.fineliId, name).toBe(before.fineliId)
      expect(after.method, name).toBe(before.method)
      if (after.fineliId !== null) expect(isSupplementaryFoodId(after.fineliId)).toBe(false)
    }
  })

  it('uses the supplementary databases only when Fineli has nothing suitable', () => {
    for (const [name, expected] of [
      ['worcestershirekastiketta', 'Worcestershirekastike'],
      ['sahramia', 'Sahrami'],
      ['hoisinkastike', 'Hoisinkastike'],
      ['tempeh', 'Tempeh'],
    ] as const) {
      expect(matchIngredient(name, { fineli: fineliLookup() }).method, name).toBe('none')
      const m = matchIngredient(name, { fineli: full })
      expect(m.method, name).toBe('supplementary-search')
      expect(full.get(m.fineliId!)?.fi, name).toBe(expected)
      expect(m.confidence).toBeLessThan(0.7) // always shown as "check"
      expect(m.explanation).toMatch(/Finelistä ei löytynyt/)
    }
  })

  it('a likely Fineli food beats a better-named supplementary food', () => {
    // "Hirvenpaisti" is a Fineli dish: still the master data even though it scores lower.
    const m = matchIngredient('hirvenpaisti', { fineli: full })
    expect(m.method).toBe('fineli-search')
    expect(isSupplementaryFoodId(m.fineliId)).toBe(false)
  })

  it('dictionary ingredients Fineli only approximates use the named supplementary food', () => {
    const before = matchIngredient('1 tl juustokuminaa', { fineli: fineliLookup() })
    const m = matchIngredient('1 tl juustokuminaa', { fineli: full })
    expect(m.canonicalId).toBe('cumin')
    expect(m.canonicalId).toBe(before.canonicalId)
    expect(m.fineliId).toBe(parseSupplementaryRef('usda:2014'))
    expect(m.confidence).toBeGreaterThan(before.confidence)
    expect(m.explanation).toMatch(/USDA/)
  })

  it('works without supplementary data (Fineli only)', () => {
    expect(searchSupplementary(fineliLookup(), 'sahrami')).toBeNull()
  })

  it('nutrition uses supplementary values and labels their source', () => {
    const m = matchIngredient('sahramia', { fineli: full })
    const food = full.get(m.fineliId!)!
    expect(foodSourceLabel(food)).toBe('USDA')
    expect(foodSourceLabel(fineliFoods()[0])).toBe('Fineli')
    const ing = buildRecipeIngredient('1 g sahramia', { fineli: full })
    expect(ing.fineliId).toBe(m.fineliId)
    const r = computeRecipeNutrition({ servings: 1, ingredients: [ing] }, full)
    expect(r.total.energyKcal).toBeCloseTo(food.nutrients.energyKcal! / 100, 5)
    expect(r.lines[0].status).toBe('approximate')
  })
})

describe('loadSupplementaryData', () => {
  const meta = readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'supplementary-meta.json'), 'utf8')
  const foods = readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'supplementary-foods.json'), 'utf8')
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith('supplementary-meta.json')) return new Response(meta)
    if (String(url).endsWith('supplementary-foods.json')) return new Response(foods)
    return new Response('', { status: 404 })
  }) as typeof fetch

  it('loads once, then only when re-imported; FineliStore exposes the foods', async () => {
    const database = new MealPlannerDB(`supp-${Math.random()}`)
    const first = await loadSupplementaryData(database, fetchImpl, () => {})
    expect(first.changed).toBe(true)
    expect(await database.supplementaryFoods.count()).toBe(supplementaryFoods().length)
    const second = await loadSupplementaryData(database, fetchImpl, () => {})
    expect(second.changed).toBe(false)
    expect(second.meta?.foodCount).toBe(supplementaryFoods().length)

    const store = new FineliStore(fineliFoods(), null)
    store.setSupplementary(await database.supplementaryFoods.toArray(), second.meta)
    expect(store.all()).toHaveLength(fineliFoods().length)
    expect(store.get(parseSupplementaryRef('usda:2037')!)?.fi).toBe('Sahrami')
    expect(matchIngredient('sahramia', { fineli: store }).method).toBe('supplementary-search')
  })

  it('is optional: offline without stored data means no fallback foods', async () => {
    const database = new MealPlannerDB(`supp-${Math.random()}`)
    const offline = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    const res = await loadSupplementaryData(database, offline, () => {})
    expect(res).toEqual({ meta: null, changed: false })
  })
})
