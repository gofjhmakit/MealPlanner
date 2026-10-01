import { Clock, Heart, Info, Star, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CONFIDENT_THRESHOLD, type NutritionCoverage } from '../../domain/nutrition'
import { recipeTime } from '../../domain/recipeInfo'
import type { NutritionTargets, Nutrients, Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { safeHttpUrl } from '../../domain/url'
import { Badge, cx, ProgressBar } from './ui'

const EMOJI_RULES: [RegExp, string][] = [
  [/puuro|kaura/i, '🥣'],
  [/keitto|soppa/i, '🍲'],
  [/pasta|spagetti|lasagne|makaroni|tortelloni/i, '🍝'],
  [/lohi|kala|silakka|tonnikala|turska|katkarapu/i, '🐟'],
  [/salaatti/i, '🥗'],
  [/broileri|kana/i, '🍗'],
  [/jauheliha|liha|pihvi|porsa|nauta|makkara/i, '🥩'],
  [/munakas|kananmuna|muna/i, '🍳'],
  [/lettu|ohukai|pannukakku/i, '🥞'],
  [/leipä|sämpylä|piirakka|pulla|kakku/i, '🍞'],
  [/tortilla|taco|burrito/i, '🌮'],
  [/curry|kurry|wokki/i, '🍛'],
  [/rahka|jogurtti|smoothie|marja/i, '🫐'],
  [/peruna|laatikko|kiusaus/i, '🥔'],
  [/kasvis|linssi|kikherne|papu/i, '🥕'],
]
const GRADIENTS = [
  'from-[#e7efe3] to-[#cfe0cb]',
  'from-[#f7eadb] to-[#efd3b5]',
  'from-[#eef0e6] to-[#dfe3cf]',
  'from-[#f3e6e1] to-[#e6cbc0]',
  'from-[#e6ecef] to-[#cddbe0]',
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function RecipeImage({
  recipe,
  className,
  rounded = 'rounded-xl',
  emojiSize = 'text-3xl',
}: {
  recipe: Pick<Recipe, 'title' | 'imageUrl' | 'tags' | 'id'>
  className?: string
  rounded?: string
  emojiSize?: string
}) {
  const [failed, setFailed] = useState(false)
  const src = safeHttpUrl(recipe.imageUrl)
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cx('object-cover', rounded, className)}
      />
    )
  }
  const text = `${recipe.title} ${recipe.tags.join(' ')}`
  const emoji = EMOJI_RULES.find(([re]) => re.test(text))?.[1] ?? '🍽️'
  return (
    <div aria-hidden className={cx('flex items-center justify-center bg-gradient-to-br dark:opacity-80 print:hidden', GRADIENTS[hash(recipe.id) % GRADIENTS.length], rounded, className)}>
      <span className={cx(emojiSize, 'drop-shadow-sm')}>{emoji}</span>
    </div>
  )
}

export function SourceBadge({ recipe }: { recipe: Pick<Recipe, 'origin' | 'sourceName'> }) {
  if (recipe.origin === 'catalogue') return <Badge tone="brand">Fineli</Badge>
  if (recipe.origin === 'imported') return <Badge tone="accent">{recipe.sourceName ?? 'Tuotu'}</Badge>
  if (recipe.origin === 'seed') return <Badge>Esimerkki</Badge>
  return <Badge>Oma</Badge>
}

export function RecipeCard({ recipe, kcal, favourite, action }: { recipe: Recipe; kcal?: number | null; favourite?: boolean; action?: ReactNode }) {
  const time = recipeTime(recipe)
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:shadow-md">
      <Link to={`/reseptit/${recipe.id}`} className="flex flex-1 flex-col">
        <RecipeImage recipe={recipe} className="aspect-[4/3] w-full" rounded="rounded-none" emojiSize="text-6xl" />
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-medium leading-snug hyphens-auto [overflow-wrap:anywhere] group-hover:text-brand">{recipe.title}</h3>
            <span className="mt-0.5 flex shrink-0 items-center gap-1">
              <StarRating value={recipe.rating} size={14} />
              {favourite && <Heart size={16} className="fill-accent text-accent" aria-label="Suosikki" />}
            </span>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {time ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={13} /> {time} min
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users size={13} /> {formatNumber(recipe.servings, 1)} annosta
            </span>
            {kcal ? <span className="tabular" title="Arvioitu energia annosta kohden">≈ {Math.round(kcal)} kcal/annos</span> : null}
          </div>
          <div className="flex flex-wrap gap-1">
            <SourceBadge recipe={recipe} />
          </div>
        </div>
      </Link>
      {action && <div className="absolute right-2 top-2">{action}</div>}
    </article>
  )
}

