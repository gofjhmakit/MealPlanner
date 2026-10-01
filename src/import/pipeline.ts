/**
 * Recipe import pipeline.
 *
 *   1. identify the site and run its adapter (site-specific knowledge)
 *   2. fill missing fields from Schema.org JSON-LD
 *   3. … from embedded application state (Next.js/Nuxt)
 *   4. … from semantic HTML (microdata, "Ainekset"/"Valmistus" headings)
 *   5. … from meta tags (og:title, og:image)
 *   6. normalize into the internal Recipe model, map ingredients, report what is missing
 *
 * Nothing is invented: fields that could not be extracted stay empty and are reported.
 */
import { buildIngredientList, buildRecipeIngredient, newId } from '../domain/recipeIngredients'
import { getIngredient } from '../domain/ingredients'
import type { MatchContext } from '../domain/matcher'
import type { ImportDiagnostics, Recipe, RecipeIngredient } from '../domain/types'
import { adapterForUrl } from './adapters'
import { extractEmbeddedState } from './extractors/embeddedState'
import { extractJsonLd } from './extractors/jsonLd'
import { extractMeta, extractSemanticHtml } from './extractors/semanticHtml'
import type { ExtractedField, ExtractedRecipe, RecipeSourceAdapter } from './types'

export class ImportError extends Error {
  code: 'invalid-url' | 'blocked' | 'fetch-failed' | 'not-a-recipe' | 'not-allowed' | 'too-large' | 'timeout'
  constructor(code: ImportError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** Fields reported in the import diagnostics, with Finnish labels. */
export const DIAGNOSTIC_FIELDS: { field: ExtractedField; label: string }[] = [
  { field: 'title', label: 'Reseptin nimi' },
  { field: 'description', label: 'Kuvaus' },
  { field: 'ingredients', label: 'Ainekset' },
  { field: 'instructions', label: 'Valmistusohje' },
  { field: 'servings', label: 'Annosmäärä' },
  { field: 'prepTimeMin', label: 'Valmisteluaika' },
  { field: 'cookTimeMin', label: 'Kypsennysaika' },
  { field: 'totalTimeMin', label: 'Kokonaisaika' },
  { field: 'images', label: 'Kuva' },
  { field: 'sourceNutrition', label: 'Lähteen ravintotiedot' },
]

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function fillMissing(target: ExtractedRecipe, source: ExtractedRecipe | null | undefined, method: string, used: Set<string>) {
  if (!source) return
  let contributed = false
  for (const [k, v] of Object.entries(source) as [ExtractedField, unknown][]) {
    if (isEmpty(target[k]) && !isEmpty(v)) {
      ;(target as Record<string, unknown>)[k] = v
      contributed = true
    }
  }
  if (contributed) used.add(method)
}

export function detectBlockedPage(html: string): boolean {
  // Only the interstitial page itself – many real pages embed a Turnstile widget for forms.
  return /<title>\s*(Just a moment|Attention Required|Access denied|Vercel Security Checkpoint)/i.test(html) || /window\._cf_chl_opt|cf-chl-bypass/i.test(html)
}

export interface ExtractionResult {
  adapter: RecipeSourceAdapter
  data: ExtractedRecipe
  methods: string[]
  warnings: string[]
}

export function extractRecipe(doc: Document, url: URL): ExtractionResult {
  const adapter = adapterForUrl(url)
  const site = adapter.extract(doc, url)
  const data: ExtractedRecipe = { ...site.data }
  const used = new Set(site.methods)
  fillMissing(data, extractJsonLd(doc, url), 'json-ld', used)
  if (isEmpty(data.ingredients) || isEmpty(data.instructions) || isEmpty(data.title)) {
    fillMissing(data, extractEmbeddedState(doc)?.recipe, 'app-state', used)
  }
  if (isEmpty(data.ingredients) || isEmpty(data.instructions)) {
    const sem = extractSemanticHtml(doc, url)
    fillMissing(data, sem?.recipe, sem?.method ?? 'html', used)
  }
  fillMissing(data, extractMeta(doc, url), 'meta-tags', used)
  return { adapter, data, methods: [...used], warnings: site.warnings }
}

export function buildDiagnostics(result: ExtractionResult): ImportDiagnostics {
  const found: Record<string, boolean> = {}
  const missing: string[] = []
  for (const { field, label } of DIAGNOSTIC_FIELDS) {
    const ok = !isEmpty(result.data[field])
    found[field] = ok
    if (!ok && field !== 'description' && field !== 'sourceNutrition' && field !== 'prepTimeMin' && field !== 'cookTimeMin' && field !== 'totalTimeMin') missing.push(label)
  }
  if (!found.prepTimeMin && !found.cookTimeMin && !found.totalTimeMin) missing.push('Valmistusaika')
  return {
    adapter: result.adapter.id,
    methods: result.methods,
    found,
    missing,
    warnings: result.warnings,
    importedAt: new Date().toISOString(),
  }
}

/** Map extracted ingredients, honouring Fineli ids given by the source itself. */
function mapIngredients(data: ExtractedRecipe, ctx: MatchContext): RecipeIngredient[] {
  const list = data.ingredients ?? []
  if (!list.some((i) => i.fineliId || i.group)) return buildIngredientList(list.map((i) => i.text), ctx)
  return list.map((item) => {
    const ing = buildRecipeIngredient(item.text, ctx, item.group ?? null)
    const food = item.fineliId ? ctx.fineli?.get(item.fineliId) : undefined
    if (!food || ing.userOverride) return ing
    const canonical = getIngredient(ing.canonicalId)
    if (canonical?.fineliId === food.id) return { ...ing, confidence: Math.max(ing.confidence, 0.95) }
    // The source knows the actual product: use its Fineli food, keep our canonical for shopping.
    return { ...ing, fineliId: food.id, confidence: 0.9, matchMethod: 'source' as const }
  })
}

export interface NormalizeOptions {
  url: URL
  ctx: MatchContext
  defaultServings: number
}

export function toRecipe(result: ExtractionResult, opts: NormalizeOptions): { recipe: Recipe; diagnostics: ImportDiagnostics } {
  const { data, adapter } = result
  const diagnostics = buildDiagnostics(result)
  if (isEmpty(data.ingredients) && isEmpty(data.instructions)) {
    throw new ImportError('not-a-recipe', 'Sivulta ei löytynyt reseptin aineksia eikä valmistusohjetta.')
  }
  const now = new Date().toISOString()
  const servings = data.servings && data.servings > 0 ? data.servings : opts.defaultServings
  if (!data.servings) diagnostics.warnings.push(`Annosmäärää ei löytynyt – oletettu ${servings} annosta. Tarkista ja korjaa.`)
  const recipe: Recipe = {
    id: newId(),
    title: data.title || 'Nimetön resepti',
    description: data.description ?? null,
    servings,
    servingsText: data.servingsText ?? null,
    prepTimeMin: data.prepTimeMin ?? null,
    cookTimeMin: data.cookTimeMin ?? null,
    totalTimeMin: data.totalTimeMin ?? (data.prepTimeMin && data.cookTimeMin ? data.prepTimeMin + data.cookTimeMin : null),
    timeText: data.timeText ?? null,
    imageUrl: data.images?.[0] ?? null,
    ingredients: mapIngredients(data, opts.ctx),
    instructions: data.instructions ?? [],
    tags: data.tags ?? [],
    category: data.category ?? null,
    cuisine: data.cuisine ?? null,
    origin: 'imported',
    sourceId: adapter.id,
    sourceUrl: data.canonicalUrl ?? opts.url.toString(),
    sourceName: adapter.id === 'generic' ? opts.url.hostname.replace(/^www\./, '') : adapter.name,
    author: data.author ?? null,
    sourceNutrition: data.sourceNutrition ?? null,
    importReport: diagnostics,
    inCollection: true,
    createdAt: now,
    updatedAt: now,
  }
  return { recipe, diagnostics }
}

export function validateRecipeUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new ImportError('invalid-url', `Virheellinen osoite: ${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ImportError('invalid-url', 'Vain http(s)-osoitteet ovat sallittuja.')
  return url
}
