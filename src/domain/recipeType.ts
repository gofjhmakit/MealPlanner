import type { Recipe } from './types'

export const RECIPE_TYPES = {
  ateria: 'Pääateria',
  aamiainen: 'Aamiainen',
  valipala: 'Välipala',
  lisuke: 'Lisuke',
  kastike: 'Kastike tai dippi',
  jalkiruoka: 'Jälkiruoka',
  leivonnainen: 'Leipä tai leivonnainen',
  juoma: 'Juoma',
  sailyke: 'Säilyke',
  muu: 'Muu',
} as const

export type RecipeType = keyof typeof RECIPE_TYPES

/** A single purpose tag, also derived for older recipes that predate type tagging. */
export function recipeType(recipe: Pick<Recipe, 'title' | 'category' | 'tags'>): RecipeType {
  const category = (recipe.category ?? '').toLowerCase()
  const detail = `${recipe.title} ${recipe.tags.join(' ')}`.toLowerCase()
  const type = recipe.tags.find((tag) => tag.startsWith('tyyppi:'))?.slice(7)
  if (type && type in RECIPE_TYPES) return type as RecipeType

  // Fineli's parent classes are broad (e.g. dairy also contains sauces and puddings).
  if (/pääruo|keitot|salaatit/.test(category)) return 'ateria'
  if (/kastik|dipp|gravy|sauce/.test(category)) return 'kastike'
  if (/^juomat$|^juoma|beverage|drink/.test(category)) return 'juoma'
  if (/^lisukkeet$|side dish/.test(category)) return 'lisuke'
  if (/^välipalat$|snack/.test(category)) return 'valipala'
  if (/^jälkiruoat$|dessert/.test(category)) return 'jalkiruoka'
  if (/^aamiainen$|breakfast/.test(category)) return 'aamiainen'
  if (/^leivät ja leivonnaiset$/.test(category)) return 'leivonnainen'
  if (/vilja ja leivontatuotteet/.test(category)) {
    if (/puuro|aamiaisvilja/.test(detail)) return 'aamiainen'
    if (/leipä|leivonnainen|kahvileipä|pulla|keksit/.test(detail)) return 'leivonnainen'
    if (/^riisi|^pasta|^makaroni|^spagetti/.test(recipe.title.toLowerCase()) && /keitetty/.test(detail)) return 'lisuke'
    return 'ateria'
  }
  if (/kastik|dipp|gravy|sauce/.test(detail)) return 'kastike'
  if (/juom|mehu|smoothie|limonad/.test(detail)) return 'juoma'
  if (/jälkiruo|vanukas|kiissel|pudding|dessert/.test(detail)) return 'jalkiruoka'
  if (/välipal|snack/.test(detail)) return 'valipala'
  if (/juom|mehu|smoothie/.test(category)) return 'juoma'
  if (/hillot|marmelad|säilyk/.test(category)) return 'sailyke'
  if (/jälkiruo|kiissel|makea|jäätel|vanukas|hedelmä- ja marjaruo/.test(category)) return 'jalkiruoka'
  if (/aamiai|puuro|aamiaisvilja/.test(category)) return 'aamiainen'
  if (/välipal|voilei|keksit/.test(category)) return 'valipala'
  if (/leip|leivonn|kahvileip|pulla/.test(category)) return 'leivonnainen'
  if (/lisuk|kypsennetyt kasvikset|kasvikset, tuoreet|perunat|riisilisäke/.test(category)) return 'lisuke'
  if (/keit|pääruo|liharuo|kalaruo|kasvisruo|kanaruo|pihvit|padat|pizza|pastaruo|munaruo|salaat/.test(category)) return 'ateria'
  if (/^muut$|^other$/.test(category)) return 'muu'
  return category ? 'ateria' : 'muu'
}

export function withRecipeType<T extends Pick<Recipe, 'title' | 'category' | 'tags'>>(recipe: T): T {
  const type = recipeType(recipe)
  return { ...recipe, tags: [...new Set([...recipe.tags.filter((tag) => !tag.startsWith('tyyppi:')), `tyyppi:${type}`])] }
}
