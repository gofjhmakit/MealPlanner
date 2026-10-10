import {
  AlertTriangle,
  ArrowLeft,
  BookmarkMinus,
  BookmarkPlus,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  ListOrdered,
  Heart,
  ChefHat,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Printer,
  ShoppingBasket,
  ShoppingCart,
  Timer,
  X,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { copyRecipeToUser, deleteRecipe, setInCollection, setRecipeNotes, setRecipeRating, toggleFavourite } from '../../db/repo'
import { getIngredient } from '../../domain/ingredients'
import { CONFIDENT_THRESHOLD, NUTRIENT_INFO, NUTRIENT_KEYS, type NutritionLine } from '../../domain/nutrition'
import { splitAmountText } from '../../domain/ingredientParser'
import { foodSourceLabel } from '../../domain/supplementary'
import { recipeDiet, recipeSpecialDiets, recipeTime, DIET_LABELS, SPECIAL_DIET_LABELS, type SpecialDiets } from '../../domain/recipeInfo'
import { isMealComponent } from '../../domain/recipeType'
import { addDays, today } from '../../domain/dates'
import { pantryMatcher } from '../../domain/shoppingList'
import { nextEmptySlot } from '../../domain/today'
import { splitTimers } from '../../domain/timers'
import { ingredientsInStep } from '../../domain/stepIngredients'
import { scaleIngredient } from '../../domain/scaling'
import type { MealSlot, Nutrients, Recipe, RecipeIngredient } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { hostnameOf, safeHttpUrl } from '../../domain/url'
import { DIAGNOSTIC_FIELDS } from '../../import/pipeline'
import { useApp, useToast } from '../AppContext'
import { AddToPlanDialog, AddToShoppingListDialog, IngredientMappingDialog } from '../components/dialogs'
import { ConfidenceDot, EstimateNote, NutritionSummary, RecipeImage, SourceBadge, StarRating } from '../components/recipe'
import { Badge, Button, Card, cx, EmptyState, IconButton, Spinner, Stepper } from '../components/ui'
import { useFavouriteIds, useMealItems, usePlanNutrition, useRecipe, useRecipeNutrition, useRecipesById, useBack } from '../hooks'
import { Segmented } from '../components/v2'
import { addToSlot, slotLabel } from '../planActions'
import { useHousehold } from '../planning'
import { useScrollLock } from '../scrollLock'

export function RecipeDetailPage() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  if (recipe === undefined) return <Spinner />
  if (recipe === null)
    return (
      <EmptyState title="Reseptiä ei löytynyt" action={<Link to="/reseptit"><Button>Takaisin resepteihin</Button></Link>}>
        Resepti on ehkä poistettu.
      </EmptyState>
    )
  return <RecipeDetail key={recipe.id} recipe={recipe} />
}

