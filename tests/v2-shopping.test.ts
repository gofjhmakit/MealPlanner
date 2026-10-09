// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MealPlannerDB } from '../src/db/db'
import { addMealItem, newShoppingTrip, ROLLING_LIST_ID, saveRecipe, setShoppingHome, syncRollingList, toggleShoppingItem } from '../src/db/repo'
import { buildIngredientList } from '../src/domain/recipeIngredients'
import { fineliLookup } from './helpers'

let db: MealPlannerDB
let n = 0
beforeEach(() => {
  db = new MealPlannerDB(`v2shop-${n++}`)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T12:00:00'))
})
afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
})

async function recipe(id: string, lines: string[]) {
  const ingredients = buildIngredientList(lines, { fineli: fineliLookup() } as never).map((x, i) => ({ ...x, id: `${id}-${i}` }))
  await saveRecipe({ id, title: id, servings: 4, ingredients, instructions: [], tags: [], origin: 'user', inCollection: true, createdAt: '', updatedAt: '' } as never, db)
}

describe('rolling shopping list', () => {
  it('covers today + horizon, follows the plan, keeps ticks and home marks', async () => {
    const lookup = fineliLookup()
    await recipe('soup', ['500 g perunoita', '1 sipuli', '1 tl suolaa'])
    await recipe('past', ['400 g naudan jauhelihaa'])
    await addMealItem({ date: '2026-10-08', slot: 'dinner', recipeId: 'past', servings: 4 }, db) // yesterday: not bought
    await addMealItem({ date: '2026-10-10', slot: 'dinner', recipeId: 'soup', servings: 4 }, db)
    await addMealItem({ date: '2026-10-20', slot: 'dinner', recipeId: 'past', servings: 4 }, db) // beyond a week
    let list = await syncRollingList(lookup, undefined, db)
    expect(list).toMatchObject({ id: ROLLING_LIST_ID, from: '2026-10-09', to: '2026-10-15', rolling: true })
    let items = await db.shoppingItems.where('listId').equals(ROLLING_LIST_ID).toArray()
    expect(items.map((i) => i.name).sort()).toEqual(['Peruna', 'Suola', 'Sipuli'].sort())

    const potato = items.find((i) => i.name === 'Peruna')!
    await toggleShoppingItem(potato.id, db)
    await setShoppingHome(ROLLING_LIST_ID, items.find((i) => i.name === 'Suola')!.key, true, db)

    // The plan changes: a new meal appears; ticks and home marks stay.
    await addMealItem({ date: '2026-10-11', slot: 'lunch', recipeId: 'past', servings: 2 }, db)
    list = await syncRollingList(lookup, undefined, db)
    items = await db.shoppingItems.where('listId').equals(ROLLING_LIST_ID).toArray()
    expect(items.some((i) => /jauheliha/i.test(i.name))).toBe(true)
    expect(items.find((i) => i.name === 'Peruna')!.checked).toBe(true)
    expect(list.homeKeys).toHaveLength(1)

    // A longer horizon brings in later meals; a new trip clears ticks and marks.
    await syncRollingList(lookup, 14, db)
    await newShoppingTrip(ROLLING_LIST_ID, db)
    items = await db.shoppingItems.where('listId').equals(ROLLING_LIST_ID).toArray()
    expect(items.every((i) => !i.checked)).toBe(true)
    expect((await db.shoppingLists.get(ROLLING_LIST_ID))!.homeKeys).toEqual([])
  })
})
