// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MealPlannerDB } from '../src/db/db'
import { syncOpenRecipes, type OpenRecipesIndex } from '../src/db/openRecipes'
import { fineliLookup } from './helpers'

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
    const files = { 'index.json': { version: 'v1', generatedAt: '', sources: [source] }, 'unitools.json': { recipes: [carbonara] } }
    await syncOpenRecipes(db, fakeFetch(files), ctx())
    await db.recipes.delete('unitools-spaghetti-carbonara')
    await syncOpenRecipes(db, fakeFetch(files), ctx())
    expect(await db.recipes.get('unitools-spaghetti-carbonara')).toBeUndefined() // not reloaded: same version

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
})
