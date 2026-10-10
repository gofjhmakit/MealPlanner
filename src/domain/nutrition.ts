/**
 * Nutrition estimation.
 *
 *   nutrient_in_line = nutrient_per_100g(Fineli food) × grams(line) / 100
 *
 * grams(line) is resolved from the parsed quantity with decreasing certainty:
 *   explicit mass in line > mass unit > volume via Fineli household units (DL/RKL/TL)
 *   > volume via dictionary density > per-package weight in line ("à 400 g")
 *   > dictionary package/piece weight > Fineli piece weight (KPL_M) > generic unit guess.
 *
 * Every resolution carries a confidence so the UI can show how solid the estimate is.
 */
import { getIngredient, type CanonicalIngredient } from './ingredients'
import { canonicalFood, type FineliLookup } from './matcher'
import { foodSourceLabel } from './supplementary'
import { applyScaling } from './scaling'
import type { FineliFood, NutrientKey, Nutrients, Recipe, RecipeIngredient } from './types'
import { getUnit } from './units'

export const NUTRIENT_KEYS: NutrientKey[] = [
  'energyKcal', 'energyKj', 'protein', 'carbohydrate', 'fat', 'fibre', 'sugars', 'saturatedFat',
  'monounsaturatedFat', 'polyunsaturatedFat', 'transFat', 'alcohol', 'salt', 'sodium', 'potassium',
  'calcium', 'iron', 'vitaminC', 'vitaminD', 'vitaminB12', 'folate', 'cholesterol',
]

export const NUTRIENT_INFO: Record<NutrientKey, { label: string; unit: string; decimals: number }> = {
  energyKcal: { label: 'Energia', unit: 'kcal', decimals: 0 },
  energyKj: { label: 'Energia', unit: 'kJ', decimals: 0 },
  protein: { label: 'Proteiini', unit: 'g', decimals: 1 },
  carbohydrate: { label: 'Hiilihydraatit', unit: 'g', decimals: 1 },
  fat: { label: 'Rasva', unit: 'g', decimals: 1 },
  fibre: { label: 'Kuitu', unit: 'g', decimals: 1 },
  sugars: { label: 'Sokerit', unit: 'g', decimals: 1 },
  saturatedFat: { label: 'Tyydyttyneet rasvahapot', unit: 'g', decimals: 1 },
  monounsaturatedFat: { label: 'Kertatyydyttymättömät rasvahapot', unit: 'g', decimals: 1 },
  polyunsaturatedFat: { label: 'Monityydyttymättömät rasvahapot', unit: 'g', decimals: 1 },
  transFat: { label: 'Transrasvahapot', unit: 'g', decimals: 2 },
  alcohol: { label: 'Alkoholi', unit: 'g', decimals: 1 },
  salt: { label: 'Suola', unit: 'g', decimals: 1 },
  sodium: { label: 'Natrium', unit: 'mg', decimals: 0 },
  potassium: { label: 'Kalium', unit: 'mg', decimals: 0 },
  calcium: { label: 'Kalsium', unit: 'mg', decimals: 0 },
  iron: { label: 'Rauta', unit: 'mg', decimals: 1 },
  vitaminC: { label: 'C-vitamiini', unit: 'mg', decimals: 0 },
  vitaminD: { label: 'D-vitamiini', unit: 'µg', decimals: 1 },
  vitaminB12: { label: 'B12-vitamiini', unit: 'µg', decimals: 1 },
  folate: { label: 'Folaatti', unit: 'µg', decimals: 0 },
  cholesterol: { label: 'Kolesteroli', unit: 'mg', decimals: 0 },
}

export function emptyNutrients(): Nutrients {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as unknown as Nutrients
}

export function addNutrients(a: Nutrients, b: Partial<Nutrients>, factor = 1): Nutrients {
  const out = { ...a }
  for (const k of NUTRIENT_KEYS) out[k] += (b[k] ?? 0) * factor
  return out
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out = { ...n }
  for (const k of NUTRIENT_KEYS) out[k] = n[k] * factor
  return out
}

// ---------------------------------------------------------------------------------------------

