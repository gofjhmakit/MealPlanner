/**
 * Shared planning data for the UI: recipe candidates (with kcal per serving) for suggestions,
 * swaps and the command bar, and the household's serving count and daily target.
 */
import { useMemo } from 'react'
import { householdServings } from '../domain/goals'
import { recipeNutritionCached } from '../domain/recipeInfo'
import { buildCandidates, type Candidate } from '../domain/weekPlanner'
import type { Recipe } from '../domain/types'
import { useApp } from './AppContext'
import { useAllRecipes, useFavouriteIds } from './hooks'

let memo: { recipes: Recipe[]; favs: Set<string>; version: number; value: Candidate[] } | null = null

export function useCandidates(): Candidate[] | undefined {
  const { fineli, settings, nutritionCache, dataVersion } = useApp()
  const recipes = useAllRecipes()
  const favs = useFavouriteIds()
  return useMemo(() => {
    if (!recipes) return undefined
    if (memo && memo.recipes === recipes && memo.favs === favs && memo.version === dataVersion) return memo.value
    const ctx = { lookup: fineli, pantry: settings.pantry, nutritionCache }
    const value = buildCandidates(recipes, fineli, favs, (r) => recipeNutritionCached(r, ctx).perServing.energyKcal)
    memo = { recipes, favs, version: dataVersion, value }
    return value
  }, [recipes, favs, fineli, settings.pantry, nutritionCache, dataVersion])
}

/** Servings to cook (from the household, else the old default) and the daily kcal target. */
export function useHousehold() {
  const { settings } = useApp()
  return {
    servings: householdServings(settings.household, settings.defaultServings),
    kcalTarget: settings.targets.energyKcal ?? null,
    proteinTarget: settings.targets.protein ?? null,
    fibreTarget: settings.targets.fibre ?? null,
    me: settings.household[0] ?? null,
  }
}
