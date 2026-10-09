/**
 * Data operations used by the UI. All writes go through here so invariants
 * (timestamps, user mapping memory, shopping list regeneration) stay in one place.
 */
import { normalizeKey } from '../domain/finnish'
import { sourceUrlKey } from '../domain/url'
import { nextProductFoodId, productMatchIndex } from '../domain/products'
import type { PlannedMeal } from '../domain/weekPlanner'
import type { FineliLookup, MatchContext, UserMappingLookup } from '../domain/matcher'
import { newId, rematchIngredients } from '../domain/recipeIngredients'
import { aggregateShoppingList, type ShoppingLineInput } from '../domain/shoppingList'
import {
  DEFAULT_SETTINGS,
  userSettingsSchema,
  type MealItem,
  type MealSlot,
  type Recipe,
  type RecipeIngredient,
  type ShoppingCategory,
  type ShoppingItem,
  type ShoppingList,
  type Product,
  productSchema,
  type UserSettings,
} from '../domain/types'
import { db as defaultDb, DEFAULT_PLAN_ID, getSetting, setSetting, type MealPlannerDB } from './db'

const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------------------------
// Settings

export async function getUserSettings(database: MealPlannerDB = defaultDb): Promise<UserSettings> {
  const stored = await getSetting<unknown>('userSettings', null, database)
  const parsed = userSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(stored as object | null) })
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function saveUserSettings(settings: UserSettings, database: MealPlannerDB = defaultDb): Promise<void> {
  await setSetting('userSettings', userSettingsSchema.parse(settings), database)
}

// ---------------------------------------------------------------------------------------------
// Ingredient mappings

export async function loadUserMappings(database: MealPlannerDB = defaultDb): Promise<UserMappingLookup> {
  const rows = await database.ingredientMappings.toArray()
  return new Map(rows.map((r) => [r.key, { canonicalId: r.canonicalId ?? null, fineliId: r.fineliId ?? null }]))
}

export async function matchContext(fineli: FineliLookup, database: MealPlannerDB = defaultDb): Promise<MatchContext> {
  const products = productMatchIndex(await database.products.toArray())
  return { fineli, userMappings: await loadUserMappings(database), products }
}

/**
 * Set the mapping of one recipe ingredient. With `remember`, the choice is stored for the
 * normalized ingredient name and applied to every other recipe that uses the same wording
 * (unless those have their own manual mapping).
 */
export async function setIngredientMapping(
  recipeId: string,
  ingredientId: string,
  mapping: { canonicalId: string | null; fineliId: number | null },
  remember: boolean,
  fineli: FineliLookup,
  database: MealPlannerDB = defaultDb,
): Promise<void> {
  await database.transaction('rw', database.recipes, database.ingredientMappings, database.products, async () => {
    const recipe = await database.recipes.get(recipeId)
    if (!recipe) return
    const ing = recipe.ingredients.find((i) => i.id === ingredientId)
    if (!ing) return
    const updated: RecipeIngredient = {
      ...ing,
      canonicalId: mapping.canonicalId,
      fineliId: mapping.fineliId,
      confidence: mapping.fineliId !== null ? 1 : 0,
      matchMethod: 'user',
      userOverride: true,
    }
    await database.recipes.put({
      ...recipe,
      ingredients: recipe.ingredients.map((i) => (i.id === ingredientId ? updated : i)),
      updatedAt: now(),
    })
    if (!remember) return
    const key = normalizeKey(ing.name)
    await database.ingredientMappings.put({ key, canonicalId: mapping.canonicalId, fineliId: mapping.fineliId, updatedAt: now() })
    const ctx = await matchContext(fineli, database)
    const others = await database.recipes.filter((r) => r.id !== recipeId && r.ingredients.some((i) => !i.userOverride && normalizeKey(i.name) === key)).toArray()
    for (const r of others) {
      await database.recipes.put({ ...r, ingredients: rematchIngredients(r.ingredients, ctx), updatedAt: now() })
    }
  })
}

