/**
 * Converts the downloaded open recipe sources (data/open-recipes/raw/) into one common
 * English format, data/open-recipes/en/<source>.json, which is the input for translation.
 *
 *   node scripts/open-recipes/normalize.ts
 *
 * Sources and licences:
 *   kitchengadget  KitchenGadget8000 recipe set (own; 49 recipes from pacharanero/recipes, CC BY-SA 4.0)
 *   myplate        USDA MyPlate Kitchen via myplate.food – public domain (images: MyPlate.food, reuse with credit)
 *   wikibooks      Wikibooks Cookbook (dump 2024-07-31) – CC BY-SA 4.0
 *   unitools       UniTools world recipes v1 – CC BY-SA 4.0 (photos: own Wikimedia Commons licences)
 *   forkrecipe     ForkRecipe open dataset – CC BY-SA 4.0
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../../data/open-recipes')
const RAW = join(ROOT, 'raw')
const OUT = join(ROOT, 'en')

export interface SourceImage {
  url: string
  credit: string
  license: string
  licenseUrl?: string
}

export interface EnRecipe {
  id: string
  source: string
  title: string
  description?: string
  servings?: number
  /** Amounts are relative ("parts", baker's %) and must be scaled to a real batch when translating. */
  ratioAmounts?: boolean
  prepTimeMin?: number
  cookTimeMin?: number
  totalTimeMin?: number
  ingredients: { text: string; group?: string }[]
  instructions: string[]
  notes?: string[]
  tags: string[]
  category?: string
  cuisine?: string
  image?: SourceImage
  sourceUrl?: string
  author?: string
  license: string
  licenseUrl?: string
}

const CC_BY_SA = { license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** "1 hr 30 min", "PT1H30M", "8 h, 10 minutes", "45 min" -> minutes */
export function minutes(text: unknown): number | undefined {
  const s = clean(text).toLowerCase()
  if (!s) return undefined
  const iso = s.match(/^pt(?:(\d+)h)?(?:(\d+)m)?/)
  if (iso && (iso[1] || iso[2])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0)
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)
  const m = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)
  if (!h && !m) return undefined
  return Math.round(Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0)) || undefined
}

function firstNumber(text: unknown): number | undefined {
  const m = clean(text).match(/\d+(?:\.\d+)?/)
  const n = m ? Number(m[0]) : NaN
  return n > 0 && n < 200 ? n : undefined
}

// ---------------------------------------------------------------------------------------------

function kitchengadget(): EnRecipe[] {
  const dir = join(RAW, 'kitchengadget')
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  // 41 files lost part of their ingredient list to a stray YAML block marker ("- >") in the
  // original conversion; leave them out rather than guess the missing ingredients.
  const broken = files.filter((f) => /^- [>|]\s*$/m.test(readFileSync(join(dir, f), 'utf8')))
  if (broken.length) console.warn(`kitchengadget: skipping ${broken.length} recipes with incomplete ingredient lists: ${broken.join(', ')}`)
  return files.filter((f) => !broken.includes(f)).map((f) => {
    const text = readFileSync(join(dir, f), 'utf8')
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim()
    const section = (name: string) => text.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'mi'))?.[1] ?? ''
    const ingredients: EnRecipe['ingredients'] = []
    let group: string | undefined
    for (const line of section('Ingredients').split('\n')) {
      const heading = line.match(/^###\s+(.*)/)
      if (heading) group = clean(heading[1])
      const item = line.match(/^\s*[-*]\s+(.*)/)
      if (item) ingredients.push({ text: clean(item[1]), ...(group ? { group } : {}) })
    }
    const instructions = section('Instructions').split('\n').map((l) => l.match(/^\s*(?:\d+[.)]|[-*])\s+(.*)/)?.[1]).filter(Boolean).map(clean)
    const notes = section('Notes').split('\n').map(clean).filter(Boolean)
    const pacharanero = notes.find((n) => /pacharanero\/recipes/i.test(n))
    const path = pacharanero?.match(/\(([^)]+\.md)\)/)?.[1]
    const tags = (field('tags') ?? '').replace(/[[\]]/g, '').split(',').map(clean).filter(Boolean)
    return {
      id: `kg-${f.replace(/\.md$/, '').replace(/_/g, '-')}`,
      source: 'kitchengadget',
      title: clean(field('title')),
      servings: firstNumber(field('servings')),
      totalTimeMin: minutes(field('time')),
      ingredients,
      instructions,
      notes: notes.filter((n) => n !== pacharanero),
      tags,
      ...(pacharanero
        ? { author: 'Marcus Baw (pacharanero/recipes)', sourceUrl: path ? `https://github.com/pacharanero/recipes/blob/main/${path}` : 'https://github.com/pacharanero/recipes', ...CC_BY_SA }
        : { author: 'Hermanni Mäkitalo (KitchenGadget8000)', sourceUrl: 'https://github.com/gofjhmakit/KitchenGadget8000', license: 'Apache-2.0', licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0' }),
    }
  })
}