export type GramsMethod =
  | 'override' | 'explicit' | 'mass' | 'volume-fineli' | 'volume-density' | 'volume-water'
  | 'per-unit' | 'unit-dictionary' | 'piece-dictionary' | 'piece-fineli' | 'unit-fineli' | 'unit-generic'
  | 'unquantified' | 'unknown'

export interface GramsResolution {
  grams: number | null
  confidence: number
  method: GramsMethod
  note: string
}

type AmountFields = Pick<
  RecipeIngredient,
  'quantity' | 'quantityMax' | 'unit' | 'explicitGrams' | 'perUnitGrams' | 'perUnitMl' | 'size' | 'gramsOverride'
>

const SIZE_UNIT = { S: 'KPL_S', M: 'KPL_M', L: 'KPL_L' } as const

function gramsPerMl(food: FineliFood | undefined, canonical: CanonicalIngredient | undefined): { g: number; conf: number; method: GramsMethod } {
  if (food?.units.DL) return { g: food.units.DL / 100, conf: 0.95, method: 'volume-fineli' }
  if (canonical?.density) return { g: canonical.density, conf: 0.85, method: 'volume-density' }
  return { g: 1, conf: 0.6, method: 'volume-water' }
}

/**
 * Resolve how many grams an ingredient line represents (unscaled, i.e. for the recipe's own servings).
 */
export function resolveGrams(
  ing: AmountFields,
  canonical: CanonicalIngredient | undefined,
  food: FineliFood | undefined,
): GramsResolution {
  if (ing.gramsOverride != null) return { grams: ing.gramsOverride, confidence: 1, method: 'override', note: 'Käyttäjän antama paino' }
  if (ing.quantity == null) {
    if (ing.explicitGrams != null) return { grams: ing.explicitGrams, confidence: 1, method: 'explicit', note: 'Paino ilmoitettu reseptissä' }
    return { grams: null, confidence: 0, method: 'unquantified', note: 'Määrää ei ilmoitettu (esim. maun mukaan)' }
  }
  const q = ing.quantityMax != null ? (ing.quantity + ing.quantityMax) / 2 : ing.quantity
  if (ing.explicitGrams != null) return { grams: ing.explicitGrams, confidence: 1, method: 'explicit', note: 'Paino ilmoitettu reseptissä' }

  const unit = getUnit(ing.unit)
  if (unit?.kind === 'mass') return { grams: q * unit.factor!, confidence: 1, method: 'mass', note: '' }

  if (unit?.kind === 'volume') {
    // Fineli has measured weights for spoon units for many foods (e.g. oil 1 rkl = 13.5 g)
    if (unit.fineliUnit && food?.units[unit.fineliUnit] && unit.fineliUnit !== 'DL') {
      return { grams: q * food.units[unit.fineliUnit], confidence: 0.95, method: 'unit-fineli', note: `${foodSourceLabel(food)}: 1 ${unit.label} = ${food.units[unit.fineliUnit]} g` }
    }
    const ml = q * unit.factor!
    const d = gramsPerMl(food, canonical)
    const note =
      d.method === 'volume-water'
        ? `Tilavuus muunnettu olettaen tiheydeksi 1 g/ml (${unit.label})`
        : `Tilavuus muunnettu: 1 dl ≈ ${Math.round(d.g * 100)} g`
    return { grams: ml * d.g, confidence: d.conf, method: d.method, note }
  }

  // Count units (or no unit): pieces and packages
  if (ing.perUnitGrams != null) return { grams: q * ing.perUnitGrams, confidence: 1, method: 'per-unit', note: `Pakkauskoko ${ing.perUnitGrams} g` }
  if (ing.perUnitMl != null) {
    const d = gramsPerMl(food, canonical)
    return { grams: q * ing.perUnitMl * d.g, confidence: Math.min(0.95, d.conf), method: 'per-unit', note: `Pakkauskoko ${ing.perUnitMl} ml` }
  }
  const unitId = unit?.id ?? 'kpl'
  // The user's own product knows its package size ("1 pkt" of that product).
  if (unit && ['pkt', 'prk', 'tlk', 'ps', 'rs', 'pll'].includes(unit.id) && food?.units.PKG) {
    return { grams: q * food.units.PKG, confidence: 0.95, method: 'unit-fineli', note: `Pakkauskoko ${food.units.PKG} g (oma tuote)` }
  }
  if (unit && unit.id !== 'kpl' && canonical?.unitGrams?.[unit.id]) {
    const g = canonical.unitGrams[unit.id]
    return { grams: q * g, confidence: 0.85, method: 'unit-dictionary', note: `Tyypillinen ${unit.label} ≈ ${g} g` }
  }
  if (unitId === 'kpl') {
    // The dictionary's piece knows what a recipe means by one ("1 kalafilee"); Fineli's piece may be
    // the whole animal or plant (a whole cod), so it only comes second.
    if (canonical?.pieceGrams) {
      const sizeFactor = ing.size === 'S' ? 0.6 : ing.size === 'L' ? 1.5 : 1
      const g = canonical.pieceGrams * sizeFactor
      return { grams: q * g, confidence: 0.85, method: 'piece-dictionary', note: `Tyypillinen kappale ≈ ${Math.round(g)} g` }
    }
    const sizeKey = ing.size ? SIZE_UNIT[ing.size] : null
    if (sizeKey && sizeKey !== 'KPL_M' && food?.units[sizeKey]) {
      return { grams: q * food.units[sizeKey], confidence: 0.85, method: 'piece-fineli', note: `${foodSourceLabel(food)}: ${ing.size === 'S' ? 'pieni' : 'iso'} kpl ≈ ${food.units[sizeKey]} g` }
    }
    if (food?.units.KPL_M) return { grams: q * food.units.KPL_M, confidence: 0.85, method: 'piece-fineli', note: `${foodSourceLabel(food)}: keskikokoinen kpl ≈ ${food.units.KPL_M} g` }
    if (food?.units.KPL_VALM) return { grams: q * food.units.KPL_VALM, confidence: 0.8, method: 'piece-fineli', note: `${foodSourceLabel(food)}: kpl ≈ ${food.units.KPL_VALM} g` }
  }
  if (unit?.fineliUnit && food?.units[unit.fineliUnit]) {
    return { grams: q * food.units[unit.fineliUnit], confidence: 0.75, method: 'unit-fineli', note: `${foodSourceLabel(food)}: ${unit.label} ≈ ${food.units[unit.fineliUnit]} g` }
  }
  if (unit?.genericGrams) {
    return { grams: q * unit.genericGrams, confidence: 0.5, method: 'unit-generic', note: `Karkea arvio: 1 ${unit.label} ≈ ${unit.genericGrams} g` }
  }
  return { grams: null, confidence: 0, method: 'unknown', note: 'Määrää ei voitu muuntaa grammoiksi – anna paino käsin' }
}

