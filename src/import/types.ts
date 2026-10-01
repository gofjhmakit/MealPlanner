import type { SourceNutrition } from '../domain/types'

export interface ExtractedIngredient {
  /** Ingredient line as shown by the source ("2 dl kevytmaitoa"). */
  text: string
  group?: string | null
  /** Fineli food id if the source itself maps ingredients to Fineli (Yhteishyvä does). */
  fineliId?: number | null
  fineliName?: string | null
}

/** Recipe data as extracted from a web page, before normalization. All fields optional. */
export interface ExtractedRecipe {
  title?: string | null
  description?: string | null
  servings?: number | null
  servingsText?: string | null
  prepTimeMin?: number | null
  cookTimeMin?: number | null
  totalTimeMin?: number | null
  timeText?: string | null
  ingredients?: ExtractedIngredient[]
  instructions?: string[]
  images?: string[]
  category?: string | null
  cuisine?: string | null
  tags?: string[]
  author?: string | null
  canonicalUrl?: string | null
  sourceNutrition?: SourceNutrition | null
}

export type ExtractedField = keyof ExtractedRecipe

export interface AdapterResult {
  data: ExtractedRecipe
  /** Names of the extraction methods that produced data, e.g. "json-ld", "valio-html". */
  methods: string[]
  warnings: string[]
}

export interface RecipeSourceAdapter {
  id: string
  name: string
  homepage: string
  /** Registrable domains this adapter handles (subdomains included). */
  domains: string[]
  /** Site-specific extraction. Missing fields are filled by the generic pipeline afterwards. */
  extract(doc: Document, url: URL): AdapterResult
}