/** Drop a manual mapping and go back to automatic matching for this ingredient. */
export async function resetIngredientMapping(recipeId: string, ingredientId: string, fineli: FineliLookup, database: MealPlannerDB = defaultDb) {
  const recipe = await database.recipes.get(recipeId)
  if (!recipe) return
  const ctx = await matchContext(fineli, database)
  const ingredients = recipe.ingredients.map((i) => {
    if (i.id !== ingredientId) return i
    const [rematched] = rematchIngredients([{ ...i, userOverride: false, matchMethod: 'none' }], ctx)
    return rematched
  })
  await database.recipes.put({ ...recipe, ingredients, updatedAt: now() })
}

export async function deleteUserMapping(key: string, database: MealPlannerDB = defaultDb) {
  await database.ingredientMappings.delete(key)
}

export async function updateIngredient(recipeId: string, ingredientId: string, patch: Partial<RecipeIngredient>, database: MealPlannerDB = defaultDb) {
  const recipe = await database.recipes.get(recipeId)
  if (!recipe) return
  await database.recipes.put({
    ...recipe,
    ingredients: recipe.ingredients.map((i) => (i.id === ingredientId ? { ...i, ...patch } : i)),
    updatedAt: now(),
  })
}

// ---------------------------------------------------------------------------------------------
// Recipes

export async function saveRecipe(recipe: Recipe, database: MealPlannerDB = defaultDb): Promise<void> {
  await database.recipes.put({ ...recipe, updatedAt: now() })
}

/** Finds an already saved recipe imported from the same page (ignores www, query and trailing slash). */
export async function findRecipeBySourceUrl(urls: (string | null | undefined)[], database: MealPlannerDB = defaultDb): Promise<Recipe | undefined> {
  const keys = new Set(urls.map(sourceUrlKey).filter((k): k is string => !!k))
  if (keys.size === 0) return undefined
  return database.recipes.filter((r) => r.origin !== 'catalogue' && !!r.sourceUrl && keys.has(sourceUrlKey(r.sourceUrl) ?? '')).first()
}

/** Rating 1–5, or null to clear. */
export async function setRecipeRating(recipeId: string, rating: number | null, database: MealPlannerDB = defaultDb) {
  const value = rating === null ? null : Math.min(5, Math.max(1, Math.round(rating)))
  await database.recipes.update(recipeId, { rating: value, updatedAt: now() })
}

export async function setRecipeNotes(recipeId: string, notes: string, database: MealPlannerDB = defaultDb) {
  await database.recipes.update(recipeId, { notes: notes.trim().slice(0, 4000) || null, updatedAt: now() })
}

export async function setInCollection(recipeId: string, inCollection: boolean, database: MealPlannerDB = defaultDb) {
  await database.recipes.update(recipeId, { inCollection, updatedAt: now() })
}

/** Catalogue recipes are read-only; editing makes a personal copy. */
export async function copyRecipeToUser(recipe: Recipe, database: MealPlannerDB = defaultDb): Promise<Recipe> {
  const copy: Recipe = {
    ...recipe,
    id: newId(),
    origin: 'user',
    inCollection: true,
    title: recipe.title,
    ingredients: recipe.ingredients.map((i) => ({ ...i, id: newId() })),
    createdAt: now(),
    updatedAt: now(),
  }
  await database.recipes.put(copy)
  return copy
}

export async function deleteRecipe(recipeId: string, database: MealPlannerDB = defaultDb) {
  await database.transaction('rw', database.recipes, database.mealItems, database.favourites, async () => {
    await database.recipes.delete(recipeId)
    await database.mealItems.where('recipeId').equals(recipeId).delete()
    await database.favourites.delete(recipeId)
  })
}

export async function toggleFavourite(recipeId: string, database: MealPlannerDB = defaultDb): Promise<boolean> {
  const existing = await database.favourites.get(recipeId)
  if (existing) {
    await database.favourites.delete(recipeId)
    return false
  }
  await database.favourites.put({ recipeId, createdAt: now() })
  return true
}

