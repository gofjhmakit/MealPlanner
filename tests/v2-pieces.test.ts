import { describe, expect, it } from 'vitest'
import { buildRecipeIngredient } from '../src/domain/recipeIngredients'
import { computeRecipeNutrition, resolveGrams } from '../src/domain/nutrition'
import { getIngredient } from '../src/domain/ingredients'
import { canonicalFood } from '../src/domain/matcher'
import { fullFoodLookup } from './helpers'
import { queryRelevance } from '../src/domain/recipeInfo'

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

describe('adjectives listed with commas', () => {
  it.each([
    ['600 g luuttomia, nahallisia broilerin reisifileitä, 2½–3 cm:n paloina', 'chicken-thigh'],
    ['4 luutonta, nahatonta broilerin rintafileetä', 'chicken-breast'],
    ['7 kypsää, pulleaa taatelia', 'date'],
    ['450 g keitettyä, suikaloitua kananlihaa', 'chicken-whole'],
  ])('%s', (line, id) => expect(grams(line).id).toBe(id))
})

describe('cooked rice and pasta', () => {
  it.each([
    ['1 l keitettyä, edellisen päivän jasmiiniriisiä', 'cooked-rice'],
    ['600 g keitettyä basmatiriisiä', 'cooked-rice'],
    ['5 dl keitettyä pientä pastaa', 'cooked-pasta'],
    ['3 dl jasmiiniriisiä', 'rice'],
    ['400 g spagettia, keitettynä', 'pasta'],
  ])('%s', (line, id) => expect(grams(line).id).toBe(id))
})

describe('"rasvaton" alone is not milk', () => {
  it.each(['1 dl rasvatonta maitojauhetta', '1 rkl rasvatonta ranch-kastiketta'])('%s', (line) => expect(grams(line).id).not.toBe('milk-skimmed'))
})

describe('search order', () => {
  const r = (title: string, lines: string[]) =>
    ({ id: title, title, servings: 4, ingredients: lines.map((l) => buildRecipeIngredient(l, { fineli: lookup })), instructions: [], tags: [], origin: 'user', createdAt: '', updatedAt: '' }) as never
  it('a dish named after the word beats one that only contains it', () => {
    const pavlova = r('Pavlova', ['4 kananmunanvalkuaista', '2 dl sokeria'])
    const curry = r('Kanacurry', ['500 g broilerin fileesuikaleita'])
    const soup = r('Kana-nuudelikeitto', ['1 l kanalientä'])
    expect(queryRelevance(soup, 'kana')).toBeGreaterThan(queryRelevance(curry, 'kana'))
    expect(queryRelevance(curry, 'kana')).toBeGreaterThan(queryRelevance(pavlova, 'kana'))
  })
})

describe('suspended compounds with an inflected head', () => {
  it.each([
    ['1 l kana- tai kasvislientä', 'chicken-stock'],
    ['1,2 l naudan- tai vasikanlientä', 'beef-stock'],
    ['1 l kala- tai kasvislientä', 'fish-stock'],
  ])('%s', (line, id) => expect(grams(line).id).toBe(id))
})
