/**
 * Household allergies: ingredients a person can't eat, written as plain words ("papu, appelsiini").
 * Deliberately literal – "papu" finds pavut, papuja and kidneypavut, but nothing is guessed from
 * food groups (lentils are not beans, coffee is not a bean). Recipes that mention a word are left
 * out of suggestions; people must still check the ingredients themselves.
 */
import { lemmaCandidates } from './finnish'
import type { Person, Recipe } from './types'

/** Consonant gradation, strong → weak, for the last syllable boundary ("papu" → "pavu"). */
const GRADATION: [RegExp, string][] = [
  [/kk([aeiouyäö]+)$/, 'k$1'],
  [/pp([aeiouyäö]+)$/, 'p$1'],
  [/tt([aeiouyäö]+)$/, 't$1'],
  [/nk([aeiouyäö]+)$/, 'ng$1'],
  [/mp([aeiouyäö]+)$/, 'mm$1'],
  [/lt([aeiouyäö]+)$/, 'll$1'],
  [/nt([aeiouyäö]+)$/, 'nn$1'],
  [/rt([aeiouyäö]+)$/, 'rr$1'],
  [/([aeiouyäöhlr])p([aeiouyäö]+)$/, '$1v$2'],
  [/([aeiouyäöh])t([aeiouyäö]+)$/, '$1d$2'],
  // and back, for a word typed in the plural ("pavut" → "papu")
  [/([aeiouyäö])v([aeiouyäö]+)$/, '$1p$2'],
]

/** The forms of one allergy word that are looked for in recipe words. */
function forms(word: string): string[] {
  const out = new Set<string>()
  for (const base of lemmaCandidates(word.trim().toLowerCase()).slice(0, 2)) {
    if (base.length < 3) continue
    out.add(base)
    for (const [re, to] of GRADATION) if (re.test(base)) out.add(base.replace(re, to))
    // "pähkinä" also finds "pähkinöitä": the stem without its last vowel, for longer words only.
    if (base.length >= 6 && /[aeiouyäö]$/.test(base)) out.add(base.slice(0, -1))
  }
  return [...out]
}

/** Allergy words of the whole household, deduplicated ("Papu" and "papu" once). */
export function householdAllergies(people: Person[]): string[] {
  return [...new Set(people.flatMap((p) => p.allergies ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean))]
}

/** Split what the user typed ("papu, appelsiini; lime") into words. */
export function parseAllergies(text: string): string[] {
  return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
}

/** Which of the allergy words the recipe's title or ingredient lines mention. */
export function allergensIn(recipe: Recipe, allergies: string[]): string[] {
  if (!allergies.length) return []
  const text = [recipe.title, ...recipe.ingredients.flatMap((i) => [i.raw, i.name])].join(' ').toLowerCase()
  const words = new Set(text.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3))
  const haystack = [...words].flatMap((w) => lemmaCandidates(w))
  return allergies.filter((a) => {
    const fs = forms(a)
    // A word's start ("papuja"), a compound's end ("kidneypavut") or, for long words, anywhere ("appelsiininmehu").
    return haystack.some((h) => fs.some((f) => h.startsWith(f) || (f.length >= 4 && h.endsWith(f)) || (f.length >= 5 && h.includes(f))))
  })
}
