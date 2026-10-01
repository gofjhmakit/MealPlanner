// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MealPlannerDB } from '../src/db/db'
import { exportData, importData, parseExportFile } from '../src/db/exportImport'
import {
  addMealItem,
  addNoteMeal,
  addRecipeToShoppingList,
  copyDay,
  copyRange,
  createShoppingList,
  findRecipeBySourceUrl,
  removeExtraRecipe,
  removeMealItem,
  restoreMealItem,
  saveRecipe,
  setRecipeNotes,
} from '../src/db/repo'
import { matchIngredient } from '../src/domain/matcher'
import { buildIngredientList } from '../src/domain/recipeIngredients'
import { EMPTY_FILTERS, filterRecipes, recipeSpecialDiets } from '../src/domain/recipeInfo'
import { pantryMatcher, shoppingListText } from '../src/domain/shoppingList'
import { recipeSchema, type Recipe } from '../src/domain/types'
import { safeHttpUrl, sourceUrlKey } from '../src/domain/url'
import { extractRecipe, toRecipe } from '../src/import/pipeline'
import { fineliLookup } from './helpers'

let db: MealPlannerDB
let n = 0
beforeEach(async () => {
  db = new MealPlannerDB(`features-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

function recipe(id: string, lines: string[], extra: Partial<Recipe> = {}): Recipe {
  const now = new Date().toISOString()
  return {
    id, title: `Resepti ${id}`, servings: 4, ingredients: buildIngredientList(lines, { fineli: fineliLookup() }),
    instructions: [], tags: [], origin: 'user', inCollection: true, createdAt: now, updatedAt: now, ...extra,
  }
}

describe('URL safety', () => {
  it('accepts only absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://valio.fi/x')).toBe('https://valio.fi/x')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,<script>')).toBeNull()
    expect(safeHttpUrl('/relative')).toBeNull()
    expect(safeHttpUrl('not a url')).toBeNull()
  })

  it('the recipe schema drops unsafe URLs instead of storing them (malicious import file)', () => {
    const r = recipeSchema.parse({ ...recipe('x', []), sourceUrl: 'javascript:alert(1)', imageUrl: 'data:image/svg+xml,<svg onload=alert(1)>' })
    expect(r.sourceUrl).toBeNull()
    expect(r.imageUrl).toBeNull()
  })

  it('normalizes source URLs for duplicate detection', () => {
    expect(sourceUrlKey('https://www.valio.fi/reseptit/lasagne/?utm=x')).toBe(sourceUrlKey('http://valio.fi/reseptit/lasagne'))
    expect(sourceUrlKey('https://a.fi/%E0%A4%A')).toBeTruthy() // malformed escapes don't throw
  })
})

describe('meal plan additions', () => {
  it('note-only meals are planned but ignored by shopping lists and survive export/import', async () => {
    await saveRecipe(recipe('a', ['1 sipuli']), db)
    await addMealItem({ date: '2026-10-05', slot: 'dinner', recipeId: 'a', servings: 4 }, db)
    await addNoteMeal('2026-10-06', 'dinner', 'Syödään ulkona', db)
    const listId = await createShoppingList('2026-10-05', '2026-10-11', 'L', fineliLookup(), db)
    const items = await db.shoppingItems.where('listId').equals(listId).toArray()
    expect(items.map((i) => i.key)).toEqual(['c:onion'])
    const file = parseExportFile(JSON.stringify(await exportData(db)))
    const target = new MealPlannerDB(`features-target-${n++}`)
    const summary = await importData(file, 'replace', target)
    expect(summary.skippedMealItems).toBe(0)
    expect((await target.mealItems.toArray()).find((m) => m.recipeId === null)?.note).toBe('Syödään ulkona')
    await target.delete()
  })

  it('copies a day and a whole week forward', async () => {
    await saveRecipe(recipe('a', ['1 sipuli']), db)
    await addMealItem({ date: '2026-10-05', slot: 'breakfast', recipeId: 'a', servings: 2 }, db)
    await addNoteMeal('2026-10-07', 'lunch', 'Eväät', db)
    expect(await copyDay('2026-10-05', '2026-10-06', db)).toBe(1)
    expect(await copyRange('2026-10-05', '2026-10-11', 7, db)).toBe(3)
    const next = await db.mealItems.where('date').between('2026-10-12', '2026-10-18', true, true).toArray()
    expect(next.map((m) => `${m.date}:${m.slot}:${m.recipeId ?? m.note}`).sort()).toEqual([
      '2026-10-12:breakfast:a', '2026-10-13:breakfast:a', '2026-10-14:lunch:Eväät',
    ])
  })

  it('undo restores a removed meal', async () => {
    const m = await addMealItem({ date: '2026-10-05', slot: 'dinner', recipeId: 'a', servings: 4 }, db)
    const removed = await removeMealItem(m.id, db)
    expect(await db.mealItems.count()).toBe(0)
    await restoreMealItem(removed!, db)
    expect(await db.mealItems.get(m.id)).toMatchObject({ servings: 4, slot: 'dinner' })
  })
})

describe('shopping list additions', () => {
  it('adds a recipe directly to a new list and keeps it through regeneration', async () => {
    await saveRecipe(recipe('a', ['200 g broilerin fileesuikaleita', '1 sipuli']), db)
    const listId = await addRecipeToShoppingList(null, 'a', 8, fineliLookup(), db)
    const list = (await db.shoppingLists.get(listId))!
    expect(list.from > list.to).toBe(true) // recipe-only list, no plan range
    let items = await db.shoppingItems.where('listId').equals(listId).toArray()
    expect(items.find((i) => i.key === 'c:chicken-breast-strips')!.amount.mass).toBe(400)
    // Adding to an existing plan-based list merges with planned amounts
    await saveRecipe(recipe('b', ['300 g broilerin fileesuikaleita']), db)
    await addMealItem({ date: '2026-10-05', slot: 'dinner', recipeId: 'b', servings: 4 }, db)
    const planList = await createShoppingList('2026-10-05', '2026-10-05', 'P', fineliLookup(), db)
    await addRecipeToShoppingList(planList, 'a', 4, fineliLookup(), db)
    items = await db.shoppingItems.where('listId').equals(planList).toArray()
    expect(items.find((i) => i.key === 'c:chicken-breast-strips')!.amount.mass).toBe(500)
    const entry = (await db.shoppingLists.get(planList))!.extraRecipes[0]
    await removeExtraRecipe(planList, entry.id, fineliLookup(), db)
    items = await db.shoppingItems.where('listId').equals(planList).toArray()
    expect(items.find((i) => i.key === 'c:chicken-breast-strips')!.amount.mass).toBe(300)
    expect(items.find((i) => i.key === 'c:onion')).toBeUndefined()
  })

  it('recognizes pantry staples through synonyms', () => {
    const inPantry = pantryMatcher(['suola', 'rypsiöljy', 'mustapippuri'])
    expect(inPantry({ key: 'c:salt', name: 'Suola' })).toBe(true)
    expect(inPantry({ key: 'c:rapeseed-oil', name: 'Rypsiöljy' })).toBe(true)
    expect(inPantry({ key: 'c:onion', name: 'Sipuli' })).toBe(false)
    expect(pantryMatcher([])({ key: 'c:salt', name: 'Suola' })).toBe(false)
  })

  it('formats a shareable plain-text list grouped by aisle, without bought items', () => {
    const text = shoppingListText('Viikko 41', [
      { name: 'Sipuli', amountText: '2 kpl', category: 'vegetables', checked: false },
      { name: 'Maito', amountText: '1 l', category: 'dairy', checked: true },
      { name: 'Jauheliha', amountText: '400 g', category: 'meat_fish', checked: false },
    ])
    expect(text).toBe('Viikko 41\n\nHedelmät ja vihannekset:\n☐ Sipuli – 2 kpl\n\nLiha ja kala:\n☐ Jauheliha – 400 g')
  })
})

describe('recipes: notes, diets, search, duplicates', () => {
  it('stores personal notes and finds duplicates by source URL', async () => {
    await saveRecipe(recipe('a', [], { origin: 'imported', sourceUrl: 'https://www.valio.fi/reseptit/lasagne/' }), db)
    await setRecipeNotes('a', '  Vähemmän chiliä  ', db)
    expect((await db.recipes.get('a'))!.notes).toBe('Vähemmän chiliä')
    expect((await findRecipeBySourceUrl(['https://valio.fi/reseptit/lasagne?x=1'], db))?.id).toBe('a')
    expect(await findRecipeBySourceUrl(['https://valio.fi/reseptit/muu'], db)).toBeUndefined()
  })

  it('derives special diets conservatively from Fineli flags', () => {
    const f = fineliLookup()
    expect(recipeSpecialDiets(recipe('a', ['400 g broilerin fileesuikaleita', '2 rkl rypsiöljyä', 'suolaa']), f)).toEqual({ glutenFree: true, milkFree: true, lactoseFree: true })
    expect(recipeSpecialDiets(recipe('b', ['400 g spagettia']), f).glutenFree).toBe(false)
    const withMilk = recipeSpecialDiets(recipe('c', ['2 dl kevytmaitoa']), f)
    expect(withMilk.milkFree).toBe(false)
    expect(recipeSpecialDiets(recipe('d', ['100 g xyzzyä']), f)).toEqual({ glutenFree: false, milkFree: false, lactoseFree: false })
  })

  it('filters by special diet and searches through synonyms ("kana" finds broileri)', () => {
    const recipes = [recipe('chicken', ['400 g broilerin fileesuikaleita']), recipe('pasta', ['400 g spagettia'])]
    const ctx = { lookup: fineliLookup(), pantry: [], nutritionCache: new Map() }
    expect(filterRecipes(recipes, { ...EMPTY_FILTERS, glutenFree: true }, ctx).map((r) => r.id)).toEqual(['chicken'])
    expect(filterRecipes(recipes, { ...EMPTY_FILTERS, query: 'kana' }, ctx).map((r) => r.id)).toEqual(['chicken'])
    // no false positives from short stems or word-internal hits ("kaneli", "porkkana")
    const others = [recipe('porridge', ['1 tl kanelia']), recipe('soup', ['2 porkkanaa'])]
    expect(filterRecipes(others, { ...EMPTY_FILTERS, query: 'kana' }, ctx)).toEqual([])
    expect(filterRecipes(others, { ...EMPTY_FILTERS, query: 'porkkanoita' }, ctx).map((r) => r.id)).toEqual(['soup'])
  })

  it('recognizes product names that are otherwise stripped as brands', () => {
    expect(matchIngredient('snack tomaatti-basilika', { fineli: fineliLookup() }, '100 g Apetina® Snack tomaatti-basilika').canonicalId).toBe('feta')
    // an exact match still wins over a brand hint
    expect(matchIngredient('margariinia', { fineli: fineliLookup() }, '50 g Keiju margariinia').canonicalId).toBe('margarine')
    expect(matchIngredient('kevytmaitoa', { fineli: fineliLookup() }, '2 dl Valio kevytmaitoa').canonicalId).toBe('milk-semi')
  })
})

describe('additional import sites (trimmed live fixtures)', () => {
  const parse = (file: string, url: string) => {
    const doc = new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8'), 'text/html')
    return toRecipe(extractRecipe(doc, new URL(url)), { url: new URL(url), ctx: { fineli: fineliLookup() }, defaultServings: 4 })
  }

  it('Arla: JSON-LD with an entity-encoded type attribute', () => {
    const { recipe: r } = parse('arla-italiainen-salaatti.html', 'https://www.arla.fi/reseptit/italiainen-salaatti/')
    expect(r.title).toBe('Italialainen salaatti')
    expect(r.servings).toBe(4)
    expect(r.totalTimeMin).toBe(20)
    expect(r.ingredients.find((i) => i.raw.includes('Apetina'))!.canonicalId).toBe('feta')
    expect(r.ingredients.find((i) => i.raw.includes('kourallinen'))!.unit).toBe('kourallinen')
  })

  it('Kotikokki.net: lines without a space between number and unit', () => {
    const { recipe: r } = parse('kotikokki-kaurajuoma.html', 'https://www.kotikokki.net/reseptit/nayta/890137/Kotitekoinen%20kaurajuoma/')
    expect(r.title).toBe('Kotitekoinen kaurajuoma')
    expect(r.ingredients[0]).toMatchObject({ quantity: 1, unit: 'l', canonicalId: 'water' })
    expect(r.ingredients[1]).toMatchObject({ quantity: 100, unit: 'g', canonicalId: 'oats' })
    expect(r.ingredients[2]).toMatchObject({ quantity: 10, quantityMax: 30, unit: 'g', canonicalId: 'rapeseed-oil' })
  })
})