function myplate(): EnRecipe[] {
  const dir = join(RAW, 'myplate', 'pages')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const slug = f.replace(/\.json$/, '')
    const steps = (Array.isArray(r.recipeInstructions) ? r.recipeInstructions : [r.recipeInstructions])
      .flatMap((s: any) => (s?.itemListElement ? s.itemListElement : [s]))
      .map((s: any) => clean(typeof s === 'string' ? s : s?.text))
      .filter(Boolean)
    const image = [r.image].flat().find((x: unknown) => typeof x === 'string')
    return {
      id: `myplate-${slug}`,
      source: 'myplate',
      title: clean(r.name),
      description: clean(r.description) || undefined,
      servings: firstNumber(r.recipeYield),
      prepTimeMin: minutes(r.prepTime),
      cookTimeMin: minutes(r.cookTime),
      totalTimeMin: minutes(r.totalTime),
      ingredients: (r.recipeIngredient ?? []).map((t: string) => ({ text: clean(t) })),
      instructions: steps,
      tags: [r.recipeCategory, r.recipeCuisine, ...String(r.keywords ?? '').split(',')].flat().map(clean).filter(Boolean),
      category: clean([r.recipeCategory].flat()[0]) || undefined,
      ...(image ? { image: { url: image, credit: 'MyPlate.food', license: 'Käyttö lähde mainiten', licenseUrl: 'https://myplate.food/recipes' } } : {}),
      sourceUrl: r.url ?? `https://myplate.food/recipes/${slug}`,
      author: 'USDA Center for Nutrition Policy and Promotion (MyPlate Kitchen)',
      license: 'Public domain (U.S. federal work)',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    }
  })
}

function wikibooks(): EnRecipe[] {
  const data = JSON.parse(readFileSync(join(RAW, 'wikibooks', 'recipes_parsed.json'), 'utf8')) as { recipe_data: any }[]
  const out: EnRecipe[] = []
  for (const { recipe_data: r } of data) {
    const lines: { text: string; line_type: string; section: string | null }[] = r.text_lines ?? []
    const isIng = (s: string | null) => !!s && /ingredient/i.test(s)
    const isProc = (s: string | null) => !!s && /(procedure|preparation|method|directions|instructions|steps)/i.test(s)
    const isNote = (s: string | null) => !!s && /(note|tip|variation|serving)/i.test(s)
    const ingredients: EnRecipe['ingredients'] = []
    for (const l of lines) {
      if (!isIng(l.section)) continue
      if (l.line_type === 'ul' || l.line_type === 'ol') ingredients.push({ text: clean(l.text) })
      else if (/^h[3-6]$|^p$/.test(l.line_type) && clean(l.text).length < 60 && ingredients.length >= 0) {
        // sub-headings such as "Dough" / "Filling" become ingredient groups
        const g = clean(l.text).replace(/:$/, '')
        if (g && !/[.!?]$/.test(g)) ingredients.push({ text: `### ${g}` })
      }
    }
    // turn "### group" markers into group fields
    let group: string | undefined
    const ings = ingredients.flatMap((i) => {
      if (i.text.startsWith('### ')) {
        group = i.text.slice(4)
        return []
      }
      return [{ text: i.text, ...(group ? { group } : {}) }]
    })
    const instructions = lines.filter((l) => isProc(l.section) && (l.line_type === 'ol' || l.line_type === 'ul' || l.line_type === 'p')).map((l) => clean(l.text)).filter(Boolean)
    if (ings.length < 2 || instructions.length < 1) continue
    const category = clean(decodeURIComponent(String(r.infobox?.category ?? '').replace(/^\/wiki\/Category:/, '')).replace(/_/g, ' ')) || undefined
    out.push({
      id: `wikibooks-${String(r.url).split('Cookbook:').pop()!.replace(/%[0-9A-F]{2}/gi, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`,
      source: 'wikibooks',
      title: clean(r.title),
      description: clean(lines.find((l) => !l.section && l.line_type === 'p')?.text) || undefined,
      servings: firstNumber(r.infobox?.servings),
      totalTimeMin: minutes(r.infobox?.time),
      ingredients: ings,
      instructions,
      notes: lines.filter((l) => isNote(l.section)).map((l) => clean(l.text)).filter(Boolean),
      tags: category ? [category.replace(/ recipes$/i, '')] : [],
      category,
      sourceUrl: r.url,
      author: 'Wikibooks contributors',
      ...CC_BY_SA,
    })
  }
  // The dump contains a few duplicate pages (redirect targets); keep the first.
  const seen = new Set<string>()
  return out.filter((r) => !seen.has(r.id) && seen.add(r.id))
}

