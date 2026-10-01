/** Date helpers working with local-time ISO dates ("2026-09-30"). */

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Start of the week containing `iso` (weekStartsOn 1 = Monday). */
export function startOfWeek(iso: string, weekStartsOn: 0 | 1 = 1): string {
  const d = parseISODate(iso)
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return toISODate(d)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 366; d = addDays(d, 1)) out.push(d)
  return out
}

const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai']
const WEEKDAYS_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la']

export function weekdayName(iso: string, short = false): string {
  const i = parseISODate(iso).getDay()
  return short ? WEEKDAYS_SHORT[i] : WEEKDAYS[i]
}

export function formatDate(iso: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = parseISODate(iso)
  const base = `${d.getDate()}.${d.getMonth() + 1}.${opts.year ? d.getFullYear() : ''}`
  return opts.weekday ? `${capitalize(weekdayName(iso))} ${base}` : base
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** ISO week number (Finnish calendars use ISO weeks). */
export function isoWeek(iso: string): number {
  const d = parseISODate(iso)
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
