/**
 * Ingredient -> canonical ingredient -> Fineli food matching.
 *
 * Strategy (first hit wins; confidence reflects how much was guessed):
 *   0. user mapping for the normalized name                               1.0  'user'
 *   1. whole name equals a dictionary alias                              1.0  'exact'
 *   2. alias matches after dropping leading neutral modifiers            0.95 'alias'
 *      ("tuore basilika" -> basilika) / meaningful modifiers              0.85 'modifier-dropped'
 *   3. Finnish compound head matches an alias                            0.8  'compound-head'
 *      ("kirsikkatomaatti" -> tomaatti; "kesäkurpitsaraaste" -> kesäkurpitsa)
 *      – guarded by notWithPrefixes so "kookosmaito" never becomes milk
 *   4. Search Fineli food names directly                                 ≤0.55 'fineli-search'
 *   5. Fineli has nothing suitable or likely: search the supplementary   ≤0.6  'supplementary-search'
 *      databases (Livsmedelsverket, USDA – Finnish names, see supplementary.ts)
 *   6. nothing                                                            0    'none'
 *
 * Fineli is the master data: steps 1–4 only ever use Fineli foods. The final nutrition
 * confidence is multiplied by the canonical ingredient's fineliConfidence (how well the chosen
 * Fineli food represents it). A dictionary entry that Fineli can only approximate may name a
 * supplementary food for the same ingredient (`supplementary`), which is then used instead.
 */
import { cleanIngredientName, lemmaCandidates, NEUTRAL_MODIFIERS, normalizeKey, tokenize } from './finnish'
import { INGREDIENTS, getIngredient, type CanonicalIngredient } from './ingredients'
import { findProduct, type ProductMatchEntry } from './products'
import { foodSourceLabel, parseSupplementaryRef } from './supplementary'
import type { FineliFood, MatchMethod } from './types'

export interface FineliLookup {
  /** Any nutrition food: Fineli, supplementary or the user's own product. */
  get(id: number): FineliFood | undefined
  /** Fineli foods only. */
  all(): FineliFood[]
  /** Supplementary foods, used only when Fineli has nothing suitable (see supplementary.ts). */
  supplementary?(): FineliFood[]
}

export interface UserMappingLookup {
  get(key: string): { canonicalId?: string | null; fineliId?: number | null } | undefined
}

export interface MatchContext {
  fineli?: FineliLookup
  userMappings?: UserMappingLookup
  /** The user's own products (see products.ts). */
  products?: ProductMatchEntry[]
}

export interface IngredientMatch {
  canonicalId: string | null
  fineliId: number | null
  /** Overall confidence that the nutrition source represents the ingredient (0..1). */
  confidence: number
  method: MatchMethod
  /** Normalized key used for user mapping overrides. */
  key: string
  /** Human-readable Finnish explanation for the UI. */
  explanation: string
}

/** Words describing a physical form; in "X-raaste" the ingredient is X, not the form. */
const FORM_WORDS = new Set([
  'raaste', 'rouhe', 'murska', 'suikale', 'kuutio', 'pala', 'viipale', 'siivu', 'lohko', 'hiutale', 'lastu',
  'pyree', 'sose', 'silppu', 'rengas', 'paloja', 'nauha', 'jauhe', 'filee', 'fileepala', 'pihvi', 'kuori',
])

const MAX_COMBOS = 400

let aliasIndex: Map<string, CanonicalIngredient> | null = null

function getAliasIndex(): Map<string, CanonicalIngredient> {
  if (aliasIndex) return aliasIndex
  aliasIndex = new Map()
  for (const ing of INGREDIENTS) {
    for (const alias of [ing.fi, ...ing.aliases]) {
      const key = tokenize(alias.toLowerCase()).join(' ')
      if (!key) continue
      // first definition wins – list more specific ingredients first in the dictionary
      if (!aliasIndex.has(key)) aliasIndex.set(key, ing)
      const joined = key.replace(/ /g, '')
      if (joined !== key && !aliasIndex.has(joined)) aliasIndex.set(joined, ing)
    }
  }
  return aliasIndex
}

function* combinations(lists: string[][]): Generator<string[]> {
  if (lists.length === 0) {
    yield []
    return
  }
  const [first, ...rest] = lists
  for (const head of first) {
    for (const tail of combinations(rest)) yield [head, ...tail]
  }
}

