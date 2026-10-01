/**
 * Downloads the USDA MyPlate Kitchen recipe library (US federal works, public domain)
 * from its preservation site myplate.food, one page per second, keeping each page's
 * schema.org Recipe JSON-LD. Resumable: already downloaded recipes are skipped.
 *
 *   node scripts/open-recipes/fetch-myplate.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, '../../data/open-recipes/raw/myplate/pages')
const UA = 'MealPlanner open-recipe importer (https://github.com/gofjhmakit/MealPlanner)'
mkdirSync(OUT, { recursive: true })

const sitemap = await (await fetch('https://myplate.food/sitemap-recipes-en.xml', { headers: { 'User-Agent': UA } })).text()
const urls = [...sitemap.matchAll(/<loc>(https:\/\/myplate\.food\/recipes\/[^<]+)<\/loc>/g)].map((m) => m[1])
console.log(`${urls.length} recipe URLs`)

let done = 0
let failed = 0
for (const url of urls) {
  const slug = url.split('/').pop()!
  const file = join(OUT, `${slug}.json`)
  if (existsSync(file)) continue
  try {
    const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
    const recipe = blocks.flatMap((b) => (Array.isArray(b) ? b : [b])).find((b) => b['@type'] === 'Recipe')
    if (!recipe) throw new Error('no Recipe JSON-LD')
    writeFileSync(file, JSON.stringify(recipe, null, 1))
    done++
  } catch (e) {
    failed++
    console.warn(`${slug}: ${(e as Error).message}`)
  }
  if ((done + failed) % 50 === 0) console.log(`${done} saved, ${failed} failed`)
  await new Promise((r) => setTimeout(r, 1000))
}
console.log(`finished: ${done} saved, ${failed} failed`)
