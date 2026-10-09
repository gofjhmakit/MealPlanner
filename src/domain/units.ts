/**
 * Unit registry and conversions.
 *
 * Three unit kinds:
 *   mass   – converts exactly to grams
 *   volume – converts exactly to millilitres (Finnish kitchen measures: rkl = 15 ml, tl = 5 ml, mm = 1 ml)
 *   count  – pieces / packages; converted to grams only through ingredient-specific
 *            knowledge (Fineli household units, dictionary weights) or explicit "(à 400 g)"
 *
 * The registry is data-driven so new units can be added by appending to UNITS.
 */
export type UnitKind = 'mass' | 'volume' | 'count'

export interface UnitDef {
  id: string
  kind: UnitKind
  /** grams (mass) or millilitres (volume) per one unit. */
  factor?: number
  /** Short Finnish label used in the UI. */
  label: string
  /** Lower-case spellings, abbreviations and inflected forms found in recipes. */
  forms: string[]
  /** Matching Fineli household unit code (foodaddunit.csv) when one exists. */
  fineliUnit?: string
  /**
   * Generic fallback weight in grams for count units when nothing better is known.
   * Deliberately rough – results using it are flagged as low-confidence.
   */
  genericGrams?: number
  /** Partitive used after numbers other than 1 ("2 ruukkua", "6 kynttä"); abbreviations have none. */
  partitive?: string
}

export const UNITS: UnitDef[] = [
  { id: 'mg', kind: 'mass', factor: 0.001, label: 'mg', forms: ['mg', 'milligramma', 'milligrammaa'] },
  { id: 'g', kind: 'mass', factor: 1, label: 'g', forms: ['g', 'gr', 'gramma', 'grammaa', 'grammoja'] },
  { id: 'kg', kind: 'mass', factor: 1000, label: 'kg', forms: ['kg', 'kilo', 'kiloa', 'kilogramma', 'kilogrammaa'] },
  { id: 'ml', kind: 'volume', factor: 1, label: 'ml', forms: ['ml', 'millilitra', 'millilitraa'] },
  { id: 'cl', kind: 'volume', factor: 10, label: 'cl', forms: ['cl', 'senttilitra', 'senttilitraa'] },
  { id: 'dl', kind: 'volume', factor: 100, label: 'dl', forms: ['dl', 'desilitra', 'desilitraa', 'desi', 'desiä'], fineliUnit: 'DL' },
  { id: 'l', kind: 'volume', factor: 1000, label: 'l', forms: ['l', 'litra', 'litraa', 'ltr'] },
  { id: 'rkl', kind: 'volume', factor: 15, label: 'rkl', forms: ['rkl', 'ruokalusikka', 'ruokalusikallista', 'ruokalusikallinen', 'rkl:a'], fineliUnit: 'RKL' },
  { id: 'tl', kind: 'volume', factor: 5, label: 'tl', forms: ['tl', 'teelusikka', 'teelusikallista', 'teelusikallinen', 'tl:a'], fineliUnit: 'TL' },
  { id: 'mm', kind: 'volume', factor: 1, label: 'mm', forms: ['mm', 'maustemitta', 'maustemittaa', 'maustemitallinen'] },
  { id: 'kuppi', kind: 'volume', factor: 240, label: 'kuppi', partitive: 'kuppia', forms: ['kuppi', 'kuppia', 'cup', 'cups'] },
  { id: 'kpl', kind: 'count', label: 'kpl', forms: ['kpl', 'kappale', 'kappaletta', 'kpl:tta', 'kpl:ta'], fineliUnit: 'KPL_M' },
  { id: 'pkt', kind: 'count', label: 'pkt', forms: ['pkt', 'paketti', 'pakettia', 'pakkaus', 'pakkausta', 'rasiallinen'], genericGrams: 400 },
  { id: 'prk', kind: 'count', label: 'prk', forms: ['prk', 'purkki', 'purkkia', 'purkillinen'], genericGrams: 200 },
  { id: 'tlk', kind: 'count', label: 'tlk', forms: ['tlk', 'tölkki', 'tölkkiä', 'tölkillinen', 'säilyke', 'säilykettä'], genericGrams: 400 },
  { id: 'ps', kind: 'count', label: 'ps', forms: ['ps', 'pussi', 'pussia', 'pussillinen'], genericGrams: 150 },
  { id: 'rs', kind: 'count', label: 'rs', forms: ['rs', 'rasia', 'rasiaa'], genericGrams: 250 },
  { id: 'pll', kind: 'count', label: 'pll', forms: ['pll', 'pullo', 'pulloa'], genericGrams: 500 },
  { id: 'nippu', kind: 'count', label: 'nippu', partitive: 'nippua', forms: ['nippu', 'nippua', 'kimppu', 'kimppua'], genericGrams: 25 },
  { id: 'ruukku', kind: 'count', label: 'ruukku', partitive: 'ruukkua', forms: ['ruukku', 'ruukkua', 'ruukullinen'], genericGrams: 25 },
  { id: 'kera', kind: 'count', label: 'kerä', partitive: 'kerää', forms: ['kerä', 'kerää'], genericGrams: 500 },
  { id: 'viipale', kind: 'count', label: 'viipale', partitive: 'viipaletta', forms: ['viipale', 'viipaletta', 'siivu', 'siivua', 'viip'], genericGrams: 25 },
  { id: 'kynsi', kind: 'count', label: 'kynsi', partitive: 'kynttä', forms: ['kynsi', 'kynttä', 'kynnen'], genericGrams: 4 },
  { id: 'pala', kind: 'count', label: 'pala', partitive: 'palaa', forms: ['pala', 'palaa', 'kuutio', 'kuutiota'], genericGrams: 10 },
  { id: 'varsi', kind: 'count', label: 'varsi', partitive: 'vartta', forms: ['varsi', 'vartta', 'tanko', 'tankoa'], genericGrams: 40 },
  { id: 'oksa', kind: 'count', label: 'oksa', partitive: 'oksaa', forms: ['oksa', 'oksaa', 'lehti', 'lehteä'], genericGrams: 1 },
  { id: 'annos', kind: 'count', label: 'annos', partitive: 'annosta', forms: ['annos', 'annosta'], fineliUnit: 'PORTM', genericGrams: 250 },
  { id: 'kourallinen', kind: 'count', label: 'kourallinen', partitive: 'kourallista', forms: ['kourallinen', 'kourallista', 'kourallisen', 'kourallisia'], genericGrams: 15 },
  { id: 'levy', kind: 'count', label: 'levy', forms: ['levy', 'levyä'], genericGrams: 20 },
  { id: 'hyppysellinen', kind: 'count', label: 'hyppysellinen', forms: ['hyppysellinen', 'hyppysellistä', 'ripaus', 'ripaus', 'ripausta', 'nipistys'], genericGrams: 0.5 },
]

