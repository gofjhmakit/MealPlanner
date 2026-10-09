/**
 * Reseptit – the catalogue is the default view ("Löydä"), sorted by recommendation; own recipes
 * and favourites are tabs. Quick chips for the common needs, everything else in "Suodata".
 * Fineli dishes (ingredients only, no instructions) appear in searches but not in browsing.
 */
import { BookOpen, Download, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EMPTY_FILTERS, filterRecipes, LOW_CALORIE_MAX_KCAL, QUICK_MAX_MIN, recipeNutritionCached, type RecipeFilters } from '../../domain/recipeInfo'
import { RECIPE_TYPES, type RecipeType } from '../../domain/recipeType'
import type { Recipe } from '../../domain/types'
import { useApp } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { RecipeCard } from '../components/recipe'
import { Button, Chip, cx, EmptyState, Select, Spinner } from '../components/ui'
import { Segmented, Sheet } from '../components/v2'
import { useAllRecipes, useFavouriteIds } from '../hooks'

type Tab = 'loyda' | 'omat' | 'suosikit'
type Sort = 'recommended' | 'protein' | 'kcal' | 'name' | 'newest' | 'rating'
const PAGE = 48

const SORT_LABELS: Record<Sort, string> = {
  recommended: 'Suositellut',
  protein: 'Eniten proteiinia / kcal',
  kcal: 'Kevyimmät ensin',
  name: 'Nimi A–Ö',
  newest: 'Uusimmat',
  rating: 'Oma arvio',
}

