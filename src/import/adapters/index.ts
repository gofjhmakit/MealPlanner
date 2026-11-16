/**
 * Recipe source adapters.
 *
 * Each adapter adds site-specific knowledge on top of the generic extraction
 * chain (JSON-LD -> embedded app state -> semantic HTML -> meta tags), which the
 * pipeline always runs afterwards to fill whatever the adapter left empty.
 *
 * Adding a new site = add an adapter object here and list its domains.
 * Remember to add the domain to the server's fetch allowlist (server/allowlist.ts)
 * — unless the adapter is `pasteOnly` (saved from pasted page source for personal
 * use only), in which case it must stay OUT of the allowlist.
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

/**
 * A source that publishes standard Schema.org recipe data and needs no site-specific
 * extraction – the shared chain (JSON-LD first) does all the work. The adapter only lets
 * the app recognise the site and show its proper name on the saved recipe.
 *
 * `pasteOnly` (the default) marks all-rights-reserved sites that are NEVER auto-fetched
 * and stay out of the server allowlist: the user pastes the page source, which for
 * personal use is akin to copying a recipe into a notebook by hand. Pass `{ pasteOnly:
 * false }` only for a site whose live auto-fetch has actually been verified and whose
 * domain is in the allowlist.
 */
function schemaOrgSource(id: string, name: string, homepage: string, domains: string[], opts: { pasteOnly?: boolean } = {}): RecipeSourceAdapter {
  return {
    id,
    name,
    homepage,
    domains,
    pasteOnly: opts.pasteOnly ?? true,
    extract(): AdapterResult {
      return { data: {}, methods: [], warnings: [] }
    },
  }
}

/** Arla: Schema.org JSON-LD (the @type attribute is entity-encoded, which the DOM decodes). Fetch verified live. */
export const ArlaAdapter = schemaOrgSource('arla', 'Arla', 'https://www.arla.fi/reseptit/', ['arla.fi'], { pasteOnly: false })
/** Kotikokki.net: Schema.org JSON-LD. Fetch verified live. */
export const KotikokkiAdapter = schemaOrgSource('kotikokki', 'Kotikokki.net', 'https://www.kotikokki.net/', ['kotikokki.net'], { pasteOnly: false })

/** Grocery/brand sites whose automated fetch is verified and allowlisted. */
export const FETCHABLE_ADAPTERS: RecipeSourceAdapter[] = [KRuokaAdapter, YhteishyvaAdapter, ValioAdapter, ArlaAdapter, KotikokkiAdapter]

/**
 * Finnish recipe blogs, magazines and food brands recognised from pasted page source only.
 * Standard Schema.org recipe data; all-rights-reserved content saved for personal use, so
 * intentionally kept out of the fetch allowlist.
 */
export const FINNISH_PASTE_ADAPTERS: RecipeSourceAdapter[] = [
  schemaOrgSource('chocochili', 'Chocochili', 'https://www.chocochili.net/', ['chocochili.net']),
  schemaOrgSource('kinuskikissa', 'Kinuskikissa', 'https://www.kinuskikissa.fi/', ['kinuskikissa.fi']),
  schemaOrgSource('hellapoliisi', 'Hellapoliisi', 'https://www.hellapoliisi.fi/', ['hellapoliisi.fi']),
  schemaOrgSource('liemessa', 'Liemessä', 'https://www.liemessa.fi/', ['liemessa.fi']),
  schemaOrgSource('kotiliesi', 'Kotiliesi', 'https://kotiliesi.fi/ruoka/', ['kotiliesi.fi']),
  schemaOrgSource('martat', 'Martat', 'https://www.martat.fi/reseptit/', ['martat.fi']),
  schemaOrgSource('soppa365', 'Soppa365', 'https://www.soppa365.fi/', ['soppa365.fi']),
  schemaOrgSource('myllarin', 'Myllärin', 'https://www.myllarin.fi/reseptit/', ['myllarin.fi']),
  schemaOrgSource('myllyn-paras', 'Myllyn Paras', 'https://myllynparas.fi/', ['myllynparas.fi']),
  schemaOrgSource('snellman', 'Snellman', 'https://www.snellman.fi/fi/reseptit/', ['snellman.fi']),
]

