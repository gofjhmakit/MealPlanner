/**
 * Browser side of recipe importing: fetch the page through the local fetch
 * service (CORS prevents fetching other sites directly) and parse it here.
 */
import type { MatchContext } from '../domain/matcher'
import type { ImportDiagnostics, Recipe } from '../domain/types'
import { detectBlockedPage, extractRecipe, ImportError, toRecipe, validateRecipeUrl } from './pipeline'

export const FETCH_ENDPOINT = `${import.meta.env.BASE_URL}api/fetch-recipe`

/** False in static-only builds (e.g. GitHub Pages) that have no fetch service: only pasting page HTML works there. */
export const FETCH_AVAILABLE = import.meta.env.VITE_STATIC_ONLY !== 'true'

export async function fetchPageHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  let res: Response
  try {
    res = await fetch(`${FETCH_ENDPOINT}?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json' } })
  } catch {
    throw new ImportError('fetch-failed', 'Hakupalveluun ei saatu yhteyttä. Onko sovellus käynnissä palvelimen kanssa (npm run dev / npm start)?')
  }
  let body: { ok: boolean; html?: string; finalUrl?: string; code?: string; message?: string }
  try {
    body = await res.json()
  } catch {
    throw new ImportError('fetch-failed', 'Hakupalvelu ei ole käytettävissä tässä ympäristössä. Voit liittää sivun HTML-koodin käsin.')
  }
  if (!body.ok || !body.html) {
    const code = body.code === 'blocked' ? 'blocked' : body.code === 'not-allowed' || body.code === 'private-address' ? 'not-allowed' : body.code === 'timeout' ? 'timeout' : body.code === 'too-large' ? 'too-large' : 'fetch-failed'
    throw new ImportError(code, body.message ?? 'Sivun haku epäonnistui.')
  }
  return { html: body.html, finalUrl: body.finalUrl ?? url }
}

export interface ImportOutcome {
  recipe: Recipe
  diagnostics: ImportDiagnostics
}

export function importFromHtml(html: string, url: string, ctx: MatchContext, defaultServings: number): ImportOutcome {
  const parsedUrl = validateRecipeUrl(url)
  if (detectBlockedPage(html)) {
    throw new ImportError('blocked', 'Liitetty sisältö on bottisuojauksen välisivu, ei reseptisivu. Avaa resepti selaimessa ja kopioi sivun lähdekoodi uudelleen.')
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const result = extractRecipe(doc, parsedUrl)
  return toRecipe(result, { url: parsedUrl, ctx, defaultServings })
}

export async function importFromUrl(url: string, ctx: MatchContext, defaultServings: number): Promise<ImportOutcome> {
  validateRecipeUrl(url)
  const page = await fetchPageHtml(url)
  return importFromHtml(page.html, page.finalUrl, ctx, defaultServings)
}

/** Split pasted text into distinct URLs. */
export function parseUrlList(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) ?? []
  return [...new Set(urls.map((u) => u.replace(/[),.;]+$/, '')))]
}
