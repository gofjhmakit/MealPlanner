/**
 * Recipe catalogue from openly licensed recipe collections, translated into Finnish
 * (public/data/open-recipes/, built by `npm run recipes:build`, see data/open-recipes/).
 *
 * The files contain Finnish ingredient lines only. They are parsed and matched here with the
 * same code as imported recipes, so the user's own ingredient mappings and products apply.
 * Every recipe keeps its source, author, licence and image credit (`attribution`).
 */
import type { MatchContext } from '../domain/matcher'
import { buildIngredientList } from '../domain/recipeIngredients'
import { withRecipeType } from '../domain/recipeType'
import type { Recipe, RecipeSource } from '../domain/types'
import { getSetting, setSetting, type MealPlannerDB } from './db'

export interface OpenSourceInfo {
  id: string
  name: string
  homepage: string
  license: string
  attribution: string
  changes: string
  file: string
  count: number
  withImage: number
}

export interface OpenRecipesIndex {
  version: string
  generatedAt: string
  sources: OpenSourceInfo[]
}

interface OpenRecipeRecord {
  id: string
  title: string
  originalTitle: string
  description?: string
  servings: number
  servingsEstimated?: boolean
  prepTimeMin?: number
  cookTimeMin?: number
  totalTimeMin?: number
  category: string
  cuisine?: string
  tags: string[]
  ingredients: string[]
  instructions: string[]
  notes?: string[]
  image?: { url: string; credit: string; license: string; licenseUrl?: string }
  sourceUrl?: string
  author?: string
  license: string
  licenseUrl?: string
}

const BASE = `${import.meta.env.BASE_URL}data/open-recipes/`

/** Bump when the ingredient matcher or dictionary changes, so stored catalogue recipes are re-matched. */
export const MATCHER_VERSION = 4

export function openSourceToRecipeSource(s: OpenSourceInfo): RecipeSource {
  return { id: s.id, name: s.name, homepage: s.homepage, domains: [], kind: 'dataset', license: s.license, notes: s.attribution }
}

export function openRecordToRecipe(r: OpenRecipeRecord, source: OpenSourceInfo, ctx: MatchContext, now: string): Recipe {
  const total = r.totalTimeMin ?? (r.prepTimeMin || r.cookTimeMin ? (r.prepTimeMin ?? 0) + (r.cookTimeMin ?? 0) : undefined)
  const translated = r.originalTitle && r.originalTitle.toLowerCase() !== r.title.toLowerCase()
  const shareAlike = /BY-SA/i.test(r.license)
  return withRecipeType({
    id: r.id,
    title: r.title,
    description: [r.description, ...(r.notes ?? [])].filter(Boolean).join('\n\n') || null,
    servings: r.servings,
    servingsText: r.servingsEstimated ? `noin ${r.servings} annosta (arvio)` : null,
    prepTimeMin: r.prepTimeMin ?? null,
    cookTimeMin: r.cookTimeMin ?? null,
    totalTimeMin: total ?? null,
    timeText: null,
    imageUrl: r.image?.url ?? null,
    ingredients: buildIngredientList(r.ingredients, ctx).map((ing, i) => ({ ...ing, id: `${r.id}-${i}` })),
    instructions: r.instructions,
    tags: r.tags,
    category: r.category,
    cuisine: r.cuisine ?? null,
    origin: 'catalogue',
    sourceId: source.id,
    sourceUrl: r.sourceUrl ?? source.homepage,
    sourceName: source.name,
    author: r.author ?? null,
    attribution: {
      license: r.license,
      licenseUrl: r.licenseUrl ?? null,
      originalTitle: translated ? r.originalTitle : null,
      changes: shareAlike ? `${source.changes} Muokattu versio on saatavilla samalla ${r.license} -lisenssillä.` : source.changes,
      imageCredit: r.image?.credit ?? null,
      imageLicense: r.image?.license ?? null,
      imageLicenseUrl: r.image?.licenseUrl ?? null,
    },
    sourceNutrition: null,
    importReport: null,
    inCollection: false,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Loads the open recipe catalogue into IndexedDB when it is missing or a newer one was built.
 * Keeps the user's own data (collection, notes, rating) for recipes that stay. Missing files
 * (offline, or an older deployment without the catalogue) are not an error.
 */
export async function syncOpenRecipes(
  database: MealPlannerDB,
  fetchImpl: typeof fetch,
  ctx: MatchContext,
  progress: (message: string) => void = () => {},
  force = false,
): Promise<OpenRecipesIndex | null> {
  let index: OpenRecipesIndex
  try {
    const res = await fetchImpl(`${BASE}index.json`, { cache: 'no-cache' })
    if (!res.ok) return getSetting<OpenRecipesIndex | null>('openRecipes', null, database)
    index = await res.json()
  } catch {
    return getSetting<OpenRecipesIndex | null>('openRecipes', null, database)
  }
  const stored = await getSetting<OpenRecipesIndex | null>('openRecipes', null, database)
  if (!force && stored?.version === index.version && (stored as { matcherVersion?: number }).matcherVersion === MATCHER_VERSION) {
    // Same dataset version: reload only if recipes have gone missing (e.g. storage was partly cleared).
    const expected = index.sources.reduce((s, x) => s + x.count, 0)
    const present = await database.recipes.where('sourceId').anyOf(index.sources.map((s) => s.id)).count()
    if (present >= expected) return stored
  }

  const now = new Date().toISOString()
  const total = index.sources.reduce((s, x) => s + x.count, 0)
  let done = 0
  const loaded = new Set<string>()
  for (const source of index.sources) {
    let records: OpenRecipeRecord[]
    try {
      const res = await fetchImpl(`${BASE}${source.file}`, { cache: 'no-cache' })
      if (!res.ok) continue
      records = ((await res.json()) as { recipes: OpenRecipeRecord[] }).recipes
    } catch {
      continue
    }
    const recipes: Recipe[] = []
    for (const r of records) {
      recipes.push(openRecordToRecipe(r, source, ctx, now))
      if (++done % 250 === 0) {
        progress(`Lisätään reseptejä… ${Math.round((100 * done) / total)} %`)
        await new Promise((resolve) => setTimeout(resolve)) // keep the page responsive
      }
    }
    await database.transaction('rw', database.recipes, database.recipeSources, async () => {
      const existing = await database.recipes.where('sourceId').equals(source.id).toArray()
      const userData = new Map(existing.map((r) => [r.id, r]))
      const keep = new Set(recipes.map((r) => r.id))
      // Recipes dropped from the dataset go, unless the user collected, rated or annotated them.
      await database.recipes.bulkDelete(existing.filter((r) => !keep.has(r.id) && !r.inCollection && !r.notes && !r.rating).map((r) => r.id))
      await database.recipes.bulkPut(
        recipes.map((r) => {
          const old = userData.get(r.id)
          return old ? { ...r, inCollection: old.inCollection, notes: old.notes ?? null, rating: old.rating ?? null, createdAt: old.createdAt } : r
        }),
      )
      await database.recipeSources.put(openSourceToRecipeSource(source))
    })
    loaded.add(source.id)
  }
  // Only remember the version when every source loaded, so a partial (offline) load is retried.
  if (loaded.size === index.sources.length) await setSetting('openRecipes', { ...index, matcherVersion: MATCHER_VERSION }, database)
  return index
}
