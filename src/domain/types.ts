/**
 * Core domain model. Zod schemas double as runtime validation for data import
 * (JSON export files) and as the single source of truth for TypeScript types.
 *
 * Concept separation (see README "Data model"):
 *   RecipeIngredient  – a line of a recipe as written ("2 dl kevytmaitoa") + parsed quantity
 *   CanonicalIngredient – normalized ingredient concept ("Kevytmaito"), code-level dictionary
 *   NutritionFood (Fineli) – generic food with nutrient values per 100 g
 *   Product – optional supermarket product (future integration, table exists but is empty)
 */
import { z } from 'zod'
import type { SupplementarySourceId } from './supplementary'
import { safeHttpUrl } from './url'

/** Optional URL field: anything that is not an absolute http(s) URL is dropped (never rendered). */
const httpUrl = z.preprocess((v) => (v == null ? v : safeHttpUrl(v)), z.string().nullish())

export const SHOPPING_CATEGORIES = [
  'vegetables',
  'meat_fish',
  'dairy',
  'bakery',
  'dry_goods',
  'frozen',
  'canned',
  'spices_sauces',
  'other',
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

export const RECIPE_ORIGINS = ['seed', 'user', 'imported', 'catalogue'] as const
export type RecipeOrigin = (typeof RECIPE_ORIGINS)[number]

export const SCALING_RULES = ['linear', 'sublinear', 'fixed'] as const
export type ScalingRule = (typeof SCALING_RULES)[number]

export const MATCH_METHODS = [
  'user', // user chose the mapping manually
  'source', // mapping given by the data source itself (Fineli dish rows)
  'exact', // whole ingredient name equals a known alias
  'alias', // alias matched after dropping neutral modifier words
  'modifier-dropped', // alias matched after dropping meaningful modifier words
  'compound-head', // head of a Finnish compound matched (kirsikkatomaatti -> tomaatti)
  'product', // matched to one of the user's own products (name, brand + name or alias)
  'fineli-search', // no dictionary hit, matched by searching Fineli food names
  'supplementary-search', // nothing suitable in Fineli, matched by searching the supplementary databases (supplementary.ts)
  'none',
] as const
export type MatchMethod = (typeof MATCH_METHODS)[number]

export const recipeIngredientSchema = z.object({
  id: z.string(),
  /** Original line exactly as it appeared in the source. Never modified. */
  raw: z.string(),
  /** Optional sub-heading within the ingredient list ("Kastike"). */
  group: z.string().nullish(),
  quantity: z.number().nullable(),
  /** Upper bound for ranges like "1–2". */
  quantityMax: z.number().nullish(),
  unit: z.string().nullable(),
  /** Cleaned ingredient name used for matching ("kevytmaito"). */
  name: z.string(),
  note: z.string().nullish(),
  /** Mass/volume explicitly given in the line, e.g. "2 dl (100 g) juustoraastetta". */
  explicitGrams: z.number().nullish(),
  /** Per-package weight/volume, e.g. "2 tlk (à 400 g)". */
  perUnitGrams: z.number().nullish(),
  perUnitMl: z.number().nullish(),
  size: z.enum(['S', 'M', 'L']).nullish(),
  canonicalId: z.string().nullish(),
  fineliId: z.number().nullish(),
  /** Mapping confidence 0..1 (1 = exact, 0 = unknown). */
  confidence: z.number().min(0).max(1),
  matchMethod: z.enum(MATCH_METHODS),
  userOverride: z.boolean().default(false),
  /** Manual weight for the whole line (in grams) when unit conversion is not possible. */
  gramsOverride: z.number().nullish(),
  scaling: z.enum(SCALING_RULES).default('linear'),
  optional: z.boolean().default(false),
})
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>

export const importDiagnosticsSchema = z.object({
  adapter: z.string(),
  methods: z.array(z.string()),
  found: z.record(z.string(), z.boolean()),
  missing: z.array(z.string()),
  warnings: z.array(z.string()),
  importedAt: z.string(),
})
export type ImportDiagnostics = z.infer<typeof importDiagnosticsSchema>

export const sourceNutritionSchema = z.object({
  /** Values exactly as the source reported them ("708 kcal", 196, ...). */
  raw: z.record(z.string(), z.union([z.string(), z.number()])),
  /** What the values refer to, if the source stated it. */
  basis: z.enum(['unknown', 'per-serving', 'per-100g', 'total']),
})
export type SourceNutrition = z.infer<typeof sourceNutritionSchema>

export const recipeSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().nullish(),
  servings: z.number().positive(),
  servingsText: z.string().nullish(),
  prepTimeMin: z.number().nullish(),
  cookTimeMin: z.number().nullish(),
  totalTimeMin: z.number().nullish(),
  timeText: z.string().nullish(),
  imageUrl: httpUrl,
  ingredients: z.array(recipeIngredientSchema),
  instructions: z.array(z.string()),
  tags: z.array(z.string()),
  category: z.string().nullish(),
  cuisine: z.string().nullish(),
  origin: z.enum(RECIPE_ORIGINS),
  sourceId: z.string().nullish(),
  sourceUrl: httpUrl,
  sourceName: z.string().nullish(),
  author: z.string().nullish(),
  /** Licence and credits for recipes from open datasets (shown on the recipe page). */
  attribution: z
    .object({
      license: z.string(),
      licenseUrl: httpUrl,
      /** Title in the original language when the recipe was translated. */
      originalTitle: z.string().nullish(),
      /** What was changed from the original (required by CC BY-SA). */
      changes: z.string().nullish(),
      imageCredit: z.string().nullish(),
      imageLicense: z.string().nullish(),
      imageLicenseUrl: httpUrl,
    })
    .nullish(),
  sourceNutrition: sourceNutritionSchema.nullish(),
  importReport: importDiagnosticsSchema.nullish(),
  /** Whether the recipe is in the user's personal collection ("Omat reseptit"). */
  inCollection: z.boolean(),
  /** The user's own notes ("vähemmän chiliä", "lapset tykkäsi"). */
  notes: z.string().nullish(),
  /** The user's own rating 1–5. */
  rating: z.number().int().min(1).max(5).nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Recipe = z.infer<typeof recipeSchema>

export const recipeSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  homepage: z.string().nullish(),
  domains: z.array(z.string()),
  kind: z.enum(['website', 'dataset', 'user']),
  license: z.string().nullish(),
  notes: z.string().nullish(),
})
export type RecipeSource = z.infer<typeof recipeSourceSchema>