export function ConfidenceDot({ confidence, method }: { confidence: number; method?: string }) {
  const tone = confidence >= 0.9 ? 'bg-ok' : confidence >= CONFIDENT_THRESHOLD ? 'bg-carb' : confidence > 0 ? 'bg-warn' : 'bg-bad'
  const label =
    confidence === 0
      ? 'Ei vastinetta'
      : `Vastaavuuden varmuus ${Math.round(confidence * 100)} %${method === 'user' ? ' (oma valinta)' : ''}`
  return <span className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', tone)} title={label} aria-label={label} role="img" />
}

export function EstimateNote({ coverage, className }: { coverage: NutritionCoverage; className?: string }) {
  const pct = Math.round(coverage.confidentShare * 100)
  const tone = pct >= 85 ? 'text-muted' : pct >= 60 ? 'text-warn' : 'text-bad'
  return (
    <p className={cx('flex items-start gap-1.5 text-xs', tone, className)}>
      <Info size={14} className="mt-px shrink-0" />
      <span>
        Arvioitu ravintosisältö — {pct} % aineksista tunnistettu luotettavasti
        {coverage.unmatched > 0 ? `, ${coverage.unmatched} ilman vastinetta` : ''}
        {coverage.unquantified > 0 ? `, ${coverage.unquantified} ilman määrää` : ''}.
      </span>
    </p>
  )
}

const MACROS: { key: keyof Nutrients; label: string; tone: 'protein' | 'carb' | 'fat' | 'fibre'; dot: string }[] = [
  { key: 'protein', label: 'Proteiini', tone: 'protein', dot: 'bg-protein' },
  { key: 'carbohydrate', label: 'Hiilihydraatit', tone: 'carb', dot: 'bg-carb' },
  { key: 'fat', label: 'Rasva', tone: 'fat', dot: 'bg-fat' },
  { key: 'fibre', label: 'Kuitu', tone: 'fibre', dot: 'bg-fibre' },
]

/** Calories + macro rows. Bars are shown against targets when the user has set them. */
export function NutritionSummary({
  nutrients,
  targets,
  compact,
  energyLabel = 'Energia',
}: {
  nutrients: Nutrients
  targets?: NutritionTargets
  compact?: boolean
  energyLabel?: string
}) {
  const kcalTarget = targets?.energyKcal ?? null
  return (
    <div className={cx('space-y-3', compact && 'space-y-2')}>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-ink-2">{energyLabel}</span>
          <span className="tabular">
            <span className={cx('font-display font-semibold', compact ? 'text-xl' : 'text-2xl')}>{formatNumber(Math.round(nutrients.energyKcal), 0)}</span>
            <span className="text-sm text-muted"> {kcalTarget ? `/ ${formatNumber(kcalTarget, 0)} ` : ''}kcal</span>
          </span>
        </div>
        {kcalTarget ? <div className="mt-1.5"><ProgressBar value={nutrients.energyKcal} max={kcalTarget} tone="accent" label="Energia tavoitteesta" /></div> : null}
      </div>
      <div className={cx('grid gap-x-6 gap-y-2', compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}>
        {MACROS.map((m) => {
          const target = targets?.[m.key as keyof NutritionTargets] ?? null
          return (
            <div key={m.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span className={cx('h-2 w-2 rounded-full', m.dot)} />
                  {m.label}
                </span>
                <span className="tabular font-medium">
                  {formatNumber(nutrients[m.key], nutrients[m.key] < 10 ? 1 : 0)}
                  <span className="font-normal text-muted"> {target ? `/ ${formatNumber(target, 0)} ` : ''}g</span>
                </span>
              </div>
              {target ? <div className="mt-1"><ProgressBar value={nutrients[m.key]} max={target} tone={m.tone} label={`${m.label} tavoitteesta`} /></div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const RATING_LABELS = ['', 'Ei kannata', 'Kohtalainen', 'Hyvä', 'Tosi hyvä', 'Suosikki']

/** 1–5 star rating. Interactive when `onChange` is given (click the current value again to clear). */
export function StarRating({ value, onChange, size = 20 }: { value: number | null | undefined; onChange?: (v: number | null) => void; size?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  if (!onChange) {
    if (!value) return null
    return (
      <span className="inline-flex items-center gap-0.5 text-accent" aria-label={`Arvio ${value}/5`} title={`Oma arvio ${value}/5`}>
        <Star size={size} className="fill-accent" /> <span className="tabular text-xs font-medium">{value}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex" role="radiogroup" aria-label="Oma arvio" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} / 5 – ${RATING_LABELS[n]}`}
            title={RATING_LABELS[n]}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(value === n ? null : n)}
            className="rounded p-0.5 text-accent transition hover:scale-110"
          >
            <Star size={size} className={n <= shown ? 'fill-accent' : 'text-line'} />
          </button>
        ))}
      </span>
      <span className="text-xs text-muted">{shown ? RATING_LABELS[shown] : 'Ei arviota'}</span>
    </span>
  )
}
