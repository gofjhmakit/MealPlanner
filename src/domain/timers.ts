/**
 * Durations in recipe instructions, for the timer chips in the recipe page and cook mode.
 */
/** Finds durations: "10 minuuttia", "20–25 min", "1 tunti", "1,5 tuntia", "30 sekuntia". */
export function splitTimers(text: string): (string | { text: string; seconds: number })[] {
  const re = /(\d+(?:[,.]\d+)?)(?:\s*[–-]\s*(\d+(?:[,.]\d+)?))?\s*(minuutti(?:a|in)?|min\b|tunti(?:a|in)?|h\b|sekunti(?:a|in)?|s\b)/gi
  const out: (string | { text: string; seconds: number })[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const value = Number((m[2] ?? m[1]).replace(',', '.'))
    const unit = m[3].toLowerCase()
    const seconds = Math.round(value * (unit.startsWith('t') || unit === 'h' ? 3600 : unit.startsWith('s') ? 1 : 60))
    if (!seconds || seconds > 12 * 3600) continue
    if (m.index! > last) out.push(text.slice(last, m.index))
    out.push({ text: m[0], seconds })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : [text]
}