export const mealPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})
export type MealPlan = z.infer<typeof mealPlanSchema>

/**
 * One entry in a meal. A "meal" is the group of items sharing date + slot.
 * `recipeId` null = a note-only entry ("Syödään ulkona", "Jämät") that has no ingredients.
 */
export const mealItemSchema = z.object({
  id: z.string(),
  planId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(MEAL_SLOTS),
  recipeId: z.string().nullable(),
  servings: z.number().positive(),
  position: z.number(),
  note: z.string().nullish(),
  /** Extra portions cooked for later (e.g. tomorrow's lunch); counted in the shopping list only. */
  extraServings: z.number().min(0).nullish(),
  /** This entry eats leftovers cooked at another meal – not counted again in the shopping list. */
  leftoverOfId: z.string().nullish(),
})
export type MealItem = z.infer<typeof mealItemSchema>

export const amountSchema = z.object({
  mass: z.number().nullish(), // grams
  volume: z.number().nullish(), // millilitres
  counts: z.record(z.string(), z.number()), // unit id -> count
  unquantified: z.number().default(0), // number of lines without a quantity ("suolaa")
})
export type Amount = z.infer<typeof amountSchema>

export const shoppingListSchema = z.object({
  id: z.string(),
  name: z.string(),
  from: z.string(),
  to: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Fingerprint of the planned meals the items were generated from (detects stale lists). */
  planHash: z.string().nullish(),
  /** Recipes added to the list directly (not via the meal plan). */
  extraRecipes: z.array(z.object({ id: z.string(), recipeId: z.string(), servings: z.number().positive() })).default([]),
})
export type ShoppingList = z.infer<typeof shoppingListSchema>

export const shoppingItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  /** Aggregation key: canonical ingredient id, Fineli id or normalized name. */
  key: z.string(),
  name: z.string(),
  amount: amountSchema,
  category: z.enum(SHOPPING_CATEGORIES),
  categoryOverridden: z.boolean().default(false),
  checked: z.boolean().default(false),
  manual: z.boolean().default(false),
  /** Free-text amount for manual items ("2 pakettia"). */
  manualAmount: z.string().nullish(),
  sources: z.array(z.object({ recipeId: z.string(), title: z.string(), raw: z.string() })),
  /** Optional supermarket product link (future integration). */
  productId: z.string().nullish(),
})
export type ShoppingItem = z.infer<typeof shoppingItemSchema>

export const ingredientMappingSchema = z.object({
  /** Normalized ingredient name the mapping applies to. */
  key: z.string(),
  canonicalId: z.string().nullish(),
  fineliId: z.number().nullish(),
  updatedAt: z.string(),
})
export type IngredientMapping = z.infer<typeof ingredientMappingSchema>

export const categoryOverrideSchema = z.object({
  key: z.string(),
  category: z.enum(SHOPPING_CATEGORIES),
})
export type CategoryOverride = z.infer<typeof categoryOverrideSchema>

export const nutritionTargetsSchema = z.object({
  energyKcal: z.number().positive().nullish(),
  protein: z.number().positive().nullish(),
  carbohydrate: z.number().positive().nullish(),
  fat: z.number().positive().nullish(),
  fibre: z.number().positive().nullish(),
  sugars: z.number().positive().nullish(),
  saturatedFat: z.number().positive().nullish(),
  salt: z.number().positive().nullish(),
})
export type NutritionTargets = z.infer<typeof nutritionTargetsSchema>