// ---------------------------------------------------------------------------------------------
// Meal plan

export async function addMealItem(
  item: {
    date: string
    slot: MealSlot
    recipeId: string | null
    servings: number
    note?: string | null
    extraServings?: number | null
    leftoverOfId?: string | null
    id?: string
  },
  database: MealPlannerDB = defaultDb,
): Promise<MealItem> {
  const siblings = await database.mealItems.where('[planId+date]').equals([DEFAULT_PLAN_ID, item.date]).filter((m) => m.slot === item.slot).count()
  const row: MealItem = {
    planId: DEFAULT_PLAN_ID,
    position: siblings,
    ...item,
    id: item.id ?? newId(),
    note: item.note ?? null,
    extraServings: item.extraServings ?? null,
    leftoverOfId: item.leftoverOfId ?? null,
  }
  await database.mealItems.put(row)
  return row
}

/** A note-only entry such as "Syödään ulkona" – planned, but without ingredients or nutrition. */
export async function addNoteMeal(date: string, slot: MealSlot, note: string, database: MealPlannerDB = defaultDb) {
  return addMealItem({ date, slot, recipeId: null, servings: 1, note: note.trim().slice(0, 120) }, database)
}

export async function moveMealItem(id: string, date: string, slot: MealSlot, database: MealPlannerDB = defaultDb) {
  const siblings = await database.mealItems.where('[planId+date]').equals([DEFAULT_PLAN_ID, date]).filter((m) => m.slot === slot && m.id !== id).count()
  await database.mealItems.update(id, { date, slot, position: siblings })
}

/** Fields copied when duplicating a meal. Leftover links are not copied (a copy is cooked on its own). */
function copyFields(item: MealItem) {
  return { recipeId: item.recipeId, servings: item.servings, note: item.note ?? null }
}

export async function duplicateMealItem(id: string, target?: { date: string; slot: MealSlot }, database: MealPlannerDB = defaultDb) {
  const item = await database.mealItems.get(id)
  if (!item) return
  await addMealItem({ date: target?.date ?? item.date, slot: target?.slot ?? item.slot, ...copyFields(item) }, database)
}

/**
 * Removes a meal entry and returns a snapshot of every row it touched, so the UI can offer "Kumoa".
 *  - removing a leftover meal gives its portions back to the source meal (fewer extra portions cooked)
 *  - removing a meal that others eat leftovers of also removes those leftover meals
 */
export async function removeMealItem(id: string, database: MealPlannerDB = defaultDb): Promise<MealItem[]> {
  return database.transaction('rw', database.mealItems, async () => {
    const item = await database.mealItems.get(id)
    if (!item) return []
    const snapshot: MealItem[] = [item]
    if (item.leftoverOfId) {
      const source = await database.mealItems.get(item.leftoverOfId)
      if (source) {
        snapshot.push(source)
        await database.mealItems.update(source.id, { extraServings: Math.max(0, (source.extraServings ?? 0) - item.servings) || null })
      }
    }
    const dependents = await database.mealItems.filter((m) => m.leftoverOfId === id).toArray()
    snapshot.push(...dependents)
    await database.mealItems.bulkDelete([id, ...dependents.map((d) => d.id)])
    return snapshot
  })
}

/** Replace a meal's recipe. Leftover meals of it (and the meal it is a leftover of) change too. Returns an undo snapshot. */
export async function swapMealRecipe(id: string, recipeId: string, database: MealPlannerDB = defaultDb): Promise<MealItem[]> {
  return database.transaction('rw', database.mealItems, async () => {
    const item = await database.mealItems.get(id)
    if (!item) return []
    const rootId = item.leftoverOfId ?? item.id
    const group = await database.mealItems.filter((m) => m.id === rootId || m.leftoverOfId === rootId).toArray()
    await database.mealItems.bulkPut(group.map((m) => ({ ...m, recipeId })))
    return group
  })
}