function lookupPhrase(tokenCands: string[][]): CanonicalIngredient | null {
  const index = getAliasIndex()
  let n = 0
  for (const combo of combinations(tokenCands)) {
    if (++n > MAX_COMBOS) break
    const spaced = combo.join(' ')
    const hit = index.get(spaced) ?? (combo.length > 1 ? index.get(combo.join('')) : undefined)
    if (hit) return hit
  }
  return null
}

function blockedByPrefix(ing: CanonicalIngredient, prefix: string): boolean {
  return (ing.notWithPrefixes ?? []).some((p) => prefix.endsWith(p) || prefix.startsWith(p))
}

/** Try to match the head of a Finnish compound word ("kirsikkatomaatti" -> "tomaatti"). */
function matchCompound(word: string): { ing: CanonicalIngredient; via: string; formOf?: string } | null {
  const index = getAliasIndex()
  for (const cand of lemmaCandidates(word)) {
    for (let i = 2; i <= cand.length - 3; i++) {
      const suffix = cand.slice(i)
      const hit = index.get(suffix)
      if (!hit) continue
      const prefix = cand.slice(0, i)
      if (FORM_WORDS.has(suffix)) {
        // "kesäkurpitsaraaste": the prefix is the actual ingredient
        for (const p of new Set([prefix, prefix.replace(/n$/u, ''), ...lemmaCandidates(prefix)])) {
          const pre = index.get(p)
          if (pre) return { ing: pre, via: p, formOf: suffix }
        }
      }
      if (blockedByPrefix(hit, prefix)) continue
      return { ing: hit, via: suffix }
    }
  }
  return null
}

// --- Food name search (Fineli, then supplementary) ----------------------------------------------

interface FoodNameEntry {
  food: FineliFood
  first: string
  /** Comma-separated name parts after the first ("Juusto, emmental" -> ["emmental"]). */
  rest: Set<string>
  /** Every word of every part. */
  words: Set<string>
  lower: string
  parts: number
}
/**
 * How the ingredient's head word was found in a food name:
 *   first – it is the food's main name ("Tomaatti, …")   → a likely match
 *   part  – it is a whole comma part ("Juusto, emmental") → a likely match
 *   word  – it is just one word somewhere in the name    → weak
 */
export type SearchTier = 'first' | 'part' | 'word'
export interface FoodSearchResult {
  food: FineliFood
  score: number
  tier: SearchTier
}
interface FoodSearchIndex {
  entries: FoodNameEntry[]
  /** Results by name: recipes repeat the same ingredient names a lot. */
  results: Map<string, FoodSearchResult | null>
}
/** Keyed by the food list itself, so a replaced list (new dataset) gets a fresh index. */
const searchIndexCache = new WeakMap<FineliFood[], FoodSearchIndex>()

function searchIndex(foods: FineliFood[]): FoodSearchIndex {
  let index = searchIndexCache.get(foods)
  if (!index) {
    const entries = foods.map((food) => {
      const lower = food.fi.toLowerCase()
      const segments = lower.split(',').map((s) => s.trim()).filter(Boolean)
      return { food, first: segments[0] ?? '', rest: new Set(segments.slice(1)), words: new Set(segments.flatMap((s) => s.split(' '))), lower, parts: segments.length }
    })
    index = { entries, results: new Map() }
    searchIndexCache.set(foods, index)
  }
  return index
}

function cachedSearch(foods: FineliFood[], name: string, compounds: boolean): FoodSearchResult | null {
  const index = searchIndex(foods)
  const cached = index.results.get(name)
  if (cached !== undefined) return cached
  const found = searchFoodsUncached(index.entries, name, compounds)
  if (index.results.size > 20000) index.results.clear()
  index.results.set(name, found)
  return found
}

/** Search Fineli foods for an ingredient name. Returns the best food and a score (0..0.55). */
export function searchFineli(lookup: FineliLookup, name: string): FoodSearchResult | null {
  return cachedSearch(lookup.all(), name, false)
}

/**
 * Search the supplementary foods. Same scoring as Fineli; the last two words may also form a
 * compound ("naudan paisti" -> "naudanpaisti"), and a food whose whole name is the ingredient
 * ("Worcestershirekastike") scores 0.6.
 */
export function searchSupplementary(lookup: FineliLookup, name: string): FoodSearchResult | null {
  const foods = lookup.supplementary?.()
  return foods?.length ? cachedSearch(foods, name, true) : null
}

