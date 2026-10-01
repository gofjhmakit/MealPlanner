/**
 * Product data from grocery store pages – K-Ruoka and S-kaupat product pages, any page with a
 * Schema.org Product, or copied label text ("Proteiini 19 g").
 *
 * Observed formats (October 2026):
 *   K-Ruoka   <div id="applicationState" data-state="{reduxState:{productDetails:{products:{entities:{<slug>:{product}}}}}}">
 *             product.productAttributes.nutritionalContents[0].nutrients.{energyKcal, protein:{amount}, …}
 *             plus JSON-LD Product (name, gtin13, brand, image, weight)
 *   S-kaupat  <script id="__NEXT_DATA__"> props.pageProps.apolloState["Product:{…}"]
 *             productDetails.nutrients[0].nutrients = [{name:"Proteiinia", value:"20 g"}, …]
 * Both sites block automated fetching, so users usually paste the page source.
 */
import type { PRODUCT_DIETS, ShoppingCategory } from '../domain/types'
import { safeHttpUrl } from '../domain/url'
import { oneLine, tryParseJson } from './text'

type Json = Record<string, unknown>
type Diet = (typeof PRODUCT_DIETS)[number]

export interface ProductNutrients {
  energyKcal: number | null
  protein: number | null
  carbohydrate: number | null
  sugars: number | null
  fat: number | null
  saturatedFat: number | null
  fibre: number | null
  salt: number | null
}

export interface ExtractedProduct {
  source: 'k-ruoka' | 's-kaupat' | 'json-ld' | 'text'
  name: string | null
  brand: string | null
  ean: string | null
  imageUrl: string | null
  sourceUrl: string | null
  packageGrams: number | null
  /** Nutrition basis, e.g. "100 g" or "100 ml". */
  basis: string | null
  nutrients: ProductNutrients
  category: ShoppingCategory | null
  diets: Diet[]
  ingredientsText: string | null
  warnings: string[]
}

const EMPTY_NUTRIENTS: ProductNutrients = {
  energyKcal: null, protein: null, carbohydrate: null, sugars: null, fat: null, saturatedFat: null, fibre: null, salt: null,
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = v.replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

/** "702 kJ / 168 kcal" -> 168 ; "944 kJ" -> 225.6 */
function kcalFrom(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  const kcal = v.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*kcal/i)
  if (kcal) return Number(kcal[1])
  const kj = v.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*kj/i)
  return kj ? Math.round((Number(kj[1]) / 4.184) * 10) / 10 : num(v)
}

/** Package size from a product name: "… 400g", "1,5 l", "6x0,33l", "4kpl/320g". */
export function packageGramsFromName(name: string | null | undefined): number | null {
  if (!name) return null
  const s = name.toLowerCase().replace(',', '.')
  const multi = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|dl|cl|ml)\b/)
  const single = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|l|dl|cl|ml)\b/g)].pop()
  const toGrams = (v: number, u: string) => (u === 'kg' || u === 'l' ? v * 1000 : u === 'dl' ? v * 100 : u === 'cl' ? v * 10 : v)
  if (multi) return Math.round(Number(multi[1]) * toGrams(Number(multi[2]), multi[3]))
  if (single) return Math.round(toGrams(Number(single[1]), single[2]))
  return null
}

