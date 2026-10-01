/**
 * Derived recipe information for browsing: diet class, time, search and filters.
 */
import { lemmaCandidates, normalizeKey, tokenize } from './finnish'
import { getIngredient } from './ingredients'
import type { FineliLookup } from './matcher'
import { computeRecipeNutrition, type NutritionResult } from './nutrition'
import type { Recipe } from './types'

export type RecipeDiet = 'vegan' | 'vegetarian' | 'fish' | 'meat'

export const DIET_LABELS: Record<RecipeDiet, string> = {
  vegan: 'Vegaaninen',
  vegetarian: 'Kasvis',
  fish: 'Kala',
  meat: 'Liha',
}

const DIET_RANK: Record<RecipeDiet, number> = { vegan: 0, vegetarian: 1, fish: 2, meat: 3 }

/** Diet class from mapped ingredients; null when some ingredient's diet is unknown. */
export function recipeDiet(recipe: Pick<Recipe, 'ingredients'>, lookup: FineliLookup): RecipeDiet | null {
  let worst: RecipeDiet = 'vegan'
  for (const ing of recipe.ingredients) {
    const canonical = getIngredient(ing.canonicalId)
    let diet: RecipeDiet | null = canonical?.diet ?? null
    const food = ing.fineliId != null ? lookup.get(ing.fineliId) : undefined
    if (food && (!canonical || food.custom || ing.matchMethod === 'source' || ing.matchMethod === 'user')) {
      if (food.diets.includes('VEGAN')) diet = 'vegan'
      else if (food.diets.includes('LACOVEGE') || food.diets.includes('LACVEGE')) diet = 'vegetarian'
      else if (food.diets.includes('MEAT')) diet = 'meat' // user product marked as meat/fish
      else if (food.igClassParent === 'FISHTOT') diet = 'fish'
      else if (food.igClassParent === 'MEATTOT') diet = 'meat'
      else diet = diet ?? null
    }
    if (!diet) {
      if (ing.quantity == null) continue // "suolaa ja pippuria" – ignore unquantified seasoning
      return null
    }
    if (DIET_RANK[diet] > DIET_RANK[worst]) worst = diet
  }
  return worst
}

export function recipeTime(recipe: Pick<Recipe, 'totalTimeMin' | 'prepTimeMin' | 'cookTimeMin'>): number | null {
  return recipe.totalTimeMin ?? ((recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0) || null)
}

export interface RecipeFilters {
  query: string
  vegetarian: boolean
  vegan: boolean
  highProtein: boolean
  lowCalorie: boolean
  quick: boolean
  glutenFree: boolean
  milkFree: boolean
  lactoseFree: boolean
  maxTimeMin: number | null
  /** Only recipes the user rated at least this high. */
  minRating: number | null
  /** Only recipes where at least this share of (non-pantry-basic) ingredients is available at home. */
  pantryMinShare: number | null
}

export const EMPTY_FILTERS: RecipeFilters = {
  query: '',
  vegetarian: false,
  vegan: false,
  highProtein: false,
  lowCalorie: false,
  quick: false,
  glutenFree: false,
  milkFree: false,
  lactoseFree: false,
  maxTimeMin: null,
  minRating: null,
  pantryMinShare: null,
}

/** Thresholds for nutrition-based filters (estimates, per serving). */
export const HIGH_PROTEIN_ENERGY_SHARE = 0.25
export const HIGH_PROTEIN_MIN_GRAMS = 25
export const LOW_CALORIE_MAX_KCAL = 450
export const QUICK_MAX_MIN = 30

const searchTextCache = new Map<string, string>()

/** Lower-cased searchable text of a recipe (title, description, tags, category, ingredients, notes). Memoized per version. */
export function searchText(recipe: Recipe): string {
  const cacheKey = `${recipe.id}:${recipe.updatedAt}`
  const cached = searchTextCache.get(cacheKey)
  if (cached !== undefined) return cached
  if (searchTextCache.size > 5000) searchTextCache.clear()
  const text = [
    recipe.title,
    recipe.description ?? '',
    recipe.tags.join(' '),
    recipe.category ?? '',
    recipe.cuisine ?? '',
    // Canonical names and synonyms: searching "kana" also finds "broilerin fileesuikale"
    recipe.ingredients.map((i) => {
      const c = getIngredient(i.canonicalId)
      return `${i.name} ${c ? `${c.fi} ${c.aliases.join(' ')}` : ''}`
    }).join(' '),
    recipe.notes ?? '',
  ]
    .join(' ')
    .toLowerCase()
  searchTextCache.set(cacheKey, text)
  return text
}

/** Every query word (or one of its base forms) must prefix-match a word in the recipe. */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = tokenize(query.toLowerCase())
  if (words.length === 0) return true
  const hayWords = haystack.split(/[^\p{L}\d]+/u)
  return words.every((w) => {
    // Only base forms close to the typed word ("kanaa" -> "kana", "porkkanoita" -> "porkkana", never "kan"), as a word prefix.
    // Substring matches only for long words, so "kana" doesn't hit "porkkana" but "suikale" hits "kanasuikale".
    const cands = lemmaCandidates(w).filter((c) => c.length >= (w.length <= 4 ? w.length : Math.max(4, w.length - 3)))
    return hayWords.some((h) => cands.some((c) => h.startsWith(c) || (c.length >= 6 && h.includes(c))))
  })
}