const byForm = new Map<string, UnitDef>()
const byId = new Map<string, UnitDef>()
for (const u of UNITS) {
  byId.set(u.id, u)
  for (const f of u.forms) byForm.set(f, u)
}

export function getUnit(id: string | null | undefined): UnitDef | undefined {
  return id ? byId.get(id) : undefined
}

/** Look up a unit by any of its written forms ("dl", "tölkkiä", "rkl."). */
export function findUnit(token: string): UnitDef | undefined {
  const t = token.toLowerCase().replace(/\.$/, '')
  return byForm.get(t)
}

/** Convert an amount between two units of the same measurable kind. Returns null if impossible. */
export function convert(value: number, from: string, to: string): number | null {
  const a = byId.get(from)
  const b = byId.get(to)
  if (!a || !b || a.kind !== b.kind || a.kind === 'count' || !a.factor || !b.factor) return null
  return (value * a.factor) / b.factor
}

/** Grams for a mass unit, ml for a volume unit, null for counts. */
export function toBase(value: number, unitId: string): { kind: 'mass' | 'volume'; value: number } | null {
  const u = byId.get(unitId)
  if (!u || u.kind === 'count' || !u.factor) return null
  return { kind: u.kind, value: value * u.factor }
}

export function unitKind(unitId: string | null | undefined): UnitKind | null {
  return unitId ? (byId.get(unitId)?.kind ?? null) : null
}

// ---------------------------------------------------------------------------
// Formatting (Finnish decimal comma, kitchen-friendly units)
// ---------------------------------------------------------------------------

const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [0.333, '⅓'],
  [0.5, '½'],
  [0.667, '⅔'],
  [0.75, '¾'],
]

export function formatNumber(n: number, maxDecimals = 1): string {
  const rounded = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals
  return rounded.toLocaleString('fi-FI', { maximumFractionDigits: maxDecimals })
}

/** Human-friendly quantity: 0.5 -> "½", 1.5 -> "1 ½", 2.25 -> "2 ¼". */
export function formatQuantity(n: number): string {
  if (n <= 0) return '0'
  const whole = Math.floor(n)
  const frac = n - whole
  if (n >= 10) return formatNumber(n, n >= 100 ? 0 : 1)
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.04) return whole > 0 ? `${whole} ${glyph}` : glyph
  }
  if (frac < 0.04) return String(whole)
  if (frac > 0.96) return String(whole + 1)
  return formatNumber(n, 1)
}

/** Choose a sensible display unit for a mass in grams. */
export function formatMass(grams: number): string {
  if (grams >= 1000) return `${formatNumber(grams / 1000, 2)} kg`
  if (grams >= 100) return `${formatNumber(Math.round(grams / 5) * 5, 0)} g`
  if (grams >= 10) return `${formatNumber(grams, 0)} g`
  return `${formatNumber(grams, 1)} g`
}

/** Choose a sensible kitchen unit for a volume in millilitres. */
export function formatVolume(ml: number): string {
  if (ml >= 1000) return `${formatNumber(ml / 1000, 2)} l`
  if (ml >= 50) {
    const dl = ml / 100
    const half = Math.round(dl * 2) / 2
    return Math.abs(dl - half) < 0.03 ? `${formatQuantity(half)} dl` : `${formatNumber(dl, 1)} dl`
  }
  if (ml >= 15 && Math.abs(ml / 15 - Math.round(ml / 15)) < 0.1) return `${formatQuantity(ml / 15)} rkl`
  if (ml >= 5 && Math.abs(ml / 5 - Math.round(ml / 5)) < 0.1) return `${formatQuantity(ml / 5)} tl`
  if (ml >= 15) return `${formatQuantity(ml / 15)} rkl`
  if (ml >= 2.5) return `${formatQuantity(ml / 5)} tl`
  return `${formatNumber(ml, 1)} ml`
}

export function formatCount(n: number, unitId: string): string {
  const u = byId.get(unitId)
  return `${formatQuantity(n).replace(' ', '')} ${n !== 1 && u?.partitive ? u.partitive : (u?.label ?? unitId)}`
}

/** Format a quantity in its original unit ("2 dl", "½ tl", "3 kpl"). */
export function formatAmountInUnit(quantity: number, unitId: string | null, quantityMax?: number | null): string {
  const q = quantityMax && quantityMax !== quantity
    ? `${formatQuantity(quantity)}–${formatQuantity(quantityMax)}`
    : formatQuantity(quantity)
  if (!unitId) return q
  return `${q} ${byId.get(unitId)?.label ?? unitId}`
}