function searchFoodsUncached(entries: FoodNameEntry[], name: string, compounds: boolean): FoodSearchResult | null {
  const tokens = tokenize(name)
  if (tokens.length === 0) return null
  const head = tokens[tokens.length - 1]
  const headCands = lemmaCandidates(head).filter((c) => c.length >= 4)
  if (compounds && tokens.length > 1) {
    const prev = tokens[tokens.length - 2]
    for (const p of new Set([prev, ...lemmaCandidates(prev)])) {
      for (const h of lemmaCandidates(head)) if (p.length >= 3 && h.length >= 3) headCands.push(p + h)
    }
  }
  const otherCands = [...new Set(tokens.slice(0, -1).flatMap((t) => lemmaCandidates(t)).filter((c) => c.length >= 4))]
  let best: FoodSearchResult | null = null
  for (const e of entries) {
    let score = 0
    let tier: SearchTier = 'word'
    if (headCands.includes(e.first)) {
      score = 0.55
      tier = 'first'
    } else if (headCands.some((c) => e.rest.has(c))) {
      score = 0.5
      tier = 'part'
    } else if (headCands.some((c) => e.words.has(c))) score = 0.45
    if (score === 0) continue
    if (compounds && tier === 'first' && e.parts === 1) score = 0.6
    if (otherCands.some((c) => e.lower.includes(c))) score += 0.03
    if (e.food.type !== 'FOOD') score -= 0.05
    if (e.food.process === 'RAW' || e.food.process === 'IND') score += 0.01
    // shorter names are more generic ("Tomaatti" over "Tomaatti, aurinkokuivattu, öljyssä")
    score -= Math.min(0.04, e.parts * 0.01)
    if (!best || score > best.score) best = { food: e.food, score, tier }
  }
  const cap = compounds ? 0.6 : 0.55
  return best && best.score >= 0.4 ? { ...best, score: Math.min(cap, best.score) } : null
}


// --- Public API -------------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function result(
  ing: CanonicalIngredient,
  matchConfidence: number,
  method: MatchMethod,
  key: string,
  how: string,
  ctx: MatchContext = {},
): IngredientMatch {
  // Fineli only approximates this ingredient: use the named supplementary food when it's loaded.
  const suppId = ing.supplementary ? parseSupplementaryRef(ing.supplementary) : null
  const supp = suppId !== null ? ctx.fineli?.get(suppId) : undefined
  if (supp) {
    return {
      canonicalId: ing.id,
      fineliId: supp.id,
      confidence: round2(matchConfidence * (ing.supplementaryConfidence ?? 0.9)),
      method,
      key,
      explanation: `${how} → ${ing.fi}. Finelissä ei ole tätä; ravintoarvot: ${foodSourceLabel(supp)} – ${supp.fi}.`,
    }
  }
  const confidence = ing.fineliId === null ? 0 : round2(matchConfidence * ing.fineliConfidence)
  const approx = ing.approximationNote ? ` ${ing.approximationNote}` : ''
  return {
    canonicalId: ing.id,
    fineliId: ing.fineliId,
    confidence,
    method,
    key,
    explanation: `${how} → ${ing.fi}.${approx}`,
  }
}

let productIndex: { re: RegExp; name: string; ing: CanonicalIngredient }[] | null = null

/** Brand/product-line names that identify an ingredient ("Apetina" -> feta), searched in the raw line. */
function findProductName(raw: string): { name: string; ing: CanonicalIngredient } | null {
  if (!productIndex) {
    productIndex = INGREDIENTS.flatMap((ing) =>
      (ing.productNames ?? []).map((name) => ({
        name,
        ing,
        re: new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu'),
      })),
    )
  }
  const hit = productIndex.find((p) => p.re.test(raw))
  return hit ? { name: hit.name, ing: hit.ing } : null
}

/**
 * @param name cleaned or raw ingredient name
 * @param raw  the original line, used to recognize product names that are stripped as brands
 */
export function matchIngredient(name: string, ctx: MatchContext = {}, raw?: string): IngredientMatch {
  const auto = matchIngredientAuto(name, ctx)
  if (auto.method === 'user') return auto
  // The user's own products come before the built-in dictionary.
  const own = ctx.products?.length ? findProduct(ctx.products, name, raw) : null
  if (own) {
    return {
      canonicalId: own.canonicalId,
      fineliId: own.foodId,
      confidence: 1,
      method: 'product',
      key: auto.key,
      explanation: `Oma tuote → ${own.name}.`,
    }
  }
  if (auto.method === 'exact' || !raw) return auto
  const product = findProductName(raw)
  if (!product || product.ing.id === auto.canonicalId) return auto
  return result(product.ing, 0.9, 'alias', auto.key, `Tuotenimi "${product.name}"`, ctx)
}

