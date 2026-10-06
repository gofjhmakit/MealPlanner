/**
 * Builds the app's open recipe catalogue from the Finnish translations.
 *
 *   npm run recipes:build
 *
 * Reads   data/open-recipes/en/<source>.json      (English originals + attribution)
 *         data/open-recipes/fi/<source>/*.json     (Finnish translations, see TRANSLATION.md)
 * Writes  public/data/open-recipes/index.json      (sources, licences, version)
 *         public/data/open-recipes/<source>.json   (recipes the app loads)
 *         data/open-recipes/not_recognized.md      (ingredients the Fineli matcher could not map)
 *
 *   npm run recipes:build -- --check unitools,forkrecipe
 *     Read-only check of some sources: prints match rate, problems and the most common
 *     unrecognized ingredients, writes nothing (safe to run while others translate).
 *
 * Attribution (author, source URL, licence, image credit) always comes from the English
 * input, never from the translation, so it can't be lost in translation.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runnerImport } from 'vite'
import type { EnRecipe } from './normalize.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const DATA = join(ROOT, 'data', 'open-recipes')
const OUT = join(ROOT, 'public', 'data', 'open-recipes')

/** What was changed (CC BY-SA asks for it). The app adds the share-alike sentence per recipe licence. */
const TRANSLATED = 'Suomennettu ja mitat muunnettu metrisiksi (koneellinen käännös).'

/** Shown in the app (Settings → Reseptiaineistot) and on every recipe from the source. */
export const OPEN_SOURCES = [
  {
    id: 'kitchengadget',
    name: 'KitchenGadget8000',
    homepage: 'https://github.com/gofjhmakit/KitchenGadget8000',
    license: 'Apache-2.0 / CC BY-SA 4.0',
    attribution: 'Hermanni Mäkitalo – KitchenGadget8000-reseptikokoelma. Osa resepteistä on Marcus Baw’n kokoelmasta pacharanero/recipes (CC BY-SA 4.0).',
    changes: TRANSLATED,
  },
  {
    id: 'myplate',
    name: 'USDA MyPlate Kitchen',
    homepage: 'https://myplate.food/recipes',
    license: 'Public domain (U.S. federal work)',
    attribution: 'U.S. Department of Agriculture, Center for Nutrition Policy and Promotion – MyPlate Kitchen. Kuvat ja säilytetty kokoelma: MyPlate.food.',
    changes: TRANSLATED,
  },
  {
    id: 'unitools',
    name: 'UniTools – maailman reseptit',
    homepage: 'https://theunitools.com/en/data',
    license: 'CC BY-SA 4.0',
    attribution: 'UniTools — theunitools.com. Valokuvat Wikimedia Commonsista, kuvakohtaiset tekijät ja lisenssit reseptin kuvan yhteydessä.',
    changes: TRANSLATED,
  },
  {
    id: 'forkrecipe',
    name: 'ForkRecipe',
    homepage: 'https://github.com/futurechef/forkrecipe-recipes',
    license: 'CC BY-SA 4.0',
    attribution: 'ForkRecipe open recipe dataset (forkrecipe.com) ja sen tekijät.',
    changes: `${TRANSLATED} Suhteelliset määrät (osat) muunnettu noin neljän annoksen määriksi.`,
  },
  {
    id: 'wikibooks',
    name: 'Wikibooks Cookbook',
    homepage: 'https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents',
    license: 'CC BY-SA 4.0',
    attribution: 'Wikibooksin Cookbook-hankkeen kirjoittajat (aineistokooste: gossminn/wikibooks-cookbook, 2024-07-31).',
    changes: TRANSLATED,
  },
  {
    id: 'recipearchive',
    name: 'Open Recipe Archive – Victorian Britain',
    homepage: 'https://github.com/AdamBouhmad/open-recipe-archive',
    license: 'Public domain',
    attribution: 'Isabella Beeton, The Book of Household Management (1861); kooste: Open Recipe Archive.',
    changes: 'Suomennettu ja mitat muunnettu metrisiksi.',
  },
  {
    id: 'openrecipeproject',
    name: 'Open Recipe Project',
    homepage: 'https://github.com/reZach/open-recipe-project',
    license: 'CC0',
    attribution: 'Open Recipe Project. Reseptit ja niiden valokuvat CC0.',
    changes: TRANSLATED,
  },
] as const

export const CATEGORIES = ['Aamiainen', 'Pääruoat', 'Keitot', 'Salaatit', 'Lisukkeet', 'Kastikkeet ja dipit', 'Leivät ja leivonnaiset', 'Jälkiruoat', 'Välipalat', 'Juomat', 'Säilykkeet', 'Muut']

