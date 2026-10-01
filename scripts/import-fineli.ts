/**
 * Fineli open data importer.
 *
 * Reads the official Fineli "basic package" (Ravintoarvopaketti) – either the
 * downloaded .zip or an extracted directory – and produces two compact JSON
 * files that the web app loads into IndexedDB on first start:
 *
 *   public/data/fineli-foods.json   foods + nutrients per 100 g + household units + diets
 *   public/data/fineli-dishes.json  Fineli "DISH" recipes (contribfood rows) for the catalogue
 *
 * Usage:
 *   npm run fineli:import                         # uses data/fineli-source/ (downloads mirror if missing)
 *   npm run fineli:import -- --source ~/Downloads/Fineli_Rel20.zip
 *   npm run fineli:import -- --source ./some/extracted/dir
 *
 * Data © Finnish Institute for Health and Welfare (THL), Fineli, licensed CC BY 4.0.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_SOURCE = join(ROOT, 'data', 'fineli-source')
const OUT_DIR = join(ROOT, 'public', 'data')

/** Community mirror of the official package (used only when no local copy exists). */
const MIRROR_BASE = 'https://raw.githubusercontent.com/theel0ja/fineli-data/master/basic-package-1/'
const REQUIRED_FILES = [
  'descript.txt',
  'food.csv',
  'foodname_FI.csv',
  'foodname_EN.csv',
  'foodname_SV.csv',
  'component.csv',
  'component_value.csv',
  'foodaddunit.csv',
  'contribfood.csv',
  'specdiet.csv',
  'fuclass_FI.csv',
  'igclass_FI.csv',
]

/** Special diet codes relevant for recipe filtering (others are dropped to keep the file small). */
const KEPT_DIETS = new Set(['VEGAN', 'LACOVEGE', 'LACVEGE', 'MILKFREE', 'GLUTFREE', 'LACSFREE', 'EGGFREE'])

/**
 * Nutrients kept in the app. key = app field, value = Fineli EUFDNAME + conversion.
 * Fineli values are per 100 g of edible portion.
 */
const NUTRIENTS: Record<string, { code: string; factor?: number }> = {
  energyKj: { code: 'ENERC' },
  protein: { code: 'PROT' },
  carbohydrate: { code: 'CHOAVL' },
  fat: { code: 'FAT' },
  fibre: { code: 'FIBC' },
  sugars: { code: 'SUGAR' },
  saturatedFat: { code: 'FASAT' },
  monounsaturatedFat: { code: 'FAMCIS' },
  polyunsaturatedFat: { code: 'FAPU' },
  transFat: { code: 'FATRN' },
  alcohol: { code: 'ALC' },
  salt: { code: 'NACL', factor: 0.001 }, // mg -> g
  sodium: { code: 'NA' }, // mg
  potassium: { code: 'K' }, // mg
  calcium: { code: 'CA' }, // mg
  iron: { code: 'FE' }, // mg
  vitaminC: { code: 'VITC' }, // mg
  vitaminD: { code: 'VITD' }, // µg
  vitaminB12: { code: 'VITB12' }, // µg
  folate: { code: 'FOL' }, // µg
  cholesterol: { code: 'CHOLE' }, // mg
}

type Files = Map<string, Uint8Array>

function parseArgs(): { source: string } {
  const args = process.argv.slice(2)
  const i = args.indexOf('--source')
  return { source: i >= 0 && args[i + 1] ? resolve(args[i + 1]) : DEFAULT_SOURCE }
}

async function ensureDefaultSource(dir: string): Promise<void> {
  const missing = REQUIRED_FILES.filter((f) => !existsSync(join(dir, f)))
  if (missing.length === 0) return
  console.log(`Fineli source files missing in ${dir}: ${missing.join(', ')}`)
  console.log('The official site (fineli.fi) blocks automated downloads, so fetching the community mirror.')
  console.log('For the latest release, download the zip manually from https://fineli.fi/fineli/fi/avoin-data')
  console.log('and run: npm run fineli:import -- --source <path-to-zip>')
  mkdirSync(dir, { recursive: true })
  for (const f of missing) {
    const res = await fetch(MIRROR_BASE + f)
    if (!res.ok) throw new Error(`Download failed for ${f}: HTTP ${res.status}`)
    writeFileSync(join(dir, f), new Uint8Array(await res.arrayBuffer()))
    console.log(`  downloaded ${f}`)
  }
}

function loadFiles(source: string): Files {
  const files: Files = new Map()
  if (statSync(source).isDirectory()) {
    for (const name of readdirSync(source)) {
      const p = join(source, name)
      if (statSync(p).isFile()) files.set(name.toLowerCase(), new Uint8Array(readFileSync(p)))
    }
  } else if (source.toLowerCase().endsWith('.zip')) {
    const entries = unzipSync(new Uint8Array(readFileSync(source)))
    for (const [path, data] of Object.entries(entries)) {
      if (!path.endsWith('/')) files.set(basename(path).toLowerCase(), data)
    }
  } else {
    throw new Error(`Unsupported source: ${source} (expected a directory or a .zip)`)
  }
  return files
}

/** Fineli packages have historically been ISO-8859-1; accept UTF-8 too. */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

