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
