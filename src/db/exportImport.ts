/**
 * Versioned JSON export / import of all user data.
 *
 * {
 *   "format": "meal-planner",
 *   "version": 1,
 *   "exportedAt": "…",
 *   "data": { recipes, collectedCatalogueIds, favourites, mealPlans, mealItems,
 *             shoppingLists, shoppingItems, ingredientMappings, categoryOverrides, settings }
 * }
 *
 * Catalogue recipes (Fineli dishes) are not exported – they are rebuilt from the
 * dataset – only the ids of the ones the user added to their collection.
 * Future schema changes: bump EXPORT_VERSION and add a step to `migrate()`.
 */
import { z } from 'zod'
import {
  categoryOverrideSchema,
  DEFAULT_SETTINGS,
  favouriteSchema,
  ingredientMappingSchema,
  mealItemSchema,
  mealPlanSchema,
  productSchema,
  recipeSchema,
  shoppingItemSchema,
  shoppingListSchema,
  userSettingsSchema,
} from '../domain/types'
import { db as defaultDb, setSetting, type MealPlannerDB } from './db'
import { getUserSettings } from './repo'
import { nextProductFoodId } from '../domain/products'

export const EXPORT_FORMAT = 'meal-planner'
export const EXPORT_VERSION = 1

const exportDataSchema = z.object({
  recipes: z.array(recipeSchema),
  collectedCatalogueIds: z.array(z.string()).default([]),
  /** Personal notes on catalogue recipes (the recipes themselves are rebuilt from the dataset). */
  catalogueNotes: z.array(z.object({ id: z.string(), notes: z.string().max(4000).nullish(), rating: z.number().int().min(1).max(5).nullish() })).default([]),
  products: z.array(productSchema).default([]),
  favourites: z.array(favouriteSchema).default([]),
  mealPlans: z.array(mealPlanSchema).default([]),
  mealItems: z.array(mealItemSchema).default([]),
  shoppingLists: z.array(shoppingListSchema).default([]),
  shoppingItems: z.array(shoppingItemSchema).default([]),
  ingredientMappings: z.array(ingredientMappingSchema).default([]),
  categoryOverrides: z.array(categoryOverrideSchema).default([]),
  settings: userSettingsSchema.partial().default({}),
})

export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  app: z.string().optional(),
  data: exportDataSchema,
})
export type ExportFile = z.infer<typeof exportFileSchema>

export async function exportData(database: MealPlannerDB = defaultDb): Promise<ExportFile> {
  const recipes = await database.recipes.toArray()
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'Ateriasuunnittelija',
    data: {
      recipes: recipes.filter((r) => r.origin !== 'catalogue'),
      collectedCatalogueIds: recipes.filter((r) => r.origin === 'catalogue' && r.inCollection).map((r) => r.id),
      catalogueNotes: recipes.filter((r) => r.origin === 'catalogue' && (r.notes || r.rating)).map((r) => ({ id: r.id, notes: r.notes ?? null, rating: r.rating ?? null })),
      products: await database.products.toArray(),
      favourites: await database.favourites.toArray(),
      mealPlans: await database.mealPlans.toArray(),
      mealItems: await database.mealItems.toArray(),
      shoppingLists: await database.shoppingLists.toArray(),
      shoppingItems: await database.shoppingItems.toArray(),
      ingredientMappings: await database.ingredientMappings.toArray(),
      categoryOverrides: await database.categoryOverrides.toArray(),
      settings: await getUserSettings(database),
    },
  }
}

export class ImportFileError extends Error {}

/** Upgrade older export files to the current version. */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') throw new ImportFileError('Tiedosto ei ole kelvollinen JSON-vienti.')
  const obj = raw as { format?: unknown; version?: unknown }
  if (obj.format !== EXPORT_FORMAT) throw new ImportFileError('Tiedosto ei ole Ateriasuunnittelijan vientitiedosto.')
  if (typeof obj.version !== 'number') throw new ImportFileError('Vientitiedostosta puuttuu versio.')
  if (obj.version > EXPORT_VERSION) {
    throw new ImportFileError(`Tiedosto on tehty uudemmalla sovellusversiolla (versio ${obj.version}). Päivitä sovellus.`)
  }
  // version 1 is current; future: if (obj.version === 1) raw = upgradeV1toV2(raw) …
  return raw
}

