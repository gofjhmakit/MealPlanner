/**
 * Automatic meal planning ("Suunnittele puolestani").
 *
 * For every day and meal slot the planner picks a recipe that satisfies the user's answers
 * (diet, special diets, time limits, ingredients to avoid, an optional per-person daily calorie
 * maximum) and scores the candidates (favourites, own ratings, own collection, ingredients to use
 * up, variety of main protein, a little randomness). With "leftovers" on, dinner is cooked with
 * extra portions and eaten again as the next day's lunch.
 *
 * Pure and deterministic for a given seed, so plans can be regenerated and tested.
 */
import { addDays, parseISODate } from './dates'
import { getIngredient } from './ingredients'
import type { FineliLookup } from './matcher'
import { computeRecipeNutrition } from './nutrition'
import { matchesQuery, recipeDiet, recipeSpecialDiets, recipeTime, searchText } from './recipeInfo'
import { isMealComponent } from './recipeType'
import type { MealSlot, Recipe } from './types'

export interface PlanOptions {
  dates: string[]
  slots: MealSlot[]
  people: number
  /** Cook dinner with extra portions and eat them as the next day's lunch. */
  leftovers: boolean
  diet: 'all' | 'vegetarian' | 'vegan'
  glutenFree: boolean
  milkFree: boolean
  lactoseFree: boolean
  maxTimeWeekday: number | null
  maxTimeWeekend: number | null
  /** Maximum energy per person per day (kcal); null = no limit. */
  maxKcalPerDay: number | null
  includeCatalogue: boolean
  preferFavourites: boolean
  /** Ingredient words to use up (preferred) and to avoid (excluded). */
  use: string[]
  avoid: string[]
  avoidRepeats: boolean
  /** Slots that already have meals and must be left alone ("date|slot"). */
  occupied: Set<string>
  /** Recipes already on the menu around these dates: not repeated while others fit. */
  alreadyPlanned?: string[]
  seed: number
}

export interface PlannedMeal {
  date: string
  slot: MealSlot
  recipeId: string
  servings: number
  extraServings: number
  /** Set on a leftover meal: the (date, slot) whose extra portions are eaten. */
  leftoverOf: { date: string; slot: MealSlot } | null
  kcalPerServing: number
}

export interface PlanResult {
  meals: PlannedMeal[]
  /** Per-person energy per day (kcal) of the planned meals. */
  kcalByDay: Record<string, number>
  warnings: string[]
}

type Kind = 'breakfast' | 'snack' | 'main'

export interface Candidate {
  recipe: Recipe
  kinds: Set<Kind>
  kcal: number
  time: number | null
  protein: string
  diet: ReturnType<typeof recipeDiet>
  special: ReturnType<typeof recipeSpecialDiets>
  text: string
  favourite: boolean
}

/** Share of the daily calorie maximum each slot aims for (normalized over the planned slots). */
const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.22, lunch: 0.3, dinner: 0.35, snack: 0.13, other: 0.1 }

const BREAKFAST_RE = /aamiai|aamupala|puuro|velli|munakas|mysli|granola|smoothie|jogurt|pannukak|ruisleipä ja/i
const SNACK_RE = /välipala|smoothie|rahka|pirtelö|jogurt|marjarahka/i
const MAIN_RE = /pääruo|keitto|salaat|liharuo|kalaruo|kasvisruo|kasvikset, kasvisruoat|broiler|pasta|laatikko|wokki|curry|kurry|pata|uuniruo|perunat|kananmunat|pihvi|lasagne|kastike|tortilla|pizza|risotto|lohi|jauheliha|makkara|keitot/i
/** Titles that are components, not meals (dressings, marinades, spreads). */
const NOT_MAIN_TITLE_RE = /vinegret|vinaigrette|marinadi|kastike$|dippi|levite|hillo|mausteseos|kastikepohja/i
const NOT_MAIN_RE = /jälkiruo|leivonnai|kakku|pulla|keksi|leipä|leivät|juoma|hedelmä- ja marjaruoat|rasva ja rasvavalmisteet|kastike, |kastikkeet|lisuke|dippi|dipit|säilyke|vinegret|vinaigrette|marinadi|kastike$/i

function kindsOf(r: Recipe): Set<Kind> {
  const text = `${r.title} ${r.category ?? ''} ${r.tags.join(' ')}`
  const kinds = new Set<Kind>()
  if (isMealComponent(r)) return kinds // stocks, spice mixes, doughs … are never a meal on their own
  if (BREAKFAST_RE.test(text)) kinds.add('breakfast')
  if (SNACK_RE.test(text)) kinds.add('snack')
  if (MAIN_RE.test(text) && !NOT_MAIN_RE.test(r.category ?? '') && !NOT_MAIN_TITLE_RE.test(r.title) && !kinds.has('breakfast')) kinds.add('main')
  return kinds
}

