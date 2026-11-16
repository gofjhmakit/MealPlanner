import { describe, expect, it } from 'vitest'
import { BOOKMARKLET } from '../src/ui/components/bookmarklet'

describe('copy-HTML bookmarklet', () => {
  it('is a javascript: URL that grabs the page source and copies it', () => {
    expect(BOOKMARKLET.startsWith('javascript:')).toBe(true)
    expect(BOOKMARKLET).toContain('document.documentElement.outerHTML')
    expect(BOOKMARKLET).toContain('navigator.clipboard.writeText')
  })

  it('is syntactically valid JavaScript (guards the string escaping)', () => {
    const body = BOOKMARKLET.replace(/^javascript:/, '')
    // Parses the body without running it; throws on unbalanced quotes / broken escaping.
    expect(() => new Function(body)).not.toThrow()
  })

  it('carries the newline as a literal escape, not an actual newline', () => {
    expect(BOOKMARKLET).toContain('<!doctype html>\\n')
    expect(BOOKMARKLET).not.toContain('\n') // the whole thing is a single line
  })
})
