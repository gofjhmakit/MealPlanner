import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, CalendarDays, Download, ShoppingCart, Sparkles, StickyNote } from 'lucide-react'
import { Link } from 'react-router'
import { db } from '../../db/db'
import { addMealItem } from '../../db/repo'
import { addDays, capitalize, formatDate, startOfWeek, today, weekdayName } from '../../domain/dates'
import { MEAL_SLOTS, type MealSlot } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp, useToast } from '../AppContext'
import { FETCH_AVAILABLE } from '../../import/client'
import { EstimateNote, NutritionSummary, RecipeCard, RecipeImage } from '../components/recipe'
import { Button, Card, EmptyState, ProgressBar, SectionTitle } from '../components/ui'
import { SLOT_LABELS, useMealItems, usePlanNutrition, useRecipesById } from '../hooks'

export function DashboardPage() {
  const { settings } = useApp()
  const toast = useToast()
  const t = today()
  const weekStart = startOfWeek(t, settings.weekStartsOn)
  const weekEnd = addDays(weekStart, 6)
  const weekItems = useMealItems(weekStart, weekEnd)
  const recipes = useRecipesById((weekItems ?? []).map((i) => i.recipeId))
  const nutrition = usePlanNutrition(weekItems, recipes)
  const todayItems = (weekItems ?? []).filter((i) => i.date === t)
  const todayNutrition = nutrition?.byDay.get(t)

  const latestList = useLiveQuery(() => db.shoppingLists.orderBy('createdAt').last(), [])
  const listItems = useLiveQuery(async () => (latestList ? db.shoppingItems.where('listId').equals(latestList.id).toArray() : []), [latestList?.id])
  const recentImports = useLiveQuery(() => db.recipes.where('origin').equals('imported').reverse().sortBy('createdAt').then((r) => r.slice(0, 4)), [])
  const seedRecipes = useLiveQuery(() => db.recipes.where('origin').equals('seed').toArray(), [])

  const hour = new Date().getHours()
  const greeting = hour < 10 ? 'Hyvää huomenta' : hour < 17 ? 'Hyvää päivää' : 'Hyvää iltaa'

  async function createExampleWeek() {
    if (!seedRecipes?.length) return
    const byId = new Map(seedRecipes.map((r) => [r.id, r]))
    const plan: [number, MealSlot, string][] = [
      [0, 'breakfast', 'seed-kaurapuuro'], [0, 'dinner', 'seed-lohikeitto'],
      [1, 'breakfast', 'seed-ruisleipa-kananmuna'], [1, 'dinner', 'seed-kanapasta'],
      [2, 'breakfast', 'seed-kaurapuuro'], [2, 'dinner', 'seed-linssikeitto'], [2, 'snack', 'seed-rahka'],
      [3, 'breakfast', 'seed-munakas'], [3, 'dinner', 'seed-makaronilaatikko'],
      [4, 'breakfast', 'seed-kaurapuuro'], [4, 'dinner', 'seed-tortillat'],
      [5, 'breakfast', 'seed-munakas'], [5, 'lunch', 'seed-kreikkalainen-salaatti'], [5, 'dinner', 'seed-uunilohi'],
      [6, 'breakfast', 'seed-rahka'], [6, 'dinner', 'seed-kikhernecurry'],
    ]
    for (const [offset, slot, id] of plan) {
      const r = byId.get(id)
      if (r) await addMealItem({ date: addDays(weekStart, offset), slot, recipeId: r.id, servings: slot === 'breakfast' || slot === 'snack' ? 2 : settings.defaultServings })
    }
    toast('Esimerkkiviikko lisätty ruokalistalle')
  }

  const checked = listItems?.filter((i) => i.checked).length ?? 0

  return (
    <div className="fade-in space-y-8">
      <div>
        <p className="text-sm text-muted">{capitalize(weekdayName(t))} {formatDate(t, { year: true })}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}!</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionTitle action={<Link to="/ruokalista" className="inline-flex items-center gap-1 text-sm font-medium text-brand">Ruokalista <ArrowRight size={14} /></Link>}>
            Tämän päivän ateriat
          </SectionTitle>
          {todayItems.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={28} />}
              title="Tälle päivälle ei ole suunniteltu aterioita"
              action={
                (weekItems?.length ?? 0) === 0 && seedRecipes?.length ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link to="/ruokalista/suunnittele"><Button icon={<Sparkles size={16} />}>Suunnittele viikkoni</Button></Link>
                    <Button variant="secondary" onClick={createExampleWeek}>Luo esimerkkiviikko</Button>
                  </div>
                ) : (
                  <Link to="/ruokalista"><Button>Suunnittele ateriat</Button></Link>
                )
              }
            >
              {(weekItems?.length ?? 0) === 0 ? 'Aloita lisäämällä reseptejä ruokalistalle – tai kokeile valmista esimerkkiviikkoa.' : undefined}
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {MEAL_SLOTS.map((slot) =>
                todayItems
                  .filter((i) => i.slot === slot)
                  .map((i) => {
                    if (!i.recipeId) {
                      return (
                        <li key={i.id} className="flex items-center gap-3 p-1">
                          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"><StickyNote size={22} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted">{SLOT_LABELS[slot]}</p>
                            <p className="truncate font-medium text-ink-2">{i.note}</p>
                          </div>
                        </li>
                      )
                    }
                    const r = recipes?.get(i.recipeId)
                    return (
                      <li key={i.id}>
                        <Link to={`/reseptit/${i.recipeId}`} className="flex items-center gap-3 rounded-xl p-1 hover:bg-surface-2">
                          {r && <RecipeImage recipe={r} className="h-14 w-14 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted">{SLOT_LABELS[slot]}</p>
                            <p className="truncate font-medium">{r?.title ?? '…'}</p>
                          </div>
                          <span className="tabular shrink-0 text-sm text-ink-2">
                            {formatNumber(i.servings, 1)} annosta
                            {nutrition?.byItem.get(i.id) ? <span className="block text-xs text-muted">≈ {Math.round(nutrition.byItem.get(i.id)!.nutrients.energyKcal)} kcal/annos</span> : null}
                          </span>
                        </Link>
                      </li>
                    )
                  }),
              )}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle action={<Link to={`/ravintosisalto?paiva=${t}`} className="text-sm font-medium text-brand">Lisää</Link>}>Tänään</SectionTitle>
          {todayNutrition ? (
            <>
              <NutritionSummary nutrients={todayNutrition.nutrients} targets={settings.targets} compact />
              <EstimateNote coverage={todayNutrition.coverage} className="mt-3" />
            </>
          ) : (
            <p className="text-sm text-muted">Ravintosisältö lasketaan, kun päivälle on suunniteltu aterioita.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionTitle action={<Link to="/ruokalista" className="text-sm font-medium text-brand">Avaa</Link>}>Tämä viikko</SectionTitle>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
              const count = (weekItems ?? []).filter((x) => x.date === d).length
              const kcal = nutrition?.byDay.get(d)?.nutrients.energyKcal
              return (
                <Link key={d} to="/ruokalista" className={`rounded-xl border p-2 text-center transition hover:border-brand ${d === t ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <p className="text-xs uppercase text-muted">{weekdayName(d, true)}</p>
                  <p className="font-display text-lg font-semibold">{formatDate(d).split('.')[0]}</p>
                  <p className="text-[11px] text-ink-2">
                    {count ? <>{count}<span className="sr-only sm:not-sr-only"> ateriaa</span></> : '–'}
                  </p>
                  {kcal ? <p className="tabular hidden text-[11px] text-muted sm:block">{Math.round(kcal)} kcal</p> : null}
                </Link>
              )
            })}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle action={<Link to="/ostoslista" className="text-sm font-medium text-brand">Avaa</Link>}>Ostoslista</SectionTitle>
          {latestList && listItems ? (
            <>
              <p className="text-sm text-ink-2">{latestList.name}</p>
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={checked} max={listItems.length || 1} label="Ostoslistan edistyminen" />
                <span className="tabular shrink-0 text-sm">{checked}/{listItems.length}</span>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">
              <p>Ei ostoslistaa vielä.</p>
              <Link to="/ostoslista" className="mt-2 inline-flex items-center gap-1 font-medium text-brand"><ShoppingCart size={14} /> Luo ostoslista</Link>
            </div>
          )}
        </Card>
      </div>

      <section>
        <SectionTitle action={<Link to="/reseptit/tuo" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><Download size={14} /> Tuo resepti</Link>}>
          Viimeksi tuodut reseptit
        </SectionTitle>
        {recentImports && recentImports.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {recentImports.map((r) => <RecipeCard key={r.id} recipe={r} />)}
          </div>
        ) : (
          <EmptyState title="Et ole vielä tuonut reseptejä" action={<Link to="/reseptit/tuo"><Button variant="secondary">Tuo resepti verkosta</Button></Link>}>
            {FETCH_AVAILABLE ? 'Liitä esimerkiksi Valion tai Yhteishyvän reseptin osoite (tai K-Ruoan sivun HTML)' : 'Liitä reseptisivun HTML-lähdekoodi esimerkiksi K-Ruoasta, Valiolta tai Yhteishyvältä'}, niin ainekset ja ravintosisältö lasketaan automaattisesti.
          </EmptyState>
        )}
      </section>
    </div>
  )
}