/** Mark a meal eaten / skipped (null = back to planned). */
export async function setMealStatus(id: string, status: 'eaten' | 'skipped' | null, database: MealPlannerDB = defaultDb) {
  await database.mealItems.update(id, { status })
}

/** Undo for removeMealItem: puts every row back exactly as it was. */
export async function restoreMealItem(snapshot: MealItem | MealItem[], database: MealPlannerDB = defaultDb) {
  await database.mealItems.bulkPut(Array.isArray(snapshot) ? snapshot : [snapshot])
}

export async function setMealServings(id: string, servings: number, database: MealPlannerDB = defaultDb) {
  if (servings <= 0) return
  await database.transaction('rw', database.mealItems, async () => {
    const item = await database.mealItems.get(id)
    if (!item) return
    await database.mealItems.update(id, { servings })
    // Eating more leftovers means cooking more at the source meal.
    if (item.leftoverOfId) {
      const source = await database.mealItems.get(item.leftoverOfId)
      if (source) await database.mealItems.update(source.id, { extraServings: Math.max(0, (source.extraServings ?? 0) + servings - item.servings) || null })
    }
  })
}

/**
 * "Eat today's dinner as tomorrow's lunch": cook extra portions at `sourceId` and plan a
 * leftover meal on the next day (default: lunch). Returns the new leftover meal.
 */
export async function planLeftover(
  sourceId: string,
  target?: { date: string; slot: MealSlot; servings?: number },
  database: MealPlannerDB = defaultDb,
): Promise<MealItem | undefined> {
  const source = await database.mealItems.get(sourceId)
  if (!source?.recipeId) return undefined
  const d = new Date(`${source.date}T12:00:00`)
  d.setDate(d.getDate() + 1)
  const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const servings = target?.servings ?? source.servings
  const leftover = await addMealItem(
    { date: target?.date ?? nextDay, slot: target?.slot ?? 'lunch', recipeId: source.recipeId, servings, leftoverOfId: source.id },
    database,
  )
  await database.mealItems.update(source.id, { extraServings: (source.extraServings ?? 0) + servings })
  return leftover
}

export async function mealItemsInRange(from: string, to: string, database: MealPlannerDB = defaultDb): Promise<MealItem[]> {
  if (from > to) return [] // e.g. recipe-only shopping lists have no plan range
  return database.mealItems.where('date').between(from, to, true, true).filter((m) => m.planId === DEFAULT_PLAN_ID).toArray()
}

/** Copy all meals of one day to another day. Returns the number of copied entries. */
export async function copyDay(fromDate: string, toDate: string, database: MealPlannerDB = defaultDb): Promise<number> {
  const items = await database.mealItems.where('[planId+date]').equals([DEFAULT_PLAN_ID, fromDate]).toArray()
  for (const it of items.sort((a, b) => a.position - b.position)) {
    await addMealItem({ date: toDate, slot: it.slot, ...copyFields(it) }, database)
  }
  return items.length
}

/** Copy a range of days forward by `offsetDays` (e.g. this week -> next week). Leftover links inside the range are kept. */
export async function copyRange(from: string, to: string, offsetDays: number, database: MealPlannerDB = defaultDb): Promise<number> {
  const items = await mealItemsInRange(from, to, database)
  const newIds = new Map(items.map((it) => [it.id, newId()]))
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)) {
    const d = new Date(`${it.date}T12:00:00`)
    d.setDate(d.getDate() + offsetDays)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const leftoverOfId = it.leftoverOfId ? (newIds.get(it.leftoverOfId) ?? null) : null
    // Extra portions only make sense if the meals eating them were copied too.
    const extra = items.filter((m) => m.leftoverOfId === it.id).reduce((sum, m) => sum + m.servings, 0)
    await addMealItem({ id: newIds.get(it.id), date, slot: it.slot, ...copyFields(it), extraServings: extra || null, leftoverOfId }, database)
  }
  return items.length
}