/** EAN from a store URL (both stores end the product URL with the EAN). */
export function eanFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/(?:^|[-/])(\d{13}|\d{8})(?:[/?#]|$)/)
  return m ? m[1] : null
}

const CATEGORY_RULES: [RegExp, ShoppingCategory][] = [
  [/pakaste|jäätelö/i, 'frozen'],
  [/hedelm|vihann|marja|juures|salaat|yrtti/i, 'vegetables'],
  [/liha|kala|broiler|kana|makkara|leikkele|äyriäi|kasviproteiini/i, 'meat_fish'],
  [/maito|juusto|jogurt|rahka|viili|kerma|muna|voi|rasva|levite|kasvijuoma|kaurajuoma/i, 'dairy'],
  [/leipä|leivä|sämpyl|korppu|leivonnai|pulla/i, 'bakery'],
  [/säilyk|purkki/i, 'canned'],
  [/mauste|kastike|öljy|etikka|ketsup|sinappi|majonee|liemi/i, 'spices_sauces'],
  [/kuiva|pasta|riisi|jauho|mur(o|ot)|hiutale|leivonta|sokeri|pähkin|siemen|välipala|makeis|keksi/i, 'dry_goods'],
]

export function categoryFromStorePath(path: string | null | undefined): ShoppingCategory | null {
  if (!path) return null
  return CATEGORY_RULES.find(([re]) => re.test(path))?.[1] ?? null
}

/** Nutrient label (Finnish, as on packages and store pages) -> field. */
function nutrientField(label: string): keyof ProductNutrients | null {
  const l = label.toLowerCase().replace(/^[-–\s]+/, '').trim()
  if (/^energia/.test(l)) return 'energyKcal'
  if (/tyydyttyn/.test(l)) return 'saturatedFat'
  if (/soker/.test(l)) return 'sugars'
  if (/^rasva/.test(l)) return 'fat'
  if (/^hiilihydraat/.test(l)) return 'carbohydrate'
  if (/proteiini/.test(l)) return 'protein'
  if (/kuitu/.test(l)) return 'fibre'
  if (/^suola/.test(l)) return 'salt'
  return null
}

function allergenDiets(freeFrom: string[], contains: string[]): Diet[] {
  const diets: Diet[] = []
  const free = freeFrom.join(' | ').toLowerCase()
  const has = contains.join(' | ').toLowerCase()
  if (/gluten|gluteen/.test(free) && !/gluten|gluteen|vehnä|wheat|ruis|rye|ohra|barley/.test(has)) diets.push('GLUTFREE')
  if (/(^|\|)\s*(milk|maito)/.test(free) && !/milk|maito/.test(has)) diets.push('MILKFREE')
  if (/lactose|laktoosi/.test(free) && !/lactose|laktoosi/.test(has)) diets.push('LACSFREE')
  return diets
}

function finish(p: ExtractedProduct): ExtractedProduct {
  if (p.nutrients.energyKcal === null) p.warnings.push('Energiasisältöä ei löytynyt – täydennä ravintoarvot pakkauksesta.')
  if (p.basis && /ml/i.test(p.basis)) p.warnings.push('Ravintoarvot on ilmoitettu 100 ml kohden – tarkista 1 dl:n paino (oletus 100 g).')
  if (!p.packageGrams) p.packageGrams = packageGramsFromName(p.name)
  return p
}

// --- K-Ruoka ------------------------------------------------------------------------------------

function kRuoka(doc: Document, url: string | null): ExtractedProduct | null {
  const raw = doc.getElementById('applicationState')?.getAttribute('data-state')
  const state = raw ? (tryParseJson(raw) as Json | undefined) : undefined
  const entities = (((state?.reduxState as Json)?.productDetails as Json)?.products as Json)?.entities as Json | undefined
  if (!entities) return null
  const ean = eanFromUrl(url)
  const entry = (Object.values(entities) as Json[]).find((e) => !ean || (e.product as Json)?.ean === ean) ?? (Object.values(entities)[0] as Json)
  const prod = entry?.product as Json | undefined
  if (!prod) return null
  const attrs = (prod.productAttributes ?? {}) as Json
  const localized = prod.localizedName as Json | undefined
  const marketing = attrs.marketingName as Json | undefined
  const nc = (attrs.nutritionalContents as Json[] | undefined)?.[0]
  const nn = (nc?.nutrients ?? nc?.primaryNutrients ?? {}) as Json
  const amount = (k: string) => num((nn[k] as Json | undefined)?.amount ?? nn[k])
  const allergens = (attrs.localizedAllergens ?? {}) as Json
  const listOf = (k: string) => (((allergens[k] as Json | undefined)?.fi ?? (allergens[k] as Json | undefined)?.en ?? []) as string[])
  const freeFromEn = (((allergens.freeFrom as Json | undefined)?.en ?? []) as string[])
  const containsEn = (((allergens.contains as Json | undefined)?.en ?? []) as string[])
  const ingredients = ((attrs.ingredients as Json | undefined)?.fi ?? []) as Json[]
  const ingredientsText = ingredients
    .map((i) => oneLine(((i.name as Json | undefined)?.value as string) ?? ''))
    .filter(Boolean)
    .join(', ')
  const size = (attrs.measurements ?? {}) as Json
  const contentSize = num(size.contentSize ?? size.netWeight)
  const contentUnit = typeof size.contentUnit === 'string' ? size.contentUnit.toLowerCase() : 'kg'
  const packageGrams = contentSize ? Math.round(contentSize * (contentUnit === 'kg' || contentUnit === 'l' ? 1000 : 1)) : null
  const image = safeHttpUrl((attrs.image as Json | undefined)?.url ?? (prod.images as string[] | undefined)?.[0])
  const breadcrumbs = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? '').join(' ')
  const crumbNames = [...breadcrumbs.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).join(' / ')
  return finish({
    source: 'k-ruoka',
    name: oneLine((localized?.finnish as string) ?? (marketing?.fi as string) ?? '') || null,
    brand: oneLine(((prod.brand as Json | undefined)?.name as string) ?? '') || null,
    ean: (prod.ean as string) ?? (attrs.ean as string) ?? ean,
    imageUrl: image,
    sourceUrl: safeHttpUrl(url),
    packageGrams,
    basis: ((nc?.basis as Json | undefined)?.fi as string) ?? null,
    nutrients: {
      energyKcal: num(nn.energyKcal) ?? kcalFrom(nn.energyKj ? `${nn.energyKj} kJ` : null),
      protein: amount('protein'),
      carbohydrate: amount('carbohydrates'),
      sugars: amount('carbohydratesSugar'),
      fat: amount('fat'),
      saturatedFat: amount('fatSaturated'),
      fibre: amount('nutritionalFiber'),
      salt: amount('salt'),
    },
    category: categoryFromStorePath(crumbNames),
    diets: allergenDiets(freeFromEn.length ? freeFromEn : listOf('freeFrom'), containsEn.length ? containsEn : listOf('contains')),
    ingredientsText: ingredientsText || null,
    warnings: [],
  })
}

