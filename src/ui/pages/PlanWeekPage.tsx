import { ArrowLeft, CalendarCheck, RefreshCw, ShoppingCart, Shuffle, SlidersHorizontal, Soup } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { applyMealPlan, mealItemsInRange, syncRollingList } from '../../db/repo'
import { addDays, capitalize, formatDate, startOfWeek, today, weekdayName } from '../../domain/dates'
import { MEAL_SLOTS, type MealSlot, type Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { planMeals, rerollMeal, type PlanOptions, type PlanResult } from '../../domain/weekPlanner'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { RecipeImage } from '../components/recipe'
import { Badge, Button, Card, Chip, Field, Select, Spinner, Stepper, Switch, TextInput } from '../components/ui'
import { SLOT_LABELS, useAllRecipes } from '../hooks'
import { useCandidates, useHousehold } from '../planning'
import { kcalTone, MiniBar } from '../components/v2'

type Period = 'week' | 'day'

const TIME_OPTIONS = [
  ['', 'Ei rajaa'],
  ['20', '≤ 20 min'],
  ['30', '≤ 30 min'],
  ['45', '≤ 45 min'],
  ['60', '≤ 60 min'],
  ['90', '≤ 90 min'],
] as const

export function PlanWeekPage() {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const recipes = useAllRecipes()
  const ownCount = (recipes ?? []).filter((r) => r.inCollection).length

  const [tuning, setTuning] = useState(false)
  const [period, setPeriod] = useState<Period>('week')
  const thisWeek = startOfWeek(today(), settings.weekStartsOn)
  const [weekStart, setWeekStart] = useState(addDays(thisWeek, 7))
  const [day, setDay] = useState(addDays(today(), 1))
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const { servings: householdServings, kcalTarget } = useHousehold()
  const [people, setPeople] = useState(householdServings)
  const [slots, setSlots] = useState<MealSlot[]>(kcalTarget ? ['breakfast', 'lunch', 'dinner'] : ['lunch', 'dinner'])
  const [leftovers, setLeftovers] = useState(true)
  const [diet, setDiet] = useState<PlanOptions['diet']>('all')
  const [glutenFree, setGlutenFree] = useState(false)
  const [milkFree, setMilkFree] = useState(false)
  const [lactoseFree, setLactoseFree] = useState(false)
  const [maxKcal, setMaxKcal] = useState(kcalTarget ? String(kcalTarget) : '')
  const [timeWeekday, setTimeWeekday] = useState('45')
  const [timeWeekend, setTimeWeekend] = useState('')
  const [use, setUse] = useState('')
  const [avoid, setAvoid] = useState('')
  const [includeCatalogue, setIncludeCatalogue] = useState<boolean | null>(null)
  const [preferFavourites, setPreferFavourites] = useState(true)
  const [avoidRepeats, setAvoidRepeats] = useState(true)
  const [replace, setReplace] = useState(false)
  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [opts, setOpts] = useState<PlanOptions | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const catalogue = includeCatalogue ?? ownCount < 25
  const dates = useMemo(
    () => (period === 'day' ? [day] : [...weekdays].sort((a, b) => a - b).map((i) => addDays(weekStart, i))),
    [period, day, weekStart, weekdays],
  )
  const kcalNum = Number(maxKcal.replace(',', '.'))
  const kcalLimit = maxKcal.trim() && Number.isFinite(kcalNum) && kcalNum >= 800 ? kcalNum : null
  const leftoverPossible = slots.includes('lunch') && slots.includes('dinner') && dates.length > 1

  const shared = useCandidates()
  const candidates = useMemo(() => shared ?? [], [shared])
  const byId = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])

  async function generate(seed = Date.now() % 100000) {
    setBusy(true)
    const sorted = [...dates].sort()
    const existing = replace ? [] : await mealItemsInRange(sorted[0], sorted.at(-1)!)
    const options: PlanOptions = {
      dates,
      slots,
      people,
      leftovers: leftovers && leftoverPossible,
      diet,
      glutenFree,
      milkFree,
      lactoseFree,
      maxTimeWeekday: timeWeekday ? Number(timeWeekday) : null,
      maxTimeWeekend: timeWeekend ? Number(timeWeekend) : null,
      maxKcalPerDay: kcalLimit,
      includeCatalogue: catalogue,
      preferFavourites,
      use: use.split(',').map((s) => s.trim()).filter(Boolean),
      avoid: avoid.split(',').map((s) => s.trim()).filter(Boolean),
      avoidRepeats,
      occupied: new Set(existing.map((m) => `${m.date}|${m.slot}`)),
      seed,
    }
    setOpts(options)
    setPlan(planMeals(candidates, options))
    setSaved(false)
    setBusy(false)
  }

  async function save() {
    if (!plan || !opts) return
    const n = await applyMealPlan(plan.meals, { replace, dates: opts.dates, slots: opts.slots })
    setSaved(true)
    toast(`${n} ateriaa lisätty ruokalistalle`)
  }

  async function shoppingList() {
    // The rolling list covers today onwards; stretch it to the last planned day (max two weeks).
    const last = [...dates].sort().at(-1)!
    const span = Math.round((new Date(`${last}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86400000) + 1
    await syncRollingList(fineli, Math.min(14, Math.max(7, span)))
    navigate('/ostokset')
  }

  // The plan is shown straight away and follows every change of the options.
  const optionKey = JSON.stringify([dates, slots, people, leftovers, diet, glutenFree, milkFree, lactoseFree, kcalLimit, timeWeekday, timeWeekend, use, avoid, catalogue, preferFavourites, avoidRepeats, replace])
  useEffect(() => {
    if (!shared || saved || dates.length === 0 || slots.length === 0) return
    const id = setTimeout(() => void generate(4242), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionKey, shared])

  if (!recipes || !shared) return <Spinner label="Ladataan reseptejä…" />

  const saveBar = !saved ? (
    <>
      <Button variant="secondary" onClick={() => generate()} icon={<RefreshCw size={16} />} disabled={busy}>Uusi ehdotus</Button>
      <Button onClick={save} disabled={!plan || plan.meals.length === 0} icon={<CalendarCheck size={16} />}>Tallenna {plan?.meals.length ?? 0} ateriaa</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={shoppingList} icon={<ShoppingCart size={16} />}>Ostokset</Button>
      <Link to="/viikko"><Button icon={<CalendarCheck size={16} />}>Avaa viikko</Button></Link>
    </>
  )

  return (
    <div className="fade-in pb-24 lg:pb-0">
      <Link to="/viikko" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> Viikko</Link>
      <PageHeader title={period === 'week' ? 'Suunnittele viikko' : 'Suunnittele päivä'} subtitle="Ehdotus päivittyy heti, kun muutat valintoja. Vaihda yksittäinen ateria nuolista." actions={saveBar} mobileActions={null} />

      <Card className="mb-5 space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {period === 'week' ? (
            <>
              <Chip active={weekStart === thisWeek} onClick={() => setWeekStart(thisWeek)}>Tämä viikko</Chip>
              <Chip active={weekStart === addDays(thisWeek, 7)} onClick={() => setWeekStart(addDays(thisWeek, 7))}>Ensi viikko</Chip>
            </>
          ) : (
            <TextInput type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="max-w-44" aria-label="Päivä" />
          )}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          {MEAL_SLOTS.filter((s) => s !== 'other').map((s) => (
            <Chip key={s} active={slots.includes(s)} onClick={() => setSlots((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{SLOT_LABELS[s]}</Chip>
          ))}
          <span className="ml-auto"><Stepper value={people} onChange={setPeople} min={1} max={20} label="Annokset" suffix="hlö" size="sm" /></span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
          <Switch checked={leftovers && leftoverPossible} onChange={setLeftovers} disabled={!leftoverPossible} label="Päivällisen tähteet seuraavan päivän lounaaksi" />
        </div>
        <button onClick={() => setTuning((v) => !v)} className="inline-flex items-center gap-1 text-sm font-medium text-brand" aria-expanded={tuning}>
          <SlidersHorizontal size={15} /> {tuning ? 'Piilota lisäasetukset' : 'Säädä: ruokavalio, kalorit, aika, toiveet'}
        </button>
        {tuning && (
          <div className="grid gap-5 border-t border-line pt-4 lg:grid-cols-2">
            {period === 'week' && (
              <div className="lg:col-span-2">
                <p className="mb-2 text-sm font-medium text-ink-2">Päivät</p>
                <div className="flex flex-wrap gap-2" aria-label="Päivät">
                  {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => (
                    <Chip key={d} active={weekdays.includes(i)} onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}>
                      {capitalize(weekdayName(d, true))} {formatDate(d)}
                    </Chip>
                  ))}
                  <Chip active={false} onClick={() => setPeriod('day')}>Vain yksi päivä…</Chip>
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Ruokavalio</p>
              <div className="flex flex-wrap gap-2">
                <Chip active={diet === 'all'} onClick={() => setDiet('all')}>Kaikki käy</Chip>
                <Chip active={diet === 'vegetarian'} onClick={() => setDiet('vegetarian')}>Kasvis</Chip>
                <Chip active={diet === 'vegan'} onClick={() => setDiet('vegan')}>Vegaaninen</Chip>
                <Chip active={glutenFree} onClick={() => setGlutenFree((v) => !v)}>Gluteeniton*</Chip>
                <Chip active={milkFree} onClick={() => setMilkFree((v) => !v)}>Maidoton*</Chip>
                <Chip active={lactoseFree} onClick={() => setLactoseFree((v) => !v)}>Laktoositon*</Chip>
              </div>
              <p className="mt-1 text-xs text-muted">* Arvio – tarkista pakkausmerkinnät allergioissa.</p>
            </div>
            <Field label="Päivän kalorit / henkilö enintään" hint={kcalTarget ? `Tavoitteesi on ${kcalTarget} kcal.` : 'Valinnainen.'}>
              <div className="flex items-center gap-2">
                <TextInput inputMode="numeric" value={maxKcal} onChange={(e) => setMaxKcal(e.target.value)} placeholder="esim. 2000" className="w-36" />
                <span className="text-sm text-muted">kcal</span>
              </div>
              {maxKcal.trim() && !kcalLimit && <p className="mt-1 text-xs text-warn">Anna vähintään 800 kcal.</p>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aika arkena">
                <Select value={timeWeekday} onChange={(e) => setTimeWeekday(e.target.value)} className="w-full">
                  {TIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Aika viikonloppuna">
                <Select value={timeWeekend} onChange={(e) => setTimeWeekend(e.target.value)} className="w-full">
                  {TIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Käytä nämä" hint="esim. broileri, kesäkurpitsa"><TextInput value={use} onChange={(e) => setUse(e.target.value)} /></Field>
              <Field label="Vältä näitä" hint="esim. sieni"><TextInput value={avoid} onChange={(e) => setAvoid(e.target.value)} /></Field>
            </div>
            <div className="space-y-3 lg:col-span-2">
              <Switch checked={preferFavourites} onChange={setPreferFavourites} label="Suosi suosikkeja ja hyvin arvioituja" />
              <Switch checked={avoidRepeats} onChange={setAvoidRepeats} label="Ei samaa reseptiä kahdesti" />
              <Switch checked={catalogue} onChange={setIncludeCatalogue} label="Käytä koko reseptikatalogia" description={`Muuten vain omat reseptit (${ownCount}).`} />
              <Switch checked={replace} onChange={setReplace} label="Korvaa jo suunnitellut ateriat" description="Pois päältä: täytetään vain tyhjät." />
            </div>
          </div>
        )}
      </Card>

      {plan && opts && (
        <div className="space-y-5">
          {plan.warnings.length > 0 && (
            <Card className="border-warn/40 bg-warn-soft p-4 text-sm text-warn">
              {plan.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </Card>
          )}
          {saved && <Card className="border-brand/30 bg-brand-soft p-4 text-sm font-medium text-brand">Tallennettu ruokalistalle.</Card>}
          {plan.meals.length === 0 ? (
            <Card className="p-5 text-sm text-ink-2">
              Ei uusia aterioita: kaikki valitut ateriat on jo suunniteltu, tai ehdot ovat liian tiukat. Kokeile ”Säädä” → ”Korvaa jo suunnitellut ateriat” tai löysempiä ehtoja.
            </Card>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
              {[...opts.dates].sort().map((date) => {
                const dayMeals = plan.meals.filter((m) => m.date === date).sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
                const kcal = plan.kcalByDay[date] ?? 0
                return (
                  <Card key={date} className="min-w-0 p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
                      <h2 className="font-display text-lg font-semibold">{capitalize(weekdayName(date))} <span className="text-ink-2">{formatDate(date)}</span></h2>
                      <span className="tabular text-sm text-ink-2">≈ {formatNumber(kcal, 0)}{opts.maxKcalPerDay ? ` / ${opts.maxKcalPerDay}` : ''} kcal/hlö</span>
                    </div>
                    {opts.maxKcalPerDay ? <div className="mb-3"><MiniBar value={kcal} max={opts.maxKcalPerDay * 1.25} tone={kcalTone(kcal, opts.maxKcalPerDay)} tick={80} /></div> : null}
                    {dayMeals.length === 0 && <p className="text-sm text-muted">Ei uusia aterioita (jo suunniteltu tai ei sopivaa reseptiä).</p>}
                    <ul className="space-y-2">
                      {dayMeals.map((m) => {
                        const r = byId.get(m.recipeId) as Recipe | undefined
                        return (
                          <li key={m.slot} className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-2">
                            {r && <RecipeImage recipe={r} className="h-12 w-12 shrink-0" rounded="rounded-lg" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted">{SLOT_LABELS[m.slot]}</p>
                              <Link to={`/reseptit/${m.recipeId}`} target="_blank" className="line-clamp-2 text-sm font-medium leading-snug hyphens-auto [overflow-wrap:anywhere] hover:text-brand">{r?.title ?? '…'}</Link>
                              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                                ≈ {Math.round(m.kcalPerServing)} kcal/annos · {m.servings}{m.extraServings ? ` + ${m.extraServings}` : ''} annosta
                                {m.extraServings > 0 && <Badge tone="accent"><Soup size={11} /> tähteet huomiseksi</Badge>}
                                {m.leftoverOf && <Badge tone="brand"><Soup size={11} /> eilisen tähteet</Badge>}
                              </p>
                            </div>
                            {!saved && (
                              <button
                                className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink"
                                aria-label={`Vaihda ${SLOT_LABELS[m.slot].toLowerCase()} ${formatDate(date)}`}
                                title="Vaihda toiseen reseptiin"
                                onClick={() => setPlan(rerollMeal(plan, candidates, opts, date, m.slot, Date.now() % 100000))}
                              >
                                <Shuffle size={16} />
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="no-print fixed inset-x-0 bottom-[68px] z-20 flex justify-center gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">{saveBar}</div>
    </div>
  )
}
