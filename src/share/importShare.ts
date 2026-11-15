/**
 * Rebuild a full Recipe from a shared payload. The payload carries only what a
 * human wrote, so ingredients are re-parsed and re-matched against *this*
 * device's Fineli dataset – exactly like a normal import.
 */
import type { MatchContext } from '../domain/matcher'
import { buildRecipeIngredient, newId } from '../domain/recipeIngredients'
import { withRecipeType } from '../domain/recipeType'
import type { ImportDiagnostics, Recipe } from '../domain/types'
import type { SharePayload } from './recipeShare'

export function sharePayloadToRecipe(p: SharePayload, ctx: MatchContext, defaultServings: number): Recipe {
  const now = new Date().toISOString()
  const servings = p.s && p.s > 0 ? p.s : defaultServings
  return withRecipeType({
    id: newId(),
    title: p.t || 'Nimetön resepti',
    description: p.d ?? null,
    servings,
    servingsText: p.st ?? null,
    prepTimeMin: p.tp ?? null,
    cookTimeMin: p.tc ?? null,
    totalTimeMin: p.tt ?? null,
    timeText: p.xt ?? null,
    imageUrl: p.im ?? null,
    ingredients: p.i.map((ing) => buildRecipeIngredient(ing.r, ctx, ing.g ?? null)),
    instructions: p.n,
    tags: p.tg ?? [],
    category: p.c ?? null,
    cuisine: p.cu ?? null,
    origin: 'imported',
    sourceId: null,
    sourceUrl: p.su ?? null,
    sourceName: p.sn ?? null,
    author: p.au ?? null,
    attribution: p.at
      ? {
          license: p.at.l,
          licenseUrl: p.at.lu ?? null,
          originalTitle: p.at.oti ?? null,
          changes: p.at.ch ?? null,
          originalText: p.at.ot ?? null,
          originalYear: p.at.oy ?? null,
        }
      : null,
    sourceNutrition: null,
    importReport: null,
    inCollection: true,
    notes: p.no ?? null,
    createdAt: now,
    updatedAt: now,
  })
}

/** Minimal diagnostics so a scanned recipe shows the same result card as a web import. */
export function shareDiagnostics(p: SharePayload): ImportDiagnostics {
  return {
    adapter: 'qr',
    methods: ['qr'],
    found: {
      title: !!p.t,
      description: !!p.d,
      ingredients: p.i.length > 0,
      instructions: p.n.length > 0,
      servings: !!p.s,
      prepTimeMin: !!p.tp,
      cookTimeMin: !!p.tc,
      totalTimeMin: !!p.tt,
      images: !!p.im,
      sourceNutrition: false,
    },
    missing: [],
    warnings: [],
    importedAt: new Date().toISOString(),
  }
}
