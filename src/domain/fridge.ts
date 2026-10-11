/**
 * "Mitä kaapista?": which recipes can be made from what is at home. The user lists what they have
 * ("riisi, jauheliha, pakasteherne"); a recipe line counts as had when it names one of those words
 * (Finnish forms and compounds both ways: "nuudelit" ↔ "riisinuudeleita", "pakasteherne" ↔ "herneitä")
 * or is the same dictionary ingredient. Water, salt, pepper, oil, dried spices and the user's
 * always-at-home list are assumed to be there and don't count either way.
 */
import { wordForms } from './allergies'
import { lemmaCandidates } from './finnish'
import { getIngredient } from './ingredients'
import { matchIngredient, type FineliLookup } from './matcher'
import { isMealComponent } from './recipeType'
import type { Recipe, RecipeIngredient } from './types'

/** Assumed to be in every kitchen. */
const BASICS_RE = /^(vesi|vettä|kylmä vesi|kuuma vesi|suola|merisuola|sormisuola|(musta|valko)?pippuri|rypsiöljy|öljy|ruokaöljy|oliiviöljy|sokeri)$|mauste|jauhettu|kuivattu|kaneli|kumina|kurkuma|currya|curryjauhe|paprikajauhe|chilijauhe|chilihiutale|cayenne|oregano|timjami|laakerinlehti|muskotti|neilikka|kardemumma|valkosipulijauhe|sipulijauhe|liemikuutio|liemijauhe/

/** Sauces, pastes, onion, garlic and herbs: needed, but easy to swap or usually at hand – listed, not counted. */
const MINOR_RE = /^(sipuli|keltasipuli|punasipuli|salottisipuli|valkosipuli|valkosipulinkynsi|kevätsipuli|persilja|lehtipersilja|korianteri|basilika|tilli|ruohosipuli|minttu|sitruunamehu|limetinmehu|sitruuna|limetti|inkivääri)$|kastike|tahna|.pasta$|ketsuppi|sinappi|etikka|majoneesi|hunaja|siirappi/

const MIN_COVERAGE = 0.8

/** Words that say how the thing is kept, not what it is: "pakasteherne" is herne. */
const KEPT_AS = ['pakaste', 'tuore', 'kuivattu', 'kuiva', 'säilyke', 'luomu', 'kevyt', 'rasvaton', 'jäädytetty', 'keitetty', 'valmis']

/** The typed word as a whole recipe word or a compound's last part, give or take an ending: riisi ⊂ jasmiiniriisiä, not riisiviiniä. */
function names(words: string[], forms: string[]): boolean {
  return words.some((h) =>
    forms.some((f) => {
      const at = h.lastIndexOf(f)
      return at >= 0 && h.length - (at + f.length) <= 3 && (at === 0 || f.length >= 4)
    }),
  )
}

const lemmaCache = new Map<string, string[]>()
function lemmas(word: string): string[] {
  let l = lemmaCache.get(word)
  if (!l) {
    l = lemmaCandidates(word)
    if (lemmaCache.size > 50000) lemmaCache.clear()
    lemmaCache.set(word, l)
  }
  return l
}

export interface FridgeMatch {
  recipe: Recipe
  /** Lines the user has (display names). */
  have: string[]
  /** Main lines the user doesn't have. */
  missing: string[]
  /** Sauces, onion, herbs … the recipe also uses (not counted in the coverage). */
  also: string[]
  /** How many of the user's words the recipe uses. */
  used: number
  coverage: number
}

interface Need {
  ing: RecipeIngredient
  words: string[]
  minor: boolean
}

function needsOf(recipe: Recipe, isBasic: (ing: RecipeIngredient) => boolean): Need[] {
  return recipe.ingredients
    .filter((ing) => !ing.optional && !/:$/.test(ing.raw) && !isBasic(ing))
    .map((ing) => {
      const canonical = getIngredient(ing.canonicalId)
      const name = displayName(ing).toLowerCase()
      const text = `${ing.name} ${canonical?.fi ?? ''}`.toLowerCase()
      const minor = canonical?.category === 'spices_sauces' || MINOR_RE.test(name) || MINOR_RE.test(ing.name.toLowerCase())
      return { ing, minor, words: [...new Set(text.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3).flatMap((w) => lemmas(w)))] }
    })
}

