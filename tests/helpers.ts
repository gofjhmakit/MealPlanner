import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FineliLookup } from '../src/domain/matcher'
import type { FineliDish, FineliFood } from '../src/domain/types'

let foods: FineliFood[] | null = null

/** Loads the generated Fineli dataset (public/data) – the same file the app ships with. */
export function fineliFoods(): FineliFood[] {
  if (!foods) {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'fineli-foods.json'), 'utf8'))
    foods = json.foods as FineliFood[]
  }
  return foods
}

export function fineliDishes(): FineliDish[] {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'fineli-dishes.json'), 'utf8')).dishes
}

let lookup: FineliLookup | null = null
export function fineliLookup(): FineliLookup {
  if (!lookup) {
    const all = fineliFoods()
    const map = new Map(all.map((f) => [f.id, f]))
    lookup = { get: (id) => map.get(id), all: () => all }
  }
  return lookup
}

let supplementary: FineliFood[] | null = null
/** The generated supplementary dataset (public/data/supplementary-foods.json). */
export function supplementaryFoods(): FineliFood[] {
  if (!supplementary) {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'supplementary-foods.json'), 'utf8'))
    supplementary = json.foods as FineliFood[]
  }
  return supplementary
}

let fullLookup: FineliLookup | null = null
/** Fineli plus the supplementary foods, like the app's FineliStore. */
export function fullFoodLookup(): FineliLookup {
  if (!fullLookup) {
    const all = fineliFoods()
    const supp = supplementaryFoods()
    const map = new Map([...all, ...supp].map((f) => [f.id, f]))
    fullLookup = { get: (id) => map.get(id), all: () => all, supplementary: () => supp }
  }
  return fullLookup
}
