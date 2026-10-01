// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FineliStore } from '../src/db/bootstrap'
import { MealPlannerDB } from '../src/db/db'
import { exportData, importData, parseExportFile } from '../src/db/exportImport'
import {
  addMealItem,
  applyMealPlan,
  createShoppingList,
  deleteProduct,
  matchContext,
  planLeftover,
  removeMealItem,
  restoreMealItem,
  saveProduct,
  saveRecipe,
  setMealServings,
  setRecipeRating,
} from '../src/db/repo'
import { addDays } from '../src/domain/dates'
import { computeRecipeNutrition } from '../src/domain/nutrition'
import { findProduct, productMatchIndex, productToFood } from '../src/domain/products'
import { buildIngredientList } from '../src/domain/recipeIngredients'
import { EMPTY_FILTERS, filterRecipes } from '../src/domain/recipeInfo'
import type { Product, Recipe } from '../src/domain/types'
import { buildCandidates, planMeals, rerollMeal, type PlanOptions } from '../src/domain/weekPlanner'
import { extractProduct, nameFromUrl, packageGramsFromName, parseNutritionText } from '../src/import/products'
import { fineliFoods } from './helpers'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')

let db: MealPlannerDB
let store: FineliStore
let n = 0
beforeEach(async () => {
  db = new MealPlannerDB(`pp-${n++}`)
  await db.open()
  store = new FineliStore(fineliFoods(), null)
})
afterEach(async () => {
  await db.delete()
})

function recipe(id: string, lines: string[], extra: Partial<Recipe> = {}): Recipe {
  const now = new Date().toISOString()
  return {
    id, title: `Resepti ${id}`, servings: 4, ingredients: buildIngredientList(lines, { fineli: store }),
    instructions: ['Tee.'], tags: [], origin: 'user', inCollection: true, createdAt: now, updatedAt: now, ...extra,
  }
}

const OIVARIINI: Omit<Product, 'id' | 'foodId'> = {
  name: 'Oivariini normaalisuolainen 400 g',
  brand: 'Valio',
  category: 'dairy',
  aliases: ['oivariini'],
  nutrients: { energyKcal: 700, protein: 0.5, carbohydrate: 0.5, fat: 78, saturatedFat: 34, salt: 1.2 },
  packageGrams: 400,
  gramsPerDl: 95,
  diets: ['LACOVEGE', 'GLUTFREE'],
  source: 'manual',
}

describe('product page parsing', () => {
  it('K-Ruoka: reads the application state (nutrition, EAN, brand, image, size, allergens)', () => {
    const p = extractProduct(fixture('k-ruoka-product.html'), 'https://www.k-ruoka.fi/kauppa/tuote/pirkka-naudan-jauheliha-400g-17-6410405338204')!
    expect(p).toMatchObject({
      source: 'k-ruoka', name: 'Pirkka suomalainen naudan jauheliha 17% 400g', brand: 'Pirkka', ean: '6410405338204',
      imageUrl: 'https://public.keskofiles.com/f/k-ruoka/product/6410405338204', packageGrams: 400, category: 'meat_fish',
    })
    expect(p.nutrients).toEqual({ energyKcal: 227, protein: 19, carbohydrate: 0, sugars: 0, fat: 17, saturatedFat: 8.9, fibre: 0, salt: 0.14 })
    expect(p.diets).toEqual(expect.arrayContaining(['GLUTFREE', 'MILKFREE', 'LACSFREE']))
  })

  it('S-kaupat: reads __NEXT_DATA__ Apollo product (nutrient table, image template, category path)', () => {
    const p = extractProduct(fixture('s-kaupat-product.html'), 'https://www.s-kaupat.fi/tuote/atria-parempi-nauta-jauheliha-10-400g/6407840041172')!
    expect(p).toMatchObject({ source: 's-kaupat', name: 'Atria Parempi Nauta Jauheliha 10% 400g', brand: 'Atria', ean: '6407840041172', packageGrams: 400, category: 'meat_fish' })
    expect(p.imageUrl).toBe('https://cdn.s-cloud.fi/v1/w800h800@_q75/assets/dam-id/FLDxK3jV4cTBexW2IgiOw5.webp')
    expect(p.nutrients).toEqual({ energyKcal: 168, protein: 20, carbohydrate: 0, sugars: 0, fat: 10, saturatedFat: 5.2, fibre: 0, salt: 0.12 })
  })

  it('copied nutrition text (store page or package label)', () => {
    expect(parseNutritionText('Energia\t944 kJ / 227 kcal\nRasva\t17 g\njosta tyydyttynyttä\t8,9 g\n- josta sokereita 0 g\nProteiini\t19 g\nSuola 0,14 g')).toMatchObject({
      energyKcal: 227, fat: 17, saturatedFat: 8.9, sugars: 0, protein: 19, salt: 0.14,
    })
    expect(parseNutritionText('Energia 1500 kJ').energyKcal).toBeCloseTo(358.5, 0)
    const p = extractProduct('Energia 944 kJ / 227 kcal\nProteiini 19 g', 'https://www.k-ruoka.fi/kauppa/tuote/pirkka-naudan-jauheliha-400g-17-6410405338204')!
    expect(p).toMatchObject({ source: 'text', name: 'Pirkka naudan jauheliha 400g 17', ean: '6410405338204' })
    expect(extractProduct('ei ravintotietoja täällä')).toBeNull()
  })

  it('helpers', () => {
    expect(packageGramsFromName('Coca-Cola 6x0,33l')).toBe(1980)
    expect(packageGramsFromName('Vaasan burgerisämpylä 4kpl/320g')).toBe(320)
    expect(packageGramsFromName('Maito 1,5 l')).toBe(1500)
    expect(nameFromUrl('https://www.s-kaupat.fi/tuote/atria-parempi-nauta-jauheliha-10-400g/6407840041172')).toBe('Atria parempi nauta jauheliha 10 400g')
  })
})

