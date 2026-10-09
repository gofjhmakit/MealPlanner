/**
 * Personal daily targets from body data, and household serving counts.
 *
 * Energy: Mifflin–St Jeor resting energy × physical activity level (PAL), adjusted by the aim.
 * A deficit of ~500 kcal/day is roughly 0.5 kg/week. The target never goes below a floor that
 * is safe without supervision (1 200 kcal women / 1 500 kcal men).
 * Protein: 1.6 g/kg when losing (keeps muscle), 1.2 g/kg otherwise; for heavy people the
 * weight is capped at the weight for BMI 27 so the number stays realistic.
 * Fibre: 25 g (women) / 35 g (men), the Nordic recommendation.
 * These are estimates to steer a meal plan, not medical advice; the UI says so.
 */
import type { Goal, GoalAim, NutritionTargets, Person } from './types'

export const ACTIVITY_LEVELS: { value: number; label: string; hint: string }[] = [
  { value: 1.3, label: 'Vähän liikettä', hint: 'Istumatyö, vähän arkiliikuntaa' },
  { value: 1.5, label: 'Jonkin verran', hint: 'Arkiliikuntaa, liikuntaa 1–2 kertaa viikossa' },
  { value: 1.7, label: 'Aktiivinen', hint: 'Liikuntaa 3–5 kertaa viikossa tai fyysinen työ' },
  { value: 1.9, label: 'Hyvin aktiivinen', hint: 'Kovaa treeniä lähes päivittäin' },
]

export const AIM_LABELS: Record<GoalAim, { label: string; hint: string; deltaKcal: number }> = {
  lose: { label: 'Laihtua', hint: 'Noin 0,5 kg viikossa', deltaKcal: -500 },
  'lose-slow': { label: 'Kevyemmin', hint: 'Hitaasti, noin 0,25 kg viikossa', deltaKcal: -250 },
  maintain: { label: 'Pitää painon', hint: 'Syödä monipuolisesti', deltaKcal: 0 },
  gain: { label: 'Kasvattaa', hint: 'Lihasta tai painoa, noin +0,25 kg viikossa', deltaKcal: 300 },
}

export function restingEnergy(goal: Pick<Goal, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  return 10 * goal.weightKg + 6.25 * goal.heightCm - 5 * goal.age + (goal.sex === 'male' ? 5 : -161)
}

export function maintenanceEnergy(goal: Goal): number {
  return restingEnergy(goal) * goal.activity
}

export function suggestTargets(goal: Goal): NutritionTargets {
  const floor = goal.sex === 'male' ? 1500 : 1200
  const kcal = Math.max(floor, maintenanceEnergy(goal) + AIM_LABELS[goal.aim].deltaKcal)
  const capWeight = Math.min(goal.weightKg, 27 * (goal.heightCm / 100) ** 2)
  const losing = goal.aim === 'lose' || goal.aim === 'lose-slow'
  return {
    energyKcal: roundTo(kcal, 50),
    protein: roundTo(capWeight * (losing || goal.aim === 'gain' ? 1.6 : 1.2), 5),
    fibre: goal.sex === 'male' ? 35 : 25,
  }
}

export function bmi(goal: Pick<Goal, 'heightCm' | 'weightKg'>): number {
  return goal.weightKg / (goal.heightCm / 100) ** 2
}

export const PERSON_KINDS: Record<Person['kind'], { label: string; portion: number }> = {
  adult: { label: 'Aikuinen', portion: 1 },
  teen: { label: 'Nuori', portion: 1 },
  child: { label: 'Lapsi', portion: 0.6 },
}

/** Servings to cook for the household: the sum of portions, rounded up to whole servings. */
export function householdServings(household: Person[], fallback: number): number {
  if (!household.length) return fallback
  return Math.max(1, Math.ceil(household.reduce((s, p) => s + p.portion, 0) - 0.05))
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step
}
