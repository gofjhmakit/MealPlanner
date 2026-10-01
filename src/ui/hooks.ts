import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { db } from '../db/db'
import { combineNutrition, computeRecipeNutrition, type NutritionCoverage, type NutritionResult } from '../domain/nutrition'
import type { MealItem, MealSlot, Nutrients, Recipe } from '../domain/types'
import { useApp } from './AppContext'

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Aamiainen',
  lunch: 'Lounas',
  dinner: 'Päivällinen',
  snack: 'Välipala',
  other: 'Muu',
}

export function useRecipe(id: string | undefined): Recipe | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.recipes.get(id)) ?? null) : null), [id])
}

export function useAllRecipes(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.toArray(), [])
}

export function useFavouriteIds(): Set<string> {
  const favs = useLiveQuery(() => db.favourites.toArray(), [])
  return useMemo(() => new Set((favs ?? []).map((f) => f.recipeId)), [favs])
}

export function useMealItems(from: string, to: string): MealItem[] | undefined {
  return useLiveQuery(() => db.mealItems.where('date').between(from, to, true, true).toArray(), [from, to])
}

/** Recipes referenced by a set of meal items. */
export function useRecipesById(ids: (string | null)[]): Map<string, Recipe> | undefined {
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(',')
  const list = useLiveQuery(async () => (await db.recipes.bulkGet(key ? key.split(',') : [])).filter((r): r is Recipe => !!r), [key])
  return useMemo(() => (list ? new Map(list.map((r) => [r.id, r])) : undefined), [list])
}

export function useRecipeNutrition(recipe: Recipe | null | undefined, servings?: number): NutritionResult | null {
  const { fineli, nutritionCache, dataVersion } = useApp()
  return useMemo(() => {
    if (!recipe) return null
    if (servings === undefined || servings === recipe.servings) {
      const key = `${recipe.id}:${recipe.updatedAt}`
      let r = nutritionCache.get(key)
      if (!r) {
        r = computeRecipeNutrition(recipe, fineli)
        nutritionCache.set(key, r)
      }
      return r
    }
    return computeRecipeNutrition(recipe, fineli, servings)
  }, [recipe, servings, fineli, nutritionCache, dataVersion])
}

export interface MealNutrition {
  nutrients: Nutrients
  coverage: NutritionCoverage
}

export interface PlanNutrition {
  byItem: Map<string, MealNutrition>
  byDay: Map<string, MealNutrition>
  byDaySlot: Map<string, MealNutrition>
  total: MealNutrition
}

/**
 * Nutrition of planned meals per item, per day+slot, per day and in total.
 *  - 'person'    (default): one serving of every planned meal – what one person eats
 *  - 'household': all planned servings together
 */
export function usePlanNutrition(
  items: MealItem[] | undefined,
  recipes: Map<string, Recipe> | undefined,
  mode: 'person' | 'household' = 'person',
): PlanNutrition | null {
  const { fineli, nutritionCache, dataVersion } = useApp()
  return useMemo(() => {
    if (!items || !recipes) return null
    const byItem = new Map<string, MealNutrition>()
    const dayGroups = new Map<string, MealNutrition[]>()
    const slotGroups = new Map<string, MealNutrition[]>()
    for (const item of items) {
      const recipe = item.recipeId ? recipes.get(item.recipeId) : undefined
      if (!recipe) continue // note-only entries have no nutrition
      const key = `${recipe.id}:${recipe.updatedAt}`
      let base = nutritionCache.get(key)
      if (!base) {
        base = computeRecipeNutrition(recipe, fineli)
        nutritionCache.set(key, base)
      }
      // Per person = one serving; household = all planned servings.
      const factor = (mode === 'person' ? 1 : item.servings) / recipe.servings
      const scaled: Nutrients = { ...base.total }
      for (const k of Object.keys(scaled) as (keyof Nutrients)[]) scaled[k] = base.total[k] * factor
      const n = { nutrients: scaled, coverage: base.coverage }
      byItem.set(item.id, n)
      dayGroups.set(item.date, [...(dayGroups.get(item.date) ?? []), n])
      const sk = `${item.date}|${item.slot}`
      slotGroups.set(sk, [...(slotGroups.get(sk) ?? []), n])
    }
    const byDay = new Map([...dayGroups].map(([d, list]) => [d, combineNutrition(list)]))
    const byDaySlot = new Map([...slotGroups].map(([d, list]) => [d, combineNutrition(list)]))
    return { byItem, byDay, byDaySlot, total: combineNutrition([...byItem.values()]) }
  }, [items, recipes, fineli, nutritionCache, mode, dataVersion])
}

/** Back navigation that stays inside the app when the page was opened directly (no in-app history). */
export function useBack(fallback: string): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return () => (location.key === 'default' ? navigate(fallback) : navigate(-1))
}
