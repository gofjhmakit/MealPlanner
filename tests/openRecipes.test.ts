// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MealPlannerDB } from '../src/db/db'
import { loadFineliData } from '../src/db/bootstrap'
import { syncOpenRecipes, type OpenRecipesIndex } from '../src/db/openRecipes'
import { fineliLookup } from './helpers'
import { RECIPE_TYPES, recipeType } from '../src/domain/recipeType'
import { EMPTY_FILTERS, filterRecipes } from '../src/domain/recipeInfo'

let db: MealPlannerDB
let n = 0
beforeEach(() => {
  db = new MealPlannerDB(`open-${n++}`)
})
afterEach(async () => {
  await db.delete()
})

const source = {
  id: 'unitools',
  name: 'UniTools – maailman reseptit',
  homepage: 'https://theunitools.com/en/data',
  license: 'CC BY-SA 4.0',
  attribution: 'UniTools — theunitools.com.',
  changes: 'Suomennettu.',
  file: 'unitools.json',
  count: 2,
  withImage: 1,
}
const carbonara = {
  id: 'unitools-spaghetti-carbonara',
  title: 'Spaghetti carbonara',
  originalTitle: 'Spaghetti carbonara',
  servings: 2,
  category: 'Pääruoat',
  cuisine: 'Italian cuisine',
  tags: ['pasta', 'italialainen'],
  ingredients: ['200 g spagettia', '100 g pancettaa', '3 kananmunan keltuaista', '60 g pecorinojuustoa, raastettuna'],
  instructions: ['Keitä spagetti.', 'Sekoita.'],
  image: { url: 'https://theunitools.com/recipes/spaghetti-carbonara.jpg', credit: 'Amin', license: 'CC BY-SA 4.0' },
  sourceUrl: 'https://theunitools.com/en/recipes/spaghetti-carbonara',
  author: 'UniTools (theunitools.com)',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
}
const soup = { ...carbonara, id: 'unitools-borscht', title: 'Borssikeitto', originalTitle: 'Borscht', image: undefined, servingsEstimated: true, ingredients: ['500 g punajuurta', '1 l lihalientä'] }

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const name = String(url).split('/open-recipes/')[1]
    if (!(name in files)) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(files[name]), { status: 200 })
  }) as typeof fetch
}

const ctx = () => ({ fineli: fineliLookup() })

describe('open recipe catalogue', () => {
  it('loads recipes with full attribution and Finnish ingredient matching', async () => {
    const index: OpenRecipesIndex = { version: 'v1', generatedAt: '', sources: [source] }
    await syncOpenRecipes(db, fakeFetch({ 'index.json': index, 'unitools.json': { recipes: [carbonara, soup] } }), ctx())

    const r = (await db.recipes.get('unitools-spaghetti-carbonara'))!
    expect(r.tags).toContain('tyyppi:ateria')
    expect(r).toMatchObject({ origin: 'catalogue', sourceId: 'unitools', sourceName: source.name, author: 'UniTools (theunitools.com)', imageUrl: carbonara.image.url })
    expect(r.attribution).toMatchObject({ license: 'CC BY-SA 4.0', imageCredit: 'Amin', imageLicense: 'CC BY-SA 4.0', originalTitle: null })
    expect(r.attribution?.changes).toBe('Suomennettu. Muokattu versio on saatavilla samalla CC BY-SA 4.0 -lisenssillä.')
    expect(r.ingredients.find((i) => i.raw.startsWith('200 g'))!.canonicalId).toBe('pasta')
    expect(r.ingredients[0].id).toBe('unitools-spaghetti-carbonara-0')

    const b = (await db.recipes.get('unitools-borscht'))!
    expect(b.attribution?.originalTitle).toBe('Borscht')

    // Only share-alike licences get the share-alike sentence
    const apache = { ...soup, id: 'unitools-x', license: 'Apache-2.0', title: 'X', originalTitle: 'x' }
    const fresh = new MealPlannerDB(`open-apache-${n++}`)
    await syncOpenRecipes(fresh, fakeFetch({ 'index.json': { version: 'v1', generatedAt: '', sources: [source] }, 'unitools.json': { recipes: [apache] } }), ctx())
    const x = (await fresh.recipes.get('unitools-x'))!
    expect(x.attribution).toMatchObject({ changes: 'Suomennettu.', originalTitle: null })
    await fresh.delete()
    expect(b.servingsText).toMatch(/arvio/)
    expect((await db.recipeSources.get('unitools'))?.license).toBe('CC BY-SA 4.0')
  })

  it("keeps the user's collection, notes and rating across dataset updates and drops removed recipes", async () => {
    await syncOpenRecipes(db, fakeFetch({ 'index.json': { version: 'v1', generatedAt: '', sources: [source] }, 'unitools.json': { recipes: [carbonara, soup] } }), ctx())
    await db.recipes.update('unitools-spaghetti-carbonara', { inCollection: true, notes: 'Lisää pippuria', rating: 5 })

    const updated = { ...carbonara, title: 'Carbonara' }
    await syncOpenRecipes(db, fakeFetch({ 'index.json': { version: 'v2', generatedAt: '', sources: [{ ...source, count: 1 }] }, 'unitools.json': { recipes: [updated] } }), ctx())

    const r = (await db.recipes.get('unitools-spaghetti-carbonara'))!
    expect(r).toMatchObject({ title: 'Carbonara', inCollection: true, notes: 'Lisää pippuria', rating: 5 })
    expect(await db.recipes.get('unitools-borscht')).toBeUndefined()
  })

  it('skips work when the version is unchanged and tolerates a missing catalogue', async () => {
    const files = { 'index.json': { version: 'v1', generatedAt: '', sources: [{ ...source, count: 1 }] }, 'unitools.json': { recipes: [carbonara] } }
    await syncOpenRecipes(db, fakeFetch(files), ctx())
    await db.recipes.update('unitools-spaghetti-carbonara', { title: 'koskematon' })
    await syncOpenRecipes(db, fakeFetch(files), ctx())
    expect((await db.recipes.get('unitools-spaghetti-carbonara'))!.title).toBe('koskematon') // not reloaded: same version, nothing missing

    const fresh = new MealPlannerDB(`open-missing-${n++}`)
    expect(await syncOpenRecipes(fresh, fakeFetch({}), ctx())).toBeNull()
    await fresh.delete()
  })

  it('retries a partial load (a source file failed) on the next start', async () => {
    const index = { version: 'v1', generatedAt: '', sources: [source] }
    await syncOpenRecipes(db, fakeFetch({ 'index.json': index }), ctx())
    expect(await db.recipes.count()).toBe(0)
    await syncOpenRecipes(db, fakeFetch({ 'index.json': index, 'unitools.json': { recipes: [carbonara] } }), ctx())
    expect(await db.recipes.count()).toBe(1)
  })

  it('reloading Fineli keeps open recipes, and missing recipes are restored even when the version is unchanged', async () => {
    const files = { 'index.json': { version: 'v1', generatedAt: '', sources: [{ ...source, count: 2 }] }, 'unitools.json': { recipes: [carbonara, soup] } }
    await syncOpenRecipes(db, fakeFetch(files), ctx())

    // Fineli reload (Settings button) must only refresh Fineli dishes
    const fineliFiles: Record<string, string> = {
      'fineli-meta.json': readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'fineli-meta.json'), 'utf8'),
      'fineli-foods.json': readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'fineli-foods.json'), 'utf8'),
      'fineli-dishes.json': readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'fineli-dishes.json'), 'utf8'),
    }
    const fineliFetch = (async (url: string) => new Response(fineliFiles[String(url).split('/').pop()!] ?? 'x', { status: String(url).split('/').pop()! in fineliFiles ? 200 : 404 })) as typeof fetch
    await loadFineliData(db, fineliFetch, () => {}, true)
    expect(await db.recipes.where('sourceId').equals('unitools').count()).toBe(2)
    expect(await db.recipes.where('sourceId').equals('fineli').count()).toBeGreaterThan(1000)
    const fineliRecipes = await db.recipes.where('sourceId').equals('fineli').toArray()
    expect(fineliRecipes.every((recipe) => recipe.tags.some((tag) => tag.startsWith('tyyppi:')))).toBe(true)

    // Recipes lost some other way come back on the next start despite the same version
    await db.recipes.delete('unitools-borscht')
    await syncOpenRecipes(db, fakeFetch(files), ctx())
    expect(await db.recipes.get('unitools-borscht')).toBeDefined()

    // force reloads regardless
    await db.recipes.update('unitools-borscht', { title: 'muutettu' })
    await syncOpenRecipes(db, fakeFetch(files), ctx(), () => {}, true)
    expect((await db.recipes.get('unitools-borscht'))!.title).toBe('Borssikeitto')
  }, 30000)
})