describe('own products as nutrition foods', () => {
  it('converts label nutrition into a food with household units', () => {
    const f = productToFood({ ...OIVARIINI, id: 'x', foodId: 900_000_001, aliases: [], diets: [], category: 'dairy', source: 'manual' } as Product)
    expect(f).toMatchObject({ id: 900_000_001, fi: 'Valio Oivariini normaalisuolainen 400 g', custom: true, category: 'dairy' })
    expect(f.units).toMatchObject({ DL: 95, RKL: 14.3, PKG: 400 })
    expect(f.nutrients.sodium).toBe(480)
  })

  it('matches by alias, by brand + name in the raw line, never inside other words', () => {
    const idx = productMatchIndex([{ ...OIVARIINI, id: 'x', foodId: 900_000_001 } as Product, { ...OIVARIINI, id: 'y', foodId: 900_000_002, name: 'Maito', brand: null, aliases: [] } as Product])
    expect(findProduct(idx, 'oivariinia')?.foodId).toBe(900_000_001)
    expect(findProduct(idx, 'x', '50 g Valio Oivariini normaalisuolainen 400 g')?.foodId).toBe(900_000_001)
    expect(findProduct(idx, 'kevytmaitoa', '2 dl kevytmaitoa')).toBeNull()
    expect(findProduct(idx, 'maito', '2 dl maito')?.foodId).toBe(900_000_002)
  })

  it('saving a product rematches existing recipes; nutrition uses the label values; deleting releases them', async () => {
    await saveRecipe(recipe('a', ['50 g oivariinia', '1 pkt oivariinia']), db)
    const before = (await db.recipes.get('a'))!.ingredients[0]
    expect(before.matchMethod).not.toBe('product')
    const p = await saveProduct(OIVARIINI, store, db)
    const after = (await db.recipes.get('a'))!
    expect(after.ingredients[0]).toMatchObject({ fineliId: p.foodId, matchMethod: 'product', confidence: 1 })
    const nutr = computeRecipeNutrition(after, store)
    expect(nutr.total.energyKcal).toBeCloseTo(700 * 0.5 + 700 * 4, 0) // 50 g + one 400 g package
    await deleteProduct(p.id, store, db)
    expect((await db.recipes.get('a'))!.ingredients[0].fineliId).not.toBe(p.foodId)
    expect(store.get(p.foodId)).toBeUndefined()
  })

  it('products group and categorize on the shopping list; new recipes match them on import', async () => {
    const p = await saveProduct({ ...OIVARIINI, category: 'spices_sauces' }, store, db)
    const ctx = await matchContext(store, db)
    const r = { ...recipe('b', []), ingredients: buildIngredientList(['2 rkl Oivariinia'], ctx) }
    await saveRecipe(r, db)
    await addMealItem({ date: '2026-10-05', slot: 'dinner', recipeId: 'b', servings: 4 }, db)
    const listId = await createShoppingList('2026-10-05', '2026-10-05', 'L', store, db)
    const items = await db.shoppingItems.where('listId').equals(listId).toArray()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: `f:${p.foodId}`, name: 'Valio Oivariini normaalisuolainen 400 g', category: 'spices_sauces' })
  })

  it('products survive export/import; colliding ids are remapped on merge', async () => {
    const p = await saveProduct(OIVARIINI, store, db)
    const ctx = await matchContext(store, db)
    await saveRecipe({ ...recipe('a', []), ingredients: buildIngredientList(['50 g oivariinia'], ctx) }, db)
    expect((await db.recipes.get('a'))!.ingredients[0].fineliId).toBe(p.foodId)
    const file = parseExportFile(JSON.stringify(await exportData(db)))
    const target = new MealPlannerDB(`pp-target-${n++}`)
    await target.products.put({ ...p, id: 'other-local', name: 'Toinen', foodId: p.foodId })
    await importData(file, 'merge', target)
    const imported = (await target.products.get(p.id))!
    expect(imported.foodId).not.toBe(p.foodId)
    expect((await target.recipes.get('a'))!.ingredients[0].fineliId).toBe(imported.foodId)
    await target.delete()
  })
})

