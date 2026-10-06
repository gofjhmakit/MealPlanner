/**
 * Supplementary food data importer (fallback for Fineli).
 *
 * Fineli is the master nutrition database. This script turns two larger / complementary open
 * food composition databases into a Finnish-named, de-duplicated supplement that the app uses
 * only when Fineli has no suitable or likely food for an ingredient:
 *
 *   Livsmedelsverket (Swedish Food Agency) Livsmedelsdatabasen – CC BY 4.0
 *     data/supplementary-source/livsmedelsverket/livsmedelsdatabasen.json
 *   USDA National Nutrient Database for Standard Reference, Release 28 (SR Legacy) – public domain
 *     data/supplementary-source/usda-sr28/FOOD_DES.txt + ABBREV.txt
 *
 * Steps:
 *   npm run supplementary:list    selected foods → data/supplementary-source/input/<source>.json
 *   (translate names to Finnish → data/supplementary-source/fi/<source>/NNN.json, see TRANSLATION.md)
 *   npm run supplementary:build   → public/data/supplementary-foods.json + supplementary-meta.json
 *
 * De-duplication (Fineli > Livsmedelsverket > USDA): a supplementary food whose Finnish name
 * equals a Fineli food name is dropped, and of foods with the same Finnish name in the
 * supplementary sources only the one from the higher-priority source (then the first) is kept.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  SUPPLEMENTARY_SOURCES,
  supplementaryFoodId,
  type SupplementarySourceId,
} from '../src/domain/supplementary.ts'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'data', 'supplementary-source')
const OUT_DIR = join(ROOT, 'public', 'data')

type Nutrients = Record<string, number>
type Category = 'vegetables' | 'meat_fish' | 'dairy' | 'bakery' | 'dry_goods' | 'frozen' | 'canned' | 'spices_sauces' | 'other'

interface SourceFood {
  source: SupplementarySourceId
  /** The source's own id (Livsmedelsnummer / NDB number). */
  ref: number
  /** Original name in the source language. */
  name: string
  group: string
  nutrients: Nutrients
  units: Record<string, number>
  edibleShare: number | null
  igClass: string
  igClassParent: string
  process: string
  diets: string[]
  category: Category
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** "21,7" / 21.7 / "" → number | null */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function setIf(target: Nutrients, key: string, value: number | null, digits = 3) {
  if (value !== null) target[key] = round(value, digits)
}

// --- diet / class helpers ------------------------------------------------------------------------

const ANIMAL_EN = /\b(eggs?|milk|butter|cheese|cream|honey|meat|beef|pork|chicken|bacon|lard|fish|anchov\w*|gelatin|whey|yogurt|buttermilk|ham|turkey|shrimp|oyster|clam|crab|casein)\b/i
const ANIMAL_SV = /(ägg|mjölk|smör|ost\b|grädde|honung|kött|fläsk|kyckling|bacon|ister|fisk|ansjovis|gelatin|vassle|yoghurt|skinka|räk|kräft)/i
const MEATLESS = /\b(meatless|vegetarian|vegan|vegetarisk|vego)\b/i

function plantDiets(name: string, animal: RegExp): string[] {
  return animal.test(name) ? [] : ['VEGAN', 'LACOVEGE']
}

function processOf(name: string): string {
  if (/\b(raw|rå|färsk)\b/i.test(name)) return 'RAW'
  if (/\b(canned|konserv)/i.test(name)) return 'CANN'
  if (/\b(dried|dehydrated|torkad)/i.test(name)) return 'DRIE'
  if (/\b(frozen|fryst)/i.test(name)) return 'FROZ'
  return 'IND'
}

// --- Livsmedelsverket ----------------------------------------------------------------------------

/** Dishes and meal replacements are left out: Fineli has Finnish dishes, and they're rarely recipe ingredients. */
const LMV_EXCLUDED_GROUPS = new Set(['Rätter', 'Måltidsersättning, sportpreparat'])

