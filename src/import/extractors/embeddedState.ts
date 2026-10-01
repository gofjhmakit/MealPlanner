/**
 * Extraction from JavaScript application state embedded in the page:
 *   - Next.js pages router:  <script id="__NEXT_DATA__" type="application/json">
 *   - Next.js app router:    self.__next_f.push([1, "…"]) flight chunks
 *   - Nuxt / generic:        window.__NUXT__ = {…}, window.__INITIAL_STATE__ = {…}
 *
 * The JSON is searched for objects that look like recipes (a name/title plus an
 * ingredient array). Field names vary by site, so mapping is heuristic.
 */
import { parseDurationMinutes, parseServings } from '../../domain/ingredientParser'
import { extractBalancedJson, oneLine, tryParseJson } from '../text'
import type { ExtractedIngredient, ExtractedRecipe } from '../types'

type Json = Record<string, unknown>

/** Collect JSON documents embedded in scripts. */
export function embeddedJsonDocuments(doc: Document): unknown[] {
  const out: unknown[] = []
  const next = doc.getElementById('__NEXT_DATA__')
  if (next?.textContent) {
    const parsed = tryParseJson(next.textContent)
    if (parsed) out.push(parsed)
  }
  let flight = ''
  for (const script of doc.querySelectorAll('script:not([src])')) {
    const text = script.textContent ?? ''
    if (text.includes('self.__next_f.push')) {
      for (const m of text.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
        const decoded = tryParseJson(m[1])
        if (typeof decoded === 'string') flight += decoded
      }
    }
    const assign = text.match(/window\.(__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__)\s*=\s*/)
    if (assign && assign.index !== undefined) {
      const start = text.indexOf('{', assign.index)
      const json = start >= 0 ? extractBalancedJson(text, start) : null
      const parsed = json ? tryParseJson(json) : undefined
      if (parsed) out.push(parsed)
    }
  }
  if (flight) {
    // Flight data is a stream of "id:json" rows; pull out every object that mentions ingredients.
    for (const m of flight.matchAll(/"(recipe|recipeData|recipeDetails)":\{/g)) {
      const json = extractBalancedJson(flight, m.index! + m[0].length - 1)
      const parsed = json ? tryParseJson(json) : undefined
      if (parsed) out.push(parsed)
    }
  }
  return out
}

const INGREDIENT_KEYS = ['ingredients', 'recipeIngredients', 'ingredientList', 'ingredientGroups', 'ingredientSections']

function looksLikeRecipe(o: Json): boolean {
  const hasName = typeof o.name === 'string' || typeof o.title === 'string'
  return hasName && INGREDIENT_KEYS.some((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length > 0)
}

export function findRecipeObjects(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 14 || !node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) findRecipeObjects(n, out, depth + 1)
    return out
  }
  const o = node as Json
  if (looksLikeRecipe(o)) out.push(o)
  for (const v of Object.values(o)) findRecipeObjects(v, out, depth + 1)
  return out
}

function ingredientText(item: unknown): string | null {
  if (typeof item === 'string') return oneLine(item) || null
  if (!item || typeof item !== 'object') return null
  const o = item as Json
  for (const k of ['ingredientTitle', 'text', 'line', 'fullText', 'displayText', 'originalText']) {
    if (typeof o[k] === 'string' && o[k]) return oneLine(o[k])
  }
  const amount = o.amount ?? o.quantity ?? o.minAmount
  const unit = o.unit ?? o.unitName ?? o.amountType
  const name = o.name ?? o.ingredient ?? o.title
  if (typeof name === 'string') {
    return oneLine([amount, typeof unit === 'string' ? unit : '', name].filter((x) => x !== undefined && x !== null && x !== '').join(' '))
  }
  return null
}

function fineliRef(item: unknown): { id: number; name: string | null } | null {
  if (!item || typeof item !== 'object') return null
  const options = (item as Json).ingredientOptions
  if (!Array.isArray(options)) return null
  for (const opt of options) {
    const id = Number((opt as Json)?.fineliId)
    if (Number.isFinite(id) && id > 0) return { id, name: typeof (opt as Json).name === 'string' ? ((opt as Json).name as string) : null }
  }
  return null
}

function ingredientsOf(o: Json): ExtractedIngredient[] {
  const out: ExtractedIngredient[] = []
  const visit = (list: unknown, group: string | null, depth: number) => {
    if (!Array.isArray(list) || depth > 3) return
    for (const item of list) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const it = item as Json
        const nested = INGREDIENT_KEYS.map((k) => it[k]).find((v) => Array.isArray(v))
        if (nested && !it.ingredientTitle) {
          const title = typeof it.title === 'string' ? it.title : typeof it.name === 'string' ? it.name : group
          visit(nested, title ? oneLine(title) : group, depth + 1)
          continue
        }
      }
      const text = ingredientText(item)
      if (!text) continue
      const ref = fineliRef(item)
      out.push({ text, group, fineliId: ref?.id ?? null, fineliName: ref?.name ?? null })
    }
  }
  for (const k of INGREDIENT_KEYS) visit(o[k], null, 0)
  return out
}

function stepsOf(o: Json): string[] {
  const list = o.steps ?? o.instructions ?? o.method ?? o.directions
  if (typeof list === 'string') return list.split('\n').map(oneLine).filter(Boolean)
  if (!Array.isArray(list)) return []
  return list
    .map((s) => (typeof s === 'string' ? s : s && typeof s === 'object' ? ((s as Json).body ?? (s as Json).text ?? (s as Json).description ?? (s as Json).instruction) : null))
    .map(oneLine)
    .filter(Boolean)
}

export function mapEmbeddedRecipe(o: Json): ExtractedRecipe {
  const yieldInfo = parseServings(o.yield ?? o.servings ?? o.portions ?? o.recipeYield ?? o.portionCount)
  const time = (v: unknown) => (typeof v === 'number' ? (v > 0 ? v : null) : parseDurationMinutes(v))
  return {
    title: oneLine(o.name ?? o.title) || null,
    description: oneLine(o.description ?? o.lead ?? o.ingress) || null,
    servings: yieldInfo.servings,
    servingsText: yieldInfo.text,
    prepTimeMin: time(o.prepTime ?? o.preparationTime),
    cookTimeMin: time(o.cookTime ?? o.cookingTime),
    totalTimeMin: time(o.totalTime),
    ingredients: ingredientsOf(o),
    instructions: stepsOf(o),
  }
}

export function extractEmbeddedState(doc: Document): { recipe: ExtractedRecipe; raw: Json } | null {
  const candidates = embeddedJsonDocuments(doc).flatMap((d) => findRecipeObjects(d))
  if (candidates.length === 0) return null
  const scored = candidates
    .map((raw) => ({ raw, recipe: mapEmbeddedRecipe(raw) }))
    .sort((a, b) => (b.recipe.ingredients?.length ?? 0) + (b.recipe.instructions?.length ?? 0) - ((a.recipe.ingredients?.length ?? 0) + (a.recipe.instructions?.length ?? 0)))
  return scored[0]
}
