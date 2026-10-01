/**
 * Recipe catalogue built from Fineli "DISH" recipes (contribfood.csv).
 *
 * Fineli publishes ~1 900 Finnish dishes with structured ingredient amounts under
 * CC BY 4.0 – a legally usable, Finnish, structured recipe catalogue. The dataset
 * contains ingredients and grams but no preparation instructions, so catalogue
 * recipes are shown as ingredient lists with a clear note.
 *
 * Other datasets can be added the same way: write a function that maps the dataset
 * into Recipe objects with origin 'catalogue' and a sourceId, then register it in
 * CATALOGUE_SOURCES (see README "Adding a recipe catalogue").
 */
import { ingredientForFineli } from '../domain/ingredients'
import type { FineliDish, FineliFood, Recipe, RecipeIngredient, RecipeSource } from '../domain/types'
import { formatNumber } from '../domain/units'

export const FINELI_SOURCE: RecipeSource = {
  id: 'fineli',
  name: 'Fineli (THL)',
  homepage: 'https://fineli.fi',
  domains: ['fineli.fi'],
  kind: 'dataset',
  license: 'CC BY 4.0 – © Terveyden ja hyvinvoinnin laitos',
  notes: 'Fineli-ruokalajien reseptirivit (raaka-aineet ja määrät). Valmistusohjeita ei sisälly aineistoon.',
}

const EXCLUDED_PARENTS = new Set(['BABYFTOT', 'ALCTOT', 'SPECTOT', 'MISCTOT', 'SUGARTOT', 'FATTOT'])
const EXCLUDED_NAME = /(lastenruoka|äidinmaidonkorvike|vauva|ateriankorvike|energiajuoma)/i

/** Readable ingredient name from a Fineli food name ("Maito, kevytmaito, d-vitamiinia 1 ug" -> "kevytmaito"). */
export function friendlyFineliName(food: FineliFood): string {
  const canonical = ingredientForFineli(food.id)
  if (canonical && canonical.fineliConfidence === 1) return canonical.fi.toLowerCase()
  const parts = food.fi.split(',').map((p) => p.trim()).filter(Boolean)
  // Keep a descriptive second part ("Jauheliha, naudan") but drop technical ones ("rasvaa 17 %")
  const useSecond = parts.length > 1 && !/\d|rasvaa|vitamiin/i.test(parts[1])
  return (useSecond ? parts.slice(0, 2).join(', ') : parts[0]).toLowerCase()
}

function dietTags(food: FineliFood | undefined): string[] {
  if (!food) return []
  const tags: string[] = []
  if (food.diets.includes('VEGAN')) tags.push('vegaaninen', 'kasvis')
  else if (food.diets.includes('LACOVEGE') || food.diets.includes('LACVEGE')) tags.push('kasvis')
  if (food.diets.includes('GLUTFREE')) tags.push('gluteeniton')
  if (food.diets.includes('MILKFREE')) tags.push('maidoton')
  return tags
}

export function buildFineliCatalogue(
  dishes: FineliDish[],
  foods: Map<number, FineliFood>,
  classNames: Record<string, string>,
  now = new Date().toISOString(),
): Recipe[] {
  const recipes: Recipe[] = []
  for (const dish of dishes) {
    if (EXCLUDED_PARENTS.has(dish.fuClassParent) || EXCLUDED_NAME.test(dish.name)) continue
    const rows = dish.rows.filter((r) => foods.has(r.foodId))
    if (rows.length < 3) continue
    const cooked = rows.reduce((s, r) => s + (r.grams * r.remainPct) / 100, 0)
    const portion = dish.portionGrams && dish.portionGrams > 0 ? dish.portionGrams : 250
    const servings = Math.min(40, Math.max(1, Math.round(cooked / portion)))
    const ingredients: RecipeIngredient[] = rows.map((r, i) => {
      const food = foods.get(r.foodId)!
      const canonical = ingredientForFineli(food.id)
      const name = friendlyFineliName(food)
      const grams = r.grams >= 10 ? Math.round(r.grams) : Math.round(r.grams * 10) / 10
      return {
        id: `fineli-${dish.id}-${i}`,
        raw: `${formatNumber(grams, 1)} g ${name}`,
        group: null,
        quantity: grams,
        quantityMax: null,
        unit: 'g',
        name,
        note: null,
        explicitGrams: null,
        perUnitGrams: null,
        perUnitMl: null,
        size: null,
        canonicalId: canonical?.id ?? null,
        fineliId: food.id,
        confidence: 1,
        matchMethod: 'source',
        userOverride: false,
        gramsOverride: null,
        scaling: canonical?.scaling ?? 'linear',
        optional: false,
      }
    })
    const dishFood = foods.get(dish.id)
    const tags = [classNames[dish.fuClass], classNames[dish.fuClassParent], ...dietTags(dishFood)]
      .filter((t): t is string => !!t)
      .map((t) => t.toLowerCase())
    recipes.push({
      id: `fineli-${dish.id}`,
      title: dish.name,
      description:
        'Fineli-ruokalaji (THL). Aineisto sisältää raaka-aineet ja niiden määrät, mutta ei valmistusohjetta.',
      servings,
      servingsText: `${servings} annosta (à noin ${Math.round(portion)} g)`,
      prepTimeMin: null,
      cookTimeMin: null,
      totalTimeMin: null,
      timeText: null,
      imageUrl: null,
      ingredients,
      instructions: [],
      tags: [...new Set(tags)],
      category: classNames[dish.fuClassParent] ?? null,
      cuisine: 'suomalainen',
      origin: 'catalogue',
      sourceId: 'fineli',
      sourceUrl: `https://fineli.fi/fineli/fi/elintarvikkeet/${dish.id}`,
      sourceName: 'Fineli (THL)',
      author: null,
      sourceNutrition: null,
      importReport: null,
      inCollection: false,
      createdAt: now,
      updatedAt: now,
    })
  }
  return recipes
}
