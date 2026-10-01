/**
 * Last-resort extraction from page markup:
 *   1. schema.org microdata (itemprop="recipeIngredient" …)
 *   2. headings such as "Ainekset" / "Valmistus" followed by lists or paragraphs
 *   3. OpenGraph / meta tags for title, description and image
 */
import { parseDurationMinutes, parseServings } from '../../domain/ingredientParser'
import { absoluteUrl, metaContent, textOf } from '../text'
import type { ExtractedRecipe } from '../types'

const INGREDIENT_HEADINGS = /^(ainekset|ainesosat|raaka-aineet|tarvitset|tarvikkeet|ingredients|aineosat)\b/i
const INSTRUCTION_HEADINGS = /^(valmistus|valmistusohje|ohje|näin valmistat|työvaiheet|tee näin|instructions|method)\b/i

function microdata(doc: Document, base: URL): ExtractedRecipe | null {
  const scope = doc.querySelector('[itemtype*="schema.org/Recipe" i]')
  if (!scope) return null
  const prop = (name: string) => scope.querySelectorAll(`[itemprop="${name}"]`)
  const content = (el: Element | null) => el?.getAttribute('content') ?? el?.getAttribute('datetime') ?? textOf(el)
  const ingredients = [...prop('recipeIngredient'), ...prop('ingredients')].map((el) => ({ text: textOf(el) })).filter((i) => i.text)
  const instructions = [...prop('recipeInstructions')].flatMap((el) => {
    const items = el.querySelectorAll('li, p')
    return items.length ? [...items].map(textOf) : [textOf(el)]
  }).filter(Boolean)
  const img = scope.querySelector('[itemprop="image"]')
  const yieldInfo = parseServings(content(scope.querySelector('[itemprop="recipeYield"]')))
  return {
    title: content(scope.querySelector('[itemprop="name"]')) || null,
    description: content(scope.querySelector('[itemprop="description"]')) || null,
    servings: yieldInfo.servings,
    servingsText: yieldInfo.text,
    prepTimeMin: parseDurationMinutes(content(scope.querySelector('[itemprop="prepTime"]'))),
    cookTimeMin: parseDurationMinutes(content(scope.querySelector('[itemprop="cookTime"]'))),
    totalTimeMin: parseDurationMinutes(content(scope.querySelector('[itemprop="totalTime"]'))),
    ingredients,
    instructions,
    images: img ? [absoluteUrl(img.getAttribute('src') ?? img.getAttribute('content'), base)].filter((x): x is string => !!x) : [],
  }
}

/** Collect list items / paragraphs following a heading until the next heading of same or higher level. */
function contentAfterHeading(heading: Element): { items: string[]; groups: (string | null)[] } {
  const level = Number(heading.tagName.slice(1)) || 6
  const items: string[] = []
  const groups: (string | null)[] = []
  let group: string | null = null
  let node: Element | null = heading.nextElementSibling
  // If the heading is wrapped (e.g. <div><h2/></div>), walk from the wrapper instead.
  if (!node && heading.parentElement) node = heading.parentElement.nextElementSibling
  let guard = 0
  while (node && guard++ < 60) {
    const tag = node.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      if (Number(tag.slice(1)) <= level) break
      group = textOf(node)
    } else {
      const lis = node.matches('ul, ol') ? node.querySelectorAll(':scope > li') : node.querySelectorAll('li')
      if (lis.length) {
        for (const li of lis) {
          const t = textOf(li)
          if (t) {
            items.push(t)
            groups.push(group)
          }
        }
      } else if (tag === 'p') {
        const t = textOf(node)
        if (t) {
          items.push(t)
          groups.push(group)
        }
      }
      const subHeading = node.querySelector('h3, h4, h5')
      if (subHeading && !lis.length) group = textOf(subHeading)
    }
    node = node.nextElementSibling
  }
  return { items, groups }
}

function headingBased(doc: Document): ExtractedRecipe | null {
  const headings = [...doc.querySelectorAll('h1, h2, h3, h4, strong, [role="heading"]')]
  const ingHeading = headings.find((h) => INGREDIENT_HEADINGS.test(textOf(h)))
  const insHeading = headings.find((h) => INSTRUCTION_HEADINGS.test(textOf(h)))
  if (!ingHeading && !insHeading) return null
  const ing = ingHeading ? contentAfterHeading(ingHeading) : { items: [], groups: [] }
  const ins = insHeading ? contentAfterHeading(insHeading) : { items: [], groups: [] }
  const bodyText = doc.body?.textContent ?? ''
  const servingMatch = bodyText.match(/(\d+)\s*(annosta|annos|hengelle|henkilölle)/i)
  const timeMatch = bodyText.match(/(\d+\s*[-–]\s*\d+|\d+)\s*min(uuttia)?\b/i)
  return {
    ingredients: ing.items.map((text, i) => ({ text, group: ing.groups[i] })),
    instructions: ins.items,
    servings: servingMatch ? Number(servingMatch[1]) : null,
    servingsText: servingMatch ? servingMatch[0] : null,
    totalTimeMin: timeMatch ? parseDurationMinutes(timeMatch[0]) : null,
    timeText: timeMatch ? timeMatch[0].replace(/\s+/g, ' ') : null,
  }
}

export function extractMeta(doc: Document, base: URL): ExtractedRecipe {
  const image = metaContent(doc, 'meta[property="og:image"]', 'meta[name="twitter:image"]')
  const title =
    metaContent(doc, 'meta[property="og:title"]', 'meta[name="twitter:title"]') ?? (textOf(doc.querySelector('h1')) || null)
  return {
    title: title?.replace(/\s*[|–-]\s*(K-Ruoka|Yhteishyvä|Valio|S-kaupat).*$/i, '') ?? null,
    description: metaContent(doc, 'meta[property="og:description"]', 'meta[name="description"]'),
    images: image ? [absoluteUrl(image, base)].filter((x): x is string => !!x) : [],
    canonicalUrl: absoluteUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), base),
  }
}

export function extractSemanticHtml(doc: Document, base: URL): { recipe: ExtractedRecipe; method: string } | null {
  const md = microdata(doc, base)
  if (md && (md.ingredients?.length ?? 0) > 0) return { recipe: md, method: 'microdata' }
  const hb = headingBased(doc)
  if (hb && ((hb.ingredients?.length ?? 0) > 0 || (hb.instructions?.length ?? 0) > 0)) return { recipe: hb, method: 'html-headings' }
  return null
}
