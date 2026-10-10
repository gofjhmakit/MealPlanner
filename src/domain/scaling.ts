/**
 * Recipe scaling.
 *
 * Default is linear scaling. Ingredients can opt into other rules through
 * RecipeIngredient.scaling (the canonical dictionary sets defaults, e.g. salt,
 * spices, baking powder and yeast use 'sublinear'):
 *   linear    – amount × factor
 *   sublinear – amount × factor^0.8 (seasoning doesn't grow as fast as the batch)
 *   fixed     – amount unchanged (e.g. "1 laakerinlehti" regardless of batch size)
 */
import type { RecipeIngredient, ScalingRule } from './types'
import { convert, formatAmountInUnit, getUnit } from './units'

export const SUBLINEAR_EXPONENT = 0.8

export function applyScaling(amount: number, factor: number, rule: ScalingRule = 'linear'): number {
  if (rule === 'fixed') return amount
  if (rule === 'sublinear') return amount * Math.pow(factor, SUBLINEAR_EXPONENT)
  return amount * factor
}

export interface ScaledIngredient {
  quantity: number | null
  quantityMax: number | null
  unit: string | null
  explicitGrams: number | null
  /** Display text for the amount, e.g. "3 dl" or "1 ½ tlk". */
  amountText: string
}

/** Round count-unit quantities to kitchen-friendly steps (¼ below 4, ½ above). */
function roundCount(q: number): number {
  if (q < 4) return Math.max(0.25, Math.round(q * 4) / 4)
  return Math.round(q * 2) / 2
}

/** Move to a larger/smaller unit when it reads better: 12 tl -> 4 rkl, 15 dl -> 1,5 l, 0,5 dl -> 3 rkl. */
export function normalizeDisplayUnit(quantity: number, unit: string | null): { quantity: number; unit: string | null } {
  if (!unit) return { quantity, unit }
  const u = getUnit(unit)
  if (!u || u.kind === 'count') return { quantity, unit }
  const tryUnit = (target: string, cond: (q: number) => boolean) => {
    const q = convert(quantity, unit, target)
    return q !== null && cond(q) ? { quantity: q, unit: target } : null
  }
  if (u.kind === 'volume') {
    // Small volumes step down to spoons, and a speck of a spoon is a pinch: never "0 dl" or "0,1 tl".
    const ml = quantity * (u.factor ?? 1)
    if (ml < 0.6) return { quantity: 1, unit: 'hyppysellinen' }
    if (ml < 15 && u.id !== 'mm') return { quantity: ml / 5, unit: 'tl' }
    if (ml < 50 && (u.id === 'dl' || u.id === 'l' || u.id === 'kuppi' || u.id === 'cl' || u.id === 'ml')) return { quantity: ml / 15, unit: 'rkl' }
  }
  if (u.id === 'tl') return tryUnit('rkl', (q) => q >= 1 && Math.abs(q * 2 - Math.round(q * 2)) < 0.01) ?? { quantity, unit }
  if (u.id === 'rkl') return tryUnit('dl', (q) => q >= 1) ?? { quantity, unit }
  if (u.id === 'dl') return tryUnit('l', (q) => q >= 1) ?? { quantity, unit }
  if (u.id === 'ml') return tryUnit('dl', (q) => q >= 1) ?? { quantity, unit }
  if (u.id === 'g') return tryUnit('kg', (q) => q >= 1) ?? { quantity, unit }
  if (u.id === 'kg') return tryUnit('g', (q) => q < 1000) ?? { quantity, unit }
  if (u.id === 'l') return tryUnit('dl', (q) => q < 10) ?? { quantity, unit }
  return { quantity, unit }
}

export function scaleIngredient(ing: RecipeIngredient, factor: number): ScaledIngredient {
  if (ing.quantity == null) {
    return {
      quantity: null,
      quantityMax: null,
      unit: ing.unit,
      explicitGrams: ing.explicitGrams ?? null,
      amountText: ing.unit ? (getUnit(ing.unit)?.label ?? '') : '',
    }
  }
  let q = applyScaling(ing.quantity, factor, ing.scaling)
  let qMax = ing.quantityMax != null ? applyScaling(ing.quantityMax, factor, ing.scaling) : null
  let unit = ing.unit
  const kind = getUnit(unit)?.kind
  if (factor !== 1) {
    if (!kind || kind === 'count') {
      q = roundCount(q)
      qMax = qMax !== null ? roundCount(qMax) : null
    } else {
      const n = normalizeDisplayUnit(q, unit)
      if (qMax !== null && n.unit !== unit) qMax = convert(qMax, unit!, n.unit!) ?? qMax
      q = n.quantity
      unit = n.unit
    }
  }
  const explicitGrams = ing.explicitGrams != null ? applyScaling(ing.explicitGrams, factor, ing.scaling) : null
  return { quantity: q, quantityMax: qMax, unit, explicitGrams, amountText: formatAmountInUnit(q, unit, qMax) }
}