export function parseExportFile(json: string): ExportFile {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ImportFileError('Tiedostoa ei voitu lukea: virheellinen JSON.')
  }
  const result = exportFileSchema.safeParse(migrate(raw))
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ImportFileError(`Vientitiedosto on virheellinen (${issue.path.join('.')}: ${issue.message}).`)
  }
  return result.data
}

export interface ImportSummary {
  recipes: number
  mealItems: number
  shoppingLists: number
  skippedMealItems: number
}

export async function importData(
  file: ExportFile,
  mode: 'replace' | 'merge',
  database: MealPlannerDB = defaultDb,
): Promise<ImportSummary> {
  const d = file.data
  return database.transaction(
    'rw',
    [database.recipes, database.products, database.favourites, database.mealPlans, database.mealItems, database.shoppingLists, database.shoppingItems, database.ingredientMappings, database.categoryOverrides, database.settings],
    async () => {
      if (mode === 'replace') {
        const userRecipeIds = (await database.recipes.filter((r) => r.origin !== 'catalogue').primaryKeys()) as string[]
        await database.recipes.bulkDelete(userRecipeIds)
        await database.recipes.where('origin').equals('catalogue').modify({ inCollection: false, notes: null, rating: null })
        await database.products.clear()
        await Promise.all([
          database.favourites.clear(),
          database.mealItems.clear(),
          database.shoppingLists.clear(),
          database.shoppingItems.clear(),
          database.ingredientMappings.clear(),
          database.categoryOverrides.clear(),
        ])
      }
      // Product food ids must stay unique: remap imported ids that belong to a different local product.
      const localProducts = await database.products.toArray()
      const ownerOfFood = new Map(localProducts.map((p) => [p.foodId, p.id]))
      let nextFood = nextProductFoodId([...localProducts, ...d.products])
      const remap = new Map<number, number>()
      const products = d.products.map((p) => {
        const owner = ownerOfFood.get(p.foodId)
        if (owner && owner !== p.id) {
          remap.set(p.foodId, nextFood)
          return { ...p, foodId: nextFood++ }
        }
        return p
      })
      const fix = (id: number | null | undefined) => (id != null && remap.has(id) ? remap.get(id)! : id)
      const recipes = remap.size
        ? d.recipes.map((r) => ({ ...r, ingredients: r.ingredients.map((i) => ({ ...i, fineliId: fix(i.fineliId) })) }))
        : d.recipes
      d.ingredientMappings = d.ingredientMappings.map((m) => ({ ...m, fineliId: fix(m.fineliId) }))
      await database.products.bulkPut(products)
      await database.recipes.bulkPut(recipes)
      for (const id of d.collectedCatalogueIds) await database.recipes.update(id, { inCollection: true })
      for (const { id, notes, rating } of d.catalogueNotes) await database.recipes.update(id, { notes: notes ?? null, rating: rating ?? null })
      const knownRecipes = new Set((await database.recipes.toCollection().primaryKeys()) as string[])
      const mealItems = d.mealItems.filter((m) => m.recipeId === null || knownRecipes.has(m.recipeId))
      await database.favourites.bulkPut(d.favourites.filter((f) => knownRecipes.has(f.recipeId)))
      if (d.mealPlans.length) await database.mealPlans.bulkPut(d.mealPlans)
      await database.mealItems.bulkPut(mealItems)
      await database.shoppingLists.bulkPut(d.shoppingLists)
      await database.shoppingItems.bulkPut(d.shoppingItems)
      await database.ingredientMappings.bulkPut(d.ingredientMappings)
      await database.categoryOverrides.bulkPut(d.categoryOverrides)
      await setSetting('userSettings', { ...DEFAULT_SETTINGS, ...d.settings }, database)
      return {
        recipes: d.recipes.length,
        mealItems: mealItems.length,
        shoppingLists: d.shoppingLists.length,
        skippedMealItems: d.mealItems.length - mealItems.length,
      }
    },
  )
}