// ---------------------------------------------------------------------------------------------

export type LineStatus = 'confident' | 'approximate' | 'unmatched' | 'unquantified' | 'no-weight'

export interface NutritionLine {
  ingredientId: string
  raw: string
  grams: number | null
  gramsResolution: GramsResolution
  food: FineliFood | undefined
  nutrients: Nutrients
  matchConfidence: number
  status: LineStatus
}

export interface NutritionCoverage {
  total: number
  confident: number
  approximate: number
  unmatched: number
  unquantified: number
  noWeight: number
  /** Share of quantified ingredients that were matched confidently (0..1). */
  confidentShare: number
  /** Share of estimated mass coming from confidently matched ingredients (0..1). */
  confidentMassShare: number
}

export interface NutritionResult {
  servings: number
  total: Nutrients
  perServing: Nutrients
  totalGrams: number
  lines: NutritionLine[]
  coverage: NutritionCoverage
}

/** Threshold above which a mapping/amount is considered "confident" in the UI. */
export const CONFIDENT_THRESHOLD = 0.7

/** Share of deep-frying oil that ends up in the food. */
export const FRYING_OIL_ABSORBED = 0.1
const FRYING_RE = /friteera|uppopaist|uppopaisto|paistamiseen|paistoon|paistorasva|frityyri/i

/**
 * A litre of oil for deep-frying isn't eaten: count only what the food absorbs. Applies to oil lines
 * that say so, and to any oil line of half a litre or more (no dressing or sauté uses that much).
 */
