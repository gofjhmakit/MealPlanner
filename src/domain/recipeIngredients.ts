/**
 * Glue between the ingredient-line parser and the matcher: turns raw text
 * lines into fully mapped RecipeIngredient records.
 */
import { getIngredient } from './ingredients'
import { parseIngredientLine } from './ingredientParser'
import { matchIngredient, type MatchContext } from './matcher'
import type { RecipeIngredient } from './types'

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Heading lines inside ingredient lists ("Kastike:", "Täyte"). */
export function isGroupHeading(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^\d|[½¼¾⅓⅔]/u.test(t)) return false
  if (/:$/.test(t) && t.length <= 40) return true
  const first = t.toLowerCase().split(/\s+/)[0]
  return t.split(/\s+/).length <= 2 && GROUP_WORDS.has(first)
}

const GROUP_WORDS = new Set([
  'kastike', 'täyte', 'pohja', 'kuorrute', 'kuorrutus', 'koristeluun', 'koristelu', 'tarjoiluun', 'marinadi',
  'taikina', 'kastikkeeseen', 'pinnalle', 'lisäksi', 'dippi', 'kaste', 'glaseeraus', 'murupohja', 'päälle',
  'lisukkeet', 'lisuke', 'täytteeseen', 'pohjaan', 'taikinaan', 'kuorrutteeseen', 'salaattiin', 'keittoon',
])

export function buildRecipeIngredient(line: string, ctx: MatchContext, group?: string | null): RecipeIngredient {
  const p = parseIngredientLine(line)
  const m = matchIngredient(p.name, ctx, p.raw)
  const canonical = getIngredient(m.canonicalId)
  return {
    id: newId(),
    raw: p.raw,
    group: group ?? null,
    quantity: p.quantity,
    quantityMax: p.quantityMax,
    unit: p.unit,
    name: p.name,
    note: p.note,
    explicitGrams: p.explicitGrams,
    perUnitGrams: p.perUnitGrams,
    perUnitMl: p.perUnitMl,
    size: p.size,
    canonicalId: m.canonicalId,
    fineliId: m.fineliId,
    confidence: m.confidence,
    matchMethod: m.method,
    userOverride: m.method === 'user',
    gramsOverride: null,
    scaling: canonical?.scaling ?? 'linear',
    optional: p.optional,
  }
}

/** Parse a list of lines, treating heading lines as group names for following ingredients. */
export function buildIngredientList(lines: string[], ctx: MatchContext): RecipeIngredient[] {
  const out: RecipeIngredient[] = []
  let group: string | null = null
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (isGroupHeading(t)) {
      group = t.replace(/:$/, '')
      continue
    }
    out.push(buildRecipeIngredient(t, ctx, group))
  }
  return out
}

/**
 * Re-run matching for ingredients that the user has not overridden
 * (e.g. after the dictionary or the user's mapping table changed).
 */
export function rematchIngredients(ings: RecipeIngredient[], ctx: MatchContext): RecipeIngredient[] {
  return ings.map((ing) => {
    if (ing.userOverride || ing.matchMethod === 'source') return ing
    const m = matchIngredient(ing.name, ctx, ing.raw)
    return {
      ...ing,
      canonicalId: m.canonicalId,
      fineliId: m.fineliId,
      confidence: m.confidence,
      matchMethod: m.method,
      userOverride: m.method === 'user',
    }
  })
}