function unitools(): EnRecipe[] {
  const d = JSON.parse(readFileSync(join(RAW, 'unitools', 'unitools-recipes-v1.json'), 'utf8'))
  const UNIT: Record<string, string> = { piece: '', toTaste: 'to taste', slice: 'slice', sprig: 'sprig', clove: 'clove', pinch: 'pinch' }
  const country = new Map<string, string>((d.countries ?? []).map((c: any) => [c.code, c.cuisine?.en ?? c.name?.en]))
  return d.recipes.map((r: any) => ({
    id: `unitools-${r.slug}`,
    source: 'unitools',
    title: clean(r.name?.en),
    description: [clean(r.summary?.en), r.nativeName ? `(${clean(r.nativeName)})` : ''].filter(Boolean).join(' ') || undefined,
    servings: r.baseServings,
    prepTimeMin: r.prepMinutes ?? undefined,
    cookTimeMin: r.cookMinutes ?? undefined,
    ingredients: r.ingredients.map((i: any) => {
      const unit = i.unit in UNIT ? UNIT[i.unit] : i.unit
      const text = i.unit === 'toTaste' ? `${clean(i.name?.en)}, to taste` : [i.quantity ?? '', unit, clean(i.name?.en)].filter((x) => x !== '').join(' ')
      return { text: i.note?.en ? `${text} (${clean(i.note.en)})` : text }
    }),
    instructions: r.steps.map((s: any) => clean(s.text?.en)),
    tags: [r.category, ...(r.diets ?? [])].filter(Boolean),
    category: r.category,
    cuisine: country.get(r.country),
    ...(r.photo?.url ? { image: { url: r.photo.url, credit: clean(r.photo.author) || 'Wikimedia Commons', license: clean(r.photo.license) || 'ks. lähde' } } : {}),
    sourceUrl: `https://theunitools.com/en/recipes/${r.slug}`,
    author: 'UniTools (theunitools.com)',
    ...CC_BY_SA,
  }))
}

async function forkrecipe(): Promise<EnRecipe[]> {
  const dir = join(RAW, 'forkrecipe', 'repo', 'recipes')
  const out: EnRecipe[] = []
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.js') || f.startsWith('_') || f === 'index.js') continue
    const r = (await import(pathToFileURL(join(dir, f)).href)).default
    const ratio = r.ratioSystem !== 'weight'
    out.push({
      id: `forkrecipe-${r.slug}`,
      source: 'forkrecipe',
      title: clean(r.title),
      description: clean(r.description) || undefined,
      servings: firstNumber(r.servings),
      ratioAmounts: ratio || undefined,
      totalTimeMin: minutes(r.totalTime),
      prepTimeMin: minutes(r.activeTime),
      ingredients: r.ingredients.map((i: any) => ({ text: [i.ratioValue ?? '', i.defaultUnit ?? '', clean(i.name)].filter((x) => x !== '').join(' ') })),
      instructions: (r.processNodes ?? []).map((n: any) => clean(n.instructions)).filter(Boolean),
      notes: r.forkNote ? [clean(r.forkNote)] : undefined,
      tags: r.tags ?? [],
      category: r.category,
      cuisine: r.cuisine,
      sourceUrl: `https://forkrecipe.com/recipe/${r.slug}`,
      author: clean(r.author) || 'ForkRecipe',
      ...CC_BY_SA,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true })
const sources: Record<string, () => EnRecipe[] | Promise<EnRecipe[]>> = { kitchengadget, myplate, wikibooks, unitools, forkrecipe }
const only = process.argv.slice(2)
for (const [name, load] of Object.entries(sources)) {
  if (only.length && !only.includes(name)) continue
  const recipes = (await load()).filter((r) => r.title && r.ingredients.length && r.instructions.length)
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(recipes, null, 1))
  const withImage = recipes.filter((r) => r.image).length
  console.log(`${name.padEnd(14)} ${String(recipes.length).padStart(5)} recipes, ${withImage} with image`)
}
