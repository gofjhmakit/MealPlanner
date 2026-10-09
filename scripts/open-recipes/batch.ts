/**
 * Helper for translating the open recipe catalogue batch by batch (see data/open-recipes/TRANSLATION.md).
 *
 *   npm run recipes:batch -- next                 # missing batches per source, in work order
 *   npm run recipes:batch -- show wikibooks 38    # the English input of one batch, compactly
 *   npm run recipes:batch -- verify wikibooks 38  # checks fi/wikibooks/038.json against its input
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DATA = resolve(import.meta.dirname, '../../data/open-recipes')
const SOURCES = ['kitchengadget', 'myplate', 'unitools', 'forkrecipe', 'wikibooks']
const CATEGORIES = ['Aamiainen', 'Pääruoat', 'Keitot', 'Salaatit', 'Lisukkeet', 'Kastikkeet ja dipit', 'Leivät ja leivonnaiset', 'Jälkiruoat', 'Välipalat', 'Juomat', 'Säilykkeet', 'Muut']
const SIZE = 25

interface EnRecipe {
  id: string
  title: string
  description?: string
  servings?: number
  prepTimeMin?: number
  cookTimeMin?: number
  totalTimeMin?: number
  category?: string
  tags?: string[]
  ratioAmounts?: boolean
  ingredients: { text: string; group?: string }[]
  instructions: string[]
  notes?: string[]
}

const en = (source: string): EnRecipe[] => JSON.parse(readFileSync(join(DATA, 'en', `${source}.json`), 'utf8'))
const pad = (n: number) => String(n).padStart(3, '0')
const fiFile = (source: string, n: number) => join(DATA, 'fi', source, `${pad(n)}.json`)

const [cmd, source, nArg] = process.argv.slice(2)
const n = Number(nArg)

if (cmd === 'next') {
  for (const s of SOURCES) {
    const batches = Math.ceil(en(s).length / SIZE)
    const missing = Array.from({ length: batches }, (_, i) => i).filter((i) => !existsSync(fiFile(s, i)))
    console.log(`${s.padEnd(14)} ${missing.length ? `${missing.length} missing: ${missing.map(pad).join(' ')}` : 'done'}`)
  }
} else if (cmd === 'show' && SOURCES.includes(source) && n >= 0) {
  en(source)
    .slice(n * SIZE, n * SIZE + SIZE)
    .forEach((r, i) => {
      console.log(`\n### ${n * SIZE + i} ${r.id} | ${r.title} | servings=${r.servings ?? '?'} prep=${r.prepTimeMin ?? '-'} cook=${r.cookTimeMin ?? '-'} total=${r.totalTimeMin ?? '-'} cat=${r.category ?? '-'}${r.ratioAmounts ? ' RATIO' : ''}`)
      if (r.description) console.log(`D: ${r.description}`)
      let group: string | undefined
      for (const ing of r.ingredients) {
        if (ing.group !== group) console.log(`  [${(group = ing.group) ?? ''}]`)
        console.log(`  - ${ing.text}`)
      }
      r.instructions.forEach((s, j) => console.log(`  ${j + 1}. ${s}`))
      if (r.notes?.length) console.log(`N: ${r.notes.join(' | ')}`)
    })
} else if (cmd === 'verify' && SOURCES.includes(source) && n >= 0) {
  const expected = en(source).slice(n * SIZE, n * SIZE + SIZE)
  const errors: string[] = []
  let batch: Record<string, unknown>[] = []
  try {
    batch = JSON.parse(readFileSync(fiFile(source, n), 'utf8'))
    if (!Array.isArray(batch)) throw new Error('not a JSON array')
  } catch (e) {
    errors.push(`cannot read ${fiFile(source, n)}: ${(e as Error).message}`)
  }
  if (batch.length !== expected.length) errors.push(`has ${batch.length} entries, expected ${expected.length}`)
  expected.forEach((r, i) => {
    const fi = batch[i]
    if (!fi) return
    const at = `#${i} ${r.id}`
    if (fi.id !== r.id) return errors.push(`${at}: id is "${fi.id}" (ids must be copied exactly, in input order)`)
    for (const k of ['source', 'author', 'license', 'licenseUrl', 'image', 'sourceUrl']) if (k in fi) errors.push(`${at}: remove "${k}" (attribution comes from the English input)`)
    if (fi.skip) return typeof fi.skip === 'string' ? undefined : errors.push(`${at}: skip must be a reason string`)
    if (!fi.title || typeof fi.title !== 'string') errors.push(`${at}: missing title`)
    if (!(typeof fi.servings === 'number' && fi.servings > 0)) errors.push(`${at}: servings must be a positive number`)
    if (!CATEGORIES.includes(fi.category as string)) errors.push(`${at}: category "${fi.category}" is not one of ${CATEGORIES.join(', ')}`)
    for (const k of ['ingredients', 'instructions', 'tags'] as const) if (!Array.isArray(fi[k]) || !(fi[k] as unknown[]).length || (fi[k] as unknown[]).some((x) => typeof x !== 'string')) errors.push(`${at}: ${k} must be a non-empty array of strings`)
    const text = [fi.title, fi.description, ...((fi.ingredients as string[]) ?? []), ...((fi.instructions as string[]) ?? [])].join('\n')
    const leftover = text.match(/\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|ounces?|oz|lbs?|pounds?|pints?|quarts?|gallons?|inch(es)?|sticks?)\b|°\s?F\b|\d+\s?F\b|\b\d+\s?(degrees|astetta) F/gi)
    if (leftover) errors.push(`${at}: imperial/English units left: ${[...new Set(leftover)].join(', ')}`)
    const odd = ((fi.ingredients as string[]) ?? []).filter((l) => /(^|\s)([3-9]|\d{2,})[¼¾⅓⅔⅛]\s*(dl|l)\b|\d+,(?!25\b|75\b)\d{2,}\s*(dl|l|kg)\b/.test(l))
    if (odd.length) errors.push(`${at}: round to what a cook measures (e.g. "4¾ dl" → "5 dl", "2,37 dl" → "2,5 dl"): ${odd.join(' | ')}`)
  })
  console.log(errors.length ? errors.join('\n') : `OK ${source}/${pad(n)}.json (${batch.length} entries, ${batch.filter((x) => x.skip).length} skipped)`)
  process.exitCode = errors.length ? 1 : 0
} else {
  console.log('usage: npm run recipes:batch -- next | show <source> <batch> | verify <source> <batch>')
  process.exitCode = 2
}
