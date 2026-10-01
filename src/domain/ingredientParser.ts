/**
 * Parse a Finnish recipe ingredient line into structured data.
 *
 *   "2 tlk (à 400 g) tomaattimurskaa esim. Mutti"
 *     -> quantity 2, unit "tlk", perUnitGrams 400, name "tomaattimurskaa", note "esim. Mutti"
 *   "2 dl (100 g) Valio emmentaljuustoraastetta"
 *     -> quantity 2, unit "dl", explicitGrams 100, name "emmentaljuustoraastetta"
 *   "1–2 valkosipulinkynttä" -> quantity 1, quantityMax 2, unit null
 *   "suolaa ja pippuria"     -> quantity null (not quantified)
 *
 * The original line is always preserved in `raw`.
 */
import { cleanIngredientName, normalizeWhitespace } from './finnish'
import { findUnit, toBase } from './units'

export interface ParsedIngredientLine {
  raw: string
  quantity: number | null
  quantityMax: number | null
  unit: string | null
  name: string
  note: string | null
  explicitGrams: number | null
  perUnitGrams: number | null
  perUnitMl: number | null
  size: 'S' | 'M' | 'L' | null
  optional: boolean
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('')

/** A single number: "2", "2,5", "2.5", "1/2", "½", "1½", "1 ½", "1 1/2". */
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`
const QUANTITY_RE = new RegExp(`^(?:n\\.|noin|ca\\.?|n)?\\s*(${NUM})(?:\\s*(?:-|–|—|\\.\\.|tai)\\s*(${NUM}))?`, 'iu')

const SIZE_WORDS: Record<string, 'S' | 'M' | 'L'> = {
  pieni: 'S', pientä: 'S', pieniä: 'S', pienehkö: 'S', pienehköä: 'S', pikkuinen: 'S',
  keskikokoinen: 'M', keskikokoista: 'M', keskikokoisia: 'M',
  iso: 'L', isoa: 'L', isoja: 'L', suuri: 'L', suurta: 'L', suuria: 'L', isohko: 'L', isohkoa: 'L', reilu: 'L',
}

/** Parse "2", "2,5", "1/2", "½", "1½", "1 1/2" into a number. */
export function parseNumber(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (!s) return null
  let m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*([${FRACTION_CHARS}])$`, 'u'))
  if (m) return (m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]]
  m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3])
  m = s.match(/^(\d+)\/(\d+)$/)
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Extract mass/volume information from bracketed text like "(à 400 g)", "(2 prk, à 2 dl)", "(100 g)". */
function parseBracket(text: string): { grams: number | null; ml: number | null; perUnit: boolean } {
  const perUnit = /(^|\s)(à|a|á|per)\s/iu.test(text) || /à/u.test(text)
  // Take the last "<number> <mass|volume unit>" pair, e.g. "à 285/145 g" -> 145 g (drained weight)
  const pairs = [...text.matchAll(new RegExp(`(${NUM})(?:\\s*\\/\\s*(${NUM}))?\\s*(kg|g|mg|l|dl|cl|ml)\\b`, 'giu'))]
  let grams: number | null = null
  let ml: number | null = null
  for (const p of pairs) {
    const value = parseNumber(p[2] ?? p[1])
    if (value === null) continue
    const base = toBase(value, p[3].toLowerCase())
    if (!base) continue
    if (base.kind === 'mass') grams = base.value
    else ml = base.value
  }
  return { grams, ml, perUnit }
}

