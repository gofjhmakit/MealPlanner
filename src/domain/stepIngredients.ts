/**
 * Which ingredients an instruction step uses, for cook mode ("Tässä vaiheessa").
 * Finnish words are compared by stem in both directions, so inflections and compounds match:
 * "tomaatit" ↔ "tomaattia", "salaatti" ↔ "jäävuorisalaattia", "baharatin" ↔ "baharatia".
 * Generic words ("kasvikset", "mausteet") pick up every ingredient of that kind.
 */
import { getIngredient } from './ingredients'
import type { RecipeIngredient, ShoppingCategory } from './types'

const STOP = new Set([
  'lisää', 'lisätä', 'sekoita', 'kanssa', 'noin', 'minuuttia', 'minuutin', 'kunnes', 'sitten', 'kuumenna', 'paista', 'keitä',
  'tarjoile', 'kypsennä', 'pinnalle', 'joukkoon', 'kaikki', 'ainekset', 'kattila', 'kattilaan', 'pannu', 'pannulla', 'pannulle',
  'uuni', 'uuniin', 'astetta', 'lämpöä', 'lämmöllä', 'hetki', 'loput', 'lopuksi', 'puolet', 'päälle', 'sisään', 'erikseen',
  'valmis', 'valmiiksi', 'kerros', 'tasaisesti', 'kevyesti', 'hyvin', 'pieni', 'pieneksi', 'iso', 'isossa', 'kulho', 'kulhossa',
  'kulhoon', 'vuoka', 'vuokaan', 'pilkottuna', 'hienonnettuna', 'viipaloituna', 'kuutioituna', 'raastettuna', 'tuoreena',
])

const GENERIC: [RegExp, ShoppingCategory[]][] = [
  [/^(kasvi?k?s|vihannes|vihannek|juurek|kasvisten|vihannesten)/, ['vegetables']],
  [/^(maust|yrtit|yrttej)/, ['spices_sauces']],
  [/^(kuivat aine|kuiva-aine)/, ['dry_goods']],
]

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w))
}

function stem(w: string): string {
  return w.slice(0, Math.max(4, w.length - 3))
}

export function ingredientsInStep<T extends Pick<RecipeIngredient, 'name' | 'canonicalId' | 'raw'>>(step: string, ingredients: T[]): T[] {
  const stepWords = words(step)
  const stepStems = stepWords.map(stem)
  const generic = new Set(stepWords.flatMap((w) => GENERIC.find(([re]) => re.test(w))?.[1] ?? []))
  return ingredients.filter((ing) => {
    if (/:$/.test(ing.raw)) return false
    const canonical = getIngredient(ing.canonicalId)
    if (canonical && generic.has(canonical.category)) return true
    const ingWords = words(`${ing.name} ${canonical?.fi ?? ''}`)
    return ingWords.some((iw) => {
      const is = stem(iw)
      return stepStems.some((ss) => iw.startsWith(ss) || iw.includes(ss.length >= 5 ? ss : '\u0000') || stepWords.some((sw) => sw.startsWith(is)))
    })
  })
}
