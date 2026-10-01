/**
 * First-start / upgrade routine.
 *   1. make sure the default meal plan and recipe sources exist
 *   2. load the Fineli dataset into IndexedDB if it is missing or a newer one was imported
 *   3. (re)build the Fineli dish catalogue
 *   4. add development seed recipes on first start
 *   5. load the translated open recipe catalogue (openRecipes.ts) when a newer one was built
 * After this the app works fully offline.
 */
import type { FineliLookup } from '../domain/matcher'
import { productMatchIndex, productToFood, type ProductMatchEntry } from '../domain/products'
import type { FineliDish, FineliFood, Product, RecipeSource } from '../domain/types'
import { ADAPTERS } from '../import/adapters'
import { buildFineliCatalogue, FINELI_SOURCE } from './catalogue'
import { db as defaultDb, DEFAULT_PLAN_ID, getSetting, setSetting, type MealPlannerDB } from './db'
import { syncOpenRecipes } from './openRecipes'
import { buildSeedRecipes, SEED_VERSION } from './seed'
import { loadUserMappings } from './repo'

export interface FineliMeta {
  release: string
  importedAt: string
  license: string
  attribution: string
  foodCount?: number
  dishCount?: number
}

/**
 * In-memory nutrition index used by matching and nutrition calculations: Fineli foods plus
 * the user's own products (virtual foods). `all()` returns Fineli foods only – products are
 * matched through their own step (products.ts), not through Fineli name search.
 */
export class FineliStore implements FineliLookup {
  private map: Map<number, FineliFood>
  private list: FineliFood[]
  private productFoods: FineliFood[] = []
  private productEntries: ProductMatchEntry[] = []
  meta: FineliMeta | null
  /** Incremented whenever products change, so memoized calculations can refresh. */
  version = 0
  constructor(foods: FineliFood[], meta: FineliMeta | null) {
    this.list = foods
    this.map = new Map(foods.map((f) => [f.id, f]))
    this.meta = meta
  }
  get(id: number) {
    return this.map.get(id)
  }
  all() {
    return this.list
  }
  get size() {
    return this.list.length
  }
  products(): FineliFood[] {
    return this.productFoods
  }
  productIndex(): ProductMatchEntry[] {
    return this.productEntries
  }
  setProducts(products: Product[]) {
    for (const f of this.productFoods) this.map.delete(f.id)
    this.productFoods = products.map(productToFood)
    for (const f of this.productFoods) this.map.set(f.id, f)
    this.productEntries = productMatchIndex(products)
    this.version++
  }
}

export type ProgressFn = (message: string) => void

const USER_SOURCE: RecipeSource = { id: 'user', name: 'Omat reseptit', homepage: null, domains: [], kind: 'user', license: null, notes: null }