export const userSettingsSchema = z.object({
  targets: nutritionTargetsSchema,
  defaultServings: z.number().positive(),
  /** Ingredients the user has at home, for the "ingredient availability" filter. */
  pantry: z.array(z.string()),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  hideCheckedShoppingItems: z.boolean(),
})
export type UserSettings = z.infer<typeof userSettingsSchema>

export const DEFAULT_SETTINGS: UserSettings = {
  targets: {},
  defaultServings: 4,
  pantry: ['suola', 'mustapippuri', 'vesi', 'rypsiöljy', 'sokeri'],
  weekStartsOn: 1,
  hideCheckedShoppingItems: false,
}

export const favouriteSchema = z.object({ recipeId: z.string(), createdAt: z.string() })
export type Favourite = z.infer<typeof favouriteSchema>

/** Diet markers a user can set on their own products (Fineli special-diet codes + MEAT). */
export const PRODUCT_DIETS = ['VEGAN', 'LACOVEGE', 'MEAT', 'GLUTFREE', 'MILKFREE', 'LACSFREE'] as const

const nutrientValue = z.number().min(0).max(100000).nullish()

/**
 * A product the user adds themselves (from a package label) because Fineli doesn't have it.
 * Each product is also a nutrition food: `foodId` is its id in the nutrition lookup
 * (>= 900 000 000, never colliding with Fineli ids), so recipes, nutrition and
 * shopping lists treat it exactly like a Fineli food.
 */
export const productSchema = z.object({
  id: z.string(),
  foodId: z.number().int().min(900_000_000),
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullish(),
  ean: z.string().regex(/^\d{8,14}$/).nullish(),
  category: z.enum(SHOPPING_CATEGORIES).default('other'),
  /** Recipe wordings this product should match ("oivariini", "voi-rypsiöljyseos"). */
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  /** Optional link to a dictionary ingredient (shopping list grouping). */
  canonicalId: z.string().nullish(),
  /** Nutrition per 100 g as printed on the package. */
  nutrients: z.object({
    energyKcal: z.number().min(0).max(1000),
    protein: nutrientValue,
    carbohydrate: nutrientValue,
    sugars: nutrientValue,
    fat: nutrientValue,
    saturatedFat: nutrientValue,
    fibre: nutrientValue,
    salt: nutrientValue,
  }),
  packageGrams: z.number().positive().max(100000).nullish(),
  pieceGrams: z.number().positive().max(100000).nullish(),
  /** Weight of 1 dl in grams (for liquids and powders measured by volume). */
  gramsPerDl: z.number().positive().max(1000).nullish(),
  diets: z.array(z.enum(PRODUCT_DIETS)).default([]),
  imageUrl: httpUrl,
  /** Store page the data was imported from (K-Ruoka, S-kaupat …). */
  sourceUrl: httpUrl,
  source: z.enum(['manual', 'k-ruoka', 's-kaupat', 'json-ld', 'text']).default('manual'),
  ingredientsText: z.string().max(4000).nullish(),
  store: z.string().max(80).nullish(),
  notes: z.string().max(2000).nullish(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type Product = z.infer<typeof productSchema>

/** Nutrient values. Mass nutrients in grams, minerals/vitamins as noted in NUTRIENT_INFO. */
export interface Nutrients {
  energyKcal: number
  energyKj: number
  protein: number
  carbohydrate: number
  fat: number
  fibre: number
  sugars: number
  saturatedFat: number
  monounsaturatedFat: number
  polyunsaturatedFat: number
  transFat: number
  alcohol: number
  salt: number
  sodium: number
  potassium: number
  calcium: number
  iron: number
  vitaminC: number
  vitaminD: number
  vitaminB12: number
  folate: number
  cholesterol: number
}
export type NutrientKey = keyof Nutrients

export interface FineliFood {
  id: number
  fi: string
  en: string | null
  sv: string | null
  type: 'FOOD' | 'DISH' | string
  process: string
  edibleShare: number | null
  igClass: string
  igClassParent: string
  fuClass: string
  fuClassParent: string
  /** Per 100 g of edible portion. Missing keys mean "not reported by Fineli". */
  nutrients: Partial<Nutrients>
  /** Household unit masses in grams (DL, RKL, TL, KPL_S, KPL_M, KPL_L, PORTM …). */
  units: Record<string, number>
  diets: string[]
  /** True for the user's own products (not Fineli data). */
  custom?: boolean
  /** Shopping category of a user product or a supplementary food. */
  category?: ShoppingCategory
  /** Set for supplementary (non-Fineli) foods: the database the values come from. */
  source?: SupplementarySourceId
  /** The food's id in that database (Livsmedelsnummer, USDA NDB number). */
  sourceRef?: string
}

export interface FineliDish {
  id: number
  name: string
  fuClass: string
  fuClassParent: string
  portionGrams: number | null
  rows: { foodId: number; grams: number; remainPct: number }[]
}
