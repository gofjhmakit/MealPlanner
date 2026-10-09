/**
 * Shopping list aggregation.
 *
 * Planned meals -> scaled recipe ingredient lines -> merged per ingredient.
 *
 * Merging rules:
 *   - lines are grouped by canonical ingredient (else Fineli food, else normalized name)
 *   - amounts of the same dimension are always summed exactly (500 g + 0,5 kg = 1 kg; 2 dl + 5 dl = 7 dl)
 *   - different dimensions (g vs dl vs kpl) are only combined when the ingredient has a
 *     reliable conversion (Fineli household units or dictionary weights). Otherwise they are
 *     shown side by side ("400 g + 1 pkt") rather than guessed.
 */
import { normalizeKey } from './finnish'
import { getIngredient, type CanonicalIngredient } from './ingredients'
import type { FineliLookup } from './matcher'
import { resolveGrams } from './nutrition'
import { applyScaling } from './scaling'
import type { Amount, FineliFood, RecipeIngredient, ShoppingCategory } from './types'
import { SHOPPING_CATEGORIES } from './types'
import { formatCount, formatMass, formatVolume, getUnit, toBase } from './units'

export const CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  vegetables: 'Hedelmät ja vihannekset',
  meat_fish: 'Liha ja kala',
  dairy: 'Maito, munat ja kylmätuotteet',
  bakery: 'Leivät',
  dry_goods: 'Kuivatuotteet',
  frozen: 'Pakasteet',
  canned: 'Säilykkeet',
  spices_sauces: 'Mausteet, kastikkeet ja öljyt',
  other: 'Muut',
}

/** Map Fineli ingredient classes to shopping categories (used when no dictionary entry exists). */
export function categoryFromFineli(food: FineliFood | undefined): ShoppingCategory {
  if (!food) return 'other'
  if (food.category) return food.category // the user's own product
  const c = food.igClass
  const p = food.igClassParent
  if (['VEGTOT', 'FRUITTOT', 'POTATOT'].includes(p) || ['MUSHRO', 'HERB'].includes(c)) {
    if (['VEGCANN', 'FRUITCAN'].includes(c)) return 'canned'
    return 'vegetables'
  }
  if (['MEATTOT', 'FISHTOT'].includes(p)) return 'meat_fish'
  if (['MILKTOT', 'EGGTOT'].includes(p)) return 'dairy'
  if (['FLAVSAUC', 'FLAVSEED', 'SALT', 'OIL', 'HERB'].includes(c)) return 'spices_sauces'
  if (['CERTOT', 'SUGARTOT', 'NUTSEEDT', 'PEABEANT'].includes(p) || ['NUTSEED', 'PEABEAN', 'SUGARSYR', 'INGRMIS'].includes(c)) return 'dry_goods'
  if (food.fuClassParent === 'CEBAKTOT' && food.process === 'BAK') return 'bakery'
  return 'other'
}

export interface ShoppingLineInput {
  recipeId: string
  recipeTitle: string
  ingredient: RecipeIngredient
  /** Scaling factor: planned servings / recipe servings. */
  factor: number
}