export async function clearRange(from: string, to: string, database: MealPlannerDB = defaultDb) {
  const items = await mealItemsInRange(from, to, database)
  await database.mealItems.bulkDelete(items.map((i) => i.id))
}

// ---------------------------------------------------------------------------------------------
// Shopping lists

/** Fingerprint of meals in a range, including recipe edits, used to detect out-of-date shopping lists. */
export async function planHash(from: string, to: string, database: MealPlannerDB = defaultDb): Promise<string> {
  const items = (await mealItemsInRange(from, to, database)).filter((m) => m.recipeId)
  const recipes = await database.recipes.bulkGet([...new Set(items.map((i) => i.recipeId!))])
  const stamps = new Map(recipes.filter((r): r is Recipe => !!r).map((r) => [r.id, r.updatedAt]))
  return items
    .map((m) => `${m.recipeId}:${m.servings}+${m.extraServings ?? 0}:${m.leftoverOfId ? 'L' : ''}:${stamps.get(m.recipeId!) ?? ''}`)
    .sort()
    .join('|')
}

async function listLines(list: ShoppingList, database: MealPlannerDB): Promise<ShoppingLineInput[]> {
  const inRange = await mealItemsInRange(list.from, list.to, database)
  // Leftover meals are eaten from portions cooked (and bought) at their source meal.
  const sourceIds = [...new Set(inRange.map((m) => m.leftoverOfId).filter((x): x is string => !!x))]
  const existingSources = new Set((await database.mealItems.bulkGet(sourceIds)).filter(Boolean).map((m) => m!.id))
  const planned = inRange
    .filter((m): m is MealItem & { recipeId: string } => !!m.recipeId)
    .filter((m) => !m.leftoverOfId || !existingSources.has(m.leftoverOfId))
    .map((m) => ({ recipeId: m.recipeId, servings: m.servings + (m.extraServings ?? 0) }))
  const entries = [...planned, ...(list.extraRecipes ?? [])]
  const recipes = new Map((await database.recipes.bulkGet([...new Set(entries.map((e) => e.recipeId))])).filter((r): r is Recipe => !!r).map((r) => [r.id, r]))
  const lines: ShoppingLineInput[] = []
  for (const entry of entries) {
    const recipe = recipes.get(entry.recipeId)
    if (!recipe) continue
    const factor = entry.servings / recipe.servings
    for (const ingredient of recipe.ingredients) {
      if (ingredient.optional) continue
      lines.push({ recipeId: recipe.id, recipeTitle: recipe.title, ingredient, factor })
    }
  }
  return lines
}

async function categoryOverrideMap(database: MealPlannerDB): Promise<Map<string, ShoppingCategory>> {
  return new Map((await database.categoryOverrides.toArray()).map((c) => [c.key, c.category]))
}

export async function createShoppingList(
  from: string,
  to: string,
  name: string,
  fineli: FineliLookup,
  database: MealPlannerDB = defaultDb,
): Promise<string> {
  const id = newId()
  await database.shoppingLists.put({ id, name, from, to, createdAt: now(), updatedAt: now(), extraRecipes: [], homeKeys: [] })
  await regenerateShoppingList(id, fineli, database)
  return id
}

/**
 * Rebuild generated items from the current meal plan, keeping checked state and
 * category overrides of items that still exist, and all manually added items.
 */