const needsCache = new WeakMap<Recipe, { key: string; needs: Need[] }>()
function cachedNeeds(recipe: Recipe, pantryKey: string, isBasic: (ing: RecipeIngredient) => boolean): Need[] {
  const hit = needsCache.get(recipe)
  if (hit?.key === pantryKey) return hit.needs
  const needs = needsOf(recipe, isBasic)
  needsCache.set(recipe, { key: pantryKey, needs })
  return needs
}

export function displayName(ing: RecipeIngredient): string {
  return getIngredient(ing.canonicalId)?.fi ?? ing.name
}

/** Recipes the listed things make: full matches first, then ones missing at most a fifth. */
export function fridgeMatches(recipes: Recipe[], typed: string[], o: { pantry: string[]; lookup?: FineliLookup }): { full: FridgeMatch[]; near: FridgeMatch[] } {
  const items = typed.map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (!items.length) return { full: [], near: [] }
  const user = items.map((word) => {
    const m = matchIngredient(word, { fineli: o.lookup })
    return { word, forms: wordForms(word), canonical: m.confidence >= 0.5 ? m.canonicalId : null, lemmas: lemmas(word) }
  })
  const pantry = new Set(o.pantry.map((p) => p.trim().toLowerCase()))
  const isBasic = (ing: RecipeIngredient) => {
    const canonical = getIngredient(ing.canonicalId)
    const names = [ing.name.toLowerCase(), ...(canonical ? [canonical.fi.toLowerCase(), ...canonical.aliases] : [])]
    return names.some((n) => BASICS_RE.test(n) || pantry.has(n))
  }
  const pantryKey = [...pantry].join(',')
  const hits = (need: Need, u: (typeof user)[number]) =>
    (!!u.canonical && need.ing.canonicalId === u.canonical) ||
    names(need.words, u.forms) ||
    // "pakasteherne" is herne: what the user typed, minus a word for how it's kept.
    KEPT_AS.some((k) => u.word.startsWith(k) && u.word.length - k.length >= 4 && names(need.words, wordForms(u.word.slice(k.length))))

  const results: FridgeMatch[] = []
  for (const recipe of recipes) {
    if (recipe.sourceId === 'fineli' || !recipe.instructions.length || isMealComponent(recipe)) continue
    const all = cachedNeeds(recipe, pantryKey, isBasic)
    const needs = all.filter((n) => !n.minor || all.every((x) => x.minor))
    const minors = all.filter((n) => !needs.includes(n))
    if (needs.length < 2) continue
    const usedBy = needs.map((n) => user.filter((u) => hits(n, u)))
    const have = needs.filter((_, i) => usedBy[i].length > 0)
    const used = new Set(usedBy.flat().map((u) => u.word)).size
    const coverage = have.length / needs.length
    const missing = needs.length - have.length
    if (used < Math.min(2, items.length)) continue
    if (coverage < MIN_COVERAGE && !(missing === 1 && needs.length >= 4)) continue
    results.push({
      recipe,
      have: [...new Set(have.map((n) => displayName(n.ing)))],
      missing: [...new Set(needs.filter((_, i) => usedBy[i].length === 0).map((n) => displayName(n.ing)))],
      also: [...new Set(minors.filter((n) => !user.some((u) => hits(n, u))).map((n) => displayName(n.ing)))],
      used,
      coverage,
    })
  }
  const order = (a: FridgeMatch, b: FridgeMatch) => b.coverage - a.coverage || b.used - a.used || (b.recipe.rating ?? 3) - (a.recipe.rating ?? 3) || a.recipe.title.localeCompare(b.recipe.title, 'fi')
  return { full: results.filter((r) => r.coverage === 1).sort(order), near: results.filter((r) => r.coverage < 1).sort(order) }
}