function readCsv(files: Files, name: string, required = true): Record<string, string>[] {
  const bytes = files.get(name.toLowerCase())
  if (!bytes) {
    if (required) throw new Error(`Required file ${name} not found in Fineli package`)
    return []
  }
  const lines = decode(bytes).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = lines[0].split(';').map((h) => h.trim().toUpperCase())
  return lines.slice(1).map((line) => {
    const cells = line.split(';')
    const row: Record<string, string> = {}
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()))
    return row
  })
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function detectRelease(files: Files): string {
  const d = files.get('descript.txt')
  if (!d) return 'unknown'
  const m = decode(d).match(/Release\.?\s*([\d.]+)/i) ?? decode(d).match(/Versio\.?\s*([\d.]+)/i)
  return m ? m[1] : 'unknown'
}

async function main() {
  const { source } = parseArgs()
  if (source === DEFAULT_SOURCE) await ensureDefaultSource(source)
  console.log(`Reading Fineli package from ${source}`)
  const files = loadFiles(source)
  const release = detectRelease(files)

  const foodRows = readCsv(files, 'food.csv')
  const namesFi = new Map(readCsv(files, 'foodname_FI.csv').map((r) => [r.FOODID, r.FOODNAME]))
  const namesEn = new Map(readCsv(files, 'foodname_EN.csv', false).map((r) => [r.FOODID, r.FOODNAME]))
  const namesSv = new Map(readCsv(files, 'foodname_SV.csv', false).map((r) => [r.FOODID, r.FOODNAME]))

  const codeToKey = new Map(Object.entries(NUTRIENTS).map(([key, v]) => [v.code, key]))
  const nutrients = new Map<string, Record<string, number>>()
  for (const r of readCsv(files, 'component_value.csv')) {
    const key = codeToKey.get(r.EUFDNAME)
    if (!key) continue
    const v = num(r.BESTLOC)
    if (v === null) continue
    const factor = NUTRIENTS[key].factor ?? 1
    let entry = nutrients.get(r.FOODID)
    if (!entry) nutrients.set(r.FOODID, (entry = {}))
    entry[key] = round(v * factor)
  }

  const units = new Map<string, Record<string, number>>()
  for (const r of readCsv(files, 'foodaddunit.csv', false)) {
    const mass = num(r.MASS)
    if (mass === null) continue
    let entry = units.get(r.FOODID)
    if (!entry) units.set(r.FOODID, (entry = {}))
    entry[r.FOODUNIT] = mass
  }

  const diets = new Map<string, string[]>()
  for (const r of readCsv(files, 'specdiet.csv', false)) {
    if (!KEPT_DIETS.has(r.SPECDIET)) continue
    const list = diets.get(r.FOODID) ?? []
    list.push(r.SPECDIET)
    diets.set(r.FOODID, list)
  }

  const foods = foodRows.map((r) => {
    const n = nutrients.get(r.FOODID) ?? {}
    if (n.energyKj !== undefined) n.energyKcal = round(n.energyKj / 4.184, 1)
    return {
      id: Number(r.FOODID),
      fi: namesFi.get(r.FOODID) ?? r.FOODNAME,
      en: namesEn.get(r.FOODID) ?? null,
      sv: namesSv.get(r.FOODID) ?? null,
      type: r.FOODTYPE, // FOOD | DISH
      process: r.PROCESS,
      edibleShare: num(r.EDPORT),
      igClass: r.IGCLASS,
      igClassParent: r.IGCLASSP,
      fuClass: r.FUCLASS,
      fuClassParent: r.FUCLASSP,
      nutrients: n,
      units: units.get(r.FOODID) ?? {},
      diets: diets.get(r.FOODID) ?? [],
    }
  })

  // Fineli DISH recipes: rows of (ingredient food, grams, % remaining after cooking)
  const dishRows = new Map<string, { foodId: number; grams: number; remainPct: number }[]>()
  for (const r of readCsv(files, 'contribfood.csv', false)) {
    const grams = num(r.MASS)
    if (grams === null || grams <= 0) continue
    const list = dishRows.get(r.FOODID) ?? []
    list.push({ foodId: Number(r.CONFDID), grams, remainPct: num(r.EVREMAIN) ?? 100 })
    dishRows.set(r.FOODID, list)
  }
  const foodById = new Map(foods.map((f) => [String(f.id), f]))
  const dishes = [...dishRows.entries()]
    .map(([id, rows]) => {
      const food = foodById.get(id)
      if (!food || food.type !== 'DISH') return null
      return {
        id: Number(id),
        name: food.fi,
        fuClass: food.fuClass,
        fuClassParent: food.fuClassParent,
        portionGrams: food.units.PORTM ?? null,
        rows,
      }
    })
    .filter((d) => d !== null)

  const classNames = (file: string) =>
    Object.fromEntries(readCsv(files, file, false).map((r) => [r.THSCODE, r.DESCRIPT]))
  const classes = { fuClass: classNames('fuclass_FI.csv'), igClass: classNames('igclass_FI.csv') }

  const meta = {
    format: 'fineli-normalized',
    formatVersion: 1,
    release,
    importedAt: new Date().toISOString(),
    license: 'CC BY 4.0',
    attribution: 'Fineli – Terveyden ja hyvinvoinnin laitos (THL), https://fineli.fi',
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'fineli-foods.json'), JSON.stringify({ ...meta, classes, foods }))
  writeFileSync(join(OUT_DIR, 'fineli-dishes.json'), JSON.stringify({ ...meta, classes, dishes }))
  // Small file the app polls to detect a new dataset without downloading the big ones.
  writeFileSync(join(OUT_DIR, 'fineli-meta.json'), JSON.stringify({ ...meta, foodCount: foods.length, dishCount: dishes.length }))
  console.log(`Fineli release ${release}: ${foods.length} foods, ${dishes.length} dish recipes → ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
