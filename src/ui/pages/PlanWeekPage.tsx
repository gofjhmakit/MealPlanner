import { ArrowLeft, ArrowRight, CalendarCheck, RefreshCw, ShoppingCart, Shuffle, Soup, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { applyMealPlan, createShoppingList, mealItemsInRange } from '../../db/repo'
import { addDays, capitalize, formatDate, isoWeek, startOfWeek, today, weekdayName } from '../../domain/dates'
import { MEAL_SLOTS, type MealSlot, type Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { buildCandidates, planMeals, rerollMeal, type PlanOptions, type PlanResult } from '../../domain/weekPlanner'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { RecipeImage } from '../components/recipe'
import { Badge, Button, Card, Chip, cx, Field, ProgressBar, Select, Spinner, Stepper, Switch, TextInput } from '../components/ui'
import { SLOT_LABELS, useAllRecipes, useFavouriteIds } from '../hooks'

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
  const favourites = useFavouriteIds()
  const ownCount = (recipes ?? []).filter((r) => r.inCollection).length

  const [step, setStep] = useState(1)
  const [period, setPeriod] = useState<Period>('week')
  const thisWeek = startOfWeek(today(), settings.weekStartsOn)
  const [weekStart, setWeekStart] = useState(addDays(thisWeek, 7))
  const [day, setDay] = useState(addDays(today(), 1))
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [people, setPeople] = useState(settings.defaultServings)
  const [slots, setSlots] = useState<MealSlot[]>(['lunch', 'dinner'])
  const [leftovers, setLeftovers] = useState(true)
  const [diet, setDiet] = useState<PlanOptions['diet']>('all')
  const [glutenFree, setGlutenFree] = useState(false)
  const [milkFree, setMilkFree] = useState(false)
  const [lactoseFree, setLactoseFree] = useState(false)
  const [maxKcal, setMaxKcal] = useState('')
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

  const candidates = useMemo(() => (recipes ? buildCandidates(recipes, fineli, favourites) : []), [recipes, fineli, favourites])
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
    setStep(4)
    setBusy(false)
  }

  async function save() {
    if (!plan || !opts) return
    const n = await applyMealPlan(plan.meals, { replace, dates: opts.dates, slots: opts.slots })
    setSaved(true)
    toast(`${n} ateriaa lisätty ruokalistalle`)
  }

  async function shoppingList() {
    const sorted = [...dates].sort()
    const name = period === 'week' ? `Viikko ${isoWeek(sorted[0])} (${formatDate(sorted[0])}–${formatDate(sorted.at(-1)!)})` : `${capitalize(weekdayName(sorted[0]))} ${formatDate(sorted[0])}`
    const id = await createShoppingList(sorted[0], sorted.at(-1)!, name, fineli)
    navigate(`/ostoslista?lista=${id}`)
  }

  if (!recipes) return <Spinner />

  const canNext1 = dates.length > 0 && slots.length > 0

  return (
    <div className="fade-in">
      <Link to="/ruokalista" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> Ruokalista</Link>
      <PageHeader
        title={period === 'week' ? 'Suunnittele viikkoni' : 'Suunnittele päiväni'}
        subtitle="Vastaa muutamaan kysymykseen, niin ehdotan ruokalistan resepteistäsi. Voit vaihtaa yksittäisiä aterioita ennen tallennusta."
      />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Vaiheet">
        {['Ajankohta ja henkilöt', 'Ruokavalio ja tavoitteet', 'Toiveet', 'Ehdotus'].map((label, i) => (
          <li key={label} className={cx('flex items-center gap-2 rounded-full px-3 py-1', step === i + 1 ? 'bg-brand text-white dark:text-canvas' : step > i + 1 ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-muted')}>
            <span className="tabular font-semibold">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="space-y-6 p-5">
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">Mitä suunnitellaan?</p>
            <div className="flex gap-2">
              <Chip active={period === 'week'} onClick={() => setPeriod('week')}>Viikko</Chip>
              <Chip active={period === 'day'} onClick={() => setPeriod('day')}>Yksi päivä</Chip>
            </div>
          </div>
          {period === 'week' ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-ink-2">Mikä viikko?</p>
              <div className="flex flex-wrap items-center gap-2">
                <Chip active={weekStart === thisWeek} onClick={() => setWeekStart(thisWeek)}>Tämä viikko ({isoWeek(thisWeek)})</Chip>
                <Chip active={weekStart === addDays(thisWeek, 7)} onClick={() => setWeekStart(addDays(thisWeek, 7))}>Ensi viikko ({isoWeek(addDays(thisWeek, 7))})</Chip>
                <TextInput type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(startOfWeek(e.target.value, settings.weekStartsOn))} className="max-w-44" aria-label="Viikon alku" />
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Päivät">
                {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => (
                  <Chip key={d} active={weekdays.includes(i)} onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}>
                    {capitalize(weekdayName(d, true))} {formatDate(d)}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            <Field label="Mikä päivä?">
              <TextInput type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="max-w-44" />
            </Field>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-2">Monelleko ruokaa tehdään?</p>
              <p className="text-xs text-muted">Annosmäärä jokaiselle aterialle.</p>
            </div>
            <Stepper value={people} onChange={setPeople} min={1} max={20} label="Henkilöt" suffix="hlö" />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">Mitkä ateriat suunnitellaan?</p>
            <div className="flex flex-wrap gap-2">
              {MEAL_SLOTS.filter((s) => s !== 'other').map((s) => (
                <Chip key={s} active={slots.includes(s)} onClick={() => setSlots((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{SLOT_LABELS[s]}</Chip>
              ))}
            </div>
          </div>
          <Switch
            checked={leftovers && leftoverPossible}
            onChange={setLeftovers}
            disabled={!leftoverPossible}
            label="Syödään eilisen päivällisen tähteet seuraavan päivän lounaaksi"
            description={
              leftoverPossible
                ? `Päivällinen tehdään ${people * 2} annokselle: ${people} syödään heti ja ${people} seuraavana päivänä lounaaksi.`
                : 'Vaatii vähintään kaksi päivää sekä lounaan ja päivällisen.'
            }
          />
          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} disabled={!canNext1} icon={<ArrowRight size={16} />}>Seuraava</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-6 p-5">
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">Ruokavalio</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={diet === 'all'} onClick={() => setDiet('all')}>Kaikki käy</Chip>
              <Chip active={diet === 'vegetarian'} onClick={() => setDiet('vegetarian')}>Kasvis</Chip>
              <Chip active={diet === 'vegan'} onClick={() => setDiet('vegan')}>Vegaaninen</Chip>
              <span className="mx-1 w-px bg-line" />
              <Chip active={glutenFree} onClick={() => setGlutenFree((v) => !v)}>Gluteeniton*</Chip>
              <Chip active={milkFree} onClick={() => setMilkFree((v) => !v)}>Maidoton*</Chip>
              <Chip active={lactoseFree} onClick={() => setLactoseFree((v) => !v)}>Laktoositon*</Chip>
            </div>
            <p className="mt-1 text-xs text-muted">* Arvio Finelin ja omien tuotteiden tietojen perusteella – tarkista pakkausmerkinnät allergioissa.</p>
          </div>
          <Field
            label="Päivän kalorimaksimi / henkilö (valinnainen)"
            hint={
              <>
                Suunnitelma pyrkii pysymään tämän alla (yksi annos jokaisesta ateriasta).{' '}
                {settings.targets.energyKcal ? (
                  <button className="text-brand underline" onClick={() => setMaxKcal(String(settings.targets.energyKcal))}>Käytä tavoitettasi {settings.targets.energyKcal} kcal</button>
                ) : null}
              </>
            }
          >
            <div className="flex items-center gap-2">
              <TextInput inputMode="numeric" value={maxKcal} onChange={(e) => setMaxKcal(e.target.value)} placeholder="esim. 2000" className="w-40" />
              <span className="text-sm text-muted">kcal</span>
            </div>
            {maxKcal.trim() && !kcalLimit && <p className="mt-1 text-xs text-warn">Anna vähintään 800 kcal.</p>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valmistusaika arkena">
              <Select value={timeWeekday} onChange={(e) => setTimeWeekday(e.target.value)} className="w-full">
                {TIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Valmistusaika viikonloppuna">
              <Select value={timeWeekend} onChange={(e) => setTimeWeekend(e.target.value)} className="w-full">
                {TIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)} icon={<ArrowLeft size={16} />}>Edellinen</Button>
            <Button onClick={() => setStep(3)} icon={<ArrowRight size={16} />}>Seuraava</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-5 p-5">
          <Field label="Käytä nämä ainekset (valinnainen)" hint="Pilkulla erotettuna, esim. ”broileri, kesäkurpitsa” – suositaan reseptejä, joissa näitä on.">
            <TextInput value={use} onChange={(e) => setUse(e.target.value)} />
          </Field>
          <Field label="Vältä näitä (valinnainen)" hint="Esim. ”sieni, katkarapu” – reseptit, joissa näitä on, jätetään pois.">
            <TextInput value={avoid} onChange={(e) => setAvoid(e.target.value)} />
          </Field>
          <Switch checked={preferFavourites} onChange={setPreferFavourites} label="Suosi suosikkeja ja hyvin arvioituja" description="Omat 1–2 tähden arviot jätetään aina pois." />
          <Switch checked={avoidRepeats} onChange={setAvoidRepeats} label="Ei samaa reseptiä kahdesti" description="Tähteet eivät lasketa toistoksi." />
          <Switch
            checked={catalogue}
            onChange={setIncludeCatalogue}
            label="Käytä myös reseptikatalogia"
            description={`Sinulla on ${ownCount} omaa reseptiä. Katalogissa on tuhansia suomennettuja reseptejä; valmistusohjeelliset suositaan.`}
          />
          <Switch checked={replace} onChange={setReplace} label="Korvaa jo suunnitellut ateriat" description="Pois päältä: täytetään vain tyhjät ateriat." />
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} icon={<ArrowLeft size={16} />}>Edellinen</Button>
            <Button onClick={() => generate()} disabled={busy} icon={<Sparkles size={16} />}>Luo ehdotus</Button>
          </div>
        </Card>
      )}

      {step === 4 && plan && opts && (
        <div className="space-y-5">
          {plan.warnings.length > 0 && (
            <Card className="border-warn/40 bg-warn-soft p-4 text-sm text-warn">
              {plan.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </Card>
          )}
          {plan.meals.length === 0 ? (
            <Card className="p-5 text-sm text-ink-2">
              Ehdotusta ei voitu tehdä valituilla ehdoilla (tai kaikki ateriat on jo suunniteltu). Kokeile löysempiä ehtoja, salli katalogi tai valitse ”Korvaa jo suunnitellut ateriat”.
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...opts.dates].sort().map((date) => {
                const dayMeals = plan.meals.filter((m) => m.date === date).sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
                const kcal = plan.kcalByDay[date] ?? 0
                return (
                  <Card key={date} className="min-w-0 p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
                      <h2 className="font-display text-lg font-semibold">{capitalize(weekdayName(date))} <span className="text-ink-2">{formatDate(date)}</span></h2>
                      <span className="tabular text-sm text-ink-2">≈ {formatNumber(kcal, 0)}{opts.maxKcalPerDay ? ` / ${opts.maxKcalPerDay}` : ''} kcal/hlö</span>
                    </div>
                    {opts.maxKcalPerDay ? <div className="mb-3"><ProgressBar value={kcal} max={opts.maxKcalPerDay} tone="accent" label="Kalorit maksimista" /></div> : null}
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
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(3)} icon={<ArrowLeft size={16} />}>Muuta vastauksia</Button>
            <div className="flex flex-wrap gap-2">
              {!saved ? (
                <>
                  <Button variant="secondary" onClick={() => generate()} icon={<RefreshCw size={16} />}>Uusi ehdotus</Button>
                  <Button onClick={save} disabled={plan.meals.length === 0} icon={<CalendarCheck size={16} />}>Tallenna ruokalistalle</Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={shoppingList} icon={<ShoppingCart size={16} />}>Luo ostoslista</Button>
                  <Link to="/ruokalista"><Button icon={<CalendarCheck size={16} />}>Avaa ruokalista</Button></Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