/** Day-stable pseudo-random order, so "Suositellut" changes a little every day but not on every visit. */
function dayHash(id: string): number {
  const seed = new Date().toDateString()
  let h = 2166136261
  for (const c of seed + id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

export function RecipesPage() {
  const recipes = useAllRecipes()
  const favourites = useFavouriteIds()
  const { fineli, settings, nutritionCache, dataVersion } = useApp()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = tabParam === 'omat' || tabParam === 'suosikit' ? tabParam : 'loyda'
  const sourceFilter = params.get('lahde') ?? ''
  const [filters, setFilters] = useState<RecipeFilters>({ ...EMPTY_FILTERS, query: params.get('q') ?? '' })
  const [filling, setFilling] = useState(false)
  const [sort, setSort] = useState<Sort>('recommended')
  const [limit, setLimit] = useState(PAGE)
  const [sheet, setSheet] = useState(false)

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setLimit(PAGE)
  }
  const setQuery = (q: string) => {
    setFilters((f) => ({ ...f, query: q }))
    setParam('q', q || null)
  }
  const toggle = (key: keyof RecipeFilters) => {
    setFilters((f) => ({ ...f, [key]: !f[key] }))
    setLimit(PAGE)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersion invalidates nutrition-based filters
  const ctx = useMemo(() => ({ lookup: fineli, pantry: settings.pantry, nutritionCache }), [fineli, settings.pantry, nutritionCache, dataVersion])

  const counts = useMemo(() => {
    const list = recipes ?? []
    return {
      loyda: list.filter((r) => r.sourceId !== 'fineli').length,
      omat: list.filter((r) => r.inCollection).length,
      suosikit: list.filter((r) => favourites.has(r.id)).length,
    }
  }, [recipes, favourites])

  const catalogueSources = useMemo(() => {
    const bySource = new Map<string, { name: string; count: number }>()
    for (const r of recipes ?? []) {
      if (r.origin !== 'catalogue' || !r.sourceId) continue
      const e = bySource.get(r.sourceId) ?? { name: r.sourceId === 'fineli' ? 'Fineli-ruokalajit (ei ohjeita)' : (r.sourceName ?? r.sourceId), count: 0 }
      e.count++
      bySource.set(r.sourceId, e)
    }
    return [...bySource.entries()].sort((a, b) => (a[0] === 'fineli' ? 1 : b[0] === 'fineli' ? -1 : b[1].count - a[1].count))
  }, [recipes])

  const results = useMemo(() => {
    if (!recipes) return []
    const nutritionOf = (r: Recipe) => recipeNutritionCached(r, ctx).perServing
    const searching = !!filters.query.trim()
    const base = recipes.filter((r: Recipe) => {
      if (tab === 'omat') return r.inCollection
      if (tab === 'suosikit') return favourites.has(r.id)
      if (sourceFilter) return r.sourceId === sourceFilter
      return r.sourceId !== 'fineli' || searching
    })
    let filtered = filterRecipes(base, filters, ctx)
    if (filling) {
      filtered = filtered.filter((r) => {
        const n = nutritionOf(r)
        return n.energyKcal >= 250 && n.energyKcal <= 600 && n.protein >= 25
      })
    }
    const score = (r: Recipe) =>
      (r.imageUrl ? 1 : 0) + (r.instructions.length ? 1 : -2) + (favourites.has(r.id) ? 1.5 : 0) + (r.inCollection ? 0.8 : 0) + ((r.rating ?? 3) - 3) * 0.6 + dayHash(r.id) * 1.6 - (r.sourceId === 'fineli' ? 1 : 0)
    const kcal = (r: Recipe) => nutritionOf(r).energyKcal || 99999
    const proteinDensity = (r: Recipe) => {
      const n = nutritionOf(r)
      return n.energyKcal > 0 ? n.protein / n.energyKcal : 0
    }
    return filtered.sort((a, b) =>
      sort === 'recommended'
        ? score(b) - score(a)
        : sort === 'protein'
          ? proteinDensity(b) - proteinDensity(a)
          : sort === 'kcal'
            ? kcal(a) - kcal(b)
            : sort === 'newest'
              ? b.createdAt.localeCompare(a.createdAt)
              : sort === 'rating'
                ? (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title, 'fi')
                : a.title.localeCompare(b.title, 'fi'),
    )
  }, [recipes, tab, favourites, filters, ctx, sort, sourceFilter, filling])

  const activeCount = [
    filters.vegetarian, filters.vegan, filters.highProtein, filters.lowCalorie, filters.quick, filters.glutenFree, filters.milkFree, filters.lactoseFree,
    filters.minRating !== null, filters.maxTimeMin !== null, filters.pantryMinShare !== null, !!filters.type, !!sourceFilter, filling, sort !== 'recommended',
  ].filter(Boolean).length

  return (
    <div className="fade-in">
      <PageHeader
        title="Reseptit"
        actions={
          <>
            <Link to="/reseptit/tuo">
              <Button variant="secondary" icon={<Download size={16} />}>Tuo</Button>
            </Link>
            <Link to="/reseptit/uusi">
              <Button icon={<Plus size={16} />}>Uusi resepti</Button>
            </Link>
          </>
        }
        mobileActions={
          <Link to="/reseptit/uusi" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2" aria-label="Uusi resepti">
            <Plus size={18} />
          </Link>
        }
      />

      <div className="sticky top-0 z-20 -mx-4 mb-4 space-y-3 bg-canvas/90 px-4 pb-3 pt-1 backdrop-blur md:-mx-8 md:px-8 lg:top-[68px] 3xl:-mx-12 3xl:px-12">
        <div className="flex gap-2">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 focus-within:border-brand">
            <Search size={17} className="shrink-0 text-muted" />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Hae ${counts.loyda.toLocaleString('fi-FI')} reseptistä`}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              aria-label="Hae reseptejä"
            />
          </label>
          <button onClick={() => setSheet(true)} className={cx('relative flex h-11 items-center gap-2 rounded-2xl border px-3.5 text-sm font-medium', activeCount ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-2')}>
            <SlidersHorizontal size={17} />
            <span className="hidden sm:inline">Suodata</span>
            {activeCount > 0 && <span className="tabular rounded-full bg-brand px-1.5 text-[11px] font-semibold text-on-brand">{activeCount}</span>}
          </button>
        </div>
        <Segmented
          size="sm"
          label="Näytä"
          value={tab}
          onChange={(t) => setParam('tab', t === 'loyda' ? null : t)}
          options={[
            { value: 'loyda', label: 'Löydä' },
            { value: 'omat', label: `Omat ${counts.omat}` },
            { value: 'suosikit', label: `Suosikit ${counts.suosikit}` },
          ]}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          <Chip active={filling} onClick={() => setFilling((v) => !v)} title="Arvio: 250–600 kcal ja vähintään 25 g proteiinia annoksessa">Kevyt ja täyttävä</Chip>
          <Chip active={filters.highProtein} onClick={() => toggle('highProtein')} title="Arvio: proteiinia ≥ 25 % energiasta tai ≥ 25 g/annos">Proteiinia</Chip>
          <Chip active={filters.quick} onClick={() => toggle('quick')} title={`Valmistusaika enintään ${QUICK_MAX_MIN} min`}>≤ {QUICK_MAX_MIN} min</Chip>
          <Chip active={filters.vegetarian} onClick={() => toggle('vegetarian')}>Kasvis</Chip>
          <Chip active={filters.pantryMinShare !== null} onClick={() => setFilters((f) => ({ ...f, pantryMinShare: f.pantryMinShare === null ? 0.6 : null }))} title="Vähintään 60 % aineksista löytyy kotoa">Kotona olevista</Chip>
          <Chip active={filters.type === 'breakfast'} onClick={() => setFilters((f) => ({ ...f, type: f.type === 'breakfast' ? null : ('breakfast' as RecipeType) }))}>Aamiaiset</Chip>
        </div>
      </div>

      {!recipes ? (
        <Spinner />
      ) : results.length === 0 ? (
        <EmptyState icon={<BookOpen size={32} />} title="Ei reseptejä näillä ehdoilla" action={tab === 'omat' ? <Link to="/reseptit/tuo"><Button>Tuo resepti</Button></Link> : undefined}>
          {tab === 'suosikit' ? 'Merkitse reseptejä suosikeiksi sydän-painikkeella.' : tab === 'omat' ? 'Tallenna katalogista reseptejä omiin tai tuo omasi.' : 'Kokeile muuttaa hakua tai suodattimia.'}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {results.length.toLocaleString('fi-FI')} reseptiä · {SORT_LABELS[sort].toLowerCase()}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
            {results.slice(0, limit).map((r) => {
              const n = recipeNutritionCached(r, ctx).perServing
              return <RecipeCard key={r.id} recipe={r} favourite={favourites.has(r.id)} kcal={n.energyKcal} protein={n.protein} />
            })}
          </div>
          {results.length > limit && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Näytä lisää ({(results.length - limit).toLocaleString('fi-FI')})</Button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={<h2 className="font-display text-xl font-semibold">Suodata ja järjestä</h2>}
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFilters({ ...EMPTY_FILTERS, query: filters.query })
                setFilling(false)
                setParam('lahde', null)
                setSort('recommended')
              }}
            >
              Tyhjennä
            </Button>
            <Button className="flex-1" onClick={() => setSheet(false)}>Näytä {results.length.toLocaleString('fi-FI')} reseptiä</Button>
          </div>
        }
      >
        <div className="space-y-6">
          <FilterGroup label="Järjestys">
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <Chip key={s} active={sort === s} onClick={() => setSort(s)}>{SORT_LABELS[s]}</Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Tyyppi">
            <Chip active={!filters.type} onClick={() => setFilters((f) => ({ ...f, type: null }))}>Kaikki</Chip>
            {Object.entries(RECIPE_TYPES).map(([type, label]) => (
              <Chip key={type} active={filters.type === type} onClick={() => setFilters((f) => ({ ...f, type: type as RecipeType }))}>{label}</Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Ruokavalio" hint="* Arvio Finelin tietojen perusteella. Allergioissa tarkista aina pakkausmerkinnät.">
            <Chip active={filters.vegetarian} onClick={() => toggle('vegetarian')}>Kasvis</Chip>
            <Chip active={filters.vegan} onClick={() => toggle('vegan')}>Vegaaninen</Chip>
            <Chip active={filters.glutenFree} onClick={() => toggle('glutenFree')}>Gluteeniton*</Chip>
            <Chip active={filters.milkFree} onClick={() => toggle('milkFree')}>Maidoton*</Chip>
            <Chip active={filters.lactoseFree} onClick={() => toggle('lactoseFree')}>Laktoositon*</Chip>
          </FilterGroup>
          <FilterGroup label="Ravinto">
            <Chip active={filters.highProtein} onClick={() => toggle('highProtein')}>Runsasproteiininen*</Chip>
            <Chip active={filters.lowCalorie} onClick={() => toggle('lowCalorie')}>Kevyt (≤ {LOW_CALORIE_MAX_KCAL} kcal)*</Chip>
            <Chip active={filling} onClick={() => setFilling((v) => !v)}>Kevyt ja täyttävä*</Chip>
          </FilterGroup>
          <FilterGroup label="Aika ja arvio">
            {[15, 30, 45, 60, 90].map((m) => (
              <Chip key={m} active={filters.maxTimeMin === m} onClick={() => setFilters((f) => ({ ...f, maxTimeMin: f.maxTimeMin === m ? null : m }))}>≤ {m} min</Chip>
            ))}
            <Chip active={filters.minRating !== null} onClick={() => setFilters((f) => ({ ...f, minRating: f.minRating ? null : 4 }))}>★ 4+</Chip>
          </FilterGroup>
          {tab === 'loyda' && catalogueSources.length > 1 && (
            <FilterGroup label="Lähde">
              <Select value={sourceFilter} onChange={(e) => setParam('lahde', e.target.value || null)} aria-label="Lähde" className="w-full">
                <option value="">Kaikki lähteet</option>
                {catalogueSources.map(([id, s]) => (
                  <option key={id} value={id}>{s.name} ({s.count})</option>
                ))}
              </Select>
            </FilterGroup>
          )}
          <p className="text-xs text-muted">
            ”Kotona olevista” käyttää listaa: {settings.pantry.join(', ') || 'ei määritelty'} – <Link className="underline" to="/asetukset">muokkaa</Link>.
          </p>
        </div>
      </Sheet>
    </div>
  )
}

function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  )
}