function lmvClass(group: string, name: string, alcohol: number): Pick<SourceFood, 'igClass' | 'igClassParent' | 'diets' | 'category'> {
  const plant = (igClassParent: string, igClass: string, category: Category) => ({ igClassParent, igClass, category, diets: plantDiets(name, ANIMAL_SV) })
  const meat = (igClass: string) =>
    MEATLESS.test(name) ? { igClassParent: 'LEGUTOT', igClass: 'SOYAPROD', category: 'meat_fish' as const, diets: [] } : { igClassParent: 'MEATTOT', igClass, category: 'meat_fish' as const, diets: [] }
  switch (group) {
    case 'Fett, olja':
      return /olja/i.test(name) ? plant('FATTOT', 'OIL', 'spices_sauces') : { igClassParent: 'FATTOT', igClass: 'FATOTH', category: 'dairy', diets: [] }
    case 'Grönsaker, baljväxter, svamp':
      if (/svamp|champinjon|kantarell|karl johan|murkla|ostronskivling|shiitake/i.test(name)) return plant('VEGTOT', 'MUSHRO', 'vegetables')
      if (/böna|bönor|linser|ärter|kikärt|sojabön/i.test(name)) return plant('LEGUTOT', 'PEABEAN', /konserv/i.test(name) ? 'canned' : 'dry_goods')
      return plant('VEGTOT', /konserv/i.test(name) ? 'VEGCANN' : 'VEGFRU', /konserv/i.test(name) ? 'canned' : /fryst/i.test(name) ? 'frozen' : 'vegetables')
    case 'Kött':
      if (/nöt|oxe|kalv/i.test(name)) return meat('BEEF')
      if (/fläsk|gris|skinka|bacon/i.test(name)) return meat('PORK')
      if (/lamm|får/i.test(name)) return meat('LAMM')
      if (/älg|ren\b|renkött|rådjur|hjort|vildsvin|hare|vilt/i.test(name)) return meat('GAME')
      return meat('MEATPROD')
    case 'Korv':
      return meat('SAUSAGE')
    case 'Kyckling, fågel':
      return meat('POULTRY')
    case 'Lever, njure, tunga etc.':
      return meat('OFFAL')
    case 'Pålägg':
      return /korv|skinka|kött|salami|fläsk|rökt kalkon|kalkon|kyckling|leverpastej/i.test(name) && !MEATLESS.test(name)
        ? meat('MEATPROD')
        : { igClassParent: 'INDTOT', igClass: 'SNACK', category: 'other', diets: [] }
    case 'Fisk, skaldjur':
      return { igClassParent: 'FISHTOT', igClass: /räk|kräft|hummer|krabb|mussl|ostron|bläckfisk|kammussl/i.test(name) ? 'SHELLFIS' : 'FISH', category: 'meat_fish', diets: [] }
    case 'Ägg, rom, kaviar':
      return /rom|kaviar/i.test(name)
        ? { igClassParent: 'FISHTOT', igClass: 'FISHPROD', category: 'meat_fish', diets: [] }
        : { igClassParent: 'EGGTOT', igClass: 'EGG', category: 'dairy', diets: ['LACOVEGE'] }
    case 'Mejeri':
      return { igClassParent: 'MILKTOT', igClass: /ost\b|ost,|ost /i.test(name) ? 'CHEESE' : /grädde/i.test(name) ? 'CREAM' : 'MILK', category: 'dairy', diets: ['LACOVEGE'] }
    case 'Glass':
      return { igClassParent: 'MILKTOT', igClass: 'ICECREAM', category: 'frozen', diets: [] }
    case 'Frukt, bär':
      return plant('FRUITTOT', /bär|lingon|blåbär|hallon|jordgubb|vinbär|krusbär|hjortron|tranbär/i.test(name) ? 'BERRY' : 'FRUITOTH', /konserv/i.test(name) ? 'canned' : /fryst/i.test(name) ? 'frozen' : 'vegetables')
    case 'Nötter, frön':
      return plant('LEGUTOT', 'NUTSEED', 'dry_goods')
    case 'Potatis':
      return plant('POTATOT', 'POTATO', 'vegetables')
    case 'Mjöl':
      return plant('CERTOT', 'WHEAT', 'dry_goods')
    case 'Pasta, ris, gryn':
      return plant('CERTOT', /ris\b|ris,/i.test(name) ? 'RICE' : /pasta|makaroner|spagetti|nudlar/i.test(name) ? 'PASTA' : 'CEROTH', 'dry_goods')
    case 'Flingor, frukostflingor, müsli, gröt, välling':
      return { igClassParent: 'CERTOT', igClass: 'OATBAR', category: 'dry_goods', diets: [] }
    case 'Bröd':
      return { igClassParent: 'CERTOT', igClass: 'BRHARD', category: 'bakery', diets: [] }
    case 'Bullar, kakor, tårtor':
      return { igClassParent: 'SUGARTOT', igClass: 'SUGAROTH', category: 'bakery', diets: [] }
    case 'Quorn, sojaprotein, vegetariska produkter':
      return { igClassParent: 'LEGUTOT', igClass: 'SOYAPROD', category: 'meat_fish', diets: ANIMAL_SV.test(name) || /quorn/i.test(name) ? ['LACOVEGE'] : ['VEGAN', 'LACOVEGE'] }
    case 'Smaksättare':
      return { igClassParent: 'FLAVTOT', igClass: 'FLAVSAUC', category: 'spices_sauces', diets: [] }
    case 'Sylt, marmelad, gelé, chutney':
      return plant('SUGARTOT', 'SUGAROTH', 'other')
    case 'Godis':
      return { igClassParent: 'SUGARTOT', igClass: 'SWEET', category: 'other', diets: [] }
    case 'Dryck':
      return alcohol > 0.5
        ? { igClassParent: 'ALCTOT', igClass: 'ALCOTH', category: 'other', diets: [] }
        : { igClassParent: 'BEVTOT', igClass: 'SDRINK', category: 'other', diets: [] }
    case 'Snacks':
      return { igClassParent: 'INDTOT', igClass: 'SNACK', category: 'other', diets: [] }
    default:
      return { igClassParent: 'INGRTOT', igClass: 'INGRMIS', category: 'other', diets: [] }
  }
}