describe('ratings', () => {
  it('stores 1–5 and filters', async () => {
    await saveRecipe(recipe('a', ['1 sipuli']), db)
    await setRecipeRating('a', 7, db)
    expect((await db.recipes.get('a'))!.rating).toBe(5)
    await setRecipeRating('a', null, db)
    expect((await db.recipes.get('a'))!.rating).toBeNull()
    const ctx = { lookup: store, pantry: [], nutritionCache: new Map() }
    const rs = [recipe('good', ['1 sipuli'], { rating: 5 }), recipe('meh', ['1 sipuli'], { rating: 3 })]
    expect(filterRecipes(rs, { ...EMPTY_FILTERS, minRating: 4 }, ctx).map((r) => r.id)).toEqual(['good'])
  })
})

describe('leftovers', () => {
  it('cooks extra at dinner, counts it once in shopping, and keeps links consistent on edits/undo', async () => {
    await saveRecipe(recipe('a', ['400 g naudan jauhelihaa']), db)
    const dinner = await addMealItem({ date: '2026-10-06', slot: 'dinner', recipeId: 'a', servings: 2 }, db)
    const lunch = (await planLeftover(dinner.id, undefined, db))!
    expect(lunch).toMatchObject({ date: '2026-10-07', slot: 'lunch', servings: 2, leftoverOfId: dinner.id })
    expect((await db.mealItems.get(dinner.id))!.extraServings).toBe(2)
    const listId = await createShoppingList('2026-10-06', '2026-10-07', 'L', store, db)
    const items = await db.shoppingItems.where('listId').equals(listId).toArray()
    expect(items[0].amount.mass).toBe(400) // 2 + 2 servings of a 4-serving recipe, not 6 servings
    await setMealServings(lunch.id, 3, db)
    expect((await db.mealItems.get(dinner.id))!.extraServings).toBe(3)
    const snapshot = await removeMealItem(lunch.id, db)
    expect((await db.mealItems.get(dinner.id))!.extraServings).toBeNull()
    await restoreMealItem(snapshot, db)
    expect((await db.mealItems.get(dinner.id))!.extraServings).toBe(3)
    const snap2 = await removeMealItem(dinner.id, db)
    expect(await db.mealItems.count()).toBe(0) // leftovers of a removed dinner are removed too
    await restoreMealItem(snap2, db)
    expect(await db.mealItems.count()).toBe(2)
  })
})