interface FiRecipe {
  id: string
  skip?: string
  title?: string
  description?: string
  servings?: number
  servingsEstimated?: boolean
  prepTimeMin?: number
  cookTimeMin?: number
  totalTimeMin?: number
  category?: string
  tags?: string[]
  ingredients?: string[]
  instructions?: string[]
  notes?: string[]
}

/** One recipe in public/data/open-recipes/<source>.json (see src/db/openRecipes.ts). */
export interface OpenRecipeRecord {
  id: string
  title: string
  originalTitle: string
  description?: string
  servings: number
  servingsEstimated?: boolean
  prepTimeMin?: number
  cookTimeMin?: number
  totalTimeMin?: number
  category: string
  cuisine?: string
  tags: string[]
  ingredients: string[]
  instructions: string[]
  notes?: string[]
  image?: { url: string; credit: string; license: string; licenseUrl?: string }
  sourceUrl?: string
  author?: string
  license: string
  licenseUrl?: string
}

// --- load the app's own parser + matcher ---------------------------------------------------------
// (typed locally: the app sources use bundler-style imports that this tsconfig can't follow)
interface ParsedIngredient { raw: string; name: string; fineliId?: number | null; confidence: number }
type RecipeIngredientsModule = { buildIngredientList(lines: string[], ctx: object): ParsedIngredient[] }
const { module: ri } = await runnerImport<RecipeIngredientsModule>('/src/domain/recipeIngredients.ts', { root: ROOT, configFile: false, logLevel: 'error' })
type RecipeTypesModule = { withRecipeType<T extends { title: string; category: string | null; tags: string[] }>(recipe: T): T }
const { module: recipeTypes } = await runnerImport<RecipeTypesModule>('/src/domain/recipeType.ts', { root: ROOT, configFile: false, logLevel: 'error' })
const foods = (JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'fineli-foods.json'), 'utf8')) as { foods: { id: number }[] }).foods
const foodMap = new Map(foods.map((f) => [f.id, f]))
const fineli = { get: (id: number) => foodMap.get(id), all: () => foods }
const ctx = { fineli }

// --- build ---------------------------------------------------------------------------------------
const checkArg = process.argv.indexOf('--check')
const checkOnly = checkArg > 0 ? new Set((process.argv[checkArg + 1] ?? '').split(',').filter(Boolean)) : null
if (!checkOnly) {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
}

const unknown = new Map<string, { count: number; examples: Set<string>; lines: Set<string> }>()
const problems: string[] = []
const index: { version: string; generatedAt: string; sources: unknown[] } = { version: '', generatedAt: new Date().toISOString(), sources: [] }
const summary: string[] = []
let versionSeed = ''

