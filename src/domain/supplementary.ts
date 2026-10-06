/**
 * Supplementary food composition data: open databases used only when Fineli has no suitable
 * or likely food for an ingredient. Fineli is the master data; see README "Supplementary
 * food data" and data/supplementary-source/.
 *
 * Supplementary foods are FineliFood records (Finnish names translated from the source) with
 * ids in their own range, so nutrition, shopping and the mapping dialog treat them like Fineli
 * foods while the UI can always tell the user where a value came from.
 *
 * No imports: this file is also used by scripts/import-supplementary.ts under plain Node.
 */

export const SUPPLEMENTARY_FOOD_ID_BASE = 800_000_000

export type SupplementarySourceId = 'livsmedelsverket' | 'usda'

export interface SupplementarySourceInfo {
  id: SupplementarySourceId
  /** Short label shown next to food names. */
  label: string
  name: string
  homepage: string
  license: string
  attribution: string
  /** Added to the source's own numeric food id. */
  idOffset: number
  /** Lower number wins when two sources have the same food (after Fineli, which always wins). */
  priority: number
}

export const SUPPLEMENTARY_SOURCES: Record<SupplementarySourceId, SupplementarySourceInfo> = {
  livsmedelsverket: {
    id: 'livsmedelsverket',
    label: 'Livsmedelsverket',
    name: 'Livsmedelsverkets livsmedelsdatabas (Ruotsin elintarvikevirasto)',
    homepage: 'https://www.livsmedelsverket.se/om-oss/psidata/livsmedelsdatabasen',
    license: 'CC BY 4.0',
    attribution: 'Livsmedelsverket (Swedish Food Agency), Livsmedelsdatabasen. Nimet suomennettu ja aineistoa karsittu.',
    idOffset: 0,
    priority: 1,
  },
  usda: {
    id: 'usda',
    label: 'USDA',
    name: 'USDA National Nutrient Database for Standard Reference, Release 28 (SR Legacy)',
    homepage: 'https://fdc.nal.usda.gov/',
    license: 'Public domain (CC0 1.0)',
    attribution: 'U.S. Department of Agriculture, Agricultural Research Service, Nutrient Data Laboratory. USDA National Nutrient Database for Standard Reference, Release 28. Nimet suomennettu ja aineistoa karsittu.',
    idOffset: 10_000_000,
    priority: 2,
  },
}

export function supplementaryFoodId(source: SupplementarySourceId, sourceFoodId: number): number {
  return SUPPLEMENTARY_FOOD_ID_BASE + SUPPLEMENTARY_SOURCES[source].idOffset + sourceFoodId
}

/** Supplementary ids sit below the user's own products (900 000 000+). */
export function isSupplementaryFoodId(id: number | null | undefined): boolean {
  return typeof id === 'number' && id >= SUPPLEMENTARY_FOOD_ID_BASE && id < SUPPLEMENTARY_FOOD_ID_BASE + 100_000_000
}

/**
 * Reference to a supplementary food in the ingredient dictionary, e.g. "usda:2014"
 * (USDA NDB number 02014, cumin seed) or "livsmedelsverket:1234".
 */
export function parseSupplementaryRef(ref: string): number | null {
  const m = /^(livsmedelsverket|usda):(\d+)$/.exec(ref)
  return m ? supplementaryFoodId(m[1] as SupplementarySourceId, Number(m[2])) : null
}

/** Short name of the database a food's values come from, for explanations and labels. */
export function foodSourceLabel(food: { custom?: boolean; source?: SupplementarySourceId } | undefined): string {
  if (food?.custom) return 'Oma tuote'
  if (food?.source) return SUPPLEMENTARY_SOURCES[food.source]?.label ?? food.source
  return 'Fineli'
}