function readLivsmedelsverket(): SourceFood[] {
  const rows = JSON.parse(readFileSync(join(SRC, 'livsmedelsverket', 'livsmedelsdatabasen.json'), 'utf8')) as Record<string, unknown>[]
  const out: SourceFood[] = []
  for (const r of rows) {
    const group = String(r.Gruppering ?? '')
    if (LMV_EXCLUDED_GROUPS.has(group)) continue
    const name = String(r.Livsmedelsnamn ?? '').trim()
    const ref = Number(r.Livsmedelsnummer)
    if (!name || !Number.isInteger(ref)) continue
    const n: Nutrients = {}
    setIf(n, 'energyKcal', num(r['Energi (kcal)']), 1)
    setIf(n, 'energyKj', num(r['Energi (kJ)']), 1)
    setIf(n, 'protein', num(r['Protein (g)']))
    setIf(n, 'carbohydrate', num(r['Kolhydrater, tillgängliga (g)']))
    setIf(n, 'fat', num(r['Fett, totalt (g)']))
    setIf(n, 'fibre', num(r['Fibrer (g)']))
    setIf(n, 'sugars', num(r['Sockerarter, totalt (g)']))
    setIf(n, 'saturatedFat', num(r['Summa mättade fettsyror (g)']))
    setIf(n, 'monounsaturatedFat', num(r['Summa enkelomättade fettsyror (g)']))
    setIf(n, 'polyunsaturatedFat', num(r['Summa fleromättade fettsyror (g)']))
    setIf(n, 'alcohol', num(r['Alkohol (g)']))
    setIf(n, 'salt', num(r['Salt, NaCl (g)']))
    setIf(n, 'sodium', num(r['Natrium, Na (mg)']))
    setIf(n, 'potassium', num(r['Kalium, K (mg)']))
    setIf(n, 'calcium', num(r['Kalcium, Ca (mg)']))
    setIf(n, 'iron', num(r['Järn, Fe (mg)']))
    setIf(n, 'vitaminC', num(r['Vitamin C (mg)']))
    setIf(n, 'vitaminD', num(r['Vitamin D (µg)']))
    setIf(n, 'vitaminB12', num(r['Vitamin B12 (µg)']))
    setIf(n, 'folate', num(r['Folat (µg)']))
    setIf(n, 'cholesterol', num(r['Kolesterol (mg)']))
    if (n.energyKcal === undefined) continue
    if (n.energyKj === undefined) n.energyKj = round(n.energyKcal * 4.184, 1)
    const refuse = num(r['Avfall (skal etc.) (%)'])
    out.push({
      source: 'livsmedelsverket',
      ref,
      name,
      group,
      nutrients: n,
      units: {},
      edibleShare: refuse === null ? null : round(100 - refuse, 1),
      process: processOf(name),
      ...lmvClass(group, name, n.alcohol ?? 0),
    })
  }
  return out
}