function matchIngredientAuto(name: string, ctx: MatchContext): IngredientMatch {
  const cleaned = cleanIngredientName(name).name
  const key = normalizeKey(name)

  const user = ctx.userMappings?.get(key)
  if (user && (user.canonicalId || user.fineliId)) {
    const ing = getIngredient(user.canonicalId)
    const fineliId = user.fineliId ?? ing?.fineliId ?? null
    const food = fineliId !== null ? ctx.fineli?.get(fineliId) : undefined
    return {
      canonicalId: ing?.id ?? null,
      fineliId,
      confidence: fineliId !== null ? 1 : 0,
      method: 'user',
      key,
      explanation: `Käyttäjän valitsema vastaavuus → ${food?.fi ?? ing?.fi ?? 'tuntematon'}.`,
    }
  }

  const tokens = tokenize(cleaned)
  if (tokens.length === 0) {
    return { canonicalId: null, fineliId: null, confidence: 0, method: 'none', key, explanation: 'Ainesosan nimeä ei tunnistettu.' }
  }
  const cands = tokens.map((t) => lemmaCandidates(t))
  const n = tokens.length

  // 1–2. windows ending at the head word (last token), longest first
  for (let s = 0; s < n; s++) {
    const hit = lookupPhrase(cands.slice(s))
    if (!hit) continue
    if (s === 0) return result(hit, 1, 'exact', key, `Tunnistettu nimi "${cleaned}"`, ctx)
    const dropped = tokens.slice(0, s)
    const neutral = dropped.every((w) => NEUTRAL_MODIFIERS.has(w))
    return result(
      hit,
      neutral ? 0.95 : 0.85,
      neutral ? 'alias' : 'modifier-dropped',
      key,
      `Tunnistettu "${tokens.slice(s).join(' ')}" (ohitettu: ${dropped.join(' ')})`,
      ctx,
    )
  }

  // 3. compound head of the head word ("kirsikkatomaatti" -> tomaatti)
  const compoundResult = (t: number) => {
    const comp = matchCompound(tokens[t])
    if (!comp) return null
    const conf = (comp.formOf ? 0.85 : 0.8) - (n - 1 - t) * 0.1
    const how = comp.formOf
      ? `Yhdyssanan alkuosa "${comp.via}" (${comp.formOf})`
      : `Yhdyssanan perusosa "${comp.via}" sanasta "${tokens[t]}"`
    return result(comp.ing, conf, 'compound-head', key, how, ctx)
  }
  const headCompound = compoundResult(n - 1)
  if (headCompound) return headCompound

  // 3b. a window that does not end at the head word (trailing descriptor we did not strip)
  for (let e = n - 2; e >= 0; e--) {
    for (let s = 0; s <= e; s++) {
      const hit = lookupPhrase(cands.slice(s, e + 1))
      if (hit) return result(hit, 0.7, 'modifier-dropped', key, `Tunnistettu "${tokens.slice(s, e + 1).join(' ')}"`, ctx)
    }
  }

  // 3c. compound heads of earlier words
  for (let t = n - 2; t >= 0; t--) {
    const r = compoundResult(t)
    if (r) return r
  }

  // 4. direct Fineli search – Fineli is the master data
  if (ctx.fineli) {
    const found = searchFineli(ctx.fineli, cleaned)
    const fineliMatch = (f: FoodSearchResult): IngredientMatch => ({
      canonicalId: null,
      fineliId: f.food.id,
      confidence: round2(f.score),
      method: 'fineli-search',
      key,
      explanation: `Ei sanakirjassa; lähin Fineli-elintarvike nimen perusteella → ${f.food.fi}.`,
    })
    // A likely Fineli food (the ingredient is its main name or a whole name part) always wins.
    if (found && found.tier !== 'word') return fineliMatch(found)
    // 5. nothing suitable in Fineli: the supplementary databases
    const supp = searchSupplementary(ctx.fineli, cleaned)
    if (supp && (!found || supp.tier !== 'word')) {
      return {
        canonicalId: null,
        fineliId: supp.food.id,
        confidence: round2(supp.score),
        method: 'supplementary-search',
        key,
        explanation: `Finelistä ei löytynyt sopivaa elintarviketta; lähin vastine täydentävästä aineistosta (${foodSourceLabel(supp.food)}) → ${supp.food.fi}.`,
      }
    }
    if (found) return fineliMatch(found)
  }

  return {
    canonicalId: null,
    fineliId: null,
    confidence: 0,
    method: 'none',
    key,
    explanation: `Ainesosalle "${cleaned}" ei löytynyt vastinetta. Valitse vastaavuus käsin.`,
  }
}
