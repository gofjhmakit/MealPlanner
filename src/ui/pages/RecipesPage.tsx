import { BookOpen, Download, Package, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  EMPTY_FILTERS,
  filterRecipes,
  LOW_CALORIE_MAX_KCAL,
  QUICK_MAX_MIN,
  recipeNutritionCached,
  type RecipeFilters,
} from '../../domain/recipeInfo'
import type { Recipe } from '../../domain/types'
import { RECIPE_TYPES, type RecipeType } from '../../domain/recipeType'
import { useApp } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { RecipeCard } from '../components/recipe'
import { Button, Chip, cx, EmptyState, Select, Spinner, TextInput } from '../components/ui'
import { useAllRecipes, useFavouriteIds } from '../hooks'

type Tab = 'omat' | 'suosikit' | 'katalogi'
type Sort = 'name' | 'newest' | 'kcal' | 'rating'
const PAGE = 48

export function RecipesPage() {
  const recipes = useAllRecipes()
  const favourites = useFavouriteIds()
  const { fineli, settings, nutritionCache, dataVersion } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'omat'
  const sourceFilter = params.get('lahde') ?? ''
  const [filters, setFilters] = useState<RecipeFilters>({ ...EMPTY_FILTERS, query: params.get('q') ?? '' })
  const [sort, setSort] = useState<Sort>('name')
  const [limit, setLimit] = useState(PAGE)

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
    setLimit(PAGE)
  }
  const setQuery = (q: string) => {
    setFilters((f) => ({ ...f, query: q }))
    const next = new URLSearchParams(params)
    if (q) next.set('q', q)
    else next.delete('q')
    setParams(next, { replace: true })
    setLimit(PAGE)
  }
  const setSourceFilter = (s: string) => {
    const next = new URLSearchParams(params)
    if (s) next.set('lahde', s)
    else next.delete('lahde')
    setParams(next, { replace: true })
    setLimit(PAGE)
  }
  const toggle = (key: keyof RecipeFilters) => setFilters((f) => ({ ...f, [key]: !f[key] }))

  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersion invalidates nutrition-based filters
  const ctx = useMemo(() => ({ lookup: fineli, pantry: settings.pantry, nutritionCache }), [fineli, settings.pantry, nutritionCache, dataVersion])

  const counts = useMemo(() => {
    const list = recipes ?? []
    return {
      omat: list.filter((r) => r.inCollection).length,
      suosikit: list.filter((r) => favourites.has(r.id)).length,
      katalogi: list.filter((r) => r.origin === 'catalogue').length,
    }
  }, [recipes, favourites])

  /** Catalogue sources with recipe counts, for the source filter. */
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
    const base = recipes.filter((r: Recipe) =>
      tab === 'omat' ? r.inCollection : tab === 'suosikit' ? favourites.has(r.id) : r.origin === 'catalogue' && (!sourceFilter || r.sourceId === sourceFilter),
    )
    const filtered = filterRecipes(base, filters, ctx)
    const kcal = (r: Recipe) => recipeNutritionCached(r, ctx).perServing.energyKcal
    return filtered.sort((a, b) =>
      sort === 'newest'
        ? b.createdAt.localeCompare(a.createdAt)
        : sort === 'kcal'
          ? kcal(a) - kcal(b)
          : sort === 'rating'
            ? (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title, 'fi')
            : a.title.localeCompare(b.title, 'fi'),
    )
  }, [recipes, tab, favourites, filters, ctx, sort, sourceFilter])

  const showKcal = tab !== 'katalogi' || filters.lowCalorie || filters.highProtein || sort === 'kcal'

  return (
    <div className="fade-in">
      <PageHeader
        title="Reseptit"
        subtitle="Omat reseptisi, suosikit sekä katalogi: avoimesti lisensoituja reseptikokoelmia suomennettuina ja Finelin ruokalajit."
        actions={
          <>
            <Link to="/tuotteet">
              <Button variant="ghost" icon={<Package size={16} />}>Omat tuotteet</Button>
            </Link>
            <Link to="/reseptit/tuo">
              <Button variant="secondary" icon={<Download size={16} />}>Tuo reseptejä</Button>
            </Link>
            <Link to="/reseptit/uusi">
              <Button icon={<Plus size={16} />}>Uusi resepti</Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
        {(
          [
            ['omat', 'Omat reseptit'],
            ['suosikit', 'Suosikit'],
            ['katalogi', 'Katalogi'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition', tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
          >
            {label} <span className="tabular text-muted">{counts[t]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" />
          <TextInput
            type="search"
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hae nimellä, aineksella, tunnisteella…"
            className="pl-9"
            aria-label="Hae reseptejä"
          />
        </div>
        {tab === 'katalogi' && catalogueSources.length > 1 && (
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="Lähde" className="max-w-full">
            <option value="">Kaikki lähteet</option>
            {catalogueSources.map(([id, s]) => (
              <option key={id} value={id}>{s.name} ({s.count})</option>
            ))}
          </Select>
        )}
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Järjestys">
          <option value="name">Nimi A–Ö</option>
          <option value="newest">Uusimmat</option>
          <option value="kcal">Kalorit (arvio)</option>
          <option value="rating">Oma arvio</option>
        </Select>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Select
          value={filters.type ?? ''}
          onChange={(e) => { setFilters((f) => ({ ...f, type: (e.target.value || null) as RecipeType | null })); setLimit(PAGE) }}
          aria-label="Reseptin tyyppi"
          className="h-8 rounded-full text-sm"
        >
          <option value="">Kaikki reseptityypit</option>
          {Object.entries(RECIPE_TYPES).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </Select>
        <Chip active={filters.minRating !== null} onClick={() => setFilters((f) => ({ ...f, minRating: f.minRating ? null : 4 }))} title="Omat arviot 4–5 tähteä">★ 4+</Chip>
        <Chip active={filters.vegetarian} onClick={() => toggle('vegetarian')}>Kasvis</Chip>
        <Chip active={filters.vegan} onClick={() => toggle('vegan')}>Vegaaninen</Chip>
        <Chip active={filters.highProtein} onClick={() => toggle('highProtein')} title="Arvio: proteiinia ≥ 25 % energiasta tai ≥ 25 g/annos">Runsasproteiininen*</Chip>
        <Chip active={filters.lowCalorie} onClick={() => toggle('lowCalorie')} title={`Arvio: enintään ${LOW_CALORIE_MAX_KCAL} kcal/annos`}>Kevyt*</Chip>
        <Chip active={filters.quick} onClick={() => toggle('quick')} title={`Valmistusaika enintään ${QUICK_MAX_MIN} min`}>Nopea</Chip>
        <Chip active={filters.glutenFree} onClick={() => toggle('glutenFree')} title="Kaikki ainekset gluteenittomia Finelin tietojen mukaan">Gluteeniton*</Chip>
        <Chip active={filters.milkFree} onClick={() => toggle('milkFree')} title="Kaikki ainekset maidottomia Finelin tietojen mukaan">Maidoton*</Chip>
        <Chip active={filters.lactoseFree} onClick={() => toggle('lactoseFree')} title="Kaikki ainekset laktoosittomia tai maidottomia Finelin tietojen mukaan">Laktoositon*</Chip>
        <Select
          value={filters.maxTimeMin ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, maxTimeMin: e.target.value ? Number(e.target.value) : null }))}
          aria-label="Valmistusaika enintään"
          className="h-8 rounded-full text-sm"
        >
          <option value="">Valmistusaika</option>
          <option value="15">≤ 15 min</option>
          <option value="30">≤ 30 min</option>
          <option value="45">≤ 45 min</option>
          <option value="60">≤ 60 min</option>
          <option value="90">≤ 90 min</option>
        </Select>
        <Chip
          active={filters.pantryMinShare !== null}
          onClick={() => setFilters((f) => ({ ...f, pantryMinShare: f.pantryMinShare === null ? 0.6 : null }))}
          title="Näytä reseptit, joiden aineksista vähintään 60 % löytyy kotoa (määritä asetuksissa)"
        >
          Ainekset kotona
        </Chip>
      </div>
      <p className="mb-5 text-xs text-muted">
        * Arvioita Finelin tietojen perusteella. Allergioissa tarkista aina tuotteiden pakkausmerkinnät.
        {filters.pantryMinShare !== null && (
          <>
            {' '}Kotona olevat ainekset: {settings.pantry.join(', ') || 'ei määritelty'} – <Link className="underline" to="/asetukset">muokkaa</Link>.
          </>
        )}
      </p>

      {!recipes ? (
        <Spinner />
      ) : results.length === 0 ? (
        <EmptyState icon={<BookOpen size={32} />} title="Ei reseptejä näillä ehdoilla" action={tab === 'omat' ? <Link to="/reseptit/tuo"><Button>Tuo resepti</Button></Link> : undefined}>
          {tab === 'suosikit' ? 'Merkitse reseptejä suosikeiksi sydän-painikkeella.' : 'Kokeile muuttaa hakua tai suodattimia.'}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{results.length} reseptiä</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {results.slice(0, limit).map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                favourite={favourites.has(r.id)}
                kcal={showKcal ? recipeNutritionCached(r, ctx).perServing.energyKcal : null}
              />
            ))}
          </div>
          {results.length > limit && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Näytä lisää ({results.length - limit})</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