// --- USDA SR28 -----------------------------------------------------------------------------------

const USDA_GROUPS: Record<string, string> = {
  '0100': 'Dairy and Egg Products',
  '0200': 'Spices and Herbs',
  '0300': 'Baby Foods',
  '0400': 'Fats and Oils',
  '0500': 'Poultry Products',
  '0600': 'Soups, Sauces, and Gravies',
  '0700': 'Sausages and Luncheon Meats',
  '0800': 'Breakfast Cereals',
  '0900': 'Fruits and Fruit Juices',
  '1000': 'Pork Products',
  '1100': 'Vegetables and Vegetable Products',
  '1200': 'Nut and Seed Products',
  '1300': 'Beef Products',
  '1400': 'Beverages',
  '1500': 'Finfish and Shellfish Products',
  '1600': 'Legumes and Legume Products',
  '1700': 'Lamb, Veal, and Game Products',
  '1800': 'Baked Products',
  '1900': 'Sweets',
  '2000': 'Cereal Grains and Pasta',
  '2100': 'Fast Foods',
  '2200': 'Meals, Entrees, and Side Dishes',
  '2500': 'Snacks',
  '3500': 'American Indian/Alaska Native Foods',
  '3600': 'Restaurant Foods',
}

/**
 * Left out: baby foods, (branded) breakfast cereals, fast food, ready meals, restaurant foods and
 * American Indian/Alaska Native traditional foods – not recipe ingredients in a Finnish kitchen.
 */