/** Share of a recipe's ingredients found in the pantry list (basic seasonings don't count against). */
export function pantryShare(recipe: Recipe, pantry: string[]): number {
  const pantryKeys = new Set(pantry.map((p) => normalizeKey(p)))
  let relevant = 0
  let have = 0
  for (const ing of recipe.ingredients) {
    const canonical = getIngredient(ing.canonicalId)
    if (canonical?.id === 'water') continue
    relevant++
    const names = [normalizeKey(ing.name), canonical ? normalizeKey(canonical.fi) : '', ...(canonical?.aliases.slice(0, 3).map(normalizeKey) ?? [])]
    if (names.some((n) => n && pantryKeys.has(n))) have++
  }
  return relevant === 0 ? 1 : have / relevant
}

export interface RecipeSearchContext {
  lookup: FineliLookup
  pantry: string[]
  nutritionCache: Map<string, NutritionResult>
}

export function recipeNutritionCached(recipe: Recipe, ctx: RecipeSearchContext): NutritionResult {
  const key = `${recipe.id}:${recipe.updatedAt}`
  let n = ctx.nutritionCache.get(key)
  if (!n) {
    n = computeRecipeNutrition(recipe, ctx.lookup)
    ctx.nutritionCache.set(key, n)
  }
  return n
}

export function filterRecipes(recipes: Recipe[], filters: RecipeFilters, ctx: RecipeSearchContext): Recipe[] {
  const needsNutrition = filters.highProtein || filters.lowCalorie
  return recipes.filter((r) => {
    if (filters.query && !matchesQuery(searchText(r), filters.query)) return false
    if (filters.vegan || filters.vegetarian) {
      const diet = recipeDiet(r, ctx.lookup)
      if (filters.vegan && diet !== 'vegan') return false
      if (filters.vegetarian && diet !== 'vegan' && diet !== 'vegetarian') return false
    }
    if (filters.glutenFree || filters.milkFree || filters.lactoseFree) {
      const sd = recipeSpecialDiets(r, ctx.lookup)
      if ((filters.glutenFree && !sd.glutenFree) || (filters.milkFree && !sd.milkFree) || (filters.lactoseFree && !sd.lactoseFree)) return false
    }
    if (filters.minRating && (r.rating ?? 0) < filters.minRating) return false
    const time = recipeTime(r)
    if (filters.quick && (time === null || time > QUICK_MAX_MIN)) return false
    if (filters.maxTimeMin && (time === null || time > filters.maxTimeMin)) return false
    if (needsNutrition) {
      const n = recipeNutritionCached(r, ctx).perServing
      if (filters.lowCalorie && (n.energyKcal <= 0 || n.energyKcal > LOW_CALORIE_MAX_KCAL)) return false
      if (filters.highProtein) {
        const share = n.energyKcal > 0 ? (n.protein * 4) / n.energyKcal : 0
        if (share < HIGH_PROTEIN_ENERGY_SHARE && n.protein < HIGH_PROTEIN_MIN_GRAMS) return false
      }
    }
    if (filters.pantryMinShare !== null && pantryShare(r, ctx.pantry) < filters.pantryMinShare) return false
    return true
  })
}

export interface SpecialDiets {
  glutenFree: boolean
  milkFree: boolean
  lactoseFree: boolean
}

export const SPECIAL_DIET_LABELS: Record<keyof SpecialDiets, string> = {
  glutenFree: 'Gluteeniton',
  milkFree: 'Maidoton',
  lactoseFree: 'Laktoositon',
}

/**
 * Special diets derived from the Fineli special-diet flags of every mapped ingredient.
 * Conservative: an ingredient without a Fineli food makes the answer "no" (unknown), and
 * generic foods only approximate real products – the UI tells users to check package labels.
 * Unquantified, unmatched seasoning lines ("suolaa ja pippuria") are ignored.
 */
export function recipeSpecialDiets(recipe: Pick<Recipe, 'ingredients'>, lookup: FineliLookup): SpecialDiets {
  const result: SpecialDiets = { glutenFree: true, milkFree: true, lactoseFree: true }
  if (recipe.ingredients.length === 0) return { glutenFree: false, milkFree: false, lactoseFree: false }
  for (const ing of recipe.ingredients) {
    const fineliId = ing.fineliId ?? getIngredient(ing.canonicalId)?.fineliId ?? null
    const food = fineliId !== null ? lookup.get(fineliId) : undefined
    if (!food) {
      if (ing.quantity == null) continue
      return { glutenFree: false, milkFree: false, lactoseFree: false }
    }
    const d = food.diets
    if (!d.includes('GLUTFREE')) result.glutenFree = false
    if (!d.includes('MILKFREE')) result.milkFree = false
    if (!d.includes('LACSFREE') && !d.includes('MILKFREE')) result.lactoseFree = false
  }
  return result
}