function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const back = useBack('/reseptit')
  const favourites = useFavouriteIds()
  const [params, setParams] = useSearchParams()
  const { servings: householdServings, kcalTarget } = useHousehold()
  const initialServings = Number(params.get('annokset')) || recipe.servings
  const [servings, setServings] = useState(initialServings)
  const [planOpen, setPlanOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const cooking = params.get('kokkaa') === '1'
  const setCooking = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('kokkaa', '1')
    else next.delete('kokkaa')
    setParams(next, { replace: !on })
  }
  const [editing, setEditing] = useState<RecipeIngredient | null>(null)
  const [perServing, setPerServing] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [checkMode, setCheckMode] = useState(false)
  const nutrition = useRecipeNutrition(recipe, servings)
  const base = useRecipeNutrition(recipe)
  const sourceUrl = safeHttpUrl(recipe.sourceUrl)
  const factor = servings / recipe.servings
  const diet = recipeDiet(recipe, fineli)
  const specialDiets = recipeSpecialDiets(recipe, fineli)
  const isFav = favourites.has(recipe.id)
  const lowConfidence = recipe.ingredients.filter((i) => i.confidence < CONFIDENT_THRESHOLD && i.quantity != null)
  const inPantry = useMemo(() => pantryMatcher(settings.pantry), [settings.pantry])
  const time = recipeTime(recipe)
  // Sauces, spice mixes, stocks …: cooked for something else, so shopping comes first, not tonight's dinner.
  const component = isMealComponent(recipe)

  // The smart "add" target: the first empty slot that suits this kind of dish.
  const t = today()
  const upcoming = useMealItems(t, addDays(t, 20))
  const preferSlot: MealSlot = /aamiai/i.test(recipe.category ?? '') ? 'breakfast' : /välipal|jälkiruo|juoma/i.test(recipe.category ?? '') ? 'snack' : 'dinner'
  const target = useMemo(() => (upcoming ? nextEmptySlot(upcoming, t, new Date().getHours(), { preferSlot }) : null), [upcoming, t, preferSlot])
  const dayItems = (upcoming ?? []).filter((i) => target && i.date === target.date && i.status !== 'skipped')
  const dayRecipes = useRecipesById(dayItems.map((i) => i.recipeId))
  const dayNutrition = usePlanNutrition(dayItems, dayRecipes)
  const dayKcal = dayNutrition?.total.nutrients.energyKcal ?? 0
  const perServingKcal = base?.perServing.energyKcal ?? 0

  const groups: [string | null, RecipeIngredient[]][] = []
  for (const ing of recipe.ingredients) {
    const g = ing.group ?? null
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(ing)
    else groups.push([g, [ing]])
  }
  const buyCount = recipe.ingredients.filter((i) => i.name && !inPantry({ key: i.name.toLowerCase(), name: i.name })).length

  async function addToTarget() {
    if (!target) return setPlanOpen(true)
    const undo = await addToSlot(recipe.id, target.date, target.slot, householdServings)
    toast(`Lisätty: ${slotLabel(target.date, target.slot)}`, 'ok', { label: 'Kumoa', onClick: undo })
  }

  async function onEdit() {
    if (recipe.origin === 'catalogue') {
      const copy = await copyRecipeToUser(recipe)
      toast('Katalogireseptistä tehtiin oma kopio muokattavaksi')
      navigate(`/reseptit/${copy.id}/muokkaa`)
    } else navigate(`/reseptit/${recipe.id}/muokkaa`)
  }

  async function onDelete() {
    if (!confirm(`Poistetaanko resepti "${recipe.title}"? Myös sen ruokalistamerkinnät poistetaan.`)) return
    await deleteRecipe(recipe.id)
    toast('Resepti poistettu')
    navigate('/reseptit')
  }

  const nutrients = nutrition ? (perServing ? nutrition.perServing : nutrition.total) : null

  const hero = (
    <figure className="relative min-w-0">
      <RecipeImage
        recipe={recipe}
        className={cx('aspect-[4/3] w-full sm:aspect-[16/10]', recipe.imageUrl ? 'xl:aspect-auto xl:h-[calc(100vh-150px)] xl:max-h-[860px]' : 'xl:aspect-square xl:max-h-[560px]')}
        rounded="rounded-b-[28px] sm:rounded-[28px]"
      />
      <div className="no-print absolute inset-x-3 top-3 flex justify-between">
        <button onClick={back} className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/90 text-ink shadow backdrop-blur" aria-label="Takaisin">
          <ArrowLeft size={18} />
        </button>
        <span className="flex gap-2">
          <button
            onClick={async () => toast((await toggleFavourite(recipe.id)) ? 'Lisätty suosikkeihin' : 'Poistettu suosikeista')}
            aria-pressed={isFav}
            aria-label={isFav ? 'Poista suosikeista' : 'Lisää suosikkeihin'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/90 shadow backdrop-blur"
          >
            <Heart size={18} className={isFav ? 'fill-accent text-accent' : 'text-ink'} />
          </button>
          <MoreMenu recipe={recipe} onEdit={onEdit} onDelete={onDelete} onShop={() => setShopOpen(true)} onPlan={() => setPlanOpen(true)} onCheck={() => setCheckMode((v) => !v)} checkMode={checkMode} />
        </span>
      </div>
      {recipe.imageUrl && recipe.attribution?.imageCredit && (
        <figcaption className="px-4 pt-1.5 text-[11px] text-muted sm:px-1">
          Kuva: {recipe.attribution.imageCredit}
          {recipe.attribution.imageLicense && (
            <>
              {' · '}
              {safeHttpUrl(recipe.attribution.imageLicenseUrl) ? (
                <a href={safeHttpUrl(recipe.attribution.imageLicenseUrl)!} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">{recipe.attribution.imageLicense}</a>
              ) : (
                recipe.attribution.imageLicense
              )}
            </>
          )}
        </figcaption>
      )}
    </figure>
  )

  const ingredientsBlock = (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Ainekset</h2>
        <span className="no-print"><Stepper value={servings} onChange={setServings} label="Annokset" min={0.5} step={servings < 2 ? 0.5 : 1} suffix="hlö" size="sm" /></span>
      </div>
      <p className="-mt-1 mb-2 text-xs text-muted">
        {buyCount} ostettavaa{factor !== 1 ? ` · skaalattu ${formatNumber(recipe.servings, 1)} → ${formatNumber(servings, 1)} annosta` : ''}
      </p>
      {checkMode && lowConfidence.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          {lowConfidence.length} aineksen ravintotieto on epävarma. Napauta ainesta korjataksesi vastaavuuden.
        </p>
      )}
      {groups.map(([group, items], gi) => (
        <div key={gi} className="mb-3 last:mb-0">
          {group && <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-muted">{group}</h3>}
          <ul className="divide-y divide-line">
            {items.map((ing) => {
              const scaled = scaleIngredient(ing, factor)
              const canonical = getIngredient(ing.canonicalId)
              const split = splitAmountText(ing.raw)
              const amountLabel = factor === 1 ? split.amount : scaled.quantity != null ? scaled.amountText : scaled.explicitGrams ? `${formatNumber(scaled.explicitGrams, 0)} g` : ''
              const home = !!ing.name && inPantry({ key: ing.name.toLowerCase(), name: ing.name })
              const content = (
                <>
                  <span className="tabular w-16 shrink-0 text-right text-sm font-semibold">{amountLabel}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className={checkMode ? 'group-hover:text-brand' : ''}>{split.rest || ing.raw}</span>
                    {checkMode && canonical && canonical.fi.toLowerCase() !== ing.name && ing.confidence < 0.95 && <span className="block text-xs text-muted">→ {canonical.fi}</span>}
                  </span>
                  {checkMode ? (
                    <span className="mt-1.5 flex items-center gap-1">
                      {ing.confidence < CONFIDENT_THRESHOLD && ing.quantity != null && <Badge tone="warn">tarkista</Badge>}
                      <ConfidenceDot confidence={ing.confidence} method={ing.matchMethod} />
                    </span>
                  ) : home ? (
                    <span className="mt-0.5 shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">kotona</span>
                  ) : null}
                </>
              )
              return (
                <li key={ing.id}>
                  {checkMode ? (
                    <button type="button" onClick={() => setEditing(ing)} className="group flex w-full items-start gap-3 py-2 text-left" title="Tarkista tai korjaa aineksen vastaavuus">
                      {content}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 py-2">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <button onClick={() => setCheckMode((v) => !v)} className="no-print mt-2 text-xs font-medium text-muted hover:text-brand">
        {checkMode ? 'Valmis' : 'Ainesten tarkistus'}
        {!checkMode && lowConfidence.length > 0 ? ` (${lowConfidence.length} epävarmaa)` : ''}
      </button>
    </section>
  )

  const stepsBlock = (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Valmistus</h2>
        {recipe.instructions.length > 0 && (
          <button onClick={() => setCooking(true)} className="no-print inline-flex items-center gap-1.5 rounded-xl bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand">
            <ChefHat size={15} /> Kokkaustila
          </button>
        )}
      </div>
      {recipe.instructions.length === 0 ? (
        <p className="text-sm text-muted">
          {recipe.sourceId === 'fineli' ? 'Fineli-aineisto sisältää vain raaka-aineet ja määrät. Valmistusohjetta ei ole saatavilla.' : 'Valmistusohjetta ei ole lisätty.'}
          {sourceUrl && recipe.origin !== 'catalogue' && (
            <> Katso ohje <a className="text-brand underline" href={sourceUrl} target="_blank" rel="noopener noreferrer">alkuperäiseltä sivulta</a>.</>
          )}
        </p>
      ) : (
        <ol className="max-w-[64ch] space-y-4">
          {recipe.instructions.map((step, i) =>
            step.endsWith(':') ? (
              <li key={i} className="list-none pt-2 text-sm font-semibold text-ink-2">{step.slice(0, -1)}</li>
            ) : (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
                <p className="pt-0.5 leading-relaxed">{withTimers(step)}</p>
              </li>
            ),
          )}
        </ol>
      )}
      {recipe.origin === 'imported' && recipe.instructions.length > 0 && (
        <p className="mt-4 text-xs text-muted">Tuotu ohje on tallennettu vain omaan käyttöösi tälle laitteelle. Tekijänoikeudet: {recipe.sourceName}.</p>
      )}
    </section>
  )

  const fitCard = base && (
    <div className="no-print rounded-[22px] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{kcalTarget && target && !component ? 'Sopii päivääsi' : 'Annos'}</p>
        {kcalTarget && target && !component ? (
          <p className="tabular text-sm text-muted">
            <span className="font-semibold text-ink">{formatNumber(dayKcal + perServingKcal, 0)}</span> / {formatNumber(kcalTarget, 0)} kcal
          </p>
        ) : null}
      </div>
      {kcalTarget && target && !component && (
        <>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="bg-brand" style={{ width: `${Math.min(100, (dayKcal / kcalTarget) * 100)}%` }} />
            <span className={dayKcal + perServingKcal > kcalTarget * 1.1 ? 'bg-fat' : 'bg-accent/70'} style={{ width: `${Math.min(100 - Math.min(100, (dayKcal / kcalTarget) * 100), (perServingKcal / kcalTarget) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">{slotLabel(target.date, target.slot)}: muut ateriat {formatNumber(dayKcal, 0)} kcal + tämä {formatNumber(perServingKcal, 0)} kcal</p>
        </>
      )}
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat value={`${formatNumber(perServingKcal, 0)}`} label="kcal" />
        <Stat value={`${formatNumber(base.perServing.protein, 0)} g`} label="proteiini" />
        <Stat value={`${formatNumber(base.perServing.carbohydrate, 0)} g`} label="hiilih." />
        <Stat value={`${formatNumber(base.perServing.fat, 0)} g`} label="rasva" />
      </div>
    </div>
  )

  const nutritionBlock = nutrition && nutrients && (
    <section className="rounded-[22px] border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Ravintosisältö</h2>
        <Segmented size="sm" label="Peruste" value={perServing ? 'one' : 'all'} onChange={(v) => setPerServing(v === 'one')} options={[{ value: 'one', label: 'Annos' }, { value: 'all', label: `Koko (${formatNumber(servings, 1)})` }]} />
      </div>
      <NutritionSummary nutrients={nutrients} />
      <EstimateNote coverage={nutrition.coverage} className="mt-4" />
      <button onClick={() => setShowDetails((v) => !v)} className="no-print mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ChevronDown size={16} className={cx('transition', showDetails && 'rotate-180')} /> {showDetails ? 'Piilota erittely' : 'Kaikki ravintoaineet ja ainesten osuudet'}
      </button>
      {showDetails && <NutritionDetails lines={nutrition.lines} nutrients={nutrients} perServing={perServing} servings={servings} />}
      {recipe.sourceNutrition && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
          <p className="font-medium">Lähteen ilmoittamat ravintotiedot ({basisLabel(recipe.sourceNutrition.basis)})</p>
          <p className="mt-1">
            {Object.entries(recipe.sourceNutrition.raw)
              .filter(([, v]) => v !== '' && v != null)
              .map(([k, v]) => `${k}: ${typeof v === 'number' ? formatNumber(v, 1) : v}`)
              .join(' · ')}
          </p>
        </div>
      )}
    </section>
  )

  const sourceBlock = (
    <section className="text-xs text-muted">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider">Lähde ja lisenssi</p>
      {sourceUrl ? (
        <p>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            {recipe.sourceName ?? hostnameOf(sourceUrl)} <ExternalLink size={12} />
          </a>
          {recipe.author ? ` · ${recipe.author}` : ''}
        </p>
      ) : (
        <p>{recipe.origin === 'user' ? 'Oma resepti' : recipe.origin === 'seed' ? 'Lautasen esimerkkiresepti' : recipe.sourceName}</p>
      )}
      {recipe.attribution && <AttributionNote attribution={recipe.attribution} />}
    </section>
  )

  return (
    <div className="fade-in -mx-4 -mt-4 sm:mx-0 sm:mt-0">
      <div className="xl:grid xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-8 3xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_380px]">
        <div className="xl:sticky xl:top-[88px] xl:self-start">{hero}</div>

        <div className="space-y-6 px-4 pt-4 sm:px-0 xl:pt-0">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {diet && <Badge tone={diet === 'vegan' || diet === 'vegetarian' ? 'ok' : 'neutral'}>{DIET_LABELS[diet]}</Badge>}
              {time ? <Badge><Clock size={12} /> {time} min</Badge> : null}
              {recipe.rating ? <Badge tone="accent">★ {recipe.rating} · sinun</Badge> : null}
              {(Object.keys(SPECIAL_DIET_LABELS) as (keyof SpecialDiets)[])
                .filter((k) => specialDiets[k] && !(k === 'lactoseFree' && specialDiets.milkFree))
                .map((k) => (
                  <Badge key={k} tone="ok" title="Arvio Finelin erityisruokavaliotietojen perusteella – tarkista tuotteiden pakkausmerkinnät">{SPECIAL_DIET_LABELS[k]}*</Badge>
                ))}
              <SourceBadge recipe={recipe} />
            </div>
            <h1 className="font-display text-[2rem] font-semibold leading-[1.1] tracking-tight hyphens-auto [overflow-wrap:anywhere] sm:text-4xl 3xl:text-5xl">{recipe.title}</h1>
            {recipe.description && <p className="mt-3 max-w-[64ch] whitespace-pre-line text-ink-2">{recipe.description}</p>}
            <div className="no-print mt-3 flex flex-wrap items-center gap-3">
              <StarRating
                value={recipe.rating}
                onChange={async (v) => {
                  await setRecipeRating(recipe.id, v)
                  toast(v ? `Arvio tallennettu: ${v}/5` : 'Arvio poistettu')
                }}
              />
              {recipe.origin === 'catalogue' && (
                <button
                  onClick={async () => {
                    await setInCollection(recipe.id, !recipe.inCollection)
                    toast(recipe.inCollection ? 'Poistettu omista resepteistä' : 'Lisätty omiin resepteihin')
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-brand"
                >
                  {recipe.inCollection ? <BookmarkMinus size={15} /> : <BookmarkPlus size={15} />}
                  {recipe.inCollection ? 'Omissa resepteissä' : 'Tallenna omiin'}
                </button>
              )}
            </div>
          </div>

          {fitCard}

          {/* Desktop: the primary actions sit here; phones get the sticky bar below. */}
          <div className="no-print hidden gap-2 lg:flex">
            {component ? (
              <>
                <Button size="lg" icon={<ShoppingCart size={18} />} onClick={() => setShopOpen(true)} className="flex-1">Lisää ostoslistalle</Button>
                <Button size="lg" variant="secondary" icon={<CalendarPlus size={18} />} onClick={() => setPlanOpen(true)}>Ruokalistalle</Button>
              </>
            ) : (
              <>
                <Button size="lg" icon={<CalendarPlus size={18} />} onClick={addToTarget} className="flex-1">
                  {target ? `Lisää · ${slotLabel(target.date, target.slot)}` : 'Lisää ruokalistalle'}
                </Button>
                <Button size="lg" variant="secondary" onClick={() => setPlanOpen(true)}>Muu päivä</Button>
                <Button size="lg" variant="secondary" icon={<ShoppingCart size={18} />} onClick={() => setShopOpen(true)} aria-label="Lisää ostoslistalle" />
              </>
            )}
          </div>

          <div className="grid gap-8 2xl:grid-cols-[300px_minmax(0,1fr)]">
            {ingredientsBlock}
            {stepsBlock}
          </div>

          {recipe.importReport && <ImportReport recipe={recipe} />}
          <NotesCard recipe={recipe} />
          <div className="3xl:hidden">{nutritionBlock}</div>
          {sourceBlock}
        </div>

        <aside className="hidden space-y-5 3xl:block">
          {nutritionBlock}
          <WeekPlacement recipeId={recipe.id} />
        </aside>
      </div>

      {/* Phones and tablets: thumb-reach primary action */}
      <div className="no-print fixed inset-x-0 bottom-[68px] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        {component ? (
          <div className="mx-auto flex max-w-[720px] gap-2">
            <button onClick={() => setShopOpen(true)} className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-semibold text-on-brand">
              <ShoppingCart size={18} className="shrink-0" /> Lisää ostoslistalle
            </button>
            <button onClick={() => setPlanOpen(true)} className="flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl border border-line px-3 text-sm font-medium">
              <CalendarPlus size={16} /> Ruokalistalle
            </button>
          </div>
        ) : (
        <div className="mx-auto flex max-w-[720px] gap-2">
          <button onClick={addToTarget} className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-semibold text-on-brand">
            <CalendarPlus size={18} className="shrink-0" />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span>Lisää ruokalistalle</span>
              {target && <span className="max-w-full truncate text-xs font-medium opacity-80">{slotLabel(target.date, target.slot)}</span>}
            </span>
          </button>
          <button onClick={() => setPlanOpen(true)} className="h-12 shrink-0 whitespace-nowrap rounded-2xl border border-line px-3 text-sm font-medium" aria-label="Valitse muu päivä">Muu päivä</button>
          <button onClick={() => setShopOpen(true)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line" aria-label="Lisää ostoslistalle">
            <ShoppingCart size={18} />
          </button>
        </div>
        )}
        <p className="mt-1 text-center text-[11px] text-muted">{component ? 'Osa ateriaa – ei ehdoteta omaksi ateriaksi' : `Ensimmäinen sopiva tyhjä paikka · ${formatNumber(householdServings, 0)} annosta`}</p>
      </div>
      <div className="h-24 lg:hidden" />

      <AddToPlanDialog recipe={recipe} open={planOpen} onClose={() => setPlanOpen(false)} />
      <AddToShoppingListDialog recipe={recipe} servings={servings} open={shopOpen} onClose={() => setShopOpen(false)} />
      {cooking && <CookingMode recipe={recipe} factor={factor} servings={servings} onClose={() => setCooking(false)} />}
      <IngredientMappingDialog recipe={recipe} ingredient={editing} open={!!editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2/70 px-1 py-2">
      <p className="tabular text-sm font-semibold">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  )
}

function MoreMenu({ recipe, onEdit, onDelete, onShop, onPlan, onCheck, checkMode }: { recipe: Recipe; onEdit: () => void; onDelete: () => void; onShop: () => void; onPlan: () => void; onCheck: () => void; checkMode: boolean }) {
  const [open, setOpen] = useState(false)
  const item = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink'
  const run = (f: () => void) => () => {
    setOpen(false)
    f()
  }
  return (
    <span className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Lisää toimintoja" className="flex h-10 w-10 items-center justify-center rounded-full bg-surface/90 text-ink shadow backdrop-blur">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span role="menu" className="fade-in absolute right-0 top-full z-40 mt-2 block w-60 rounded-2xl border border-line bg-surface p-2 shadow-xl">
            <button role="menuitem" className={item} onClick={run(onPlan)}><CalendarPlus size={16} /> Lisää tiettyyn päivään</button>
            <button role="menuitem" className={item} onClick={run(onShop)}><ShoppingCart size={16} /> Lisää ostoslistalle</button>
            <button role="menuitem" className={item} onClick={run(() => window.print())}><Printer size={16} /> Tulosta</button>
            <button role="menuitem" className={item} onClick={run(onEdit)}><Pencil size={16} /> {recipe.origin === 'catalogue' ? 'Muokkaa omana kopiona' : 'Muokkaa'}</button>
            <button role="menuitem" className={item} onClick={run(onCheck)}><CheckCircle2 size={16} /> {checkMode ? 'Lopeta ainesten tarkistus' : 'Ainesten tarkistus'}</button>
            {recipe.origin !== 'catalogue' && <button role="menuitem" className={cx(item, 'text-bad')} onClick={run(onDelete)}><Trash2 size={16} /> Poista resepti</button>}
          </span>
        </>
      )}
    </span>
  )
}

/** Where this recipe sits in the coming two weeks (wide screens). */
function WeekPlacement({ recipeId }: { recipeId: string }) {
  const t = today()
  const items = useMealItems(t, addDays(t, 13))
  const placed = (items ?? []).filter((i) => i.recipeId === recipeId)
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5">
      <h2 className="font-display text-lg font-semibold">Viikollasi</h2>
      {placed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Ei vielä ruokalistalla seuraavan kahden viikon aikana.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {placed.map((i) => (
            <li key={i.id} className="flex justify-between">
              <span>{slotLabel(i.date, i.slot)}</span>
              <span className="text-muted">{formatNumber(i.servings, 1)} annosta</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Durations in instruction text ("20–25 minuuttia", "1 tunti") become small timer chips. */
function withTimers(step: string): ReactNode {
  const parts = splitTimers(step)
  if (parts.length === 1) return step
  return parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <TimerChip key={i} label={p.text} seconds={p.seconds} />))
}

function basisLabel(b: string): string {
  return b === 'total' ? 'koko resepti' : b === 'per-serving' ? 'annosta kohden' : b === 'per-100g' ? '100 g kohden' : 'peruste ei tiedossa'
}

const STATUS_LABEL: Record<NutritionLine['status'], string> = {
  confident: 'Luotettava',
  approximate: 'Arvio',
  unmatched: 'Ei vastinetta',
  unquantified: 'Ei määrää',
  'no-weight': 'Paino puuttuu',
}

function NutritionDetails({ lines, nutrients, perServing, servings }: { lines: NutritionLine[]; nutrients: Nutrients; perServing: boolean; servings: number }) {
  const div = perServing ? servings : 1
  return (
    <div className="mt-4 space-y-5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left text-xs text-muted">Kaikki ravintotekijät ({perServing ? 'annos' : 'koko resepti'}), Fineli-arvoihin perustuva arvio{lines.some((l) => l.food?.source) ? ' (merkityt rivit muista avoimista aineistoista)' : ''}</caption>
          <tbody className="divide-y divide-line">
            {NUTRIENT_KEYS.filter((k) => k !== 'energyKj').map((k) => (
              <tr key={k}>
                <td className="py-1.5 text-ink-2">{NUTRIENT_INFO[k].label}</td>
                <td className="tabular py-1.5 text-right">
                  {formatNumber(nutrients[k], NUTRIENT_INFO[k].decimals)} {NUTRIENT_INFO[k].unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="mb-2 text-left text-xs text-muted">Ainesten osuudet ({perServing ? 'annos' : 'koko resepti'})</caption>
          <thead className="text-xs text-muted">
            <tr className="text-left">
              <th className="py-1 font-medium">Aines</th>
              <th className="py-1 text-right font-medium">g</th>
              <th className="py-1 text-right font-medium">kcal</th>
              <th className="py-1 text-right font-medium">Prot.</th>
              <th className="py-1 pl-3 font-medium">Tila</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => (
              <tr key={l.ingredientId} className="align-top">
                <td className="py-1.5 pr-2">
                  <span className="block">{l.raw}</span>
                  <span className="block text-xs text-muted">{l.food?.fi ?? '—'}{l.food?.source ? ` (${foodSourceLabel(l.food)})` : ''}{l.gramsResolution.note ? ` · ${l.gramsResolution.note}` : ''}</span>
                </td>
                <td className="tabular py-1.5 text-right">{l.grams !== null ? formatNumber(l.grams / div, 0) : '—'}</td>
                <td className="tabular py-1.5 text-right">{formatNumber(l.nutrients.energyKcal / div, 0)}</td>
                <td className="tabular py-1.5 text-right">{formatNumber(l.nutrients.protein / div, 1)}</td>
                <td className="py-1.5 pl-3">
                  <span className="inline-flex items-center gap-1 text-xs">
                    {l.status === 'confident' ? <CheckCircle2 size={13} className="text-ok" /> : l.status === 'approximate' ? <AlertTriangle size={13} className="text-warn" /> : <XCircle size={13} className="text-bad" />}
                    {STATUS_LABEL[l.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ImportReport({ recipe }: { recipe: Recipe }) {
  const [open, setOpen] = useState(false)
  const r = recipe.importReport!
  const matched = recipe.ingredients.filter((i) => i.confidence >= CONFIDENT_THRESHOLD).length
  const approx = recipe.ingredients.filter((i) => i.confidence > 0 && i.confidence < CONFIDENT_THRESHOLD).length
  return (
    <Card className="mt-6 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-sm">
          <span className="font-medium">Tuontiraportti</span>
          <span className="text-muted"> · {matched}/{recipe.ingredients.length} ainesta tunnistettu{approx ? `, ${approx} arvioitu` : ''}{r.missing.length ? ` · puuttuu: ${r.missing.join(', ')}` : ''}</span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <ul className="space-y-1">
            {DIAGNOSTIC_FIELDS.map(({ field, label }) => (
              <li key={field} className="flex items-center gap-2">
                {r.found[field] ? <CheckCircle2 size={15} className="text-ok" /> : <XCircle size={15} className="text-muted" />}
                {label}
              </li>
            ))}
          </ul>
          <div className="space-y-2 text-xs text-muted">
            <p>Lähdeadapteri: {r.adapter}. Menetelmät: {r.methods.join(', ')}.</p>
            <p>Tuotu {new Date(r.importedAt).toLocaleString('fi-FI')}.</p>
            {r.warnings.map((w, i) => (
              <p key={i} className="text-warn">⚠ {w}</p>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function NotesCard({ recipe }: { recipe: Recipe }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(recipe.notes ?? '')
  if (!editing && !recipe.notes) {
    return (
      <button onClick={() => setEditing(true)} className="no-print mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
        <NotebookPen size={16} /> Lisää omia muistiinpanoja
      </button>
    )
  }
  return (
    <Card className="mt-6 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium"><NotebookPen size={16} /> Omat muistiinpanot</h2>
        {!editing && <Button size="sm" variant="ghost" className="no-print" onClick={() => { setText(recipe.notes ?? ''); setEditing(true) }}>Muokkaa</Button>}
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="esim. Vähemmän chiliä, lapset tykkäsi. Tuplaa kastike."
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Peruuta</Button>
            <Button
              size="sm"
              onClick={async () => {
                await setRecipeNotes(recipe.id, text)
                setEditing(false)
                toast('Muistiinpanot tallennettu')
              }}
            >
              Tallenna
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm text-ink-2">{recipe.notes}</p>
      )}
    </Card>
  )
}

/**
 * Cook mode: one step at a time in big type (or every step at once), the ingredients of that step,
 * timers parsed from the text, and the screen kept awake where the browser allows.
 * Keys: → / space next, ← previous, T start the step's timer, Esc close.
 * Below xl the full ingredient list opens at the top of the one scrolling column, so there is
 * never a scroll area inside a scroll area on a phone.
 */
const SHOW_ALL_STEPS_KEY = 'cook.allSteps'

/** Big type for a short step; long paragraphs step down so they still fit a screen or two. */
function stepTextClass(length: number): string {
  if (length > 450) return 'max-w-[60ch] text-xl sm:text-2xl lg:text-3xl 3xl:text-4xl'
  if (length > 220) return 'max-w-[42ch] text-2xl sm:text-3xl lg:text-4xl 3xl:text-5xl'
  return 'max-w-[30ch] text-[1.75rem] sm:text-4xl lg:max-w-[32ch] lg:text-5xl 3xl:text-[4.25rem]'
}

function CookingMode({ recipe, factor, servings, onClose }: { recipe: Recipe; factor: number; servings: number; onClose: () => void }) {
  const steps = recipe.instructions.map((s, i) => ({ s, i })).filter((x) => !x.s.endsWith(':'))
  const [index, setIndex] = useState(0)
  const [wakeLock, setWakeLock] = useState<'on' | 'unsupported' | 'off'>('off')
  const [timers, setTimers] = useState<{ id: number; label: string; end: number }[]>([])
  const [showIngredients, setShowIngredients] = useState(false)
  const [allSteps, setAllSteps] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ALL_STEPS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [, tick] = useState(0)
  const scroller = useRef<HTMLElement>(null)
  useScrollLock()

  const toggleAllSteps = () => {
    setAllSteps((v) => {
      try {
        localStorage.setItem(SHOW_ALL_STEPS_KEY, v ? '0' : '1')
      } catch {
        // private window: the choice just isn't remembered
      }
      return !v
    })
  }

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const request = async () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      if (!wl) return setWakeLock('unsupported')
      try {
        lock = await wl.request('screen')
        if (cancelled) void lock.release()
        else setWakeLock('on')
      } catch {
        setWakeLock('unsupported')
      }
    }
    void request()
    const onVisible = () => document.visibilityState === 'visible' && void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!timers.length) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [timers.length])

  // Keep the current step in view when it changes (or when the view mode changes: jump, don't glide).
  const lastMode = useRef(allSteps)
  useEffect(() => {
    const box = scroller.current
    const el = box?.querySelector<HTMLElement>(`[data-step="${index}"]`)
    const modeChanged = lastMode.current !== allSteps
    lastMode.current = allSteps
    if (!box || !el) return
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 24
    const smooth = allSteps && !modeChanged && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }, [index, allSteps])

  const openIngredients = () => {
    setShowIngredients((v) => !v)
    if (!showIngredients) requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }))
  }

  const current = steps[index]
  const timersOf = (s: string) => splitTimers(s).filter((p): p is { text: string; seconds: number } => typeof p !== 'string')
  const stepTimers = current ? timersOf(current.s) : []
  const startTimer = (label: string, seconds: number) => setTimers((t) => [...t, { id: Date.now(), label, end: Date.now() + seconds * 1000 }])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        setIndex((i) => Math.min(steps.length - 1, i + 1))
      } else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      else if (e.key.toLowerCase() === 't' && stepTimers[0]) startTimer(`Vaihe ${index + 1}: ${stepTimers[0].text}`, stepTimers[0].seconds)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, steps.length, stepTimers, index])

  // Ingredients this step uses (inflections, compounds and words like "kasvikset" understood).
  const stepIngredients = current ? ingredientsInStep(current.s, recipe.ingredients) : []
  const amount = (ing: RecipeIngredient) => {
    const scaled = scaleIngredient(ing, factor)
    const split = splitAmountText(ing.raw)
    return { amount: factor === 1 ? split.amount : scaled.quantity != null ? scaled.amountText : '', rest: split.rest || ing.raw }
  }
  const ingredientList = (size: 'base' | 'sm') => (
    <ul className={cx('space-y-1.5', size === 'base' ? 'text-base' : 'text-sm')}>
      {recipe.ingredients.map((ing) => {
        if (/:$/.test(ing.raw)) return <li key={ing.id} className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">{ing.raw.slice(0, -1)}</li>
        const a = amount(ing)
        return (
          <li key={ing.id} className={cx('flex gap-3', !allSteps && stepIngredients.includes(ing) && 'font-semibold text-brand')}>
            <span className={cx('tabular shrink-0 text-right font-semibold', size === 'base' ? 'w-16' : 'w-14')}>{a.amount}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{a.rest}</span>
          </li>
        )
      })}
    </ul>
  )
  const timerButtons = (list: { text: string; seconds: number }[], stepNo: number) =>
    list.length > 0 && (
      <div className="mt-4 flex flex-wrap gap-2">
        {list.map((tm, i) => (
          <button key={i} onClick={() => startTimer(`Vaihe ${stepNo}: ${tm.text}`, tm.seconds)} className="inline-flex items-center gap-2 rounded-full bg-sun-soft px-4 py-2 text-sm font-semibold text-warn">
            <Timer size={16} /> Käynnistä {tm.text}
          </button>
        ))}
      </div>
    )
  const toggleClass = (on: boolean) =>
    cx('inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-semibold sm:flex-none', on ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink')

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overscroll-none bg-canvas" role="dialog" aria-modal="true" aria-label={`Kokkaustila: ${recipe.title}`}>
      <header className="safe-top flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">
            Kokkaustila · {formatNumber(servings, 1)} annosta
            {wakeLock === 'on' && <span className="hidden sm:inline"> · näyttö pysyy päällä</span>}
          </p>
          <h2 className="truncate font-display text-xl font-semibold">{recipe.title}</h2>
        </div>
        <div className="order-last flex w-full gap-2 sm:order-none sm:w-auto">
          <button onClick={toggleAllSteps} aria-pressed={allSteps} className={toggleClass(allSteps)}>
            <ListOrdered size={16} /> Kaikki vaiheet
          </button>
          <button onClick={openIngredients} aria-pressed={showIngredients} className={cx(toggleClass(showIngredients), 'xl:hidden')}>
            <ShoppingBasket size={16} /> Ainekset
          </button>
        </div>
        <IconButton label="Sulje kokkaustila" onClick={onClose} className="h-11 w-11"><X size={24} /></IconButton>
      </header>
      <div className="flex min-h-0 flex-1">
        {!allSteps && (
          <nav className="hidden w-72 shrink-0 overflow-y-auto overscroll-contain border-r border-line p-4 lg:block 3xl:w-96" aria-label="Vaiheet">
            <ol className="space-y-1">
              {steps.map((x, i) => (
                <li key={x.i}>
                  <button onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined} className={cx('flex w-full gap-3 rounded-xl p-2.5 text-left text-sm', i === index ? 'bg-brand-soft text-ink' : i < index ? 'text-muted line-through' : 'text-ink-2 hover:bg-surface-2')}>
                    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', i === index ? 'bg-brand text-on-brand' : 'bg-surface-2')}>{i + 1}</span>
                    <span className="line-clamp-2">{x.s}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <main ref={scroller} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {showIngredients && (
            <section className="border-b border-line bg-surface px-5 py-4 sm:px-6 lg:px-12 xl:hidden" aria-label="Kaikki ainekset">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Kaikki ainekset · {formatNumber(servings, 1)} annosta</p>
              <div className="sm:columns-2 sm:gap-8 [&_li]:break-inside-avoid">{ingredientList('base')}</div>
            </section>
          )}
          <div className="px-6 py-8 lg:px-12">
            {steps.length === 0 ? (
              <p className="text-muted">Tässä reseptissä ei ole valmistusohjetta.</p>
            ) : allSteps ? (
              <ol className="mx-auto max-w-3xl space-y-3">
                {steps.map((x, i) => (
                  <li key={x.i} data-step={i}>
                    <button
                      onClick={() => setIndex(i)}
                      aria-current={i === index ? 'step' : undefined}
                      className={cx('flex w-full gap-4 rounded-2xl p-4 text-left transition sm:p-5', i === index ? 'bg-brand-soft ring-1 ring-brand' : 'hover:bg-surface-2')}
                    >
                      <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', i === index ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink-2')}>{i + 1}</span>
                      <span className={cx('min-w-0 font-display text-xl leading-snug sm:text-2xl 3xl:text-3xl', i < index ? 'text-muted' : 'text-ink')}>{x.s}</span>
                    </button>
                    {i === index && <div className="pl-[4.25rem] sm:pl-[4.5rem]">{timerButtons(timersOf(x.s), i + 1)}</div>}
                  </li>
                ))}
              </ol>
            ) : (
              <div data-step={index}>
                <p className="text-sm font-semibold uppercase tracking-wider text-brand">Vaihe {index + 1} / {steps.length}</p>
                <p className={cx('mt-4 font-display font-medium leading-snug', stepTextClass(current.s.length))}>{current.s}</p>
                <div className="mt-2">{timerButtons(stepTimers, index + 1)}</div>
                {stepIngredients.length > 0 && (
                  <div className="mt-8 max-w-xl">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tässä vaiheessa</p>
                    <ul className="grid gap-x-6 gap-y-1.5 text-lg sm:grid-cols-2">
                      {stepIngredients.map((ing) => {
                        const a = amount(ing)
                        return (
                          <li key={ing.id} className="flex gap-3">
                            <span className="tabular w-16 shrink-0 text-right font-semibold">{a.amount}</span>
                            <span className="min-w-0 [overflow-wrap:anywhere]">{a.rest}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
        <aside className="hidden w-80 shrink-0 overflow-y-auto overscroll-contain border-l border-line p-5 xl:block 3xl:w-96" aria-label="Kaikki ainekset">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Kaikki ainekset</p>
          {ingredientList('sm')}
        </aside>
      </div>
      {timers.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line bg-surface px-5 py-2">
          {timers.map((tm) => {
            const left = Math.max(0, Math.round((tm.end - Date.now()) / 1000))
            return (
              <button key={tm.id} onClick={() => setTimers((t) => t.filter((x) => x.id !== tm.id))} className={cx('tabular inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold', left === 0 ? 'animate-pulse bg-accent text-white' : 'bg-sun-soft text-warn')} title="Poista ajastin">
                <Timer size={14} /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {tm.label}
              </button>
            )
          })}
        </div>
      )}
      <footer className="flex items-center gap-3 border-t border-line bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button size="lg" variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>Edellinen</Button>
        {steps.length > 12 ? (
          <p className="tabular flex-1 text-center text-sm font-semibold text-ink-2">{index + 1} / {steps.length}</p>
        ) : (
          <div className="flex min-w-0 flex-1 justify-center gap-1" aria-hidden>
            {steps.map((_, i) => (
              <span key={i} className={cx('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-brand' : i < index ? 'w-1.5 bg-brand/50' : 'w-1.5 bg-line')} />
            ))}
          </div>
        )}
        {index < steps.length - 1 ? (
          <Button size="lg" onClick={() => setIndex((i) => i + 1)}>Seuraava</Button>
        ) : (
          <Button size="lg" onClick={onClose}>Valmis!</Button>
        )}
      </footer>
    </div>
  )
}

function TimerChip({ label, seconds }: { label: string; seconds: number }) {
  const [end, setEnd] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!end) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [end])
  const left = end ? Math.max(0, Math.round((end - Date.now()) / 1000)) : null
  return (
    <button
      onClick={() => setEnd(end ? null : Date.now() + seconds * 1000)}
      className={cx('inline-flex items-center gap-1 rounded-md px-1.5 align-baseline text-[0.95em] font-medium', left === 0 ? 'bg-accent text-white' : 'bg-sun-soft text-warn')}
      title={end ? 'Pysäytä ajastin' : 'Käynnistä ajastin'}
    >
      <Timer size={12} className="self-center" />
      {left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : label}
    </button>
  )
}

function AttributionNote({ attribution: a }: { attribution: NonNullable<Recipe['attribution']> }) {
  const licenseUrl = safeHttpUrl(a.licenseUrl)
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted">
      <p>
        Lisenssi:{' '}
        {licenseUrl ? (
          <a href={licenseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">{a.license}</a>
        ) : (
          a.license
        )}
        {a.originalTitle ? <> · Alkuperäinen nimi: <span lang="en">{a.originalTitle}</span></> : null}
      </p>
      {a.changes && <p>{a.changes}</p>}
    </div>
  )
}