/** Main protein group, used to avoid e.g. chicken two meals in a row. */
function proteinOf(r: Recipe): string {
  const groups: [RegExp, string][] = [
    [/chicken|turkey/, 'poultry'],
    [/beef|mince|reindeer|moose|lamb/, 'red-meat'],
    [/pork|bacon|ham|sausage|chorizo|salami|hot-dog/, 'pork'],
    [/salmon|trout|fish|tuna|shrimp|herring|vendace|mussel|anchovy/, 'fish'],
    [/lentil|chickpea|bean|tofu|plant-mince|soy-mince|pulled-oats|quorn/, 'legumes'],
    [/egg/, 'egg'],
  ]
  for (const ing of r.ingredients) {
    const id = getIngredient(ing.canonicalId)?.id ?? ''
    const hit = groups.find(([re]) => re.test(id))
    if (hit) return hit[1]
  }
  return 'other'
}

export function buildCandidates(recipes: Recipe[], lookup: FineliLookup, favourites: Set<string>, kcalOf?: (r: Recipe) => number): Candidate[] {
  return recipes.map((recipe) => ({
    recipe,
    kinds: kindsOf(recipe),
    kcal: kcalOf ? kcalOf(recipe) : computeRecipeNutrition(recipe, lookup).perServing.energyKcal,
    time: recipeTime(recipe),
    protein: proteinOf(recipe),
    diet: recipeDiet(recipe, lookup),
    special: recipeSpecialDiets(recipe, lookup),
    text: searchText(recipe),
    favourite: favourites.has(recipe.id),
  }))
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isWeekend(date: string): boolean {
  const d = parseISODate(date).getDay()
  return d === 0 || d === 6
}

function slotKind(slot: MealSlot): Kind {
  return slot === 'breakfast' ? 'breakfast' : slot === 'snack' ? 'snack' : 'main'
}

interface PickContext {
  opts: PlanOptions
  candidates: Candidate[]
  used: Map<string, number>
  random: () => number
}

type Relax = 'none' | 'kcal' | 'time' | 'repeat'

function eligible(c: Candidate, opts: PlanOptions, kind: Kind, date: string, budget: number | null, used: Map<string, number>, relax: Relax[]): boolean {
  if (!c.kinds.has(kind)) return false
  if (!opts.includeCatalogue && !c.recipe.inCollection) return false
  if ((c.recipe.rating ?? 3) <= 2) return false
  if (c.kcal <= 0 || c.kcal > 1600) return false // >1 600 kcal per serving is almost always a matching error
  if (kind === 'main' && c.kcal < 180) return false // side dishes are not a meal on their own
  if (opts.diet === 'vegan' && c.diet !== 'vegan') return false
  if (opts.diet === 'vegetarian' && c.diet !== 'vegan' && c.diet !== 'vegetarian') return false
  if (opts.glutenFree && !c.special.glutenFree) return false
  if (opts.milkFree && !c.special.milkFree) return false
  if (opts.lactoseFree && !c.special.lactoseFree) return false
  if (opts.avoid.some((w) => matchesQuery(c.text, w))) return false
  const limit = isWeekend(date) ? opts.maxTimeWeekend : opts.maxTimeWeekday
  if (limit && !relax.includes('time') && c.time !== null && c.time > limit) return false
  if (budget !== null && !relax.includes('kcal') && c.kcal > budget) return false
  if (opts.avoidRepeats && !relax.includes('repeat') && used.has(c.recipe.id)) return false
  return true
}

function score(c: Candidate, ctx: PickContext, date: string, avoidProtein: Set<string>, budget: number | null): number {
  const { opts } = ctx
  let s = ctx.random() * 0.8
  if (c.recipe.inCollection) s += 0.35
  if (opts.preferFavourites && c.favourite) s += 0.6
  if (c.recipe.rating) s += (c.recipe.rating - 3) * 0.3
  if (c.recipe.instructions.length === 0) s -= 0.25 // catalogue dishes without instructions
  const useHits = opts.use.filter((w) => matchesQuery(c.text, w)).length
  s += Math.min(1.5, useHits * 0.75)
  if (avoidProtein.has(c.protein) && c.protein !== 'other') s -= 0.45
  s -= (ctx.used.get(c.recipe.id) ?? 0) * 0.8
  const limit = isWeekend(date) ? opts.maxTimeWeekend : opts.maxTimeWeekday
  if (limit && c.time === null) s -= 0.15
  // With a calorie budget, prefer meals that use a good part of it (not tiny snacks as dinner).
  if (budget) s -= Math.abs(1 - Math.min(c.kcal, budget * 1.2) / budget) * 0.5
  return s
}

function pick(ctx: PickContext, kind: Kind, date: string, budget: number | null, avoidProtein: Set<string>): { c: Candidate; relaxed: Relax[] } | null {
  const steps: Relax[][] = [[], ['repeat'], ['repeat', 'time'], ['repeat', 'time', 'kcal']]
  for (const relax of steps) {
    const pool = ctx.candidates.filter((c) => eligible(c, ctx.opts, kind, date, budget, ctx.used, relax))
    if (pool.length === 0) continue
    let best = pool[0]
    let bestScore = -Infinity
    for (const c of pool) {
      const sc = score(c, ctx, date, avoidProtein, budget)
      if (sc > bestScore) {
        best = c
        bestScore = sc
      }
    }
    return { c: best, relaxed: relax }
  }
  return null
}

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']

export function planMeals(candidates: Candidate[], opts: PlanOptions): PlanResult {
  const used = new Map<string, number>()
  for (const id of opts.alreadyPlanned ?? []) used.set(id, (used.get(id) ?? 0) + 1)
  const ctx: PickContext = { opts, candidates, used, random: rng(opts.seed) }
  const meals: PlannedMeal[] = []
  const warnings: string[] = []
  const kcalByDay: Record<string, number> = {}
  const slots = SLOT_ORDER.filter((s) => opts.slots.includes(s))
  const shareSum = slots.reduce((a, s) => a + SLOT_SHARE[s], 0)
  const leftoverMode = opts.leftovers && slots.includes('lunch') && slots.includes('dinner')
  const dates = [...opts.dates].sort()
  const relaxNotes = new Set<string>()
  let prevProteins = new Set<string>()

  for (const date of dates) {
    const dayProteins = new Set<string>()
    let dayKcal = 0
    // Leftover lunch from yesterday's dinner is fixed before anything else is picked.
    const yesterdayDinner = leftoverMode ? meals.find((m) => m.date === addDays(date, -1) && m.slot === 'dinner') : undefined
    for (const slot of slots) {
      if (opts.occupied.has(`${date}|${slot}`)) continue
      if (slot === 'lunch' && yesterdayDinner && dates.includes(date)) {
        yesterdayDinner.extraServings = opts.people
        meals.push({
          date, slot, recipeId: yesterdayDinner.recipeId, servings: opts.people, extraServings: 0,
          leftoverOf: { date: yesterdayDinner.date, slot: 'dinner' }, kcalPerServing: yesterdayDinner.kcalPerServing,
        })
        dayKcal += yesterdayDinner.kcalPerServing
        continue
      }
      let budget: number | null = null
      if (opts.maxKcalPerDay) {
        // Remaining budget spread over the remaining slots of the day, weighted by slot share.
        const remainingSlots = slots.slice(slots.indexOf(slot))
        const remainingShare = remainingSlots.reduce((a, s) => a + SLOT_SHARE[s], 0)
        const remaining = Math.max(0, opts.maxKcalPerDay - dayKcal)
        budget = remaining * (SLOT_SHARE[slot] / remainingShare) * 1.1
        // Tomorrow's lunch will be this dinner again: it must also fit a lunch share.
        if (slot === 'dinner' && leftoverMode && dates.includes(addDays(date, 1))) {
          budget = Math.min(budget, opts.maxKcalPerDay * (SLOT_SHARE.lunch / shareSum) * 1.15)
        }
      }
      const avoidProtein = new Set([...dayProteins, ...(slot === 'lunch' || slot === 'dinner' ? prevProteins : [])])
      const chosen = pick(ctx, slotKind(slot), date, budget, avoidProtein)
      if (!chosen) {
        warnings.push(`${date} ${slot}: ei sopivaa reseptiä valituilla ehdoilla.`)
        continue
      }
      for (const r of chosen.relaxed) relaxNotes.add(r)
      ctx.used.set(chosen.c.recipe.id, (ctx.used.get(chosen.c.recipe.id) ?? 0) + 1)
      if (slotKind(slot) === 'main') dayProteins.add(chosen.c.protein)
      dayKcal += chosen.c.kcal
      meals.push({ date, slot, recipeId: chosen.c.recipe.id, servings: opts.people, extraServings: 0, leftoverOf: null, kcalPerServing: chosen.c.kcal })
    }
    kcalByDay[date] = Math.round(dayKcal)
    prevProteins = dayProteins
    if (opts.maxKcalPerDay && dayKcal > opts.maxKcalPerDay * 1.03) {
      warnings.push(`${date}: arvio ${Math.round(dayKcal)} kcal ylittää tavoitteen ${opts.maxKcalPerDay} kcal – sopivia kevyempiä reseptejä ei löytynyt tarpeeksi.`)
    }
  }
  if (relaxNotes.has('repeat')) warnings.push('Reseptejä ei riittänyt ilman toistoa – osa resepteistä toistuu. Lisää reseptejä tai salli katalogi.')
  if (relaxNotes.has('time')) warnings.push('Kaikkiin aterioihin ei löytynyt tarpeeksi nopeita reseptejä – osa ylittää aikarajan.')
  if (relaxNotes.has('kcal')) warnings.push('Kaikkiin aterioihin ei löytynyt kalorirajaan mahtuvaa reseptiä.')
  return { meals, kcalByDay, warnings }
}

/** Replace one planned meal with another candidate (keeps a linked leftover meal in sync). */
export function rerollMeal(result: PlanResult, candidates: Candidate[], opts: PlanOptions, date: string, slot: MealSlot, seed: number): PlanResult {
  const meals = result.meals.map((m) => ({ ...m }))
  const target = meals.find((m) => m.date === date && m.slot === slot)
  if (!target) return result
  const source = target.leftoverOf ? meals.find((m) => m.date === target.leftoverOf!.date && m.slot === target.leftoverOf!.slot) : target
  if (!source) return result
  const used = new Map<string, number>()
  for (const m of meals) if (!m.leftoverOf) used.set(m.recipeId, (used.get(m.recipeId) ?? 0) + 1)
  const ctx: PickContext = { opts, candidates: candidates.filter((c) => c.recipe.id !== source.recipeId), used, random: rng(seed) }
  const dayOthers = meals.filter((m) => m.date === source.date && m !== source).reduce((a, m) => a + m.kcalPerServing, 0)
  const budget = opts.maxKcalPerDay ? Math.max(150, opts.maxKcalPerDay - dayOthers) : null
  const chosen = pick(ctx, slotKind(source.slot), source.date, budget, new Set())
  if (!chosen) return result
  for (const m of meals) {
    if (m === source || (m.leftoverOf && m.leftoverOf.date === source.date && m.leftoverOf.slot === source.slot)) {
      m.recipeId = chosen.c.recipe.id
      m.kcalPerServing = chosen.c.kcal
    }
  }
  const kcalByDay: Record<string, number> = {}
  for (const m of meals) kcalByDay[m.date] = Math.round((kcalByDay[m.date] ?? 0) + m.kcalPerServing)
  return { ...result, meals, kcalByDay }
}

/** Options for quick planning from the UI (suggestions, swaps, "fill empty slots"). */
export function quickPlanOptions(o: { dates: string[]; slots?: MealSlot[]; people: number; maxKcalPerDay: number | null; occupied?: Set<string>; seed?: number }): PlanOptions {
  return {
    dates: o.dates,
    slots: o.slots ?? ['breakfast', 'lunch', 'dinner'],
    people: o.people,
    leftovers: false,
    diet: 'all',
    glutenFree: false,
    milkFree: false,
    lactoseFree: false,
    // Quick suggestions stay practical; the planner relaxes these when nothing else fits.
    maxTimeWeekday: 60,
    maxTimeWeekend: 120,
    maxKcalPerDay: o.maxKcalPerDay,
    includeCatalogue: true,
    preferFavourites: true,
    use: [],
    avoid: [],
    avoidRepeats: true,
    occupied: o.occupied ?? new Set(),
    seed: o.seed ?? 1,
  }
}

/**
 * The best few recipes for one slot: fit the slot, stay within `budget` kcal per person when given
 * (aiming to use most of it), and skip `exclude`d recipes. Used for empty-slot suggestions and swaps.
 */
export function suggestForSlot(candidates: Candidate[], opts: PlanOptions, date: string, slot: MealSlot, budget: number | null, exclude: Set<string>, count = 3): Candidate[] {
  const used = new Map([...exclude].map((id) => [id, 1]))
  const ctx: PickContext = { opts, candidates, used, random: rng(opts.seed) }
  const kind = slotKind(slot)
  const steps: Relax[][] = [[], ['time'], ['time', 'kcal']]
  for (const relax of steps) {
    const pool = candidates.filter((c) => !exclude.has(c.recipe.id) && eligible(c, opts, kind, date, budget, used, relax))
    if (pool.length < count && relax.length < 2) continue
    return pool
      .map((c) => ({ c, s: score(c, ctx, date, new Set(), budget) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, count)
      .map((x) => x.c)
  }
  return []
}

/** Share of a day's energy each main slot is planned for (breakfast, lunch, dinner, snack). */
export function slotShare(slot: MealSlot): number {
  return SLOT_SHARE[slot]
}