export function parseIngredientLine(rawLine: string): ParsedIngredientLine {
  const raw = normalizeWhitespace(rawLine.replace(/^[\s•·*\-–—]+/u, ''))
  let rest = raw
  let optional = false
  if (/\b(valinnainen|halutessasi|tarvittaessa|koristeluun|koristeeksi)\b/iu.test(rest)) optional = true

  let quantity: number | null = null
  let quantityMax: number | null = null
  const qm = rest.match(QUANTITY_RE)
  if (qm && qm[1]) {
    quantity = parseNumber(qm[1])
    quantityMax = qm[2] ? parseNumber(qm[2]) : null
    rest = rest.slice(qm[0].length).trim()
  }

  // Quantity written at the end: "Rainbow kanafileesuikale 300 g"
  if (quantity === null) {
    const tail = rest.match(new RegExp(`\\s(${NUM})\\s*([\\p{L}]+\\.?)$`, 'u'))
    if (tail && findUnit(tail[2])) {
      quantity = parseNumber(tail[1])
      rest = `${tail[2]} ${rest.slice(0, tail.index).trim()}`
    }
  }

  // Unit: first word after the quantity (may also appear without quantity: "ripaus suolaa")
  let unit: string | null = null
  const unitMatch = rest.match(/^([\p{L}]+\.?(?::\p{L}+)?)(?=\s|$|\()/u)
  if (unitMatch) {
    const u = findUnit(unitMatch[1])
    if (u) {
      unit = u.id
      rest = rest.slice(unitMatch[0].length).trim()
      if (quantity === null) quantity = 1
    }
  }

  // Bracket right after the unit carries weights: "(à 400 g)", "(100 g)", "(1 prk, à 285/145 g)"
  let explicitGrams: number | null = null
  let perUnitGrams: number | null = null
  let perUnitMl: number | null = null
  const bracket = rest.match(/^\(([^)]*)\)/u)
  const bracketText = bracket ? bracket[1] : (raw.match(/\(([^)]*)\)/u)?.[1] ?? null)
  if (bracket) rest = rest.slice(bracket[0].length).trim()
  if (bracketText) {
    const b = parseBracket(bracketText)
    const unitIsMeasure = unit !== null && toBase(1, unit) !== null
    if (b.perUnit && !unitIsMeasure) {
      perUnitGrams = b.grams
      perUnitMl = b.ml
    } else if (b.grams !== null && b.perUnit && unitIsMeasure) {
      // "145 g (1 prk, à 285/145 g)": the leading quantity already is the mass
    } else if (b.grams !== null && !b.perUnit) {
      // "2 dl (100 g)" or "1 pkt (400 g)" -> weight of the whole line
      if (unit && !unitIsMeasure && quantity) perUnitGrams = b.grams / quantity
      else explicitGrams = b.grams
    } else if (b.ml !== null && !b.perUnit && unit && !unitIsMeasure && quantity) {
      perUnitMl = b.ml / quantity
    }
  }

  // Size adjective directly after the quantity: "1 iso sipuli"
  let size: 'S' | 'M' | 'L' | null = null
  const sizeMatch = rest.match(/^(\p{L}+)\s/u)
  if (sizeMatch && SIZE_WORDS[sizeMatch[1].toLowerCase()]) {
    size = SIZE_WORDS[sizeMatch[1].toLowerCase()]
    rest = rest.slice(sizeMatch[0].length).trim()
  }

  const cleaned = cleanIngredientName(rest)
  // Garlic cloves written as "3 valkosipulinkynttä" imply the unit "kynsi"
  if (!unit && /kyn(tt|s|n)/u.test(cleaned.name)) unit = 'kynsi'

  return {
    raw,
    quantity,
    quantityMax: quantityMax !== null && quantityMax !== quantity ? quantityMax : null,
    unit,
    name: cleaned.name || rest.toLowerCase(),
    note: cleaned.note,
    explicitGrams,
    perUnitGrams,
    perUnitMl,
    size,
    optional,
  }
}

/** Parse recipeYield strings: "4", "4, 4 annosta", "4 portion", "6–8 annosta", ["4", "4 annosta"]. */
export function parseServings(input: unknown): { servings: number | null; text: string | null } {
  const values = Array.isArray(input) ? input : [input]
  for (const v of values) {
    if (typeof v === 'number' && v > 0) return { servings: v, text: String(v) }
    if (typeof v !== 'string') continue
    const m = v.match(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+))?/u)
    if (m) {
      const n = Number(m[1].replace(',', '.'))
      if (n > 0 && n < 200) return { servings: n, text: normalizeWhitespace(v) }
    }
  }
  const text = values.find((v) => typeof v === 'string') as string | undefined
  return { servings: null, text: text ? normalizeWhitespace(text) : null }
}

/** Parse ISO 8601 durations ("PT1H30M", "PT45M") and Finnish text ("15–30 min", "1 h 20 min") to minutes. */
export function parseDurationMinutes(input: unknown): number | null {
  if (typeof input === 'number') return input > 0 ? input : null
  if (typeof input !== 'string' || !input.trim()) return null
  const s = input.trim()
  const iso = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?$/i)
  if (iso) {
    const total = Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0) + Number(iso[4] ?? 0) / 60
    return total > 0 ? Math.round(total) : null
  }
  const lower = s.toLowerCase()
  let minutes = 0
  const h = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:h|t|tuntia|tunti|tunnin)\b/u)
  if (h) minutes += Number(h[1].replace(',', '.')) * 60
  // ranges: take the upper bound ("15–30 min" -> 30)
  const m = lower.match(/(?:(\d+)\s*[-–]\s*)?(\d+)\s*(?:min|minuuttia|minuutti|minuutin)/u)
  if (m) minutes += Number(m[2])
  return minutes > 0 ? Math.round(minutes) : null
}

/**
 * Split a raw line into its leading amount ("2 tlk") and the rest ("(à 400 g) tomaattimurskaa"),
 * so the UI can show scaled amounts while keeping the original wording.
 */
export function splitAmountText(raw: string): { amount: string; rest: string } {
  const text = normalizeWhitespace(raw)
  const qm = text.match(QUANTITY_RE)
  if (!qm || !qm[1]) return { amount: '', rest: text }
  let end = qm[0].length
  const after = text.slice(end).trimStart()
  const unitMatch = after.match(/^([\p{L}]+\.?)(?=\s|$|\()/u)
  if (unitMatch && findUnit(unitMatch[1])) end = text.length - after.length + unitMatch[0].length
  return { amount: text.slice(0, end).trim(), rest: text.slice(end).trim() }
}
