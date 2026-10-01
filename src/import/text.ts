/** Small DOM/text helpers shared by the extractors. Only standard DOM APIs are used. */

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' }

/** Decode HTML entities and strip tags from a string that may contain markup. */
export function cleanText(input: unknown): string {
  if (typeof input !== 'string') return ''
  let s = input.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '')
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITY_MAP[code.toLowerCase()] ?? m
  })
  return s
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function oneLine(input: unknown): string {
  return cleanText(input).replace(/\n+/g, ' ').trim()
}

export function textOf(el: Element | null | undefined): string {
  return el ? oneLine(el.textContent ?? '') : ''
}

export function metaContent(doc: Document, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const v = doc.querySelector(sel)?.getAttribute('content')
    if (v && v.trim()) return oneLine(v)
  }
  return null
}

export function absoluteUrl(href: string | null | undefined, base: URL): string | null {
  if (!href) return null
  try {
    const u = new URL(href, base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Extract a balanced JSON object/array starting at `start` (which must point at "{" or "[").
 * String-aware, so braces inside strings don't confuse it.
 */
export function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
