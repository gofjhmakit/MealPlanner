import { ChevronLeft, ChevronRight, PieChart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { addDays, capitalize, daysBetween, formatDate, isoWeek, startOfWeek, today, weekdayName } from '../../domain/dates'
import { combineNutrition, emptyNutrients, NUTRIENT_INFO, scaleNutrients } from '../../domain/nutrition'
import { MEAL_SLOTS, type Nutrients } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { EstimateNote, NutritionSummary } from '../components/recipe'
import { Button, Card, cx, EmptyState, IconButton, ProgressBar, SectionTitle, Spinner } from '../components/ui'
import { SLOT_LABELS, useMealItems, usePlanNutrition, useRecipesById } from '../hooks'

export function NutritionPage() {
  const { settings } = useApp()
  const [params, setParams] = useSearchParams()
  const focusDay = params.get('paiva')
  const [anchor, setAnchor] = useState(focusDay ?? today())
  const from = startOfWeek(anchor, settings.weekStartsOn)
  const to = addDays(from, 6)
  const days = useMemo(() => daysBetween(from, to), [from, to])
  const items = useMealItems(from, to)
  const recipes = useRecipesById((items ?? []).map((i) => i.recipeId))
  const [mode, setMode] = useState<'person' | 'household'>('person')
  const nutrition = usePlanNutrition(items, recipes, mode)
  const selected = focusDay && focusDay >= from && focusDay <= to ? focusDay : null

  const plannedDays = days.filter((d) => nutrition?.byDay.has(d))
  const average = useMemo(() => {
    if (!nutrition || plannedDays.length === 0) return null
    return scaleNutrients(nutrition.total.nutrients, 1 / plannedDays.length)
  }, [nutrition, plannedDays.length])
  const targets = settings.targets

  if (!items || !nutrition) return <Spinner />

  return (
    <div className="fade-in">
      <PageHeader
        title="Ravintosisältö"
        subtitle={mode === 'person' ? 'Arvioitu ravintosisältö yhdelle henkilölle: yksi annos jokaisesta suunnitellusta ateriasta.' : 'Arvioitu ravintosisältö kaikille suunnitelluille annoksille yhteensä.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-surface-2 p-1 text-sm">
            {(['person', 'household'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx('rounded-lg px-3 py-1.5 font-medium', mode === m ? 'bg-surface shadow-sm' : 'text-ink-2')}>
                {m === 'person' ? 'Henkilöä kohden' : 'Koko talous'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Edellinen viikko" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft size={18} /></IconButton>
            <span className="min-w-[10rem] text-center text-sm font-medium">Viikko {isoWeek(from)} · {formatDate(from)}–{formatDate(to)}</span>
            <IconButton label="Seuraava viikko" onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight size={18} /></IconButton>
          </div>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<PieChart size={32} />} title="Tälle viikolle ei ole suunniteltu aterioita" action={<Link to="/ruokalista"><Button>Siirry ruokalistaan</Button></Link>} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle>Keskimäärin päivässä</SectionTitle>
              {average && <NutritionSummary nutrients={average} targets={mode === 'person' ? targets : undefined} />}
              <p className="mt-3 text-xs text-muted">Keskiarvo {plannedDays.length} päivästä, joille on suunniteltu aterioita.</p>
              {!targets.energyKcal && (
                <p className="mt-1 text-xs text-muted">Aseta halutessasi omat päivätavoitteet <Link className="underline" to="/asetukset">asetuksissa</Link>.</p>
              )}
            </Card>
            <Card className="p-5">
              <SectionTitle>Viikko yhteensä</SectionTitle>
              <NutritionSummary nutrients={nutrition.total.nutrients} />
              <EnergySplit nutrients={nutrition.total.nutrients} />
              <EstimateNote coverage={nutrition.total.coverage} className="mt-4" />
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-display text-lg font-semibold">Päivittäin</h2>
            </div>
            <ul className="divide-y divide-line">
              {days.map((d) => {
                const n = nutrition.byDay.get(d)
                const isSel = selected === d
                return (
                  <li key={d}>
                    <button
                      onClick={() => setParams(isSel ? {} : { paiva: d })}
                      className={cx('grid w-full grid-cols-[7rem_1fr] items-center gap-4 px-5 py-3 text-left hover:bg-surface-2 sm:grid-cols-[8rem_1fr_repeat(4,4.5rem)]', isSel && 'bg-brand-soft/50')}
                      aria-expanded={isSel}
                    >
                      <span>
                        <span className="block font-medium">{capitalize(weekdayName(d))}</span>
                        <span className="text-xs text-muted">{formatDate(d)}</span>
                      </span>
                      {n ? (
                        <>
                          <span>
                            <span className="tabular text-sm font-medium">{formatNumber(Math.round(n.nutrients.energyKcal), 0)} kcal</span>
                            {targets.energyKcal && mode === 'person' ? <span className="mt-1 block"><ProgressBar value={n.nutrients.energyKcal} max={targets.energyKcal} tone="accent" /></span> : null}
                          </span>
                          <Macro label="P" value={n.nutrients.protein} />
                          <Macro label="HH" value={n.nutrients.carbohydrate} />
                          <Macro label="R" value={n.nutrients.fat} />
                          <Macro label="K" value={n.nutrients.fibre} />
                        </>
                      ) : (
                        <span className="text-sm text-muted">Ei suunniteltuja aterioita</span>
                      )}
                    </button>
                    {isSel && n && <DayDetail day={d} items={items} recipes={recipes!} nutrition={nutrition} targets={mode === 'person' ? targets : {}} />}
                  </li>
                )
              })}
            </ul>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">P = proteiini, HH = hiilihydraatit, R = rasva, K = kuitu (grammoina). Napauta päivää nähdäksesi aterioittaisen erittelyn.</p>
          </Card>
        </div>
      )}
    </div>
  )
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <span className="tabular hidden text-right text-sm sm:block">
      <span className="text-muted">{label} </span>
      {formatNumber(value, 0)} g
    </span>
  )
}

/** Share of energy from protein / carbohydrate / fat (4/4/9 kcal per g). */
function EnergySplit({ nutrients }: { nutrients: Nutrients }) {
  const p = nutrients.protein * 4
  const c = nutrients.carbohydrate * 4
  const f = nutrients.fat * 9
  const total = p + c + f
  if (total <= 0) return null
  const parts = [
    { label: 'Proteiini', value: p, cls: 'bg-protein' },
    { label: 'Hiilihydraatit', value: c, cls: 'bg-carb' },
    { label: 'Rasva', value: f, cls: 'bg-fat' },
  ]
  return (
    <div className="mt-5">
      <p className="mb-2 text-sm text-ink-2">Energian jakauma</p>
      <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={parts.map((x) => `${x.label} ${Math.round((x.value / total) * 100)} %`).join(', ')}>
        {parts.map((x) => (
          <div key={x.label} className={x.cls} style={{ width: `${(x.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {parts.map((x) => (
          <span key={x.label} className="flex items-center gap-1.5">
            <span className={cx('h-2 w-2 rounded-full', x.cls)} /> {x.label} {Math.round((x.value / total) * 100)} %
          </span>
        ))}
      </div>
    </div>
  )
}

function DayDetail({
  day,
  items,
  recipes,
  nutrition,
  targets,
}: {
  day: string
  items: import('../../domain/types').MealItem[]
  recipes: Map<string, import('../../domain/types').Recipe>
  nutrition: import('../hooks').PlanNutrition
  targets: import('../../domain/types').NutritionTargets
}) {
  const dayItems = items.filter((i) => i.date === day)
  const n = nutrition.byDay.get(day) ?? { nutrients: emptyNutrients(), coverage: combineNutrition([]).coverage }
  const extra: (keyof Nutrients)[] = ['sugars', 'saturatedFat', 'salt', 'sodium', 'calcium', 'iron', 'vitaminC', 'vitaminD']
  return (
    <div className="grid gap-6 border-t border-line bg-surface-2/30 px-5 py-5 lg:grid-cols-2">
      <div>
        <NutritionSummary nutrients={n.nutrients} targets={targets} />
        <table className="mt-4 w-full text-sm">
          <tbody className="divide-y divide-line">
            {extra.map((k) => (
              <tr key={k}>
                <td className="py-1.5 text-ink-2">{NUTRIENT_INFO[k].label}</td>
                <td className="tabular py-1.5 text-right">
                  {formatNumber(n.nutrients[k], NUTRIENT_INFO[k].decimals)} {NUTRIENT_INFO[k].unit}
                  {k === 'salt' && targets.salt ? <span className="text-muted"> / {formatNumber(targets.salt, 1)} g</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <EstimateNote coverage={n.coverage} className="mt-3" />
      </div>
      <div className="space-y-3">
        {MEAL_SLOTS.map((slot) => {
          const slotItems = dayItems.filter((i) => i.slot === slot)
          if (!slotItems.length) return null
          const sn = nutrition.byDaySlot.get(`${day}|${slot}`)
          return (
            <div key={slot} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{SLOT_LABELS[slot]}</p>
                {sn && <p className="tabular text-sm text-ink-2">{formatNumber(Math.round(sn.nutrients.energyKcal), 0)} kcal</p>}
              </div>
              <ul className="mt-1 space-y-1 text-sm">
                {slotItems.map((i) => {
                  if (!i.recipeId) return <li key={i.id} className="text-muted">{i.note} <span className="text-xs">(ei ravintotietoja)</span></li>
                  const r = recipes.get(i.recipeId)
                  const inn = nutrition.byItem.get(i.id)
                  return (
                    <li key={i.id} className="flex justify-between gap-3">
                      <Link to={`/reseptit/${i.recipeId}`} className="min-w-0 hyphens-auto [overflow-wrap:anywhere] hover:text-brand">
                        {r?.title ?? 'Poistettu resepti'} <span className="text-muted">· {formatNumber(i.servings, 1)} annosta</span>
                      </Link>
                      {inn && (
                        <span className="tabular shrink-0 text-muted">
                          {Math.round(inn.nutrients.energyKcal)} kcal · P {formatNumber(inn.nutrients.protein, 0)} g
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
