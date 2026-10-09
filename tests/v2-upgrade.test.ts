// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MealPlannerDB, setSetting } from '../src/db/db'
import { exportData, importData, parseExportFile } from '../src/db/exportImport'
import { getUserSettings, ROLLING_LIST_ID, setShoppingHome, syncRollingList } from '../src/db/repo'
import { fineliLookup } from './helpers'

let db: MealPlannerDB
let n = 0
beforeEach(() => {
  db = new MealPlannerDB(`v2up-${n++}`)
})
afterEach(async () => {
  await db.delete()
})

describe('upgrading v1 data', () => {
  it('reads v1 settings, meals and shopping lists without the new fields', async () => {
    // Exactly what v1 stored: no household/goal/onboarded/weights, lists without rolling/homeKeys.
    await setSetting('userSettings', { targets: { energyKcal: 2000 }, defaultServings: 3, pantry: ['suola'], weekStartsOn: 1, hideCheckedShoppingItems: false }, db)
    await db.mealItems.put({ id: 'm1', planId: 'default', date: '2026-10-10', slot: 'dinner', recipeId: null, servings: 2, position: 0, note: 'Pizzaa ulkona' } as never)
    await db.shoppingLists.put({ id: 'old', name: 'Viikko 41', from: '2026-10-05', to: '2026-10-11', createdAt: '', updatedAt: '', extraRecipes: [] } as never)

    const s = await getUserSettings(db)
    expect(s).toMatchObject({ household: [], goal: null, onboarded: false, weights: [], defaultServings: 3, targets: { energyKcal: 2000 } })

    // The old list keeps working with the new "kotona" marks.
    await setShoppingHome('old', 'c:salt', true, db)
    expect((await db.shoppingLists.get('old'))!.homeKeys).toEqual(['c:salt'])

    // The rolling list appears next to it.
    await syncRollingList(fineliLookup(), undefined, db)
    expect(await db.shoppingLists.get(ROLLING_LIST_ID)).toBeDefined()

    // A v2 export round-trips, including the new settings and list fields.
    const file = await exportData(db)
    const fresh = new MealPlannerDB(`v2up-fresh-${n++}`)
    await importData(parseExportFile(JSON.stringify(file)), 'replace', fresh)
    expect((await fresh.shoppingLists.get('old'))!.homeKeys).toEqual(['c:salt'])
    expect((await getUserSettings(fresh)).defaultServings).toBe(3)
    await fresh.delete()
  })
})