const USDA_EXCLUDED_GROUPS = new Set(['0300', '0800', '2100', '2200', '3500', '3600'])
/** Brand names are upper case in SR descriptions ("KRAFT", "CAMPBELL'S"); USDA commodity foods too. */
const BRAND = /\b[A-Z][A-Z'&.-]{2,}\b/
/** Recipes list raw ingredients: cooked variants of meat, fish, vegetables, legumes and grains are left out. */
const COOKED = /\b(cooked|boiled|roasted|braised|broiled|grilled|fried|stewed|baked|microwaved|steamed|simmered|heated|pan-browned|rotisserie|toasted|scrambled|poached|prepared|drained|stir-fried|reheated|pan-fried|blanched)\b/i
const RAW_INGREDIENT_GROUPS = new Set(['0100', '0500', '0700', '1000', '1100', '1300', '1500', '1600', '1700', '2000'])
/** Variants that differ only in grading, trimming or sodium are collapsed to one entry. */
function usdaVariantKey(desc: string): string {
  return desc
    .replace(/,?\s*\b(all grades|choice|select|prime)\b/gi, '')
    .replace(/,?\s*trimmed to [\d/]+" fat/gi, '')
    .replace(/,?\s*separable lean (and fat|only)/gi, '')
    .replace(/,?\s*(with|without) salt( added)?/gi, '')
    .replace(/,?\s*(low|reduced|no added) sodium|,?\s*\d+% less sodium/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function usdaClass(group: string, name: string): Pick<SourceFood, 'igClass' | 'igClassParent' | 'diets' | 'category'> {
  const plant = (igClassParent: string, igClass: string, category: Category) => ({ igClassParent, igClass, category, diets: plantDiets(name, ANIMAL_EN) })
  const meat = (igClass: string) =>
    MEATLESS.test(name) ? { igClassParent: 'LEGUTOT', igClass: 'SOYAPROD', category: 'meat_fish' as const, diets: [] } : { igClassParent: 'MEATTOT', igClass, category: 'meat_fish' as const, diets: [] }
  const canned = /\bcanned\b/i.test(name)
  const frozen = /\bfrozen\b/i.test(name)
  switch (group) {
    case '0100':
      if (/^egg/i.test(name)) return { igClassParent: 'EGGTOT', igClass: 'EGG', category: 'dairy', diets: ['LACOVEGE'] }
      return { igClassParent: 'MILKTOT', igClass: /^cheese/i.test(name) ? 'CHEESE' : /^cream/i.test(name) ? 'CREAM' : 'MILK', category: frozen ? 'frozen' : 'dairy', diets: ['LACOVEGE'] }
    case '0200':
      return plant('FLAVTOT', /fresh/i.test(name) ? 'HERB' : 'FLAVSEED', 'spices_sauces')
    case '0400':
      if (/^oil\b/i.test(name) && !/fish|cod liver|herring|salmon|menhaden|sardine/i.test(name)) return plant('FATTOT', 'OIL', 'spices_sauces')
      return { igClassParent: 'FATTOT', igClass: 'FATOTH', category: /^butter|^margarine/i.test(name) ? 'dairy' : 'spices_sauces', diets: [] }
    case '0500':
      return meat('POULTRY')
    case '0600':
      return { igClassParent: 'FLAVTOT', igClass: 'FLAVSAUC', category: /^soup/i.test(name) ? 'canned' : 'spices_sauces', diets: [] }
    case '0700':
      return meat('SAUSAGE')
    case '0900':
      return plant('FRUITTOT', /juice/i.test(name) ? 'JUICE' : canned ? 'FRUITCAN' : /berr/i.test(name) ? 'BERRY' : 'FRUITOTH', canned ? 'canned' : frozen ? 'frozen' : 'vegetables')
    case '1000':
      return meat('PORK')
    case '1100':
      if (/^mushroom/i.test(name)) return plant('VEGTOT', 'MUSHRO', canned ? 'canned' : 'vegetables')
      if (/^potato/i.test(name)) return plant('POTATOT', 'POTATO', frozen ? 'frozen' : 'vegetables')
      return plant('VEGTOT', canned ? 'VEGCANN' : 'VEGFRU', canned ? 'canned' : frozen ? 'frozen' : 'vegetables')
    case '1200':
      return plant('LEGUTOT', 'NUTSEED', 'dry_goods')
    case '1300':
      return meat('BEEF')
    case '1400':
      return /^alcoholic/i.test(name)
        ? { igClassParent: 'ALCTOT', igClass: 'ALCOTH', category: 'other', diets: [] }
        : { igClassParent: 'BEVTOT', igClass: /coffee/i.test(name) ? 'COFFEE' : /\btea\b/i.test(name) ? 'TEA' : 'SDRINK', category: 'other', diets: [] }
    case '1500':
      return { igClassParent: 'FISHTOT', igClass: /^(crustaceans|mollusks)/i.test(name) ? 'SHELLFIS' : 'FISH', category: frozen ? 'frozen' : 'meat_fish', diets: [] }
    case '1600':
      return plant('LEGUTOT', /soy|tofu|tempeh|miso|natto/i.test(name) ? 'SOYAPROD' : 'PEABEAN', canned ? 'canned' : 'dry_goods')
    case '1700':
      if (/^game meat/i.test(name)) return meat('GAME')
      if (/^veal/i.test(name)) return meat('BEEF')
      return meat('LAMM')
    case '1800':
      return { igClassParent: 'CERTOT', igClass: 'WHEAT', category: frozen ? 'frozen' : 'bakery', diets: [] }
    case '1900':
      return /^(sugars?|syrups?|honey|molasses)\b/i.test(name)
        ? { igClassParent: 'SUGARTOT', igClass: 'SUGARSYR', category: 'dry_goods', diets: /honey/i.test(name) ? ['LACOVEGE'] : [] }
        : { igClassParent: 'SUGARTOT', igClass: 'SWEET', category: 'other', diets: [] }
    case '2000':
      return plant('CERTOT', /^rice/i.test(name) ? 'RICE' : /pasta|noodles|spaghetti|macaroni/i.test(name) ? 'PASTA' : /^wheat/i.test(name) ? 'WHEAT' : 'CEROTH', 'dry_goods')
    case '2500':
      return { igClassParent: 'INDTOT', igClass: 'SNACK', category: 'other', diets: [] }
    default:
      return { igClassParent: 'INGRTOT', igClass: 'INGRMIS', category: 'other', diets: [] }
  }
}

const CUP_ML = 236.588
const PIECE_WORDS: Record<string, string> = {
  small: 'KPL_S',
  medium: 'KPL_M',
  large: 'KPL_L',
  fruit: 'KPL_M',
  whole: 'KPL_M',
  each: 'KPL_M',
  piece: 'KPL_M',
  item: 'KPL_M',
  clove: 'KPL_M',
  stalk: 'KPL_M',
  pepper: 'KPL_M',
  egg: 'KPL_M',
  leaf: 'KPL_M',
}

/** SR household measures ("1 cup, chopped", "1 tbsp", "1 medium") → Fineli-style unit weights. */
function usdaUnits(measures: { grams: number | null; desc: string }[]): Record<string, number> {
  const units: Record<string, number> = {}
  for (const { grams, desc } of measures) {
    if (!grams || grams <= 0) continue
    const m = /^([\d.]+)\s+([a-z]+)/i.exec(desc.trim())
    if (!m) continue
    const amount = Number(m[1])
    if (!(amount > 0)) continue
    const unit = m[2].toLowerCase()
    const per = grams / amount
    if (unit === 'cup' || unit === 'cups') units.DL ??= round((per * 100) / CUP_ML, 1)
    else if (unit === 'tbsp') units.RKL ??= round(per, 1)
    else if (unit === 'tsp') units.TL ??= round(per, 1)
    else if (PIECE_WORDS[unit]) units[PIECE_WORDS[unit]] ??= round(per, 1)
  }
  if (!units.DL && units.RKL) units.DL = round(units.RKL / 0.15, 1)
  if (!units.DL && units.TL) units.DL = round(units.TL / 0.05, 1)
  return units
}

function readUsda(): SourceFood[] {
  const split = (line: string) => line.replace(/\r$/, '').split('^').map((f) => f.replace(/^~|~$/g, ''))
  const read = (file: string) => readFileSync(join(SRC, 'usda-sr28', file), 'latin1').split('\n').filter((l) => l.trim()).map(split)
  const abbrev = new Map(read('ABBREV.txt').map((f) => [f[0], f]))
  const out: SourceFood[] = []
  const seenVariants = new Set<string>()
  for (const d of read('FOOD_DES.txt')) {
    const [ndb, group, desc] = d
    if (USDA_EXCLUDED_GROUPS.has(group)) continue
    if (BRAND.test(desc)) continue
    if (RAW_INGREDIENT_GROUPS.has(group) && COOKED.test(desc)) continue
    if (/separable fat\b/i.test(desc)) continue
    const variant = `${group}|${usdaVariantKey(desc)}`
    if (seenVariants.has(variant)) continue
    seenVariants.add(variant)
    const a = abbrev.get(ndb)
    if (!a) continue
    const v = (i: number) => num(a[i])
    const kcal = v(3)
    if (kcal === null) continue
    const n: Nutrients = {}
    setIf(n, 'energyKcal', kcal, 1)
    n.energyKj = round(kcal * 4.184, 1)
    setIf(n, 'protein', v(4))
    setIf(n, 'fat', v(5))
    const carbByDifference = v(7)
    const fibre = v(8)
    // SR carbohydrate is "by difference" and includes fibre; Fineli reports available carbohydrate.
    if (carbByDifference !== null) n.carbohydrate = round(Math.max(0, carbByDifference - (fibre ?? 0)))
    setIf(n, 'fibre', fibre)
    setIf(n, 'sugars', v(9))
    setIf(n, 'calcium', v(10))
    setIf(n, 'iron', v(11))
    setIf(n, 'potassium', v(14))
    const sodium = v(15)
    setIf(n, 'sodium', sodium)
    if (sodium !== null) n.salt = round((sodium * 2.5) / 1000)
    setIf(n, 'vitaminC', v(20))
    setIf(n, 'folate', v(26))
    setIf(n, 'vitaminB12', v(31))
    setIf(n, 'vitaminD', v(41))
    setIf(n, 'saturatedFat', v(44))
    setIf(n, 'monounsaturatedFat', v(45))
    setIf(n, 'polyunsaturatedFat', v(46))
    setIf(n, 'cholesterol', v(47))
    const refuse = v(52)
    out.push({
      source: 'usda',
      ref: Number(ndb),
      name: desc,
      group,
      nutrients: n,
      units: usdaUnits([
        { grams: v(48), desc: a[49] ?? '' },
        { grams: v(50), desc: a[51] ?? '' },
      ]),
      edibleShare: refuse === null ? null : round(100 - refuse, 1),
      process: processOf(desc),
      ...usdaClass(group, desc),
    })
  }
  return out
}

// --- translations --------------------------------------------------------------------------------

interface Translation {
  id: string
  fi?: string
  skip?: string
}

function foodKey(f: Pick<SourceFood, 'source' | 'ref'>): string {
  return `${f.source}:${f.ref}`
}

function readTranslations(source: SupplementarySourceId): { names: Map<string, string>; skipped: Set<string>; problems: string[] } {
  const dir = join(SRC, 'fi', source)
  const names = new Map<string, string>()
  const skipped = new Set<string>()
  const problems: string[] = []
  if (!existsSync(dir)) return { names, skipped, problems }
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let rows: Translation[]
    try {
      rows = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      problems.push(`${source}/${file}: virheellinen JSON (${(e as Error).message})`)
      continue
    }
    for (const r of rows) {
      if (r.skip) skipped.add(r.id)
      else if (r.fi?.trim()) names.set(r.id, r.fi.trim().replace(/\s+/g, ' '))
      else problems.push(`${source}/${file}: ${r.id} ilman nimeä`)
    }
  }
  return { names, skipped, problems }
}

/**
 * Name key for duplicate detection: case, punctuation and the order of the comma-separated
 * parts don't matter ("Juusto, ricotta" = "ricotta, juusto").
 */
function duplicateKey(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .split(',')
    .map((s) => s.replace(/[^\p{L}\d%]+/gu, ' ').trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

// --- main ----------------------------------------------------------------------------------------

function list(all: SourceFood[]) {
  const dir = join(SRC, 'input')
  mkdirSync(dir, { recursive: true })
  for (const source of Object.keys(SUPPLEMENTARY_SOURCES) as SupplementarySourceId[]) {
    const rows = all
      .filter((f) => f.source === source)
      .map((f) => ({ id: foodKey(f), name: f.name, group: source === 'usda' ? USDA_GROUPS[f.group] : f.group }))
    writeFileSync(join(dir, `${source}.json`), `${JSON.stringify(rows, null, 1)}\n`)
    console.log(`${source}: ${rows.length} foods to translate → data/supplementary-source/input/${source}.json`)
  }
}

function build(all: SourceFood[]) {
  const fineli = JSON.parse(readFileSync(join(OUT_DIR, 'fineli-foods.json'), 'utf8')) as { foods: { fi: string }[] }
  const fineliKeys = new Set(fineli.foods.map((f) => duplicateKey(f.fi)))
  const taken = new Set<string>()
  const stats: Record<string, { selected: number; translated: number; skipped: number; duplicateOfFineli: number; duplicate: number; kept: number }> = {}
  const problems: string[] = []
  const foods: unknown[] = []
  const sources = (Object.values(SUPPLEMENTARY_SOURCES) as (typeof SUPPLEMENTARY_SOURCES)[SupplementarySourceId][]).sort((a, b) => a.priority - b.priority)
  for (const info of sources) {
    const { names, skipped, problems: p } = readTranslations(info.id)
    problems.push(...p)
    const s = (stats[info.id] = { selected: 0, translated: 0, skipped: 0, duplicateOfFineli: 0, duplicate: 0, kept: 0 })
    for (const f of all.filter((x) => x.source === info.id)) {
      s.selected++
      const key = foodKey(f)
      if (skipped.has(key)) {
        s.skipped++
        continue
      }
      const fi = names.get(key)
      if (!fi) continue
      s.translated++
      const dk = duplicateKey(fi)
      if (fineliKeys.has(dk)) {
        // Fineli is the master data: an identically named supplementary food is never needed.
        s.duplicateOfFineli++
        continue
      }
      if (taken.has(dk)) {
        s.duplicate++
        continue
      }
      taken.add(dk)
      s.kept++
      foods.push({
        id: supplementaryFoodId(f.source, f.ref),
        fi,
        en: f.source === 'usda' ? f.name : null,
        sv: f.source === 'livsmedelsverket' ? f.name : null,
        type: 'FOOD',
        process: f.process,
        edibleShare: f.edibleShare,
        igClass: f.igClass,
        igClassParent: f.igClassParent,
        fuClass: '',
        fuClassParent: '',
        nutrients: f.nutrients,
        units: f.units,
        diets: f.diets,
        category: f.category,
        source: f.source,
        sourceRef: String(f.ref),
      })
    }
  }
  const meta = {
    format: 'supplementary-foods',
    formatVersion: 1,
    importedAt: new Date().toISOString(),
    sources: sources.map((x) => ({
      id: x.id,
      label: x.label,
      name: x.name,
      homepage: x.homepage,
      license: x.license,
      attribution: x.attribution,
      count: stats[x.id].kept,
    })),
    foodCount: foods.length,
  }
  writeFileSync(join(OUT_DIR, 'supplementary-foods.json'), JSON.stringify({ ...meta, foods }))
  writeFileSync(join(OUT_DIR, 'supplementary-meta.json'), JSON.stringify(meta))
  for (const [id, s] of Object.entries(stats)) {
    console.log(
      `${id}: ${s.selected} selected, ${s.translated} translated, ${s.skipped} skipped, ` +
        `${s.duplicateOfFineli} same as Fineli, ${s.duplicate} duplicates → ${s.kept} foods`,
    )
  }
  if (problems.length) console.warn(`\n${problems.length} problems:\n${problems.slice(0, 50).join('\n')}`)
  console.log(`→ public/data/supplementary-foods.json (${foods.length} foods)`)
}

const all = [...readLivsmedelsverket(), ...readUsda()]
if (process.argv.includes('--list')) list(all)
else build(all)
