/**
 * Recipe source adapters.
 *
 * Each adapter adds site-specific knowledge on top of the generic extraction
 * chain (JSON-LD -> embedded app state -> semantic HTML -> meta tags), which the
 * pipeline always runs afterwards to fill whatever the adapter left empty.
 *
 * Adding a new site = add an adapter object here and list its domains.
 * Remember to add the domain to the server's fetch allowlist (server/allowlist.ts).
 */
import { extractEmbeddedState } from '../extractors/embeddedState'
import { extractJsonLd } from '../extractors/jsonLd'
import { oneLine, textOf } from '../text'
import type { AdapterResult, ExtractedIngredient, RecipeSourceAdapter } from '../types'

/** Valio: complete JSON-LD; ingredient sub-headings (h3) only exist in the HTML list. */
export const ValioAdapter: RecipeSourceAdapter = {
  id: 'valio',
  name: 'Valio',
  homepage: 'https://www.valio.fi/reseptit/',
  domains: ['valio.fi'],
  extract(doc, url) {
    const methods: string[] = []
    const warnings: string[] = []
    const data = extractJsonLd(doc, url) ?? {}
    if (data.title) methods.push('json-ld')

    const list = doc.querySelector('.vl-recipe-content__ingredients__list')
    if (list) {
      const items: ExtractedIngredient[] = []
      let group: string | null = null
      for (const el of list.querySelectorAll('h2, h3, h4, li.ingredient-item')) {
        if (/^h[2-4]$/i.test(el.tagName)) {
          group = textOf(el) || null
          continue
        }
        const amount = textOf(el.querySelector('.ingredient-amount'))
        // Product-linked ingredients keep their name in a link instead of .ingredient-name
        const name = textOf(el.querySelector('.ingredient-name')) || textOf(el.querySelector('.ingredient-product__link'))
        const text = oneLine(`${amount} ${name}`) || textOf(el)
        if (text) items.push({ text, group })
      }
      const jsonLd = data.ingredients ?? []
      if (items.length > 0 && items.length === jsonLd.length) {
        // Same list: keep the exact JSON-LD wording, add the group headings from the HTML.
        data.ingredients = jsonLd.map((ing, i) => ({ ...ing, group: items[i].group }))
        methods.push('valio-html-groups')
      } else if (items.length > 0 && jsonLd.length === 0) {
        data.ingredients = items
        methods.push('valio-html')
      } else if (items.length > 0) {
        warnings.push('Valion HTML-ainesluettelo poikkesi JSON-LD-tiedoista; käytettiin JSON-LD-luetteloa.')
      }
    }
    return { data, methods, warnings }
  },
}

/**
 * Yhteishyvä / S-kaupat: JSON-LD plus the Next.js recipe object, which maps every
 * ingredient to a Fineli food and gives unambiguous total nutrition.
 * Note: the JSON-LD "nutrition" mixes per-portion kcal with whole-recipe macros,
 * so we prefer the embedded totals.
 */