describe('automatic meal planning', () => {
  const mains = [
    recipe('chicken', ['500 g broilerin fileesuikaleita', '300 g riisiä', '2 rkl rypsiöljyä'], { tags: ['pääruoat'], totalTimeMin: 25 }),
    recipe('beef', ['400 g naudan jauhelihaa', '600 g perunoita', '1 sipuli'], { tags: ['pääruoat'], totalTimeMin: 40 }),
    recipe('salmon', ['500 g lohifileetä', '800 g perunoita'], { tags: ['pääruoat'], totalTimeMin: 35 }),
    recipe('lentil', ['2 dl punaisia linssejä', '1 tlk (400 g) tomaattimurskaa', '1 tlk (400 ml) kookosmaitoa'], { tags: ['keitto'], totalTimeMin: 30 }),
    recipe('pasta', ['400 g spagettia', '400 g tomaattimurskaa', '100 g juustoraastetta'], { tags: ['pääruoat', 'pasta'], totalTimeMin: 20 }),
    recipe('heavy', ['400 g pekonia', '500 g kermaa', '400 g spagettia'], { tags: ['pääruoat'], totalTimeMin: 30 }),
    recipe('slow', ['1 kg naudan kastikelihaa', '500 g perunoita'], { tags: ['pääruoat'], totalTimeMin: 180 }),
    recipe('porridge', ['2 dl kaurahiutaleita', '4 dl vettä'], { tags: ['aamiainen'], servings: 2, totalTimeMin: 10 }),
    recipe('bad', ['400 g naudan jauhelihaa'], { tags: ['pääruoat'], rating: 1 }),
  ]
  const week = Array.from({ length: 7 }, (_, i) => addDays('2026-10-05', i))
  const base: PlanOptions = {
    dates: week, slots: ['lunch', 'dinner'], people: 2, leftovers: true, diet: 'all', glutenFree: false, milkFree: false, lactoseFree: false,
    maxTimeWeekday: null, maxTimeWeekend: null, maxKcalPerDay: null, includeCatalogue: false, preferFavourites: true, use: [], avoid: [],
    avoidRepeats: false, occupied: new Set(), seed: 42,
  }
  const cands = () => buildCandidates(mains, store, new Set())

  it('plans every slot, eats yesterday’s dinner as today’s lunch, never picks 1-star recipes', () => {
    const plan = planMeals(cands(), base)
    const dinners = plan.meals.filter((m) => m.slot === 'dinner')
    expect(dinners).toHaveLength(7)
    for (const d of week.slice(1)) {
      const lunch = plan.meals.find((m) => m.date === d && m.slot === 'lunch')!
      const prevDinner = plan.meals.find((m) => m.date === addDays(d, -1) && m.slot === 'dinner')!
      expect(lunch.recipeId).toBe(prevDinner.recipeId)
      expect(lunch.leftoverOf).toEqual({ date: prevDinner.date, slot: 'dinner' })
      expect(prevDinner.extraServings).toBe(2)
    }
    expect(plan.meals.find((m) => m.date === week[0] && m.slot === 'lunch')!.leftoverOf).toBeNull()
    expect(plan.meals.some((m) => m.recipeId === 'bad' || m.recipeId === 'porridge')).toBe(false)
  })

  it('is deterministic per seed and respects diet, time and avoid-lists', () => {
    expect(planMeals(cands(), base)).toEqual(planMeals(cands(), base))
    const veg = planMeals(cands(), { ...base, diet: 'vegan' })
    expect(new Set(veg.meals.map((m) => m.recipeId))).toEqual(new Set(['lentil']))
    const quick = planMeals(cands(), { ...base, maxTimeWeekday: 30, maxTimeWeekend: 30, leftovers: false, avoidRepeats: false })
    expect(quick.meals.every((m) => ['chicken', 'lentil', 'pasta', 'heavy'].includes(m.recipeId))).toBe(true)
    const noFish = planMeals(cands(), { ...base, avoid: ['lohi'] })
    expect(noFish.meals.some((m) => m.recipeId === 'salmon')).toBe(false)
  })

  it('keeps each day under the per-person calorie maximum when possible', () => {
    const c = cands()
    const kcal = new Map(c.map((x) => [x.recipe.id, x.kcal]))
    const limit = 1400
    const plan = planMeals(c, { ...base, maxKcalPerDay: limit, slots: ['breakfast', 'lunch', 'dinner'] })
    for (const d of week) expect(plan.kcalByDay[d]).toBeLessThanOrEqual(limit * 1.03)
    expect(plan.meals.some((m) => m.recipeId === 'heavy' && (kcal.get('heavy') ?? 0) > limit * 0.5)).toBe(false)
  })

  it('plans a single day, skips occupied slots and supports rerolling one meal', () => {
    const day = planMeals(cands(), { ...base, dates: ['2026-10-05'], slots: ['breakfast', 'dinner'], occupied: new Set(['2026-10-05|breakfast']) })
    expect(day.meals.map((m) => m.slot)).toEqual(['dinner'])
    const plan = planMeals(cands(), base)
    const target = plan.meals.find((m) => m.date === week[2] && m.slot === 'dinner')!
    const rerolled = rerollMeal(plan, cands(), base, week[2], 'dinner', 7)
    const newDinner = rerolled.meals.find((m) => m.date === week[2] && m.slot === 'dinner')!
    expect(newDinner.recipeId).not.toBe(target.recipeId)
    expect(rerolled.meals.find((m) => m.date === week[3] && m.slot === 'lunch')!.recipeId).toBe(newDinner.recipeId)
  })

  it('saves a plan with working leftover links', async () => {
    for (const r of mains) await saveRecipe(r, db)
    const plan = planMeals(cands(), { ...base, dates: week.slice(0, 2) })
    const count = await applyMealPlan(plan.meals, { replace: false, dates: week.slice(0, 2), slots: base.slots }, db)
    expect(count).toBe(4)
    const items = await db.mealItems.toArray()
    const lunch2 = items.find((m) => m.date === week[1] && m.slot === 'lunch')!
    const dinner1 = items.find((m) => m.date === week[0] && m.slot === 'dinner')!
    expect(lunch2.leftoverOfId).toBe(dinner1.id)
    expect(dinner1.extraServings).toBe(2)
  })
})