// --- S-kaupat -----------------------------------------------------------------------------------

function sKaupat(doc: Document, url: string | null): ExtractedProduct | null {
  const next = tryParseJson(doc.getElementById('__NEXT_DATA__')?.textContent ?? '') as Json | undefined
  const apollo = ((next?.props as Json)?.pageProps as Json)?.apolloState as Json | undefined
  if (!apollo) return null
  const ean = eanFromUrl(url)
  const keys = Object.keys(apollo).filter((k) => k.startsWith('Product:'))
  const key = keys.find((k) => ean && k.includes(ean)) ?? keys[0]
  const prod = key ? (apollo[key] as Json) : undefined
  if (!prod) return null
  const details = (prod.productDetails ?? {}) as Json
  const block = (details.nutrients as Json[] | undefined)?.[0]
  const nutrients: ProductNutrients = { ...EMPTY_NUTRIENTS }
  for (const n of ((block?.nutrients ?? []) as Json[])) {
    const field = nutrientField(String(n.name ?? ''))
    if (!field || nutrients[field] !== null) continue
    nutrients[field] = field === 'energyKcal' ? kcalFrom(n.value) : num(n.value)
  }
  const images = (details.productImages ?? {}) as Json
  const template = ((images.mainImage as Json | undefined)?.urlTemplate as string) ?? null
  const image = template
    ? safeHttpUrl(template.replace('{MODIFIERS}', 'w800h800@_q75').replace('{EXTENSION}', 'webp'))
    : safeHttpUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'))
  const path = ((prod.hierarchyPath ?? []) as Json[]).map((h) => h.name).join(' / ')
  const allergens = ((prod.allergens ?? []) as Json[]).map((a) => `${a.allergenTypeCode ?? ''} ${a.levelOfContainmentCode ?? ''} ${a.name ?? ''}`)
  return finish({
    source: 's-kaupat',
    name: oneLine(prod.name) || null,
    brand: oneLine(prod.brandName) || null,
    ean: (prod.ean as string) ?? ean,
    imageUrl: image,
    sourceUrl: safeHttpUrl(url),
    packageGrams: null,
    basis: (block?.referenceQuantity as string) ?? null,
    nutrients,
    category: prod.frozen ? 'frozen' : categoryFromStorePath(path),
    diets: allergenDiets([], allergens),
    ingredientsText: oneLine(prod.ingredientStatement) || null,
    warnings: [],
  })
}

// --- Schema.org Product --------------------------------------------------------------------------