export const YhteishyvaAdapter: RecipeSourceAdapter = {
  id: 'yhteishyva',
  name: 'Yhteishyvä / S-kaupat',
  homepage: 'https://yhteishyva.fi/reseptit',
  domains: ['yhteishyva.fi', 's-kaupat.fi', 'foodie.fi'],
  extract(doc, url) {
    const methods: string[] = []
    const warnings: string[] = []
    const data = extractJsonLd(doc, url) ?? {}
    if (data.title) methods.push('json-ld')

    const embedded = extractEmbeddedState(doc)
    if (embedded) {
      methods.push('yhteishyva-next-data')
      const e = embedded.recipe
      if ((e.ingredients?.length ?? 0) >= (data.ingredients?.length ?? 0)) data.ingredients = e.ingredients
      if (!data.instructions?.length) data.instructions = e.instructions
      data.servings = data.servings ?? e.servings
      if (!data.cookTimeMin && e.cookTimeMin) data.cookTimeMin = e.cookTimeMin
      const raw = embedded.raw
      const activeCook = typeof raw.activeCookTime === 'number' ? raw.activeCookTime : null
      if (!data.prepTimeMin && activeCook && data.cookTimeMin && activeCook < data.cookTimeMin) data.prepTimeMin = activeCook
      const nutrition = (raw.nutrition as Record<string, unknown> | undefined)?.nutrients as Record<string, number> | undefined
      if (nutrition && typeof nutrition.kcal === 'number') {
        data.sourceNutrition = {
          basis: 'total',
          raw: {
            'Energia (kcal)': Math.round(nutrition.kcal),
            'Proteiini (g)': nutrition.protein,
            'Hiilihydraatit (g)': nutrition.carbs,
            'Rasva (g)': nutrition.fat,
            'Kuitu (g)': nutrition.fibre,
            'Sokerit (g)': nutrition.sugar,
            'Tyydyttynyt rasva (g)': nutrition.saturatedFat,
            'Suola (g)': typeof nutrition.salt === 'number' ? Math.round(nutrition.salt / 100) / 10 : '',
            'Kokonaispaino (g)': nutrition.mass,
          },
        }
      }
      const cats = raw.categories as Record<string, string[]> | undefined
      if (cats) {
        data.tags = [...new Set([...(data.tags ?? []), ...Object.values(cats).flat().map((t) => t.toLowerCase())])]
        data.category = data.category ?? cats.course?.[0] ?? cats.foodType?.[0] ?? null
      }
    } else if (data.sourceNutrition) {
      data.sourceNutrition = { ...data.sourceNutrition, basis: 'unknown' }
      warnings.push('Lähteen ravintoarvojen perustetta (annos/kokonais) ei voitu varmistaa.')
    }
    return { data, methods, warnings }
  },
}

/**
 * K-Ruoka: prefers JSON-LD and embedded Next.js state when present. The live site is
 * behind a bot-protection challenge, so automated fetching usually fails; the user can
 * paste the page HTML instead and the same extraction runs on it.
 */
export const KRuokaAdapter: RecipeSourceAdapter = {
  id: 'k-ruoka',
  name: 'K-Ruoka',
  homepage: 'https://www.k-ruoka.fi/reseptit',
  domains: ['k-ruoka.fi', 'kesko.fi', 'pirkka.fi'],
  extract(doc, url) {
    const methods: string[] = []
    const warnings: string[] = []
    const data = extractJsonLd(doc, url) ?? {}
    if (data.title) methods.push('json-ld')
    if (!data.ingredients?.length) {
      const embedded = extractEmbeddedState(doc)
      if (embedded) {
        methods.push('k-ruoka-app-state')
        Object.assign(data, Object.fromEntries(Object.entries(embedded.recipe).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))))
      }
    }
    // K-Ruoka shows e.g. "6annosta" and "15–30 min" as plain text in the recipe header.
    if (!data.servings || (!data.totalTimeMin && !data.cookTimeMin)) {
      const header = textOf(doc.querySelector('main')) || textOf(doc.body)
      const s = header.match(/(\d+)\s*annosta/i)
      if (s && !data.servings) {
        data.servings = Number(s[1])
        data.servingsText = s[0]
      }
      const t = header.match(/(\d+\s*[–-]\s*\d+|\d+)\s*min\b/i)
      if (t && !data.totalTimeMin && !data.cookTimeMin) {
        data.timeText = t[0]
        const nums = t[1].split(/[–-]/).map((x) => Number(x.trim()))
        data.totalTimeMin = Math.max(...nums)
      }
    }
    return { data, methods, warnings }
  },
}

/** Generic adapter for any other site: relies entirely on the shared extraction chain. */
export const GenericRecipeAdapter: RecipeSourceAdapter = {
  id: 'generic',
  name: 'Muu sivusto',
  homepage: '',
  domains: [],
  extract(): AdapterResult {
    return { data: {}, methods: [], warnings: [] }
  },
}

export const ADAPTERS: RecipeSourceAdapter[] = [KRuokaAdapter, YhteishyvaAdapter, ValioAdapter]

export function adapterForUrl(url: URL): RecipeSourceAdapter {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return ADAPTERS.find((a) => a.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? GenericRecipeAdapter
}