export async function regenerateShoppingList(listId: string, fineli: FineliLookup, database: MealPlannerDB = defaultDb) {
  const list = await database.shoppingLists.get(listId)
  if (!list) return
  const aggregated = aggregateShoppingList(await listLines(list, database), fineli, await categoryOverrideMap(database))
  const hash = await planHash(list.from, list.to, database)
  await database.transaction('rw', database.shoppingItems, database.shoppingLists, async () => {
    const existing = await database.shoppingItems.where('listId').equals(listId).toArray()
    const byKey = new Map(existing.filter((i) => !i.manual).map((i) => [i.key, i]))
    const next: ShoppingItem[] = aggregated.map((a) => {
      const prev = byKey.get(a.key)
      return {
        id: prev?.id ?? newId(),
        listId,
        key: a.key,
        name: a.name,
        amount: a.amount,
        category: prev?.categoryOverridden ? prev.category : a.category,
        categoryOverridden: prev?.categoryOverridden ?? false,
        checked: prev?.checked ?? false,
        manual: false,
        manualAmount: null,
        sources: a.sources,
        productId: prev?.productId ?? null,
      }
    })
    const keep = new Set(next.map((n) => n.id))
    await database.shoppingItems.bulkDelete(existing.filter((i) => !i.manual && !keep.has(i.id)).map((i) => i.id))
    await database.shoppingItems.bulkPut(next)
    await database.shoppingLists.update(listId, { updatedAt: now(), planHash: hash })
  })
}

export const ROLLING_LIST_ID = 'rolling'

/**
 * The always-current shopping list: today → today + horizon − 1. Moves forward with the calendar
 * and is rebuilt whenever the meal plan in that range changes (ticks and "kotona" marks are kept).
 */
export async function syncRollingList(fineli: FineliLookup, horizonDays?: number, database: MealPlannerDB = defaultDb): Promise<ShoppingList> {
  const t = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const existing = await database.shoppingLists.get(ROLLING_LIST_ID)
  const days = horizonDays ?? existing?.horizonDays ?? 7
  const end = new Date(t)
  end.setDate(end.getDate() + days - 1)
  const from = iso(t)
  const to = iso(end)
  if (!existing) {
    await database.shoppingLists.put({ id: ROLLING_LIST_ID, name: 'Ostokset', from, to, createdAt: now(), updatedAt: now(), extraRecipes: [], rolling: true, horizonDays: days, homeKeys: [], triaged: false })
    await regenerateShoppingList(ROLLING_LIST_ID, fineli, database)
  } else {
    const moved = existing.from !== from || existing.to !== to
    if (moved) await database.shoppingLists.update(ROLLING_LIST_ID, { from, to, horizonDays: days })
    const hash = await planHash(from, to, database)
    if (moved || hash !== existing.planHash) await regenerateShoppingList(ROLLING_LIST_ID, fineli, database)
  }
  return (await database.shoppingLists.get(ROLLING_LIST_ID))!
}

/** Mark an item as "at home" (not bought this trip), or back to buy. */
export async function setShoppingHome(listId: string, key: string, home: boolean, database: MealPlannerDB = defaultDb) {
  const list = await database.shoppingLists.get(listId)
  if (!list) return
  const keys = new Set(list.homeKeys ?? [])
  if (home) keys.add(key)
  else keys.delete(key)
  await database.shoppingLists.update(listId, { homeKeys: [...keys] })
}

/** Start a fresh trip: clear ticks, bought manual items, "kotona" marks and the check. */
export async function newShoppingTrip(listId: string, database: MealPlannerDB = defaultDb) {
  await database.transaction('rw', database.shoppingLists, database.shoppingItems, async () => {
    await database.shoppingItems.where('listId').equals(listId).filter((i) => i.manual && i.checked).delete()
    await database.shoppingItems.where('listId').equals(listId).modify({ checked: false })
    await database.shoppingLists.update(listId, { homeKeys: [], triaged: false })
  })
}

export async function toggleShoppingItem(id: string, database: MealPlannerDB = defaultDb) {
  const item = await database.shoppingItems.get(id)
  if (item) await database.shoppingItems.update(id, { checked: !item.checked })
}

export async function setShoppingItemCategory(id: string, category: ShoppingCategory, remember: boolean, database: MealPlannerDB = defaultDb) {
  const item = await database.shoppingItems.get(id)
  if (!item) return
  await database.shoppingItems.update(id, { category, categoryOverridden: true })
  if (remember && !item.manual) await database.categoryOverrides.put({ key: item.key, category })
}

