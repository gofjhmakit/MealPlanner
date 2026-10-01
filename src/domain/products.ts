/**
 * The user's own products (package-label nutrition) as nutrition foods.
 *
 * Fineli doesn't contain every product ("Valio Oivariini", a specific protein yoghurt …),
 * so users can add products. Each product becomes a virtual FineliFood with id
 * `product.foodId` (>= PRODUCT_FOOD_ID_BASE), which lets nutrition, the mapping dialog,
 * shopping lists and diet checks treat it exactly like a Fineli food.
 */
import { lemmaCandidates, tokenize } from './finnish'
import type { FineliFood, Product } from './types'

export const PRODUCT_FOOD_ID_BASE = 900_000_000

export function isProductFoodId(id: number | null | undefined): boolean {
  return typeof id === 'number' && id >= PRODUCT_FOOD_ID_BASE
}

export function productDisplayName(p: Pick<Product, 'name' | 'brand'>): string {
  const brand = p.brand?.trim()
  return brand && !p.name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${p.name}` : p.name
}

/** Next free virtual food id. */
export function nextProductFoodId(existing: Pick<Product, 'foodId'>[]): number {
  return Math.max(PRODUCT_FOOD_ID_BASE, ...existing.map((p) => p.foodId)) + 1
}

export function productToFood(p: Product): FineliFood {
  const n = p.nutrients
  const salt = n.salt ?? null
  const dl = p.gramsPerDl ?? null
  const units: Record<string, number> = {}
  if (dl) {
    units.DL = dl
    units.RKL = Math.round(dl * 0.15 * 10) / 10
    units.TL = Math.round(dl * 0.05 * 10) / 10
  }
  if (p.pieceGrams) units.KPL_M = p.pieceGrams
  if (p.packageGrams) units.PKG = p.packageGrams
  return {
    id: p.foodId,
    fi: productDisplayName(p),
    en: null,
    sv: null,
    type: 'PRODUCT',
    process: 'IND',
    edibleShare: 100,
    igClass: '',
    igClassParent: '',
    fuClass: '',
    fuClassParent: '',
    nutrients: {
      energyKcal: n.energyKcal,
      energyKj: Math.round(n.energyKcal * 4.184 * 10) / 10,
      protein: n.protein ?? undefined,
      carbohydrate: n.carbohydrate ?? undefined,
      sugars: n.sugars ?? undefined,
      fat: n.fat ?? undefined,
      saturatedFat: n.saturatedFat ?? undefined,
      fibre: n.fibre ?? undefined,
      salt: salt ?? undefined,
      // EU labels give salt; sodium = salt / 2.5 (g) -> mg
      sodium: salt !== null ? Math.round((salt / 2.5) * 1000) : undefined,
    },
    units,
    diets: [...p.diets],
    custom: true,
    category: p.category,
  }
}

function stripMarks(text: string): string {
  return text.toLowerCase().replace(/[®™©]/g, ' ').replace(/\([^)]*\)/g, ' ')
}

/** Names/aliases exactly as written (lower-case, tokenized), brands kept. */
function phrase(text: string): string {
  return tokenize(stripMarks(text)).join(' ')
}

export interface ProductMatchEntry {
  foodId: number
  canonicalId: string | null
  name: string
  /** Lower-case tokenized names (with and without brand) and aliases. */
  keys: Set<string>
  /** Lower-case full names (brand + name) searched in the raw recipe line. */
  rawNames: string[]
}

export function productMatchIndex(products: Product[]): ProductMatchEntry[] {
  return products.map((p) => {
    const names = [p.name, productDisplayName(p), ...p.aliases]
    const keys = new Set(names.map((n) => phrase(n)).filter((k) => k.length >= 3))
    const rawNames = [...new Set([productDisplayName(p), p.name].map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 4))]
    return { foodId: p.foodId, canonicalId: p.canonicalId ?? null, name: productDisplayName(p), keys, rawNames }
  })
}

/**
 * Find a user product for an ingredient line: the normalized ingredient name equals a product
 * name/alias, or the raw line contains the product's full name ("Valio Oivariini").
 */
export function findProduct(index: ProductMatchEntry[], name: string, raw?: string): ProductMatchEntry | null {
  if (index.length === 0) return null
  // Every combination of base-form candidates of the input words ("oivariinia" -> "oivariini").
  const tokens = tokenize(stripMarks(name))
  if (tokens.length > 0 && tokens.length <= 5) {
    const lists = tokens.map((t) => lemmaCandidates(t))
    let combos: string[][] = [[]]
    for (const l of lists) combos = combos.flatMap((c) => l.map((x) => [...c, x])).slice(0, 300)
    const phrases = new Set(combos.flatMap((c) => [c.join(' '), c.join('')]))
    const byKey = index.find((e) => [...phrases].some((p) => e.keys.has(p)))
    if (byKey) return byKey
  }
  if (raw) {
    const r = raw.toLowerCase()
    // Word-boundary at the start so a product "Maito" doesn't match "kevytmaitoa".
    return index.find((e) => e.rawNames.some((n) => startsWord(r, n))) ?? null
  }
  return null
}

function startsWord(haystack: string, needle: string): boolean {
  let i = haystack.indexOf(needle)
  while (i >= 0) {
    if (i === 0 || !/\p{L}/u.test(haystack[i - 1])) return true
    i = haystack.indexOf(needle, i + 1)
  }
  return false
}
