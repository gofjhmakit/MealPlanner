/**
 * Local-first persistence in IndexedDB (Dexie).
 *
 * Everything the user creates stays in this browser. Tables:
 *   recipes             all recipes (seed, user, imported, catalogue); `inCollection` = in "Omat reseptit"
 *   recipeSources       known recipe sources (sites, datasets)
 *   fineliFoods         Fineli nutrition database (imported from public/data/fineli-foods.json)
 *   supplementaryFoods  other open food databases in Finnish, used only where Fineli has nothing
 *                       suitable (public/data/supplementary-foods.json, see domain/supplementary.ts)
 *   mealPlans/mealItems meal planner; a meal = mealItems with the same date + slot
 *   shoppingLists/Items generated shopping lists with checked state and manual items
 *   favourites          favourite recipe ids
 *   ingredientMappings  user corrections: normalized ingredient name -> canonical/Fineli
 *   categoryOverrides   user-chosen shopping categories per ingredient key
 *   products            supermarket products (future integration; currently empty)
 *   settings            key/value app settings and data versions
 */
import Dexie, { type EntityTable } from 'dexie'
import type {
  CategoryOverride,
  Favourite,
  FineliFood,
  IngredientMapping,
  MealItem,
  MealPlan,
  Product,
  Recipe,
  RecipeSource,
  ShoppingItem,
  ShoppingList,
} from '../domain/types'

export interface SettingRow {
  key: string
  value: unknown
}

export class MealPlannerDB extends Dexie {
  recipes!: EntityTable<Recipe, 'id'>
  recipeSources!: EntityTable<RecipeSource, 'id'>
  fineliFoods!: EntityTable<FineliFood, 'id'>
  supplementaryFoods!: EntityTable<FineliFood, 'id'>
  mealPlans!: EntityTable<MealPlan, 'id'>
  mealItems!: EntityTable<MealItem, 'id'>
  shoppingLists!: EntityTable<ShoppingList, 'id'>
  shoppingItems!: EntityTable<ShoppingItem, 'id'>
  favourites!: EntityTable<Favourite, 'recipeId'>
  ingredientMappings!: EntityTable<IngredientMapping, 'key'>
  categoryOverrides!: EntityTable<CategoryOverride, 'key'>
  products!: EntityTable<Product, 'id'>
  settings!: EntityTable<SettingRow, 'key'>

  constructor(name = 'meal-planner') {
    super(name)
    this.version(1).stores({
      recipes: 'id, origin, inCollection, sourceId, updatedAt, createdAt',
      recipeSources: 'id',
      fineliFoods: 'id, type',
      mealPlans: 'id',
      mealItems: 'id, planId, date, recipeId, [planId+date]',
      shoppingLists: 'id, createdAt',
      shoppingItems: 'id, listId, [listId+key]',
      favourites: 'recipeId, createdAt',
      ingredientMappings: 'key',
      categoryOverrides: 'key',
      products: 'id, canonicalId, ean',
      settings: 'key',
    })
    this.version(2).stores({
      supplementaryFoods: 'id',
    })
  }
}

export const db = new MealPlannerDB()

export const DEFAULT_PLAN_ID = 'default'

export async function getSetting<T>(key: string, fallback: T, database: MealPlannerDB = db): Promise<T> {
  const row = await database.settings.get(key)
  return row ? (row.value as T) : fallback
}

export async function setSetting(key: string, value: unknown, database: MealPlannerDB = db): Promise<void> {
  await database.settings.put({ key, value })
}