describe('recipe purpose filters', () => {
  it('classifies all catalogue recipes, including older records without purpose tags', () => {
    const files = ['kitchengadget', 'myplate', 'unitools', 'forkrecipe', 'wikibooks', 'recipearchive', 'openrecipeproject']
    for (const file of files) {
      const records = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'open-recipes', `${file}.json`), 'utf8')).recipes as { title: string; category: string; tags: string[] }[]
      expect(records.length).toBeGreaterThan(0)
      expect(records.every((r) => r.tags.filter((tag) => tag.startsWith('tyyppi:')).length === 1 && recipeType(r) in RECIPE_TYPES)).toBe(true)
    }
    expect(recipeType({ title: 'Falafelit yrttikastikkeella', category: 'Pääruoat', tags: [] })).toBe('ateria')
    expect(recipeType({ title: 'Ruskea kastike', category: 'Kastikkeet ja dipit', tags: [] })).toBe('kastike')
    expect(recipeType({ title: 'Mustikkakiisseli', category: 'Maitojälkiruoat', tags: [] })).toBe('jalkiruoka')
    expect(recipeType({ title: 'Sitruunalimonadi', category: 'Juomat', tags: [] })).toBe('juoma')
    expect(recipeType({ title: 'Ruispuuro', category: 'Vilja ja leivontatuotteet', tags: ['puuro'] })).toBe('aamiainen')
    expect(recipeType({ title: 'Ruisleipä', category: 'Vilja ja leivontatuotteet', tags: ['leipä, ruis-'] })).toBe('leivonnainen')
  })

  it('filters by purpose alongside existing search criteria', async () => {
    const index: OpenRecipesIndex = { version: 'v1', generatedAt: '', sources: [source] }
    const sauce = { ...soup, id: 'unitools-sauce', title: 'Ruskea kastike', category: 'Kastikkeet ja dipit' }
    await syncOpenRecipes(db, fakeFetch({ 'index.json': index, 'unitools.json': { recipes: [carbonara, sauce] } }), ctx())
    const recipes = await db.recipes.toArray()
    const context = { lookup: fineliLookup(), pantry: [], nutritionCache: new Map() }
    expect(filterRecipes(recipes, { ...EMPTY_FILTERS, type: 'kastike' }, context).map((r) => r.id)).toEqual(['unitools-sauce'])
    expect(filterRecipes(recipes, { ...EMPTY_FILTERS, type: 'kastike', query: 'carbonara' }, context)).toEqual([])
  })
})
