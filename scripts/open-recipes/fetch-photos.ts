/**
 * Photos for catalogue recipes that have none, from Wikimedia Commons:
 *  1. the Wikibooks Cookbook page's own image (the recipe's page photo), and
 *  2. for other recipes whose English title is exactly a Wikidata dish name, that dish's image
 *     (credited as an example photo of the dish). The file name must share a word with the dish
 *     name, which drops images that show something else (a drum group for "egusi soup").
 * Each photo keeps its own author and licence from Commons; non-free or unclear files are skipped.
 *
 *   node scripts/open-recipes/fetch-photos.ts      (~10 min, polite to the APIs, resumable cache)
 * Output: data/open-recipes/photos.json  { recipeId: { url, credit, license, licenseUrl } }
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../data/open-recipes')
const CACHE = join(ROOT, 'raw/photos')
const UA = 'RecipeToolCatalogue/1.0 (open recipe catalogue builder)'
mkdirSync(CACHE, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (res.status === 429 || res.status >= 500) {
      await sleep(15000 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    await sleep(1500)
    return res.json()
  }
  throw new Error(`gave up: ${url}`)
}
function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const file = join(CACHE, name)
  if (existsSync(file)) return Promise.resolve(JSON.parse(readFileSync(file, 'utf8')))
  return make().then((v) => (writeFileSync(file, JSON.stringify(v)), v))
}

// 1. Page images of all Wikibooks Cookbook pages: title -> file name
const pageImages = await cached<Record<string, string>>('wikibooks-pageimages.json', async () => {
  const out: Record<string, string> = {}
  let cont: Record<string, string> = {}
  for (;;) {
    const q = new URLSearchParams({ action: 'query', generator: 'allpages', gapnamespace: '102', gaplimit: '500', gapfilterredir: 'nonredirects', prop: 'pageimages', piprop: 'name', format: 'json', ...cont })
    const d = await getJson(`https://en.wikibooks.org/w/api.php?${q}`)
    for (const p of Object.values<any>(d.query?.pages ?? {})) if (p.pageimage) out[p.title.replace(/^Cookbook:/, '').toLowerCase()] = p.pageimage
    if (!d.continue) break
    cont = d.continue
  }
  return out
})

// 2. Wikidata dishes with an image: English name or alias -> file name
const dishImages = await cached<Record<string, string>>('wikidata-dishes.json', async () => {
  const query = `SELECT ?en ?alias ?img WHERE { ?d wdt:P31/wdt:P279* wd:Q746549 ; wdt:P18 ?img ; rdfs:label ?en FILTER(LANG(?en)="en") OPTIONAL { ?d skos:altLabel ?alias FILTER(LANG(?alias)="en") } }`
  const d = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`)
  const out: Record<string, string> = {}
  for (const b of d.results.bindings) {
    const file = decodeURIComponent(b.img.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ')
    for (const k of ['en', 'alias']) if (b[k] && !out[b[k].value.toLowerCase()]) out[b[k].value.toLowerCase()] = file
  }
  return out
})

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter((w) => w.length >= 4)
const wanted = new Map<string, { file: string; kind: 'page' | 'dish' }>()
for (const f of readdirSync(join(ROOT, 'en')).filter((f) => f.endsWith('.json'))) {
  for (const r of JSON.parse(readFileSync(join(ROOT, 'en', f), 'utf8'))) {
    if (r.image) continue
    const page = typeof r.sourceUrl === 'string' && r.sourceUrl.includes('Cookbook:') ? decodeURIComponent(r.sourceUrl.split('Cookbook:')[1]).replace(/_/g, ' ').toLowerCase() : null
    if (page && pageImages[page]) {
      wanted.set(r.id, { file: pageImages[page].replace(/_/g, ' '), kind: 'page' })
      continue
    }
    const title = r.title.toLowerCase().replace(/\(.*?\)/g, '').trim()
    const name = [title, title.replace(/^(easy|simple|classic|homemade|quick|basic|traditional|best) /, '')].find((t) => dishImages[t])
    if (!name) continue
    const file = dishImages[name]
    if (!words(file).some((w) => words(name).some((n) => w.includes(n) || n.includes(w)))) continue
    wanted.set(r.id, { file, kind: 'dish' })
  }
}
console.log(`photos wanted: ${wanted.size} (${[...wanted.values()].filter((w) => w.kind === 'page').length} Wikibooks page photos)`)

// 3. Commons metadata (author, licence) and an 800 px thumbnail, 50 files per request
const files = [...new Set([...wanted.values()].map((w) => w.file))]
const info = await cached<Record<string, any>>('commons-info.json', async () => {
  const out: Record<string, any> = {}
  for (let i = 0; i < files.length; i += 50) {
    const titles = files.slice(i, i + 50).map((f) => `File:${f}`).join('|')
    const q = new URLSearchParams({ action: 'query', titles, prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '800', format: 'json' })
    const d = await getJson(`https://commons.wikimedia.org/w/api.php?${q}`)
    const norm = new Map<string, string>((d.query?.normalized ?? []).map((n: any) => [n.to, n.from]))
    for (const p of Object.values<any>(d.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0]
      if (!ii) continue
      const m = ii.extmetadata ?? {}
      out[(norm.get(p.title) ?? p.title).replace(/^File:/, '')] = {
        url: (ii.thumburl ?? ii.url).split('?')[0],
        mime: ii.mime,
        artist: m.Artist?.value,
        license: m.LicenseShortName?.value,
        licenseUrl: m.LicenseUrl?.value,
        restrictions: m.Restrictions?.value,
      }
    }
    console.log(`commons ${Math.min(i + 50, files.length)}/${files.length}`)
  }
  return out
})

const FREE = /^(cc0|cc[ -]by(-sa)?[ -]\d|public domain|pd|gfdl|attribution|cc-by)/i
const plain = (html?: string) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const photos: Record<string, { url: string; credit: string; license: string; licenseUrl?: string }> = {}
let skipped = 0
for (const [id, w] of wanted) {
  const i = info[w.file] ?? info[w.file.replace(/ /g, '_')]
  if (!i || !/^image\/(jpeg|png|webp)$/.test(i.mime) || !FREE.test(i.license ?? '') || i.restrictions) {
    skipped++
    continue
  }
  const artist = plain(i.artist).slice(0, 120) || 'Wikimedia Commons'
  photos[id] = {
    url: i.url,
    credit: w.kind === 'page' ? `${artist} (Wikimedia Commons)` : `${artist} (Wikimedia Commons) – esimerkkikuva ruokalajista`,
    license: i.license,
    licenseUrl: i.licenseUrl || undefined,
  }
}
writeFileSync(join(ROOT, 'photos.json'), JSON.stringify(photos, null, 1))
console.log(`photos.json: ${Object.keys(photos).length} photos, ${skipped} skipped (unclear licence or not a photo)`)