for (const source of OPEN_SOURCES) {
  if (checkOnly && !checkOnly.has(source.id)) continue
  const enFile = join(DATA, 'en', `${source.id}.json`)
  const fiDir = join(DATA, 'fi', source.id)
  if (!existsSync(enFile) || !existsSync(fiDir)) continue
  const en = new Map((JSON.parse(readFileSync(enFile, 'utf8')) as EnRecipe[]).map((r) => [r.id, r]))
  const records: OpenRecipeRecord[] = []
  let skipped = 0
  let lines = 0
  let matched = 0
  const seen = new Set<string>()
  for (const file of readdirSync(fiDir).filter((f) => f.endsWith('.json')).sort()) {
    let batch: FiRecipe[]
    try {
      batch = JSON.parse(readFileSync(join(fiDir, file), 'utf8'))
    } catch (e) {
      problems.push(`${source.id}/${file}: virheellinen JSON (${(e as Error).message})`)
      continue
    }
    for (const fi of batch) {
      const orig = en.get(fi.id)
      if (!orig) {
        problems.push(`${source.id}/${file}: tuntematon id ${fi.id}`)
        continue
      }
      if (seen.has(fi.id)) continue
      seen.add(fi.id)
      if (fi.skip) {
        skipped++
        continue
      }
      const missing = (['title', 'ingredients', 'instructions'] as const).filter((k) => !fi[k] || (Array.isArray(fi[k]) && !(fi[k] as unknown[]).length))
      if (missing.length || !(fi.servings! > 0)) {
        problems.push(`${source.id}/${file}: ${fi.id} puuttuu ${[...missing, ...(fi.servings! > 0 ? [] : ['servings'])].join(', ')}`)
        continue
      }
      const category = CATEGORIES.includes(fi.category ?? '') ? fi.category! : 'Muut'
      if (fi.category && category !== fi.category) problems.push(`${source.id}/${file}: ${fi.id} tuntematon kategoria "${fi.category}"`)

      for (const ing of ri.buildIngredientList(fi.ingredients!, ctx)) {
        lines++
        if (ing.fineliId && ing.confidence >= 0.5) {
          matched++
          continue
        }
        const key = ing.name.toLowerCase()
        const entry = unknown.get(key) ?? { count: 0, examples: new Set(), lines: new Set() }
        entry.count++
        if (entry.examples.size < 3) entry.examples.add(`${fi.id}`)
        if (entry.lines.size < 2) entry.lines.add(ing.raw)
        unknown.set(key, entry)
      }

      records.push(recipeTypes.withRecipeType({
        id: fi.id,
        title: fi.title!.trim(),
        originalTitle: orig.title,
        description: fi.description?.trim() || undefined,
        servings: fi.servings!,
        servingsEstimated: fi.servingsEstimated || undefined,
        prepTimeMin: fi.prepTimeMin || undefined,
        cookTimeMin: fi.cookTimeMin || undefined,
        totalTimeMin: fi.totalTimeMin || undefined,
        category,
        cuisine: orig.cuisine,
        tags: [...new Set((fi.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))],
        ingredients: fi.ingredients!.map((l) => l.trim()).filter(Boolean),
        instructions: fi.instructions!.map((l) => l.trim()).filter(Boolean),
        notes: fi.notes?.length ? fi.notes : undefined,
        image: orig.image,
        sourceUrl: orig.sourceUrl,
        author: orig.author,
        license: orig.license,
        licenseUrl: orig.licenseUrl,
      }))
    }
  }
  if (!records.length) continue
  const json = JSON.stringify({ source: source.id, recipes: records })
  if (!checkOnly) writeFileSync(join(OUT, `${source.id}.json`), json)
  versionSeed += `${source.id}:${records.length}:${json.length};`
  index.sources.push({ ...source, file: `${source.id}.json`, count: records.length, withImage: records.filter((r) => r.image).length })
  const pct = lines ? Math.round((100 * matched) / lines) : 0
  summary.push(`${source.id.padEnd(14)} ${String(records.length).padStart(5)} reseptiä, ${String(skipped).padStart(4)} ohitettu, ${String(en.size - seen.size).padStart(5)} kääntämättä, aineksista tunnistettu ${pct} % (${(json.length / 1024 / 1024).toFixed(1)} Mt)`)
}

let hash = 0
for (const c of versionSeed) hash = (hash * 31 + c.charCodeAt(0)) | 0
index.version = `${new Date().toISOString().slice(0, 10)}-${(hash >>> 0).toString(36)}`
if (!checkOnly) writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1))

// --- not_recognized.md ---------------------------------------------------------------------------
const rows = [...unknown.entries()].sort((a, b) => b[1].count - a[1].count)
const md = [
  '# Tunnistamattomat ainekset',
  '',
  `Generoitu ${new Date().toISOString().slice(0, 16).replace('T', ' ')} komennolla \`npm run recipes:build\`. Älä muokkaa käsin.`,
  '',
  'Ainekset, joita Fineli-vastaavuuksien haku ei tunnistanut (varmuus alle 50 %). Yleisimmät kannattaa lisätä',
  'ainessanastoon (`src/domain/ingredients.ts`) tai korjata käännösten sanamuotoa.',
  '',
  `Yhteensä ${rows.length} eri nimeä, ${rows.reduce((s, [, e]) => s + e.count, 0)} riviä.`,
  '',
  '| Kertaa | Aines (tunnistettu nimi) | Esimerkkirivit | Reseptit |',
  '|---:|---|---|---|',
  ...rows.map(([name, e]) => `| ${e.count} | ${name.replace(/\|/g, '/')} | ${[...e.lines].join(' · ').replace(/\|/g, '/')} | ${[...e.examples].join(', ')} |`),
  '',
]
if (!checkOnly) writeFileSync(join(DATA, 'not_recognized.md'), md.join('\n'))

console.log(summary.join('\n') || 'Ei käännettyjä reseptejä vielä.')
if (checkOnly) {
  console.log(`\nYleisimmät tunnistamattomat (${rows.length} eri nimeä):`)
  for (const [name, e] of rows.slice(0, 30)) console.log(`  ${String(e.count).padStart(3)}  ${name}  ← ${[...e.lines][0]}`)
} else console.log(`Tunnistamattomia nimiä ${rows.length} → data/open-recipes/not_recognized.md`)
if (problems.length) console.log(`\nOngelmat (${problems.length}):\n  ${problems.slice(0, 40).join('\n  ')}`)
