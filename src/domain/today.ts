/**
 * "What now?" helpers for the Today view and the smart "add to plan" buttons.
 */
import { addDays } from './dates'
import type { MealItem, MealSlot } from './types'

export const MAIN_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']

/** Hour after which a slot of today counts as passed (no longer offered as "next empty"). */
const SLOT_ENDS: Record<MealSlot, number> = { breakfast: 10, lunch: 14, dinner: 20, snack: 23, other: 24 }
/** Typical start time, shown on the timeline. */
export const SLOT_TIMES: Record<MealSlot, string> = { breakfast: '7.30', lunch: '11.30', dinner: '17.30', snack: '20.30', other: '' }

export function slotPassed(slot: MealSlot, hour: number): boolean {
  return hour >= SLOT_ENDS[slot]
}

/** The slot that is "now" or next today, or null late in the evening. */
export function currentSlot(hour: number): MealSlot | null {
  return MAIN_SLOTS.find((s) => !slotPassed(s, hour)) ?? null
}

/**
 * First empty main-meal slot from now on (today's passed slots are skipped), within `days` days.
 * Snacks are only offered when asked for, so "add to plan" fills real meals first.
 */
export function nextEmptySlot(
  items: Pick<MealItem, 'date' | 'slot'>[],
  todayIso: string,
  hour: number,
  opts: { slots?: MealSlot[]; days?: number; preferSlot?: MealSlot | null } = {},
): { date: string; slot: MealSlot } {
  const slots = opts.preferSlot ? [opts.preferSlot] : (opts.slots ?? ['breakfast', 'lunch', 'dinner'])
  const taken = new Set(items.map((i) => `${i.date}|${i.slot}`))
  const days = opts.days ?? 14
  for (let d = 0; d < days; d++) {
    const date = addDays(todayIso, d)
    for (const slot of slots) {
      if (d === 0 && slotPassed(slot, hour)) continue
      if (!taken.has(`${date}|${slot}`)) return { date, slot }
    }
  }
  return { date: addDays(todayIso, 1), slot: slots.includes('dinner') ? 'dinner' : slots[0] }
}
