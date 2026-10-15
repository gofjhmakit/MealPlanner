/**
 * Turns a DeepL draft (design/research/mt/<source>-NNN.json) plus a short hand-written patch
 * (design/research/mt/<source>-NNN.patch.json) into the catalogue batch fi/<source>/NNN.json.
 * US units in the draft are converted to metric first (cups → dl, tsp → tl, oz → g, °F → °C …).
 *
 *   node scripts/open-recipes/mt-apply.ts <source> <batch>          writes the batch
 *   node scripts/open-recipes/mt-apply.ts <source> <batch> --show   prints the unit-converted draft compactly
 *
 * Patch: { "<id>": { "skip": "syy" } | {
 *   "cat": "Pääruoat", "tags": ["…"], "serv": 4, "est": true,          // est = servingsEstimated (default: no servings in source)
 *   "title": "…", "desc": "…",                                          // optional overrides
 *   "ing": { "3": "uusi rivi", "5": null, "+": ["lisärivi"] },          // replace / drop (null) / append lines (0-based)
 *   "steps": { "0": "…" }, "ingAll": [...], "stepsAll": [...], "notes": [...] } }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')
const [source, batchArg, flag] = process.argv.slice(2)
const nnn = String(Number(batchArg)).padStart(3, '0')
const draft = JSON.parse(readFileSync(join(ROOT, 'design/research/mt', `${source}-${nnn}.json`), 'utf8')) as any[]

const num = (s: string) => {
  const frac: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }
  let v = 0
  for (const part of s.trim().split(/\s+/)) {
    if (frac[part]) v += frac[part]
    else if (/^\d+\/\d+$/.test(part)) v += Number(part.split('/')[0]) / Number(part.split('/')[1])
    else if (/^\d+[½¼¾⅓⅔⅛]$/.test(part)) v += Number(part.slice(0, -1)) + frac[part.slice(-1)]
    else v += Number(part.replace(',', '.'))
  }
  return v
}
const fmt = (v: number) => {
  const r = Math.round(v * 2) / 2
  const whole = Math.floor(r)
  return r - whole === 0.5 ? (whole ? `${whole},5` : '½') : String(whole)
}
const N = String.raw`(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d*[½¼¾⅓⅔⅛])`
function metric(line: string): string {
  return line
    .replace(new RegExp(`${N}\\s*(?:kupillista|kupillinen|kuppia|kuppi|kupin|cups?)\\b`, 'gi'), (_, n) => `${fmt(num(n) * 2.4)} dl`)
    .replace(new RegExp(`${N}\\s*(?:ruokalusikallista|ruokalusikallinen|ruokalusikkaa|rkl\\.?)`, 'gi'), (_, n) => `${n} rkl`)
    .replace(new RegExp(`${N}\\s*(?:teelusikallista|teelusikallinen|teelusikkaa|tl\\.?)`, 'gi'), (_, n) => `${n} tl`)
    .replace(new RegExp(`${N}\\s*(?:unssia|unssi|oz\\.?)`, 'gi'), (_, n) => `${Math.round((num(n) * 28) / 5) * 5} g`)
    .replace(new RegExp(`${N}\\s*(?:naulaa|naula|paunaa|pauna|lb\\.?|lbs\\.?)`, 'gi'), (_, n) => `${Math.round((num(n) * 450) / 25) * 25} g`)
    .replace(new RegExp(`${N}\\s*(?:gallonaa|gallona|gallons?)\\b`, 'gi'), (_, n) => `${fmt(num(n) * 3.8)} l`)
    .replace(new RegExp(`${N}\\s*(?:quartia|quarts?|quartin)\\b`, 'gi'), (_, n) => `${fmt(num(n) * 9.5)} dl`)
    .replace(new RegExp(`${N}\\s*(?:pinttiä|pinttia|pintti|pints?)\\b`, 'gi'), (_, n) => `${fmt(num(n) * 4.7)} dl`)
    .replace(new RegExp(`${N}\\s*(?:tuumaa|tuuman|tuuma)`, 'gi'), (_, n) => `${Math.round(num(n) * 2.5)} cm`)
    .replace(/(\d+)\s*°\s*F:?(?:een|iin|n)?\s*(?:\(~?\s*\d+\s*°\s*C\))?/g, (_, f) => `${Math.round(((Number(f) - 32) * 5) / 9 / 5) * 5} asteeseen`)
    .replace(/\b(\d+\s+(?:isoa|keskikokoista|pientä)?\s*)munaa\b/g, '$1kananmunaa')
    .replace(/^(Suola|Pippuri|Mustapippuri|Öljy|Vesi|Voi|Sokeri)$/, (w) => ({ Suola: 'suolaa', Pippuri: 'mustapippuria', Mustapippuri: 'mustapippuria', Öljy: 'rypsiöljyä', Vesi: 'vettä', Voi: 'voita', Sokeri: 'sokeria' })[w]!)
    .replace(/(\d+)\s*°C:?(?:een|iin|n)?\s*(?:\([^)]*\))?/g, '$1 asteeseen')
    .replace(/(\d[\d,½¼¾]*\s*(?:dl|g|ml|l|kg|cm))\s*\((?:~?\s*[\d.,]+\s*(?:g|ml|dl|l|cm|US fl oz)[^)]*)\)/g, '$1')
    .replace(/\s*\(\d+ asteeseen\)/g, '')
    .replace(/asteeseen asteeseen/g, 'asteeseen')
    .replace(/\s+\./g, '.')
    .replace(/\.$/, (m) => (/^\d/.test(line) ? '' : m))
}

const items = draft.map((d) => ({ ...d, ingredients: d.ingredients.map(metric), instructions: d.instructions.map(metric) }))

if (flag === '--show') {
  for (const d of items) {
    const m = d.meta
    console.log(`## ${d.id} | ${d.title} | ${m.en.title} | serv=${m.servings ?? '-'} t=${m.totalTimeMin ?? '-'} cat=${m.category ?? '-'}${m.ratioAmounts ? ' RATIO' : ''}`)
    d.ingredients.forEach((l: string, i: number) => console.log(`  i${i}: ${l}`))
    d.instructions.forEach((l: string, i: number) => console.log(`  s${i}: ${l.slice(0, 160)}`))
  }
  process.exit(0)
}

const patch = JSON.parse(readFileSync(join(ROOT, 'design/research/mt', `${source}-${nnn}.patch.json`), 'utf8'))
const CATS = ['Aamiainen', 'Pääruoat', 'Keitot', 'Salaatit', 'Lisukkeet', 'Kastikkeet ja dipit', 'Leivät ja leivonnaiset', 'Jälkiruoat', 'Välipalat', 'Juomat', 'Säilykkeet', 'Muut']
const edit = (lines: string[], p: Record<string, string | null | string[]> | undefined) => {
  if (!p) return lines
  const out = lines.map((l, i) => (String(i) in p ? (p[String(i)] as string | null) : l)).filter((l): l is string => l !== null)
  return [...out, ...((p['+'] as string[]) ?? [])]
}
const result = items.map((d) => {
  const p = patch[d.id]
  if (!p) throw new Error(`patch puuttuu: ${d.id}`)
  if (p.skip) return { id: d.id, skip: p.skip }
  if (!CATS.includes(p.cat)) throw new Error(`${d.id}: tuntematon kategoria ${p.cat}`)
  const m = d.meta
  const servings = p.serv ?? m.servings
  if (!servings) throw new Error(`${d.id}: annosmäärä puuttuu`)
  const r: any = { id: d.id, title: p.title ?? d.title, description: (p.desc ?? d.description) || undefined, servings }
  if (p.est ?? !m.servings) r.servingsEstimated = true
  for (const k of ['prepTimeMin', 'cookTimeMin', 'totalTimeMin']) if (m[k]) r[k] = m[k]
  r.category = p.cat
  r.tags = p.tags
  r.ingredients = p.ingAll ?? edit(d.ingredients, p.ing)
  r.instructions = p.stepsAll ?? edit(d.instructions, p.steps)
  const notes = p.notes ?? d.notes
  if (notes?.length) r.notes = notes
  return r
})
writeFileSync(join(ROOT, 'data/open-recipes/fi', source, `${nnn}.json`), JSON.stringify(result, null, 1))
console.log(`fi/${source}/${nnn}.json: ${result.filter((r) => !r.skip).length} reseptiä, ${result.filter((r) => r.skip).length} ohitettu`)