function fryingOil(raw: string, canonical: CanonicalIngredient | undefined, res: GramsResolution): GramsResolution {
  if (res.grams === null || !canonical || canonical.category !== 'spices_sauces' || !/-oil$/.test(canonical.id)) return res
  // "2 rkl öljyä + friteeraukseen": a spoonful said next to the frying oil is still eaten in full
  if (res.grams < (FRYING_RE.test(raw) ? 80 : 450)) return res
  return { ...res, grams: res.grams * FRYING_OIL_ABSORBED, confidence: Math.min(res.confidence, 0.6), note: `Paistoöljy: laskettu ruokaan imeytyvä osuus (~${FRYING_OIL_ABSORBED * 100} %)` }
}

export function computeRecipeNutrition(
  recipe: Pick<Recipe, 'servings' | 'ingredients'>,
  lookup: FineliLookup,
  servings: number = recipe.servings,
): NutritionResult {
  const factor = servings / recipe.servings
  let total = emptyNutrients()
  let totalGrams = 0
  let confidentGrams = 0
  const lines: NutritionLine[] = []
  const coverage = { total: 0, confident: 0, approximate: 0, unmatched: 0, unquantified: 0, noWeight: 0 }

  for (const ing of recipe.ingredients) {
    const canonical = getIngredient(ing.canonicalId)
    const fineliId = ing.fineliId ?? (canonical ? canonicalFood(canonical, lookup).fineliId : null)
    const food = fineliId !== null ? lookup.get(fineliId) : undefined
    const res = fryingOil(ing.raw, canonical, resolveGrams(ing, canonical, food))
    const grams = res.grams !== null ? res.grams * applyScaling(1, factor, ing.scaling) : null
    let status: LineStatus
    let nutrients = emptyNutrients()
    coverage.total++
    if (res.method === 'unquantified') {
      status = 'unquantified'
      coverage.unquantified++
    } else if (!food) {
      status = 'unmatched'
      coverage.unmatched++
    } else if (grams === null) {
      status = 'no-weight'
      coverage.noWeight++
    } else {
      nutrients = addNutrients(nutrients, food.nutrients, grams / 100)
      total = addNutrients(total, nutrients)
      totalGrams += grams
      const confident = ing.confidence >= CONFIDENT_THRESHOLD && res.confidence >= CONFIDENT_THRESHOLD
      status = confident ? 'confident' : 'approximate'
      if (confident) {
        coverage.confident++
        confidentGrams += grams
      } else coverage.approximate++
    }
    lines.push({ ingredientId: ing.id, raw: ing.raw, grams, gramsResolution: res, food, nutrients, matchConfidence: ing.confidence, status })
  }

  const quantified = coverage.total - coverage.unquantified
  return {
    servings,
    total,
    perServing: scaleNutrients(total, 1 / servings),
    totalGrams,
    lines,
    coverage: {
      ...coverage,
      confidentShare: quantified > 0 ? coverage.confident / quantified : 0,
      confidentMassShare: totalGrams > 0 ? confidentGrams / totalGrams : 0,
    },
  }
}

/** Combine several nutrition results (meal, day, week) keeping coverage statistics. */
export function combineNutrition(results: { nutrients: Nutrients; coverage: NutritionCoverage }[]): {
  nutrients: Nutrients
  coverage: NutritionCoverage
} {
  let nutrients = emptyNutrients()
  const c = { total: 0, confident: 0, approximate: 0, unmatched: 0, unquantified: 0, noWeight: 0 }
  let massNum = 0
  let massDen = 0
  for (const r of results) {
    nutrients = addNutrients(nutrients, r.nutrients)
    c.total += r.coverage.total
    c.confident += r.coverage.confident
    c.approximate += r.coverage.approximate
    c.unmatched += r.coverage.unmatched
    c.unquantified += r.coverage.unquantified
    c.noWeight += r.coverage.noWeight
    massNum += r.coverage.confidentMassShare * r.nutrients.energyKcal
    massDen += r.nutrients.energyKcal
  }
  const quantified = c.total - c.unquantified
  return {
    nutrients,
    coverage: {
      ...c,
      confidentShare: quantified > 0 ? c.confident / quantified : 0,
      confidentMassShare: massDen > 0 ? massNum / massDen : 0,
    },
  }
}