export async function addManualShoppingItem(
  listId: string,
  name: string,
  amountText: string,
  category: ShoppingCategory,
  database: MealPlannerDB = defaultDb,
) {
  await database.shoppingItems.put({
    id: newId(),
    listId,
    key: `manual:${newId()}`,
    name,
    amount: { mass: null, volume: null, counts: {}, unquantified: 0 },
    category,
    categoryOverridden: true,
    checked: false,
    manual: true,
    manualAmount: amountText || null,
    sources: [],
    productId: null,
  })
}

export async function uncheckAll(listId: string, database: MealPlannerDB = defaultDb) {
  await database.shoppingItems.where('listId').equals(listId).modify({ checked: false })
}

export async function deleteShoppingList(listId: string, database: MealPlannerDB = defaultDb) {
  await database.transaction('rw', database.shoppingLists, database.shoppingItems, async () => {
    await database.shoppingItems.where('listId').equals(listId).delete()
    await database.shoppingLists.delete(listId)
  })
}

/** Add a recipe's ingredients to a shopping list without planning it (creates a list when listId is null). */
export async function addRecipeToShoppingList(
  listId: string | null,
  recipeId: string,
  servings: number,
  fineli: FineliLookup,
  database: MealPlannerDB = defaultDb,
): Promise<string> {
  let id = listId
  if (!id) {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const recipe = await database.recipes.get(recipeId)
    id = newId()
    // An empty date range: the list contains only the directly added recipes.
    await database.shoppingLists.put({ id, name: recipe ? `Ostoslista: ${recipe.title}` : 'Ostoslista', from: iso, to: '0000-00-00', createdAt: now(), updatedAt: now(), extraRecipes: [], homeKeys: [] })
  }
  const list = await database.shoppingLists.get(id)
  if (!list) throw new Error('Ostoslistaa ei löytynyt')
  await database.shoppingLists.update(id, { extraRecipes: [...(list.extraRecipes ?? []), { id: newId(), recipeId, servings }] })
  await regenerateShoppingList(id, fineli, database)
  return id
}

export async function removeExtraRecipe(listId: string, entryId: string, fineli: FineliLookup, database: MealPlannerDB = defaultDb) {
  const list = await database.shoppingLists.get(listId)
  if (!list) return
  await database.shoppingLists.update(listId, { extraRecipes: (list.extraRecipes ?? []).filter((e) => e.id !== entryId) })
  await regenerateShoppingList(listId, fineli, database)
}

/** Deletes a shopping item and returns it so the UI can offer "Kumoa". */
export async function removeShoppingItem(id: string, database: MealPlannerDB = defaultDb): Promise<ShoppingItem | undefined> {
  const item = await database.shoppingItems.get(id)
  await database.shoppingItems.delete(id)
  return item
}

export async function restoreShoppingItem(item: ShoppingItem, database: MealPlannerDB = defaultDb) {
  await database.shoppingItems.put(item)
}

// ---------------------------------------------------------------------------------------------
// The user's own products

/**
 * Re-run automatic matching in the user's own recipes (not catalogue dishes, whose rows come
 * from Fineli) so new or changed products or nutrition data are picked up. Manual choices are kept.
 */
export async function rematchUserRecipes(fineli: FineliLookup, database: MealPlannerDB, onlyFoodId?: number) {
  const ctx = await matchContext(fineli, database)
  const recipes = await database.recipes.filter((r) => r.origin !== 'catalogue').toArray()
  for (const r of recipes) {
    const next = rematchIngredients(r.ingredients, ctx)
    const changed = next.some((ing, i) => ing.fineliId !== r.ingredients[i].fineliId || ing.canonicalId !== r.ingredients[i].canonicalId)
    const touches = onlyFoodId === undefined || r.ingredients.some((i) => i.fineliId === onlyFoodId) || next.some((i) => i.fineliId === onlyFoodId)
    if (changed && touches) await database.recipes.put({ ...r, ingredients: next, updatedAt: now() })
    else if (touches && onlyFoodId !== undefined) await database.recipes.put({ ...r, updatedAt: now() }) // nutrition changed
  }
}

