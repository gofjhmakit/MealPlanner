/**
 * Schema.org Recipe extraction from <script type="application/ld+json">.
 * Handles arrays, @graph containers, nested objects and HowToSection/HowToStep instructions.
 */
import { parseDurationMinutes, parseServings } from '../../domain/ingredientParser'
import { absoluteUrl, cleanText, oneLine, tryParseJson } from '../text'
import type { ExtractedRecipe } from '../types'

type Json = Record<string, unknown>

function isRecipe(node: unknown): node is Json {
  if (!node || typeof node !== 'object') return false
  const t = (node as Json)['@type']
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))
}

function findRecipes(node: unknown, out: Json[], depth = 0): void {
  if (depth > 8 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) findRecipes(n, out, depth + 1)
    return
  }
  if (isRecipe(node)) {
    out.push(node)
    return
  }
  for (const v of Object.values(node)) findRecipes(v, out, depth + 1)
}

export function findJsonLdRecipes(doc: Document): Json[] {
  const out: Json[] = []
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = (script.textContent ?? '').trim()
    // Some sites put invalid control characters in JSON-LD; strip them before parsing.
    const parsed = tryParseJson(raw) ?? tryParseJson(raw.replace(/[\u0000-\u001f]+/g, ' '))
    findRecipes(parsed, out)
  }
  return out
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\n|\r/).map(oneLine).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap((v) => (typeof v === 'string' ? [oneLine(v)] : [])).filter(Boolean)
  return []
}

/** Flatten recipeInstructions: string | string[] | HowToStep[] | HowToSection[] */
function instructions(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return []
  if (typeof value === 'string') return cleanText(value).split('\n').map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap((v) => instructions(v, depth + 1))
  if (typeof value === 'object') {
    const o = value as Json
    if (o.itemListElement) {
      const steps = instructions(o.itemListElement, depth + 1)
      const name = oneLine(o.name)
      return name && o['@type'] === 'HowToSection' ? [`${name}:`, ...steps] : steps
    }
    const text = oneLine(o.text ?? o.description ?? o.name)
    return text ? [text] : []
  }
  return []
}

function images(value: unknown, base: URL): string[] {
  const out: string[] = []
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      const u = absoluteUrl(v, base)
      if (u) out.push(u)
    } else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') visit((v as Json).url ?? (v as Json).contentUrl)
  }
  visit(value)
  return [...new Set(out)]
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return oneLine(value) || null
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ') || null
  if (value && typeof value === 'object') return nameOf((value as Json).name)
  return null
}

function nutrition(value: unknown): ExtractedRecipe['sourceNutrition'] {
  if (!value || typeof value !== 'object') return null
  const raw: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(value as Json)) {
    if (k.startsWith('@')) continue
    if (typeof v === 'string' || typeof v === 'number') raw[k] = typeof v === 'string' ? oneLine(v) : v
  }
  if (Object.keys(raw).length === 0) return null
  const servingSize = typeof raw.servingSize === 'string' ? raw.servingSize.toLowerCase() : ''
  const basis = /100\s*g/.test(servingSize) ? 'per-100g' : servingSize ? 'per-serving' : 'unknown'
  return { raw, basis }
}

export function mapJsonLdRecipe(r: Json, base: URL): ExtractedRecipe {
  const yieldInfo = parseServings(r.recipeYield ?? r.yield)
  const keywords = typeof r.keywords === 'string' ? r.keywords.split(',') : Array.isArray(r.keywords) ? r.keywords : []
  const categories = Array.isArray(r.recipeCategory) ? r.recipeCategory : r.recipeCategory ? [r.recipeCategory] : []
  const ingredientList = stringList(r.recipeIngredient ?? r.ingredients)
  return {
    title: oneLine(r.name) || null,
    description: cleanText(r.description) || null,
    servings: yieldInfo.servings,
    servingsText: yieldInfo.text,
    prepTimeMin: parseDurationMinutes(r.prepTime),
    cookTimeMin: parseDurationMinutes(r.cookTime),
    totalTimeMin: parseDurationMinutes(r.totalTime),
    ingredients: ingredientList.map((text) => ({ text })),
    instructions: instructions(r.recipeInstructions),
    images: images(r.image, base),
    category: categories.map((c) => oneLine(c)).filter(Boolean)[0] ?? null,
    cuisine: nameOf(r.recipeCuisine),
    tags: [...new Set([...categories, ...keywords].map((k) => oneLine(k).toLowerCase()).filter(Boolean))],
    author: nameOf(r.author),
    canonicalUrl: typeof r.url === 'string' ? absoluteUrl(r.url, base) : null,
    sourceNutrition: nutrition(r.nutrition),
  }
}

/** Extract the first (most complete) Schema.org Recipe on the page. */
export function extractJsonLd(doc: Document, base: URL): ExtractedRecipe | null {
  const recipes = findJsonLdRecipes(doc)
  if (recipes.length === 0) return null
  const mapped = recipes.map((r) => mapJsonLdRecipe(r, base))
  mapped.sort((a, b) => (b.ingredients?.length ?? 0) - (a.ingredients?.length ?? 0))
  return mapped[0]
}
