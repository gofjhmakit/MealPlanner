import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildFineliCatalogue } from '../src/db/catalogue'
import { MealPlannerDB } from '../src/db/db'
import { exportData, importData, migrate, parseExportFile } from '../src/db/exportImport'
import { addMealItem, createShoppingList, regenerateShoppingList, saveRecipe, setIngredientMapping, setShoppingItemCategory, toggleFavourite, toggleShoppingItem } from '../src/db/repo'
import { buildSeedRecipes, SEED_RECIPES } from '../src/db/seed'
import { buildIngredientList } from '../src/domain/recipeIngredients'
import type { Recipe } from '../src/domain/types'
import { fineliDishes, fineliFoods, fineliLookup } from './helpers'

let db: MealPlannerDB
let n = 0

beforeEach(async () => {
  db = new MealPlannerDB(`test-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

function recipe(id: string, lines: string[], servings = 4): Recipe {
  const now = new Date().toISOString()
  return {
    id, title: `Resepti ${id}`, servings, ingredients: buildIngredientList(lines, { fineli: fineliLookup() }),
    instructions: ['Tee näin.'], tags: [], origin: 'user', inCollection: true, createdAt: now, updatedAt: now,
  }
}

describe('seed data and catalogue', () => {
  it('seed recipes parse and map well', () => {
    const seeds = buildSeedRecipes({ fineli: fineliLookup() })
    expect(seeds).toHaveLength(SEED_RECIPES.length)
    const all = seeds.flatMap((r) => r.ingredients)
    const confident = all.filter((i) => i.confidence >= 0.7 || i.quantity == null)
    expect(confident.length / all.length).toBeGreaterThan(0.9)
  })

  it('builds a Fineli dish catalogue with source-mapped ingredients', () => {
    const foods = new Map(fineliFoods().map((f) => [f.id, f]))
    const catalogue = buildFineliCatalogue(fineliDishes(), foods, {})
    expect(catalogue.length).toBeGreaterThan(1000)
    const lasagne = catalogue.find((r) => r.id === 'fineli-7065')!
    expect(lasagne.title).toBe('Lasagne, sika-nauta')
    expect(lasagne.ingredients.every((i) => i.matchMethod === 'source' && i.confidence === 1)).toBe(true)
    expect(lasagne.instructions).toEqual([])
    expect(lasagne.servings).toBeGreaterThan(1)
  })
})

describe('repository operations', () => {
  it('remembers a user mapping and applies it to other recipes', async () => {
    await saveRecipe(recipe('a', ['1 pkt taco seasoning']), db)
    await saveRecipe(recipe('b', ['2 pkt taco seasoning']), db)
    const a = (await db.recipes.get('a'))!
    await setIngredientMapping('a', a.ingredients[0].id, { canonicalId: 'spice-mix', fineliId: 11196 }, true, fineliLookup(), db)
    const b = (await db.recipes.get('b'))!
    expect(b.ingredients[0]).toMatchObject({ fineliId: 11196, matchMethod: 'user', confidence: 1 })
    expect(await db.ingredientMappings.count()).toBe(1)
  })

  it('generates a shopping list, keeps checked state and category overrides on regeneration', async () => {
    await saveRecipe(recipe('a', ['200 g broilerin fileesuikaleita', '1 sipuli', '2 dl kuohukermaa']), db)
    await saveRecipe(recipe('b', ['300 g broilerin fileesuikaleita', '1 sipuli', '5 dl kuohukermaa']), db)
    await addMealItem({ date: '2026-10-05', slot: 'dinner', recipeId: 'a', servings: 4 }, db)
    await addMealItem({ date: '2026-10-06', slot: 'dinner', recipeId: 'b', servings: 4 }, db)
    const listId = await createShoppingList('2026-10-05', '2026-10-11', 'Testi', fineliLookup(), db)
    let items = await db.shoppingItems.where('listId').equals(listId).toArray()
    const chicken = items.find((i) => i.key === 'c:chicken-breast-strips')!
    expect(chicken.amount.mass).toBe(500)
    await toggleShoppingItem(chicken.id, db)
    const onion = items.find((i) => i.key === 'c:onion')!
    await setShoppingItemCategory(onion.id, 'other', true, db)

    // Plan changes: double the servings of recipe b
    const mb = (await db.mealItems.where('recipeId').equals('b').first())!
    await db.mealItems.update(mb.id, { servings: 8 })
    await regenerateShoppingList(listId, fineliLookup(), db)
    items = await db.shoppingItems.where('listId').equals(listId).toArray()
    expect(items.find((i) => i.key === 'c:chicken-breast-strips')).toMatchObject({ checked: true, amount: expect.objectContaining({ mass: 800 }) })
    expect(items.find((i) => i.key === 'c:onion')).toMatchObject({ category: 'other', categoryOverridden: true })
    expect((await db.shoppingLists.get(listId))!.planHash).toBeTruthy()
  })
})

describe('data export / import', () => {
  async function populate() {
    await saveRecipe(recipe('a', ['2 dl kevytmaitoa', '3 kananmunaa']), db)
    await db.recipes.put({ ...recipe('fineli-1', ['100 g sipulia']), origin: 'catalogue', inCollection: true })
    await toggleFavourite('a', db)
    await addMealItem({ date: '2026-10-05', slot: 'breakfast', recipeId: 'a', servings: 2 }, db)
    await createShoppingList('2026-10-05', '2026-10-05', 'Lista', fineliLookup(), db)
    await db.ingredientMappings.put({ key: 'jokin', canonicalId: 'onion', fineliId: 335, updatedAt: new Date().toISOString() })
    await db.settings.put({ key: 'userSettings', value: { targets: { energyKcal: 2200 }, defaultServings: 2, pantry: ['suola'], weekStartsOn: 1, hideCheckedShoppingItems: false } })
  }

  it('exports a versioned file without catalogue recipe bodies', async () => {
    await populate()
    const file = await exportData(db)
    expect(file.format).toBe('meal-planner')
    expect(file.version).toBe(1)
    expect(file.data.recipes.map((r) => r.id)).toEqual(['a'])
    expect(file.data.collectedCatalogueIds).toEqual(['fineli-1'])
    expect(file.data.favourites).toHaveLength(1)
    expect(file.data.mealItems).toHaveLength(1)
    expect(file.data.shoppingItems.length).toBeGreaterThan(0)
    expect(file.data.ingredientMappings).toHaveLength(1)
    expect(file.data.settings.targets?.energyKcal).toBe(2200)
  })

  it('round-trips through JSON into an empty database', async () => {
    await populate()
    const json = JSON.stringify(await exportData(db))
    const target = new MealPlannerDB(`test-target-${n++}`)
    await target.recipes.put({ ...recipe('fineli-1', ['100 g sipulia']), origin: 'catalogue', inCollection: false })
    const summary = await importData(parseExportFile(json), 'replace', target)
    expect(summary).toMatchObject({ recipes: 1, mealItems: 1, shoppingLists: 1, skippedMealItems: 0 })
    expect((await target.recipes.get('a'))!.ingredients).toHaveLength(2)
    expect((await target.recipes.get('fineli-1'))!.inCollection).toBe(true)
    expect(await target.favourites.count()).toBe(1)
    expect(await target.ingredientMappings.count()).toBe(1)
    expect(((await target.settings.get('userSettings'))!.value as { defaultServings: number }).defaultServings).toBe(2)
    await target.delete()
  })

  it('rejects invalid or future-version files with a clear message', () => {
    expect(() => parseExportFile('not json')).toThrow(/virheellinen JSON/)
    expect(() => parseExportFile(JSON.stringify({ format: 'other', version: 1 }))).toThrow(/Ateriasuunnittelijan/)
    expect(() => migrate({ format: 'meal-planner', version: 99 })).toThrow(/uudemmalla/)
    expect(() => parseExportFile(JSON.stringify({ format: 'meal-planner', version: 1, exportedAt: 'x', data: { recipes: [{ id: 1 }] } }))).toThrow(/virheellinen/)
  })

  it('skips meal items that reference missing recipes', async () => {
    const file = await exportData(db)
    file.data.mealItems.push({ id: 'm', planId: 'default', date: '2026-10-05', slot: 'lunch', recipeId: 'missing', servings: 1, position: 0 })
    const summary = await importData(file, 'merge', db)
    expect(summary.skippedMealItems).toBe(1)
  })
})
