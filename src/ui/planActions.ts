/**
 * Plan actions shared by the command bar, Today, Week and the recipe page.
 */
import { db } from '../db/db'
import { addMealItem, applyMealPlan, mealItemsInRange } from '../db/repo'
import { capitalize, formatDate, today, weekdayName } from '../domain/dates'
import { slotPassed } from '../domain/today'
import type { MealSlot } from '../domain/types'
import { planMeals, quickPlanOptions, type Candidate } from '../domain/weekPlanner'
import { SLOT_LABELS } from './hooks'

export function slotLabel(date: string, slot: MealSlot): string {
  return `${capitalize(weekdayName(date, true))} ${formatDate(date)} ${SLOT_LABELS[slot].toLowerCase()}`
}

/** Add a recipe to a slot; returns an undo function. */
export async function addToSlot(recipeId: string, date: string, slot: MealSlot, servings: number): Promise<() => Promise<void>> {
  const row = await addMealItem({ date, slot, recipeId, servings })
  return async () => {
    await db.mealItems.delete(row.id)
  }
}

/**
 * Fill the empty breakfast/lunch/dinner slots of `dates` with suggestions that fit the daily
 * target. Returns how many meals were added and an undo function.
 */
export async function fillEmptySlots(
  candidates: Candidate[],
  dates: string[],
  o: { servings: number; kcalTarget: number | null; slots?: MealSlot[]; seed?: number },
): Promise<{ added: number; undo: () => Promise<void> }> {
  if (!dates.length) return { added: 0, undo: async () => {} }
  const sorted = [...dates].sort()
  const before = await mealItemsInRange(sorted[0], sorted.at(-1)!)
  const occupied = new Set(before.map((m) => `${m.date}|${m.slot}`))
  // Today's meals that are already over are not planned after the fact.
  const t = today()
  const hour = new Date().getHours()
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as MealSlot[]) if (slotPassed(slot, hour)) occupied.add(`${t}|${slot}`)
  const opts = quickPlanOptions({ dates: sorted, slots: o.slots, people: o.servings, maxKcalPerDay: o.kcalTarget, occupied, seed: o.seed ?? Date.now() % 100000 })
  const plan = planMeals(candidates, opts)
  await applyMealPlan(plan.meals, { replace: false, dates: sorted, slots: opts.slots })
  const beforeIds = new Set(before.map((m) => m.id))
  const added = (await mealItemsInRange(sorted[0], sorted.at(-1)!)).filter((m) => !beforeIds.has(m.id)).map((m) => m.id)
  return {
    added: added.length,
    undo: async () => {
      await db.mealItems.bulkDelete(added)
    },
  }
}