/**
 * International recipe sites recognised from pasted page source only. All-rights-reserved
 * content saved for personal use; intentionally absent from the fetch allowlist.
 */
export const INTERNATIONAL_ADAPTERS: RecipeSourceAdapter[] = [
  schemaOrgSource('nyt-cooking', 'NYT Cooking', 'https://cooking.nytimes.com/', ['cooking.nytimes.com']),
  schemaOrgSource('bon-appetit', 'Bon Appétit', 'https://www.bonappetit.com/', ['bonappetit.com']),
  schemaOrgSource('serious-eats', 'Serious Eats', 'https://www.seriouseats.com/', ['seriouseats.com']),
  schemaOrgSource('delish', 'Delish', 'https://www.delish.com/', ['delish.com']),
  schemaOrgSource('tasty', 'Tasty', 'https://tasty.co/', ['tasty.co']),
  schemaOrgSource('great-british-chefs', 'Great British Chefs', 'https://www.greatbritishchefs.com/', ['greatbritishchefs.com']),
  schemaOrgSource('americas-test-kitchen', "America's Test Kitchen", 'https://www.americastestkitchen.com/', ['americastestkitchen.com']),
  schemaOrgSource('damn-delicious', 'Damn Delicious', 'https://damndelicious.net/', ['damndelicious.net']),
  schemaOrgSource('cooking-classy', 'Cooking Classy', 'https://www.cookingclassy.com/', ['cookingclassy.com']),
  schemaOrgSource('allrecipes', 'Allrecipes', 'https://www.allrecipes.com/', ['allrecipes.com']),
  schemaOrgSource('food-network', 'Food Network', 'https://www.foodnetwork.com/', ['foodnetwork.com']),
  schemaOrgSource('epicurious', 'Epicurious', 'https://www.epicurious.com/', ['epicurious.com']),
  schemaOrgSource('bbc-good-food', 'BBC Good Food', 'https://www.bbcgoodfood.com/', ['bbcgoodfood.com']),
  schemaOrgSource('simply-recipes', 'Simply Recipes', 'https://www.simplyrecipes.com/', ['simplyrecipes.com']),
  schemaOrgSource('the-kitchn', 'The Kitchn', 'https://www.thekitchn.com/', ['thekitchn.com']),
  schemaOrgSource('king-arthur', 'King Arthur Baking', 'https://www.kingarthurbaking.com/', ['kingarthurbaking.com']),
  schemaOrgSource('smitten-kitchen', 'Smitten Kitchen', 'https://smittenkitchen.com/', ['smittenkitchen.com']),
  schemaOrgSource('budget-bytes', 'Budget Bytes', 'https://www.budgetbytes.com/', ['budgetbytes.com']),
  schemaOrgSource('recipetin-eats', 'RecipeTin Eats', 'https://www.recipetineats.com/', ['recipetineats.com']),
  schemaOrgSource('minimalist-baker', 'Minimalist Baker', 'https://minimalistbaker.com/', ['minimalistbaker.com']),
  schemaOrgSource('food52', 'Food52', 'https://food52.com/', ['food52.com']),
  schemaOrgSource('love-and-lemons', 'Love and Lemons', 'https://www.loveandlemons.com/', ['loveandlemons.com']),
  schemaOrgSource('half-baked-harvest', 'Half Baked Harvest', 'https://www.halfbakedharvest.com/', ['halfbakedharvest.com']),
  schemaOrgSource('taste-of-home', 'Taste of Home', 'https://www.tasteofhome.com/', ['tasteofhome.com']),
  schemaOrgSource('jamie-oliver', 'Jamie Oliver', 'https://www.jamieoliver.com/', ['jamieoliver.com']),
  schemaOrgSource('pinch-of-yum', 'Pinch of Yum', 'https://pinchofyum.com/', ['pinchofyum.com']),
]

export const ADAPTERS: RecipeSourceAdapter[] = [...FETCHABLE_ADAPTERS, ...FINNISH_PASTE_ADAPTERS, ...INTERNATIONAL_ADAPTERS]

export function adapterForUrl(url: URL): RecipeSourceAdapter {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return ADAPTERS.find((a) => a.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? GenericRecipeAdapter
}
