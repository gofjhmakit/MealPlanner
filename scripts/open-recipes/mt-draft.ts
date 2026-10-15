/**
 * Machine-translation drafts for catalogue batches (DeepL API Free), to post-edit into fi/<source>/NNN.json.
 * Only recipe text is sent; the key is read from .env (`DEEPL_API_KEY=…` or `deepl:…`) and never printed.
 *
 *   node scripts/open-recipes/mt-draft.ts <source> <batch> [<batch> …]
 *   node scripts/open-recipes/mt-draft.ts --usage
 * Output: design/research/mt/<source>-NNN.json  [{ id, title, description, ingredients[], instructions[], notes[], meta }]
 * Already drafted batches are skipped, so re-running costs nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')
const OUT = join(ROOT, 'design/research/mt')
const API = 'https://api-free.deepl.com/v2'
const UA = 'RecipeToolCatalogue/1.0 (open recipe catalogue builder)'

const env = readFileSync(join(ROOT, '.env'), 'utf8')
const key = (env.match(/^\s*DEEPL_API_KEY\s*=\s*(\S+)/m) ?? env.match(/^\s*deepl\s*[:=]\s*(\S+)/im))?.[1]
if (!key) throw new Error('No DeepL key in .env (expected DEEPL_API_KEY=… or deepl:…)')
const headers = { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json', 'User-Agent': UA }

async function usage() {
  const res = await fetch(`${API}/usage`, { headers })
  if (!res.ok) throw new Error(`usage: ${res.status}`)
  const u = (await res.json()) as { character_count: number; character_limit: number }
  console.log(`DeepL: ${u.character_count.toLocaleString('fi')} / ${u.character_limit.toLocaleString('fi')} merkkiä käytetty`)
}

async function translate(texts: string[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < texts.length; i += 50) {
    const body = JSON.stringify({ text: texts.slice(i, i + 50), source_lang: 'EN', target_lang: 'FI', formality: 'prefer_less', context: 'Cooking recipe (title, ingredients, method).' })
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}/translate`, { method: 'POST', headers, body })
      if (res.status === 429 || res.status >= 500) {
        if (attempt > 5) throw new Error(`translate: ${res.status}`)
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
        continue
      }
      if (!res.ok) throw new Error(`translate: ${res.status} ${await res.text()}`)
      out.push(...((await res.json()) as { translations: { text: string }[] }).translations.map((t) => t.text))
      break
    }
  }
  return out
}

const args = process.argv.slice(2)
if (args[0] === '--usage' || !args.length) {
  await usage()
  process.exit(0)
}
const [source, ...batches] = args
const recipes = JSON.parse(readFileSync(join(ROOT, 'data/open-recipes/en', `${source}.json`), 'utf8')) as any[]
mkdirSync(OUT, { recursive: true })
for (const b of batches.map(Number)) {
  const file = join(OUT, `${source}-${String(b).padStart(3, '0')}.json`)
  if (existsSync(file)) {
    console.log(`${file}: on jo, ohitetaan`)
    continue
  }
  const chunk = recipes.slice(b * 25, b * 25 + 25)
  // One flat list per batch, so a batch is only a handful of requests.
  const texts: string[] = []
  const slots = chunk.map((r) => {
    const take = (xs: string[]) => {
      const start = texts.length
      texts.push(...xs)
      return [start, texts.length] as const
    }
    return {
      title: take([r.title]),
      description: take(r.description ? [r.description] : []),
      ingredients: take(r.ingredients.map((i: any) => (i.group ? `[${i.group}] ` : '') + i.text)),
      instructions: take(r.instructions),
      notes: take(r.notes ?? []),
    }
  })
  const fi = await translate(texts.map((t) => t || ' '))
  const pick = ([a, z]: readonly [number, number]) => fi.slice(a, z)
  const drafts = chunk.map((r, k) => ({
    id: r.id,
    title: pick(slots[k].title)[0],
    description: pick(slots[k].description)[0] ?? '',
    ingredients: pick(slots[k].ingredients),
    instructions: pick(slots[k].instructions),
    notes: pick(slots[k].notes),
    meta: { servings: r.servings, prepTimeMin: r.prepTimeMin, cookTimeMin: r.cookTimeMin, totalTimeMin: r.totalTimeMin, ratioAmounts: r.ratioAmounts, category: r.category, en: { title: r.title, ingredients: r.ingredients.map((i: any) => i.text) } },
  }))
  writeFileSync(file, JSON.stringify(drafts, null, 1))
  console.log(`${file}: ${drafts.length} reseptiä, ${texts.join('').length.toLocaleString('fi')} merkkiä`)
}
await usage()