async function fetchJson<T>(fetchImpl: typeof fetch, path: string): Promise<T> {
  const res = await fetchImpl(path, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function loadFineliData(
  database: MealPlannerDB,
  fetchImpl: typeof fetch,
  progress: ProgressFn,
  force = false,
): Promise<FineliMeta | null> {
  const stored = await getSetting<FineliMeta | null>('fineliMeta', null, database)
  let remote: FineliMeta | null = null
  try {
    remote = await fetchJson<FineliMeta>(fetchImpl, `${import.meta.env.BASE_URL}data/fineli-meta.json`)
  } catch {
    // offline: keep whatever is stored
  }
  const count = await database.fineliFoods.count()
  const needsLoad = force || count === 0 || (remote && stored?.importedAt !== remote.importedAt)
  if (!needsLoad) return stored
  if (!remote && count === 0) throw new Error('Fineli-aineistoa ei voitu ladata. Tarkista verkkoyhteys ja lataa sivu uudelleen.')
  if (!remote) return stored

  progress('Ladataan Fineli-ravintotietokantaa…')
  const foodsFile = await fetchJson<FineliMeta & { foods: FineliFood[] }>(fetchImpl, `${import.meta.env.BASE_URL}data/fineli-foods.json`)
  progress(`Tallennetaan ${foodsFile.foods.length} elintarviketta…`)
  await database.transaction('rw', database.fineliFoods, async () => {
    await database.fineliFoods.clear()
    await database.fineliFoods.bulkPut(foodsFile.foods)
  })

  progress('Rakennetaan reseptikatalogia…')
  const dishFile = await fetchJson<{ dishes: FineliDish[]; classes: { fuClass: Record<string, string> } }>(fetchImpl, `${import.meta.env.BASE_URL}data/fineli-dishes.json`)
  const foodMap = new Map(foodsFile.foods.map((f) => [f.id, f]))
  const catalogue = buildFineliCatalogue(dishFile.dishes, foodMap, dishFile.classes.fuClass)
  await database.transaction('rw', database.recipes, async () => {
    const existing = await database.recipes.where('origin').equals('catalogue').toArray()
    const inCollection = new Set(existing.filter((r) => r.inCollection).map((r) => r.id))
    const notes = new Map(existing.filter((r) => r.notes).map((r) => [r.id, r.notes]))
    const ratings = new Map(existing.filter((r) => r.rating).map((r) => [r.id, r.rating]))
    const keep = new Set(catalogue.map((r) => r.id))
    // Remove catalogue entries that no longer exist, unless the user collected them.
    const stale = existing.filter((r) => !keep.has(r.id) && !r.inCollection && !r.notes && !r.rating).map((r) => r.id)
    await database.recipes.bulkDelete(stale)
    // Keep the user's own data (collection membership, notes, rating) when the dataset is refreshed.
    await database.recipes.bulkPut(catalogue.map((r) => ({ ...r, inCollection: inCollection.has(r.id), notes: notes.get(r.id) ?? null, rating: ratings.get(r.id) ?? null })))
  })
  const meta: FineliMeta = {
    release: foodsFile.release,
    importedAt: foodsFile.importedAt,
    license: foodsFile.license,
    attribution: foodsFile.attribution,
    foodCount: foodsFile.foods.length,
    dishCount: catalogue.length,
  }
  await setSetting('fineliMeta', meta, database)
  return meta
}

export async function bootstrap(
  progress: ProgressFn = () => {},
  database: MealPlannerDB = defaultDb,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<FineliStore> {
  progress('Avataan tietokantaa…')
  if (!(await database.mealPlans.get(DEFAULT_PLAN_ID))) {
    await database.mealPlans.put({ id: DEFAULT_PLAN_ID, name: 'Ruokalista', createdAt: new Date().toISOString() })
  }
  await database.recipeSources.bulkPut([
    ...ADAPTERS.map((a) => ({ id: a.id, name: a.name, homepage: a.homepage, domains: a.domains, kind: 'website' as const, license: null, notes: null })),
    FINELI_SOURCE,
    USER_SOURCE,
  ])

  const meta = await loadFineliData(database, fetchImpl, progress)
  progress('Valmistellaan ravintotietoja…')
  const store = new FineliStore(await database.fineliFoods.toArray(), meta)
  store.setProducts(await database.products.toArray())

  const seeded = await getSetting<number>('seedVersion', 0, database)
  if (seeded < SEED_VERSION) {
    progress('Lisätään esimerkkireseptit…')
    const userMappings = await loadUserMappings(database)
    const seeds = buildSeedRecipes({ fineli: store, userMappings })
    const existing = new Set((await database.recipes.bulkGet(seeds.map((s) => s.id))).filter(Boolean).map((r) => r!.id))
    await database.recipes.bulkPut(seeds.filter((s) => !existing.has(s.id)))
    await setSetting('seedVersion', SEED_VERSION, database)
  }

  const products = productMatchIndex(await database.products.toArray())
  await syncOpenRecipes(database, fetchImpl, { fineli: store, userMappings: await loadUserMappings(database), products }, progress)
  return store
}