export async function saveProduct(
  input: Omit<Product, 'id' | 'foodId'> & { id?: string; foodId?: number },
  fineli: FineliLookup,
  database: MealPlannerDB = defaultDb,
): Promise<Product> {
  const existing = input.id ? await database.products.get(input.id) : undefined
  const all = await database.products.toArray()
  const product = productSchema.parse({
    ...input,
    id: existing?.id ?? input.id ?? newId(),
    foodId: existing?.foodId ?? input.foodId ?? nextProductFoodId(all),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  })
  await database.products.put(product)
  if ('setProducts' in fineli) (fineli as { setProducts: (p: Product[]) => void }).setProducts(await database.products.toArray())
  await rematchUserRecipes(fineli, database, product.foodId)
  return product
}

/** Delete a product; recipe lines that used it go back to automatic matching. */
export async function deleteProduct(id: string, fineli: FineliLookup, database: MealPlannerDB = defaultDb) {
  const product = await database.products.get(id)
  if (!product) return
  await database.products.delete(id)
  await database.ingredientMappings.filter((m) => m.fineliId === product.foodId).delete()
  const recipes = await database.recipes.filter((r) => r.ingredients.some((i) => i.fineliId === product.foodId)).toArray()
  for (const r of recipes) {
    const released = r.ingredients.map((i) => (i.fineliId === product.foodId ? { ...i, userOverride: false, matchMethod: 'none' as const } : i))
    await database.recipes.put({ ...r, ingredients: released, updatedAt: now() })
  }
  if ('setProducts' in fineli) (fineli as { setProducts: (p: Product[]) => void }).setProducts(await database.products.toArray())
  await rematchUserRecipes(fineli, database)
}

export async function findProductByEan(ean: string, database: MealPlannerDB = defaultDb): Promise<Product | undefined> {
  return database.products.where('ean').equals(ean).first()
}

// ---------------------------------------------------------------------------------------------
// Automatic planning

/**
 * Save a generated plan. With `replace`, existing meals in the planned date/slot combinations are
 * removed first; otherwise the planner has already skipped occupied slots.
 */
export async function applyMealPlan(
  meals: PlannedMeal[],
  opts: { replace: boolean; dates: string[]; slots: MealSlot[] },
  database: MealPlannerDB = defaultDb,
): Promise<number> {
  return database.transaction('rw', database.mealItems, async () => {
    if (opts.replace) {
      const from = [...opts.dates].sort()[0]
      const to = [...opts.dates].sort().at(-1)!
      const existing = await mealItemsInRange(from, to, database)
      const doomed = existing.filter((m) => opts.dates.includes(m.date) && opts.slots.includes(m.slot)).map((m) => m.id)
      // Leftover meals elsewhere that pointed at removed meals become ordinary meals.
      await database.mealItems.filter((m) => !!m.leftoverOfId && doomed.includes(m.leftoverOfId)).modify({ leftoverOfId: null })
      await database.mealItems.bulkDelete(doomed)
    }
    const ids = new Map<string, string>()
    let count = 0
    for (const m of meals.filter((x) => !x.leftoverOf)) {
      const row = await addMealItem({ date: m.date, slot: m.slot, recipeId: m.recipeId, servings: m.servings, extraServings: m.extraServings || null }, database)
      ids.set(`${m.date}|${m.slot}`, row.id)
      count++
    }
    for (const m of meals.filter((x) => x.leftoverOf)) {
      const sourceId = ids.get(`${m.leftoverOf!.date}|${m.leftoverOf!.slot}`) ?? null
      await addMealItem({ date: m.date, slot: m.slot, recipeId: m.recipeId, servings: m.servings, leftoverOfId: sourceId }, database)
      count++
    }
    return count
  })
}
