/**
 * Parser for the command bar (⌘K / the (+) button): Finnish day and meal words are picked out
 * of free text, and the rest is the recipe search.
 *
 *   "su lounas kana"              → Sunday, lunch, search "kana"
 *   "huomenna päivälliseksi lohi" → tomorrow, dinner, search "lohi"
 *   "ensi ma aamiainen"           → Monday next week, breakfast
 *   "12.10. iltapala"             → 12 October, snack
 *   "täytä"                       → action: fill the empty slots of the week
 */
import { addDays, parseISODate, startOfWeek, toISODate } from './dates'
import type { MealSlot } from './types'

export type CommandAction = 'fill' | 'shop' | 'copy-week' | 'leftover'

export interface CommandToken {
  kind: 'day' | 'slot' | 'action'
  text: string
  label: string
}

export interface ParsedCommand {
  date: string | null
  slot: MealSlot | null
  action: CommandAction | null
  query: string
  tokens: CommandToken[]
}

const WEEKDAYS: [RegExp, number][] = [
  [/^(ma|maanantai(na)?)$/, 1],
  [/^(ti|tiistai(na)?)$/, 2],
  [/^(ke|keskiviikko(na)?)$/, 3],
  [/^(to|torstai(na)?)$/, 4],
  [/^(pe|perjantai(na)?)$/, 5],
  [/^(la|lauantai(na)?)$/, 6],
  [/^(su|sunnuntai(na)?)$/, 0],
]

const SLOTS: [RegExp, MealSlot][] = [
  [/^(aamu|aamulla|aamiainen|aamiaiseksi|aamupala(ksi)?)$/, 'breakfast'],
  [/^(lounas|lounaaksi|lounaalle|lou)$/, 'lunch'],
  [/^(päivällinen|päivälliseksi|päivälliselle|pv|illallinen|illalliseksi|ruoka|ruoaksi|ruuaksi)$/, 'dinner'],
  [/^(iltapala(ksi)?|välipala(ksi)?|välipalaksi|snack)$/, 'snack'],
]

const ACTIONS: [RegExp, CommandAction][] = [
  [/^(täytä|täyttö|täytä?\s*tyhjät)$/, 'fill'],
  [/^(osta|ostokset|ostoslista)$/, 'shop'],
  [/^(kopioi|kopioi viikko)$/, 'copy-week'],
  [/^(tähde|tähteet|tähteiksi)$/, 'leftover'],
]

const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'aamiainen', lunch: 'lounas', dinner: 'päivällinen', snack: 'iltapala', other: 'muu' }
const DAY_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la']

export function parseCommand(text: string, todayIso: string): ParsedCommand {
  const words = text.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const out: ParsedCommand = { date: null, slot: null, action: null, query: '', tokens: [] }
  const rest: string[] = []
  let nextWeek = false
  const dayLabel = (iso: string) => `${DAY_SHORT[parseISODate(iso).getDay()]} ${parseISODate(iso).getDate()}.${parseISODate(iso).getMonth() + 1}.`

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!out.date && (w === 'ensi' || w === 'ensiviikon' || w === 'seuraava')) {
      nextWeek = true
      continue
    }
    if (!out.date) {
      let date: string | null = null
      if (w === 'tänään' || w === 'tänä') date = todayIso
      else if (w === 'huomenna' || w === 'huom') date = addDays(todayIso, 1)
      else if (w === 'ylihuomenna') date = addDays(todayIso, 2)
      else {
        const wd = WEEKDAYS.find(([re]) => re.test(w))?.[1]
        if (wd !== undefined) {
          // "su" = the next Sunday (today included); "ensi su" = Sunday of next calendar week
          date = nextWeek ? addDays(startOfWeek(todayIso, 1), 7 + ((wd + 6) % 7)) : addDays(todayIso, (wd - parseISODate(todayIso).getDay() + 7) % 7)
        } else {
          const m = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(w)
          if (m) {
            const year = m[3] ? Number(m[3]) : parseISODate(todayIso).getFullYear()
            const d = new Date(year, Number(m[2]) - 1, Number(m[1]))
            if (d.getMonth() === Number(m[2]) - 1) {
              date = toISODate(d)
              // "3.1." in December means next January
              if (!m[3] && date < addDays(todayIso, -60)) date = toISODate(new Date(year + 1, Number(m[2]) - 1, Number(m[1])))
            }
          }
        }
      }
      if (date) {
        out.date = date
        out.tokens.push({ kind: 'day', text: w, label: dayLabel(date) })
        continue
      }
    }
    if (!out.slot) {
      const slot = SLOTS.find(([re]) => re.test(w))?.[1]
      if (slot) {
        out.slot = slot
        out.tokens.push({ kind: 'slot', text: w, label: SLOT_LABEL[slot] })
        continue
      }
    }
    if (!out.action && rest.length === 0) {
      const action = ACTIONS.find(([re]) => re.test(w))?.[1]
      if (action) {
        out.action = action
        out.tokens.push({ kind: 'action', text: w, label: w })
        continue
      }
    }
    rest.push(w)
  }
  out.query = rest.join(' ')
  return out
}