function jsonLdProduct(doc: Document, url: string | null): ExtractedProduct | null {
  const nodes: Json[] = []
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visit)
    const o = n as Json
    if (o['@type'] === 'Product') nodes.push(o)
    if (o['@graph']) visit(o['@graph'])
  }
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => visit(tryParseJson(s.textContent ?? '')))
  const p = nodes[0]
  if (!p) return null
  const nutrition = (p.nutrition ?? {}) as Json
  const weight = p.weight as Json | undefined
  const wv = num(weight?.value)
  const wu = String(weight?.unitText ?? weight?.unitCode ?? '').toLowerCase()
  const image = Array.isArray(p.image) ? p.image[0] : typeof p.image === 'object' ? (p.image as Json)?.url : p.image
  return finish({
    source: 'json-ld',
    name: oneLine(p.name) || null,
    brand: oneLine(typeof p.brand === 'object' ? (p.brand as Json)?.name : p.brand) || null,
    ean: (p.gtin13 as string) ?? (p.gtin as string) ?? (p.gtin8 as string) ?? eanFromUrl(url),
    imageUrl: safeHttpUrl(image),
    sourceUrl: safeHttpUrl(url),
    packageGrams: wv ? Math.round(wv * (wu.startsWith('k') || wu === 'l' || wu === 'ltr' ? 1000 : 1)) : null,
    basis: null,
    nutrients: {
      energyKcal: kcalFrom(nutrition.calories),
      protein: num(nutrition.proteinContent),
      carbohydrate: num(nutrition.carbohydrateContent),
      sugars: num(nutrition.sugarContent),
      fat: num(nutrition.fatContent),
      saturatedFat: num(nutrition.saturatedFatContent),
      fibre: num(nutrition.fiberContent),
      salt: num(nutrition.sodiumContent) !== null ? Math.round((num(nutrition.sodiumContent)! * 2.5) / 10) / 100 : null,
    },
    category: null,
    diets: [],
    ingredientsText: null,
    warnings: [],
  })
}

// --- Plain text (copied page or label) ----------------------------------------------------------

/** Parse nutrition lines from copied text: "Energia 944 kJ / 227 kcal", "- josta sokereita 0 g", "Proteiini\t19 g". */
export function parseNutritionText(text: string): ProductNutrients {
  const out: ProductNutrients = { ...EMPTY_NUTRIENTS }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const m = line.match(/^([-–\s]*[\p{L} ,-]+?)[\s:\t]+(<?\s*\d[\d\s.,]*(?:\s*(?:kj|kcal|g|mg))?(?:\s*\/\s*\d[\d.,]*\s*(?:kj|kcal))?)\s*$/iu)
    if (!m) continue
    const field = nutrientField(m[1])
    if (!field || out[field] !== null) continue
    out[field] = field === 'energyKcal' ? kcalFrom(m[2]) : num(m[2].replace('<', ''))
  }
  return out
}

/** "…/tuote/pirkka-naudan-jauheliha-400g-17-6410405338204" -> "Pirkka naudan jauheliha 400g 17" */
export function nameFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/tuote\/([^/?#]+)/)
  if (!m) return null
  const words = decodeURIComponent(m[1]).replace(/-?\d{8,14}$/, '').split('-').filter(Boolean)
  if (words.length === 0) return null
  const s = words.join(' ')
  return s[0].toUpperCase() + s.slice(1)
}

function fromText(text: string, url: string | null): ExtractedProduct | null {
  const nutrients = parseNutritionText(text)
  if (nutrients.energyKcal === null && nutrients.protein === null) return null
  const ean = eanFromUrl(url) ?? text.match(/\b(\d{13})\b/)?.[1] ?? null
  const brand = text.match(/Tuotemerkki:?\s*\n?\s*([^\n]+)/i)?.[1]?.trim() ?? null
  return finish({
    source: 'text',
    name: nameFromUrl(url),
    brand,
    ean,
    // K-Ruoka product images follow the EAN
    imageUrl: ean && url && /k-ruoka\.fi/.test(url) ? `https://public.keskofiles.com/f/k-ruoka/product/${ean}` : null,
    sourceUrl: safeHttpUrl(url),
    packageGrams: null,
    basis: text.match(/per\s+(100\s*(?:g|ml))/i)?.[1] ?? null,
    nutrients,
    category: null,
    diets: [],
    ingredientsText: null,
    warnings: ['Tiedot luettiin kopioidusta tekstistä – tarkista nimi ja arvot.'],
  })
}

/**
 * Extract a product from pasted page source or copied text.
 * Tries the store-specific formats, then Schema.org, then plain text. Returns null if nothing usable was found.
 */
export function extractProduct(input: string, url?: string | null): ExtractedProduct | null {
  const u = url?.trim() || null
  if (/<\s*(html|body|div|script|meta)\b/i.test(input)) {
    const doc = new DOMParser().parseFromString(input, 'text/html')
    const store = kRuoka(doc, u) ?? sKaupat(doc, u)
    if (store) return store
    const ld = jsonLdProduct(doc, u)
    const text = fromText(doc.body?.innerText || doc.body?.textContent || '', u)
    if (ld && text && ld.nutrients.energyKcal === null) return { ...ld, nutrients: text.nutrients, basis: text.basis }
    return ld ?? text
  }
  return fromText(input, u)
}
