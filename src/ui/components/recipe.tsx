import { Clock, Heart, Info, Star } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CONFIDENT_THRESHOLD, type NutritionCoverage } from '../../domain/nutrition'
import { recipeTime } from '../../domain/recipeInfo'
import type { NutritionTargets, Nutrients, Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { safeHttpUrl } from '../../domain/url'
import { Badge, cx, ProgressBar } from './ui'

/**
 * Placeholder art for recipes without a photo: a plate seen from above, with the food drawn
 * in CSS gradients by dish family. The family comes from the title (then category), so a
 * Greek salad never gets a fish. Colours vary per recipe so a grid doesn't look repetitive.
 */
type Family = 'soup' | 'porridge' | 'salad' | 'pasta' | 'fish' | 'meat' | 'curry' | 'egg' | 'baked' | 'bread' | 'drink' | 'mixed'

const FAMILY_RULES: [RegExp, Family][] = [
  [/smoothie|juoma|mehu|limonadi|kaakao|\btee\b|kahvi|lassi|shake|booli/i, 'drink'],
  [/keitto|soppa|liemi|borssi|gazpacho|ramen|pho\b|chowder/i, 'soup'],
  [/puuro|kaura|rahka|jogurtti|granola|mysli|chia/i, 'porridge'],
  [/salaatti|coleslaw|tabbouleh/i, 'salad'],
  [/munakas|kananmuna|omeletti|frittata|shakshuka|\bmuna/i, 'egg'],
  [/pasta|spagetti|makaroni|nuudeli|lasagne|tortelloni|penne|risotto|gnocchi/i, 'pasta'],
  [/curry|kurry|wokki|dal\b|dahl|chili|tagine|gulassi|pata\b|muhennos/i, 'curry'],
  [/lohi|kala|silakka|turska|tonnikala|katkarap|muikku|ahven|kuha|siika|simpuk|äyriäi/i, 'fish'],
  [/liha|pihvi|porsa|nauta|kana|broileri|kalkkuna|makkara|pekoni|kinkku|lammas|riista|poro/i, 'meat'],
  [/kakku|piirakka|piiras|pulla|keksi|leivos|torttu|muffin|brownie|kiisseli|vanukas|jäätelö|crumble|jälkiruoka|leivonnai/i, 'baked'],
  [/leipä|sämpylä|tortilla|pizza|rieska|patonki|focaccia|wrap|burger|voileipä|toast/i, 'bread'],
]

const PALETTES: Record<Family, { tint: string[]; food: (c: string[]) => string; colors: string[][] }> = {
  soup: {
    tint: ['#e7efd9', '#f1dfcc', '#dce6ea', '#f6e2e6'],
    colors: [['#b9cc6b', '#93ae45', '#7fa44a'], ['#e0812f', '#c8631e', '#3f7a3b'], ['#f4e4c4', '#e9cfa0', '#f08c5a'], ['#b8324a', '#8e2238', '#f3e3c2']],
    food: (c) => `radial-gradient(circle at 40% 42%, ${c[2]} 0 7%, transparent 8%), radial-gradient(circle at 62% 58%, ${c[2]} 0 6%, transparent 7%), radial-gradient(circle at 58% 34%, #f7f1e6 0 5%, transparent 6%), radial-gradient(circle at 50% 50%, ${c[0]}, ${c[1]})`,
  },
  porridge: {
    tint: ['#e9e1f1', '#f6e2e6', '#efe6d8'],
    colors: [['#efe3cc', '#4b3b8f', '#c63b4a'], ['#fbf7f2', '#c63b4a', '#4b3b8f'], ['#f2e6cf', '#d98b3a', '#6a4fb0']],
    food: (c) => `radial-gradient(circle at 38% 38%, ${c[1]} 0 9%, transparent 10%), radial-gradient(circle at 58% 44%, ${c[2]} 0 8%, transparent 9%), radial-gradient(circle at 48% 64%, ${c[1]} 0 7%, transparent 8%), radial-gradient(circle at 66% 62%, ${c[2]} 0 6%, transparent 7%), ${c[0]}`,
  },
  salad: {
    tint: ['#e6eddc', '#e2efe3', '#eef0e2'],
    colors: [['#6e9e4f', '#8fbf5f', '#d84a3a'], ['#5e8e3e', '#a8cf6a', '#f2f2f2'], ['#7aa84f', '#b8d878', '#f2c230']],
    food: (c) => `radial-gradient(circle at 36% 40%, ${c[2]} 0 7%, transparent 8%), radial-gradient(circle at 62% 60%, ${c[2]} 0 6%, transparent 7%), radial-gradient(circle at 60% 34%, ${c[1]} 0 14%, transparent 15%), radial-gradient(circle at 38% 64%, ${c[1]} 0 13%, transparent 14%), radial-gradient(circle at 50% 50%, ${c[0]}, ${c[0]})`,
  },
  pasta: {
    tint: ['#f2e3cb', '#f4e1d8', '#efe8d6'],
    colors: [['#e9b866', '#d99a47', '#c9442f'], ['#f0c878', '#e0a850', '#3f7a3b'], ['#eccf8a', '#d8b05c', '#c63b4a']],
    food: (c) => `radial-gradient(circle at 56% 40%, ${c[2]} 0 9%, transparent 10%), repeating-radial-gradient(circle at 50% 50%, ${c[0]} 0 3px, ${c[1]} 3px 6px)`,
  },
  fish: {
    tint: ['#dce6ea', '#dfe8ec', '#e4ecef'],
    colors: [['#f08c5a', '#e8be6a', '#5e8e3e'], ['#f59a6e', '#f7e3b2', '#6e9e4f'], ['#f2f0ea', '#e8be6a', '#5e8e3e']],
    food: (c) => `radial-gradient(ellipse 30% 18% at 42% 42%, ${c[0]} 0 98%, transparent 100%), radial-gradient(circle at 64% 62%, ${c[1]} 0 10%, transparent 11%), radial-gradient(circle at 40% 66%, ${c[1]} 0 9%, transparent 10%), radial-gradient(circle at 66% 34%, ${c[2]} 0 6%, transparent 7%), #f5efe4`,
  },
  meat: {
    tint: ['#f1dfcc', '#efe2d6', '#f4e1d8'],
    colors: [['#8a4a2a', '#a8603a', '#4e9a3e'], ['#c98a5a', '#e5c38d', '#4e9a3e'], ['#7a3f24', '#d84a3a', '#f2c230']],
    food: (c) => `radial-gradient(circle at 36% 42%, ${c[0]} 0 11%, transparent 12%), radial-gradient(circle at 60% 36%, ${c[1]} 0 10%, transparent 11%), radial-gradient(circle at 56% 62%, ${c[0]} 0 10%, transparent 11%), radial-gradient(circle at 72% 56%, ${c[2]} 0 6%, transparent 7%), radial-gradient(circle at 34% 64%, ${c[2]} 0 5%, transparent 6%), #f3e8d2`,
  },
  curry: {
    tint: ['#f3e6c9', '#f1dfcc', '#efe6d0'],
    colors: [['#e3a33a', '#c9822a', '#2f6b2e'], ['#e0812f', '#b85a1e', '#3f7a3b'], ['#d9a13b', '#b8801f', '#f7f1e6']],
    food: (c) => `radial-gradient(circle at 36% 40%, #e9d08a 0 11%, transparent 12%), radial-gradient(circle at 60% 58%, #e9d08a 0 10%, transparent 11%), radial-gradient(circle at 56% 34%, ${c[2]} 0 7%, transparent 8%), radial-gradient(circle at 50% 50%, ${c[0]}, ${c[1]})`,
  },
  egg: {
    tint: ['#fdf3dc', '#f3ecd6', '#f7efd8'],
    colors: [['#fbf7f2', '#f2b43c', '#6e9e4f'], ['#f7e8b8', '#e8a020', '#d84a3a']],
    food: (c) => `radial-gradient(circle at 52% 48%, ${c[1]} 0 13%, transparent 14%), radial-gradient(circle at 34% 64%, ${c[2]} 0 5%, transparent 6%), radial-gradient(ellipse 40% 34% at 50% 50%, ${c[0]} 0 98%, transparent 100%), #f6efe2`,
  },
  baked: {
    tint: ['#f4e1d8', '#f6e2e6', '#efe2d6'],
    colors: [['#d9a066', '#f3e3c2', '#c63b4a'], ['#5a3a2a', '#8a5a3a', '#f7f1e6'], ['#e8c27a', '#f7e8c8', '#4b3b8f']],
    food: (c) => `radial-gradient(circle at 50% 30%, ${c[2]} 0 6%, transparent 7%), conic-gradient(from 200deg at 50% 50%, ${c[0]} 0 32%, transparent 32% 100%), radial-gradient(circle at 50% 50%, ${c[1]} 0 46%, transparent 47%), #f6efe2`,
  },
  bread: {
    tint: ['#f2e3cb', '#efe6d8', '#f1dfcc'],
    colors: [['#c98a4a', '#e5c38d', '#6e9e4f'], ['#8a5a32', '#c9a06a', '#d84a3a']],
    food: (c) => `radial-gradient(ellipse 34% 26% at 50% 50%, ${c[1]} 0 70%, ${c[0]} 72% 98%, transparent 100%), radial-gradient(circle at 72% 68%, ${c[2]} 0 6%, transparent 7%), #f6efe2`,
  },
  drink: {
    tint: ['#e9e1f1', '#e2efe3', '#fde9e2'],
    colors: [['#c63b4a', '#f6d0d8'], ['#8fbf5f', '#e2f0d0'], ['#f2a43c', '#fde9c8']],
    food: (c) => `radial-gradient(circle at 50% 50%, ${c[1]} 0 30%, ${c[0]} 31% 44%, #ffffff 45% 49%, transparent 50%), #f6efe2`,
  },
  mixed: {
    tint: ['#e7efe3', '#f7eadb', '#eef0e6', '#e6ecef'],
    colors: [['#e5c38d', '#d84a3a', '#4e9a3e'], ['#f2c230', '#6e9e4f', '#c9822a'], ['#f08c5a', '#93ae45', '#f7e3b2']],
    food: (c) => `radial-gradient(circle at 36% 42%, ${c[0]} 0 11%, transparent 12%), radial-gradient(circle at 62% 38%, ${c[1]} 0 8%, transparent 9%), radial-gradient(circle at 52% 62%, ${c[2]} 0 10%, transparent 11%), radial-gradient(circle at 70% 60%, ${c[0]} 0 6%, transparent 7%), #f3e8d2`,
  },
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function dishFamily(recipe: Pick<Recipe, 'title' | 'category'>): Family {
  return FAMILY_RULES.find(([re]) => re.test(recipe.title))?.[1] ?? FAMILY_RULES.find(([re]) => re.test(recipe.category ?? ''))?.[1] ?? 'mixed'
}

/** The plate illustration on its own (also used as a small thumbnail in lists). */
export function PlateArt({ recipe, className, rounded = 'rounded-xl', style }: { recipe: Pick<Recipe, 'title' | 'category' | 'id'>; className?: string; rounded?: string; style?: React.CSSProperties }) {
  const p = PALETTES[dishFamily(recipe)]
  const h = hash(recipe.id)
  const tint = p.tint[h % p.tint.length]
  const colors = p.colors[(h >> 3) % p.colors.length]
  return (
    <div aria-hidden className={cx('plate-art relative overflow-hidden print:hidden', rounded, className)} style={{ background: tint, ...style }}>
      <div className="plate-art__plate absolute left-1/2 top-1/2 aspect-square h-[78%] max-h-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full">
        <div className="absolute inset-[11%] rounded-full" style={{ background: p.food(colors) }} />
      </div>
    </div>
  )
}

export function RecipeImage({
  recipe,
  className,
  rounded = 'rounded-xl',
}: {
  recipe: Pick<Recipe, 'title' | 'imageUrl' | 'id'> & Partial<Pick<Recipe, 'category'>>
  className?: string
  rounded?: string
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
  return <PlateArt recipe={recipe} rounded={rounded} className={className} />
}

export function SourceBadge({ recipe }: { recipe: Pick<Recipe, 'origin' | 'sourceName' | 'sourceId'> }) {
  if (recipe.origin === 'catalogue') return <Badge tone="brand">{recipe.sourceId === 'fineli' ? 'Fineli' : (recipe.sourceName ?? 'Katalogi')}</Badge>
  if (recipe.origin === 'imported') return <Badge tone="accent">{recipe.sourceName ?? 'Tuotu'}</Badge>
  if (recipe.origin === 'seed') return <Badge>Esimerkki</Badge>
  return <Badge>Oma</Badge>
}

export function RecipeCard({ recipe, kcal, protein, favourite, action }: { recipe: Recipe; kcal?: number | null; protein?: number | null; favourite?: boolean; action?: ReactNode }) {
  const time = recipeTime(recipe)
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-lg">
      <Link to={`/reseptit/${recipe.id}`} className="flex flex-1 flex-col">
        <RecipeImage recipe={recipe} className="aspect-[4/3] w-full" rounded="rounded-none" />
        <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-3.5">
          <h3 className="line-clamp-2 text-[15px] font-medium leading-snug hyphens-auto [overflow-wrap:anywhere] group-hover:text-brand">{recipe.title}</h3>
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            {kcal ? <span className="tabular font-medium text-ink-2">{Math.round(kcal)} kcal</span> : null}
            {protein ? <span className="tabular">P {Math.round(protein)} g</span> : null}
            {time ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> {time} min
              </span>
            ) : null}
            {recipe.rating ? <span className="text-accent">★ {recipe.rating}</span> : null}
          </div>
        </div>
      </Link>
      {favourite && <Heart size={18} className="absolute right-2.5 top-2.5 fill-accent text-accent drop-shadow" aria-label="Suosikki" />}
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
