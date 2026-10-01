// @vitest-environment jsdom
/**
 * Recipe page parsing. Valio and Yhteishyvä fixtures are trimmed copies of the real
 * pages (structure preserved, instruction prose shortened). The K-Ruoka site could not
 * be fetched during development (bot protection), so its fixture is synthetic and
 * exercises the embedded-app-state and plain-text fallbacks.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterForUrl } from '../src/import/adapters'
import { parseUrlList } from '../src/import/client'
import { detectBlockedPage, extractRecipe, ImportError, toRecipe } from '../src/import/pipeline'
import { fineliLookup } from './helpers'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
const parse = (html: string, url: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const u = new URL(url)
  return toRecipe(extractRecipe(doc, u), { url: u, ctx: { fineli: fineliLookup() }, defaultServings: 4 })
}

describe('adapter selection', () => {
  it('chooses site adapters by domain', () => {
    expect(adapterForUrl(new URL('https://www.k-ruoka.fi/reseptit/x')).id).toBe('k-ruoka')
    expect(adapterForUrl(new URL('https://yhteishyva.fi/reseptit/x/1')).id).toBe('yhteishyva')
    expect(adapterForUrl(new URL('https://www.s-kaupat.fi/resepti/x')).id).toBe('yhteishyva')
    expect(adapterForUrl(new URL('https://www.valio.fi/reseptit/x/')).id).toBe('valio')
    expect(adapterForUrl(new URL('https://example.com/recipe')).id).toBe('generic')
  })

  it('extracts URLs from pasted text', () => {
    expect(parseUrlList('https://a.fi/x\nhttps://b.fi/y, https://a.fi/x')).toEqual(['https://a.fi/x', 'https://b.fi/y'])
  })
})

describe('Valio (JSON-LD + HTML ingredient groups)', () => {
  const { recipe, diagnostics } = parse(fixture('valio-kasvislasagne.html'), 'https://www.valio.fi/reseptit/maukas-kasvislasagne/')

  it('extracts all main fields', () => {
    expect(recipe.title).toBe('Maukas kasvislasagne')
    expect(recipe.servings).toBe(4)
    expect(recipe.prepTimeMin).toBe(30)
    expect(recipe.cookTimeMin).toBe(70)
    expect(recipe.totalTimeMin).toBe(100)
    expect(recipe.ingredients).toHaveLength(18)
    expect(recipe.instructions).toHaveLength(4)
    expect(recipe.imageUrl).toMatch(/^https:\/\/www\.valio\.fi\//)
    expect(recipe.sourceName).toBe('Valio')
    expect(recipe.author).toBe('Sanna Mäenpää')
    expect(diagnostics.missing).toEqual([])
    expect(diagnostics.methods).toContain('valio-html-groups')
  })

  it('keeps the original ingredient wording and adds group headings', () => {
    const sipuli = recipe.ingredients.find((i) => i.raw === '1 sipuli')!
    expect(sipuli.group).toBe('Kasviproteiinikastike')
    expect(recipe.ingredients.find((i) => i.raw.includes('kevytmaitoa'))!.group).toBe('Juustokastike')
    expect(recipe.ingredients[0].raw).toBe('9 lasagnelevyä')
  })

  it('maps nearly all ingredients to Fineli', () => {
    const confident = recipe.ingredients.filter((i) => i.confidence >= 0.7)
    expect(confident.length).toBeGreaterThanOrEqual(16)
    expect(recipe.ingredients.find((i) => i.raw.includes('mozzarella'))!.canonicalId).toBe('mozzarella')
  })

  it('stores source nutrition without claiming a basis it did not state', () => {
    expect(recipe.sourceNutrition).toEqual({ raw: { calories: '89 kcal' }, basis: 'unknown' })
  })
})

describe('Yhteishyvä (JSON-LD + Next.js data with Fineli ids)', () => {
  const { recipe, diagnostics } = parse(fixture('yhteishyva-marry-me-keitto.html'), 'https://yhteishyva.fi/reseptit/marry-me-keitto/7EDLGkBh6ltuuGI38fTrob')

  it('extracts the recipe', () => {
    expect(recipe.title).toBe('Marry me -keitto')
    expect(recipe.servings).toBe(4)
    expect(recipe.cookTimeMin).toBe(30)
    expect(recipe.ingredients).toHaveLength(15)
    expect(recipe.instructions).toHaveLength(4)
    expect(diagnostics.methods).toEqual(expect.arrayContaining(['json-ld', 'yhteishyva-next-data']))
  })

  it("uses the source's own Fineli mapping when it differs", () => {
    const cream = recipe.ingredients.find((i) => i.raw.includes('kuohukermaa'))!
    expect(cream.fineliId).toBe(29066) // "Kerma, kuohukerma, rasvaa 35 %" as chosen by the source
    expect(cream.canonicalId).toBe('cream') // shopping ingredient from our dictionary
    expect(cream.matchMethod).toBe('source')
  })

  it('takes unambiguous total nutrition from embedded data', () => {
    expect(recipe.sourceNutrition?.basis).toBe('total')
    expect(recipe.sourceNutrition?.raw['Energia (kcal)']).toBe(2831)
    expect(recipe.sourceNutrition?.raw['Suola (g)']).toBe(13.5)
  })
})

describe('K-Ruoka (synthetic fixture: embedded Next.js state, no JSON-LD)', () => {
  const html = `<!doctype html><html><head><title>Texmex-salaatti | K-Ruoka</title>
    <meta property="og:image" content="https://example.invalid/texmex.jpg"></head>
    <body><main><h1>Texmex-salaatti</h1><p>6annosta</p><p>15–30 min</p></main>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          recipe: {
            name: 'Texmex-salaatti',
            ingredients: [
              { title: 'Salaatti', ingredients: [{ amount: '½', unit: 'kerää', name: '(250 g) jäävuorisalaattia' }, { amount: '2', unit: '', name: 'tomaattia' }] },
              { title: 'Jauheliha', ingredients: [{ amount: '1', unit: 'pkt', name: '(400 g) naudan jauhelihaa' }, { amount: '½', unit: 'dl', name: 'vettä' }] },
            ],
            instructions: 'Ruskista jauheliha.\nPilko kasvikset.\nKokoa salaatti.',
          },
        },
      },
    })}</script></body></html>`
  const { recipe, diagnostics } = parse(html, 'https://www.k-ruoka.fi/reseptit/texmex-salaatti')

  it('reads ingredients with groups from app state', () => {
    expect(recipe.title).toBe('Texmex-salaatti')
    expect(recipe.ingredients.map((i) => i.raw)).toEqual(['½ kerää (250 g) jäävuorisalaattia', '2 tomaattia', '1 pkt (400 g) naudan jauhelihaa', '½ dl vettä'])
    expect(recipe.ingredients[2].group).toBe('Jauheliha')
    expect(recipe.instructions).toHaveLength(3)
    expect(diagnostics.methods).toContain('k-ruoka-app-state')
  })

  it('reads servings and time from page text', () => {
    expect(recipe.servings).toBe(6)
    expect(recipe.totalTimeMin).toBe(30)
    expect(recipe.imageUrl).toBe('https://example.invalid/texmex.jpg')
  })
})

describe('generic fallbacks', () => {
  it('parses schema.org microdata', () => {
    const html = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Pannukakku</h1>
      <span itemprop="recipeYield">6 annosta</span><meta itemprop="totalTime" content="PT40M">
      <ul><li itemprop="recipeIngredient">1 l maitoa</li><li itemprop="recipeIngredient">3 kananmunaa</li></ul>
      <div itemprop="recipeInstructions"><ol><li>Sekoita.</li><li>Paista.</li></ol></div></div>`
    const { recipe, diagnostics } = parse(html, 'https://example.com/pannukakku')
    expect(recipe).toMatchObject({ title: 'Pannukakku', servings: 6, totalTimeMin: 40 })
    expect(recipe.ingredients).toHaveLength(2)
    expect(recipe.instructions).toEqual(['Sekoita.', 'Paista.'])
    expect(diagnostics.methods).toContain('microdata')
  })

  it('parses "Ainekset" / "Valmistus" headings', () => {
    const html = `<html><head><meta property="og:title" content="Lihapullat"></head><body>
      <h2>Ainekset</h2><ul><li>400 g jauhelihaa</li><li>1 sipuli</li><li>1 dl korppujauhoja</li></ul>
      <h2>Valmistus</h2><ol><li>Sekoita ainekset.</li><li>Pyöritä pullat ja paista.</li></ol></body></html>`
    const { recipe } = parse(html, 'https://example.com/lihapullat')
    expect(recipe.title).toBe('Lihapullat')
    expect(recipe.ingredients.map((i) => i.canonicalId)).toEqual(['mixed-mince', 'onion', 'breadcrumbs'])
    expect(recipe.instructions).toHaveLength(2)
  })

  it('does not invent data: missing fields are reported', () => {
    const html = `<h1>Salaatti</h1><h2>Ainekset</h2><ul><li>1 kurkku</li></ul>`
    const { recipe, diagnostics } = parse(html, 'https://example.com/s')
    expect(recipe.instructions).toEqual([])
    expect(diagnostics.missing).toEqual(expect.arrayContaining(['Valmistusohje', 'Annosmäärä', 'Valmistusaika']))
    expect(diagnostics.warnings.join(' ')).toMatch(/Annosmäärää ei löytynyt/)
  })

  it('rejects pages without recipe content', () => {
    expect(() => parse('<html><body><h1>Etusivu</h1><p>Tervetuloa</p></body></html>', 'https://example.com/')).toThrow(ImportError)
  })

  it('detects bot-protection interstitials but not pages that merely embed a Turnstile widget', () => {
    expect(detectBlockedPage('<html><head><title>Just a moment...</title></head></html>')).toBe(true)
    expect(detectBlockedPage('<html><head><title>Vercel Security Checkpoint</title></head></html>')).toBe(true)
    expect(detectBlockedPage(fixture('valio-kasvislasagne.html'))).toBe(false)
    expect(detectBlockedPage('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><h1>Resepti</h1>')).toBe(false)
  })
})
