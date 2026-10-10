import { describe, expect, it } from 'vitest'
import { buildRecipeIngredient } from '../src/domain/recipeIngredients'
import { computeRecipeNutrition, resolveGrams } from '../src/domain/nutrition'
import { getIngredient } from '../src/domain/ingredients'
import { canonicalFood } from '../src/domain/matcher'
import { fullFoodLookup } from './helpers'

const lookup = fullFoodLookup()
function grams(line: string) {
  const ing = buildRecipeIngredient(line, { fineli: lookup })
  const c = getIngredient(ing.canonicalId)
  const fid = ing.fineliId ?? (c ? canonicalFood(c, lookup).fineliId : null)
  return { id: ing.canonicalId, grams: resolveGrams(ing, c, fid != null ? lookup.get(fid) : undefined).grams }
}

describe('pieces of an animal are not the whole animal', () => {
  it.each([
    ['24 broilerin siipeä', 'chicken-wing', 1000, 3000],
    ['8 broilerin reisifilettä', 'chicken-thigh', 600, 1600],
    ['4 broilerin koipireittä', 'chicken-thigh', 400, 1200],
    ['4 broilerin rintaa ilman nahkaa', 'chicken-breast', 400, 1000],
    ['4 paksua ribeye-pihviä', 'beef-steak', 600, 1200],
    ['4 paksua possun kylkiluupihviä', 'pork-chop', 500, 1200],
    ['4 turskan, koljan tai merikrotin fileetä', 'white-fish', 400, 900],
    ['2 pak choita', 'pak-choi', 200, 500],
  ])('%s', (line, id, min, max) => {
    const r = grams(line)
    expect(r.id).toBe(id)
    expect(r.grams).toBeGreaterThanOrEqual(min)
    expect(r.grams).toBeLessThanOrEqual(max)
  })

  it('still knows a whole chicken and a whole fillet', () => {
    expect(grams('1 grillattu broileri')).toMatchObject({ id: 'chicken-whole', grams: 1200 })
    expect(grams('1 naudan ulkofilee (n. 1,5 kg)')).toMatchObject({ id: 'beef-fillet', grams: 1500 })
  })
})

describe('deep-frying oil', () => {
  const recipe = (lines: string[]) => ({ servings: 4, ingredients: lines.map((l, i) => ({ ...buildRecipeIngredient(l, { fineli: lookup }), id: String(i) })) })
  it('counts only the absorbed share of frying oil', () => {
    const fried = computeRecipeNutrition(recipe(['500 g perunoita', '1 l rypsiöljyä friteeraukseen']), lookup)
    expect(fried.perServing.energyKcal!).toBeGreaterThan(150)
    expect(fried.perServing.energyKcal!).toBeLessThan(500)
  })
  it('keeps normal amounts of oil as they are', () => {
    const r = computeRecipeNutrition(recipe(['2 rkl oliiviöljyä']), lookup)
    expect(r.total.energyKcal!).toBeGreaterThan(200)
  })
})

describe('meal components', async () => {
  const { isMealComponent } = await import('../src/domain/recipeType')
  const r = (title: string, category = '') => ({ title, category, tags: [] as string[] })
  it.each(['Katsu-kastike (tonkatsu-kastike)', 'Meat masala – keralalainen lihamausteseos', 'Chiliöljy', 'Kirkastettu voi', 'Kananluuliemi', 'Pizzataikina', 'Chilijauhe (monichili)'])('%s is a component', (t) => {
    expect(isMealComponent(r(t))).toBe(true)
  })
  it.each([
    ['Spagetti ja pinaattipesto', ''],
    ['Uunikalkkuna ja täyte', ''],
    ['Jasha maroo – bhutanilainen kanaliemi', 'pääruoat'],
    ['Nigerialainen kana-currykastike', 'pääruoat'],
    ['Mummon täyte', 'lisukkeet'],
    ['Lohikeitto', ''],
  ])('%s is a meal', (t, c) => {
    expect(isMealComponent(r(t, c))).toBe(false)
  })
})

describe('step ingredients in compounds', async () => {
  const { ingredientsInStep } = await import('../src/domain/stepIngredients')
  const ings = ['2½ dl kuohukermaa', '2 rkl pikakahvijauhetta', '3 dl vehnäjauhoja', '1 tl suolaa', '1 porkkana'].map((l, i) => ({ ...buildRecipeIngredient(l, { fineli: lookup }), id: String(i) }))
  const raws = (step: string) => ingredientsInStep(step, ings).map((i) => i.raw)
  it('finds the compound word', () => {
    expect(raws('Lämmitä kerma mikrossa.')).toEqual(['2½ dl kuohukermaa'])
    expect(raws('Liuota kahvi veteen.')).toEqual(['2 rkl pikakahvijauhetta'])
    expect(raws('Sekoita jauhot ja suola.')).toEqual(['3 dl vehnäjauhoja', '1 tl suolaa'])
    expect(raws('Ruskista kanaa.')).toEqual([])
  })
})