export interface AggregatedItem {
  key: string
  name: string
  category: ShoppingCategory
  amount: Amount
  sources: { recipeId: string; title: string; raw: string }[]
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export function shoppingKey(ing: RecipeIngredient): string {
  if (ing.canonicalId) return `c:${ing.canonicalId}`
  if (ing.fineliId != null) return `f:${ing.fineliId}`
  return `n:${normalizeKey(ing.name) || ing.name.toLowerCase()}`
}

function emptyAmount(): Amount {
  return { mass: null, volume: null, counts: {}, unquantified: 0 }
}

function addTo(a: Amount, dim: 'mass' | 'volume', value: number) {
  a[dim] = (a[dim] ?? 0) + value
}

/** Grams per one of the given unit for an ingredient, only when reliably known. */
function reliableGramsPerUnit(
  unit: string,
  canonical: CanonicalIngredient | undefined,
  food: FineliFood | undefined,
): number | null {
  const res = resolveGrams({ quantity: 1, unit: unit === 'kpl' ? null : unit }, canonical, food)
  if (res.grams === null || res.confidence < 0.75 || res.method === 'volume-water') return null
  return res.grams
}

function normalizeAmount(amount: Amount, canonical: CanonicalIngredient | undefined, food: FineliFood | undefined): Amount {
  const out: Amount = { ...amount, counts: { ...amount.counts } }
  const gPerMl = reliableGramsPerUnit('ml', canonical, food)

  // Estimate the size of each part in grams to find the dominant dimension.
  const parts: { dim: string; grams: number | null }[] = []
  if (out.mass) parts.push({ dim: 'mass', grams: out.mass })
  if (out.volume) parts.push({ dim: 'volume', grams: gPerMl ? out.volume * gPerMl : out.volume })
  for (const [u, n] of Object.entries(out.counts)) {
    const g = reliableGramsPerUnit(u, canonical, food)
    parts.push({ dim: `count:${u}`, grams: g ? g * n : null })
  }
  if (parts.length <= 1) return out

  let target = canonical?.shoppingUnit as string | undefined
  if (target === 'count') target = 'count:kpl'
  if (!target || !parts.some((p) => p.dim === target || (target === 'count:kpl' && p.dim.startsWith('count')))) {
    target = [...parts].sort((a, b) => (b.grams ?? 0) - (a.grams ?? 0))[0].dim
  }

  const gramsPerTarget =
    target === 'mass' ? 1 : target === 'volume' ? gPerMl : reliableGramsPerUnit(target.slice(6), canonical, food)
  if (!gramsPerTarget) return out

  let total = 0
  const leftover: Amount = emptyAmount()
  leftover.unquantified = out.unquantified
  const push = (dim: string, value: number, grams: number | null) => {
    if (dim === target) total += value
    else if (grams !== null) total += grams / gramsPerTarget
    else if (dim === 'mass') addTo(leftover, 'mass', value)
    else if (dim === 'volume') addTo(leftover, 'volume', value)
    else leftover.counts[dim.slice(6)] = (leftover.counts[dim.slice(6)] ?? 0) + value
  }
  if (out.mass) push('mass', out.mass, out.mass)
  if (out.volume) push('volume', out.volume, gPerMl ? out.volume * gPerMl : null)
  for (const [u, n] of Object.entries(out.counts)) {
    const g = reliableGramsPerUnit(u, canonical, food)
    push(`count:${u}`, n, g !== null ? g * n : null)
  }
  if (target === 'mass') leftover.mass = (leftover.mass ?? 0) + total
  else if (target === 'volume') leftover.volume = (leftover.volume ?? 0) + total
  else leftover.counts[target.slice(6)] = (leftover.counts[target.slice(6)] ?? 0) + total
  return leftover
}

export function aggregateShoppingList(
  lines: ShoppingLineInput[],
  lookup: FineliLookup | undefined,
  categoryOverrides: Map<string, ShoppingCategory> = new Map(),
): AggregatedItem[] {
  const items = new Map<string, AggregatedItem & { canonical?: CanonicalIngredient; food?: FineliFood }>()

  for (const { recipeId, recipeTitle, ingredient: ing, factor } of lines) {
    const canonical = getIngredient(ing.canonicalId)
    if (canonical?.excludeFromShopping) continue
    const fineliId = ing.fineliId ?? canonical?.fineliId ?? null
    const food = fineliId !== null ? lookup?.get(fineliId) : undefined
    const key = shoppingKey(ing)
    let item = items.get(key)
    if (!item) {
      const name = canonical?.fi ?? (food?.custom ? food.fi : capitalize(normalizeKey(ing.name) || ing.name))
      item = {
        key,
        name,
        category: categoryOverrides.get(key) ?? canonical?.category ?? categoryFromFineli(food),
        amount: emptyAmount(),
        sources: [],
        canonical,
        food,
      }
      items.set(key, item)
    }
    item.sources.push({ recipeId, title: recipeTitle, raw: ing.raw })

    const scale = (v: number) => applyScaling(v, factor, ing.scaling)
    const a = item.amount
    if (ing.quantity == null) {
      if (ing.explicitGrams != null) addTo(a, 'mass', scale(ing.explicitGrams))
      else a.unquantified += 1
      continue
    }
    const q = ing.quantityMax != null ? (ing.quantity + ing.quantityMax) / 2 : ing.quantity
    if (ing.explicitGrams != null) {
      addTo(a, 'mass', scale(ing.explicitGrams))
      continue
    }
    const base = ing.unit ? toBase(q, ing.unit) : null
    if (base) {
      addTo(a, base.kind, scale(base.value))
      continue
    }
    if (ing.perUnitGrams != null) {
      addTo(a, 'mass', scale(q * ing.perUnitGrams))
      continue
    }
    if (ing.perUnitMl != null) {
      addTo(a, 'volume', scale(q * ing.perUnitMl))
      continue
    }
    const unit = ing.unit && getUnit(ing.unit) ? ing.unit : 'kpl'
    a.counts[unit] = (a.counts[unit] ?? 0) + scale(q)
  }

  const order = new Map(SHOPPING_CATEGORIES.map((c, i) => [c, i]))
  return [...items.values()]
    .map(({ canonical, food, ...item }) => ({ ...item, amount: normalizeAmount(item.amount, canonical, food) }))
    .sort((a, b) => order.get(a.category)! - order.get(b.category)! || a.name.localeCompare(b.name, 'fi'))
}

/** Units bought whole: half a pot of dill or half an onion is still one in the basket. */
const WHOLE_UNITS = new Set(['kpl', 'pkt', 'prk', 'tlk', 'ps', 'rs', 'pll', 'nippu', 'ruukku', 'kera', 'varsi'])

/** Amounts rounded up to what you'd pick up in a shop: 265 g → 300 g, 4,3 dl → 4,5 dl. */
function buyMass(g: number): number {
  if (g >= 1000) return Math.ceil(g / 100) * 100
  if (g >= 100) return Math.ceil(g / 50) * 50
  if (g >= 20) return Math.ceil(g / 10) * 10
  return g
}
function buyVolume(ml: number): number {
  if (ml >= 45) return Math.ceil(ml / 50) * 50 // half decilitres
  if (ml >= 15) return Math.ceil(ml / 7.5) * 7.5 // half tablespoons
  return Math.ceil(ml / 1.25) * 1.25 // quarter teaspoons
}

/** Human-readable amount for a shopping list line, e.g. "1 kg", "7 dl", "2 kpl + 200 g". */
export function formatShoppingAmount(a: Amount): string {
  const parts: string[] = []
  if (a.mass) parts.push(formatMass(buyMass(a.mass)))
  if (a.volume) parts.push(formatVolume(buyVolume(a.volume)))
  for (const [u, n] of Object.entries(a.counts)) {
    if (n > 0) parts.push(formatCount(WHOLE_UNITS.has(u) ? Math.ceil(n - 0.05) : Math.ceil(n * 2 - 0.05) / 2, u))
  }
  if (parts.length === 0) return a.unquantified > 0 ? 'tarpeen mukaan' : ''
  return parts.join(' + ')
}

/**
 * Returns a predicate telling whether a shopping item is something the household keeps at home
 * (settings → "Kotona olevat ainekset"). Matches the canonical ingredient's name and synonyms.
 */
export function pantryMatcher(pantry: string[]): (item: { key: string; name: string }) => boolean {
  const keys = new Set(pantry.map((p) => normalizeKey(p)).filter(Boolean))
  return (item) => {
    if (keys.size === 0) return false
    const canonical = item.key.startsWith('c:') ? getIngredient(item.key.slice(2)) : undefined
    const names = [item.name, ...(canonical ? [canonical.fi, ...canonical.aliases] : [])]
    return names.some((n) => keys.has(normalizeKey(n)))
  }
}

export interface ShoppingTextItem {
  name: string
  amountText: string
  category: ShoppingCategory
  checked: boolean
}

/** Plain-text version of a shopping list for sharing (messages, notes apps). Checked items are left out. */
export function shoppingListText(title: string, items: ShoppingTextItem[]): string {
  const lines: string[] = [title]
  for (const category of SHOPPING_CATEGORIES) {
    const inCat = items.filter((i) => i.category === category && !i.checked)
    if (inCat.length === 0) continue
    lines.push('', `${CATEGORY_LABELS[category]}:`)
    for (const i of inCat.sort((a, b) => a.name.localeCompare(b.name, 'fi'))) lines.push(`☐ ${i.name}${i.amountText ? ` – ${i.amountText}` : ''}`)
  }
  return lines.join('\n')
}

const STAPLE_NAME_RE = /öljy|jauho|sokeri|suola|pippuri|etikka|soija|liemikuutio|liemijauhe|mauste|leivinjauhe|sooda|vanilja|kaneli|paprikajauhe|curry|kurkuma|oregano|basilika, kuivattu|timjami|sinappi|ketsuppi|majoneesi|hunaja|siirappi|kaakao/i

/**
 * Lines worth asking "onko kotona?" before a trip: seasonings, oils, baking basics and other
 * small amounts of things a kitchen usually keeps (a teaspoon of cinnamon is not a purchase).
 */
export function isStapleLike(item: { name: string; category: ShoppingCategory; amount: Amount; manual?: boolean }): boolean {
  if (item.manual) return false
  if (item.category === 'spices_sauces') return true
  if (STAPLE_NAME_RE.test(item.name)) return true
  const a = item.amount
  const countTotal = Object.values(a.counts).reduce((s, n) => s + n, 0)
  if (!a.mass && !countTotal && a.volume && a.volume <= 45) return true
  if (!a.volume && !countTotal && a.mass && a.mass <= 20) return true
  return !a.mass && !a.volume && !countTotal && a.unquantified > 0
}
