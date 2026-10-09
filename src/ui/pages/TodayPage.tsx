/**
 * Tänään – the day cockpit (Draft 1). Answers "what now, and is it enough?":
 * a timeline of today's meals (eaten → now → still empty), the day against the goal, and the
 * next things to do. Phones: one column. 1024+: two columns. 1280+: three. 1920+: four, with the month.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Check, ChefHat, Fish, Leaf, Plus, Scale, ShoppingCart, Sparkles, Timer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { db } from '../../db/db'
import { ROLLING_LIST_ID, saveUserSettings, setMealStatus } from '../../db/repo'
import { addDays, capitalize, formatDate, isoWeek, parseISODate, startOfWeek, today, weekdayName } from '../../domain/dates'
import { pantryMatcher } from '../../domain/shoppingList'
import { scaleIngredient } from '../../domain/scaling'
import { MAIN_SLOTS, SLOT_TIMES, slotPassed } from '../../domain/today'
import type { MealItem, MealSlot, Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { quickPlanOptions, slotShare, suggestForSlot, type Candidate } from '../../domain/weekPlanner'
import { useApp, useToast } from '../AppContext'
import { useCommand } from '../command'
import { PageHeader } from '../components/Layout'
import { MealSheet } from '../components/MealSheet'
import { Button, cx } from '../components/ui'
import { dayTone, GoalRing, kcalTone, MealThumb, MiniBar, Panel, Segmented } from '../components/v2'
import { SLOT_LABELS, useMealItems, usePlanNutrition, useRecipesById, type PlanNutrition } from '../hooks'
import { addToSlot, fillEmptySlots } from '../planActions'
import { useCandidates, useHousehold } from '../planning'

const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, other: 4 }

/** Nordic reference intakes for adults (rough, for a weekly "arvio" only). */
const REFERENCES = [
  { key: 'vitaminD', label: 'D-vitamiini', ref: 10, unit: 'µg' },
  { key: 'folate', label: 'Folaatti', ref: 330, unit: 'µg' },
  { key: 'iron', label: 'Rauta', ref: 12, unit: 'mg' },
  { key: 'calcium', label: 'Kalsium', ref: 950, unit: 'mg' },
] as const

export function TodayPage() {
  const { settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const command = useCommand()
  const { servings, kcalTarget, proteinTarget, fibreTarget, me } = useHousehold()
  const candidates = useCandidates()
  const t = today()
  const hour = new Date().getHours()
  const from = addDays(t, -13)
  const to = addDays(t, 20)
  const items = useMealItems(from, to)
  const recipes = useRecipesById((items ?? []).map((i) => i.recipeId))
  const nutrition = usePlanNutrition(items, recipes)
  const [sheet, setSheet] = useState<string | null>(null)

  const todayItems = useMemo(() => (items ?? []).filter((i) => i.date === t).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.position - b.position), [items, t])
  const kcalOf = (i: MealItem) => nutrition?.byItem.get(i.id)?.nutrients.energyKcal ?? 0
  const eaten = (i: MealItem) => i.status === 'eaten' || (i.status !== 'skipped' && slotPassed(i.slot, hour))
  const counted = todayItems.filter((i) => i.status !== 'skipped')
  const doneKcal = counted.filter(eaten).reduce((s, i) => s + kcalOf(i), 0)
  const plannedKcal = counted.filter((i) => !eaten(i)).reduce((s, i) => s + kcalOf(i), 0)
  const dayNutrients = (date: string) => {
    let kcal = 0, protein = 0, fibre = 0
    for (const i of (items ?? []).filter((x) => x.date === date && x.status !== 'skipped')) {
      const n = nutrition?.byItem.get(i.id)?.nutrients
      if (!n) continue
      kcal += n.energyKcal
      protein += n.protein
      fibre += n.fibre
    }
    return { kcal, protein, fibre }
  }
  const todayN = dayNutrients(t)
  const hasAny = (items ?? []).length > 0
  const sheetItem = sheet ? ((items ?? []).find((i) => i.id === sheet) ?? null) : null

  const greeting = hour < 5 ? 'Hyvää yötä' : hour < 10 ? 'Huomenta' : hour < 17 ? 'Päivää' : 'Iltaa'
  const weekStart = startOfWeek(t, settings.weekStartsOn)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const remaining = weekDays.filter((d) => d >= t)

  async function fillWeek(dates: string[], label: string) {
    if (!candidates) return
    const { added, undo } = await fillEmptySlots(candidates, dates, { servings, kcalTarget })
    toast(added ? `${label}: lisättiin ${added} ateriaa` : 'Ei tyhjiä aterioita', 'ok', added ? { label: 'Kumoa', onClick: undo } : undefined)
  }

  const header = (
    <PageHeader
      eyebrow={`${capitalize(weekdayName(t))} ${formatDate(t)} · viikko ${isoWeek(t)}`}
      title={`${greeting}${me ? `, ${me.name}` : ''}`}
      actions={
        <>
          <Button variant="secondary" onClick={() => window.print()}>Tulosta päivä</Button>
          <Button icon={<Sparkles size={16} />} onClick={() => fillWeek(Array.from({ length: 7 }, (_, i) => addDays(weekStart, 7 + i)), 'Ensi viikko')} disabled={!candidates}>
            Täytä ensi viikko
          </Button>
        </>
      }
      mobileActions={null}
    />
  )

  if (items && !hasAny) {
    return (
      <div className="fade-in">
        {header}
        {!settings.onboarded && <OnboardingNudge />}
        <Panel className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Sparkles size={26} /></div>
          <h2 className="font-display text-2xl font-semibold">Tyhjä viikko – täytetäänkö?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
            Ehdotan aamiaiset, lounaat ja päivälliset tästä päivästä viikon loppuun{kcalTarget ? ` noin ${formatNumber(kcalTarget, 0)} kcal päivätavoitteeseesi` : ''}. Voit vaihtaa minkä tahansa aterian yhdellä napautuksella.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button size="lg" icon={<Sparkles size={18} />} disabled={!candidates} onClick={() => fillWeek(remaining, 'Viikko')}>
              {candidates ? 'Täytä viikko puolestani' : 'Ladataan reseptejä…'}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigate('/viikko/suunnittele')}>Säädä ensin</Button>
          </div>
          <button onClick={() => command.open('tänään ')} className="mt-4 text-sm font-medium text-brand hover:underline">tai valitse itse ateria tälle päivälle</button>
        </Panel>
      </div>
    )
  }

  const ring = (
    <DayRing doneKcal={doneKcal} plannedKcal={plannedKcal} target={kcalTarget} protein={todayN.protein} proteinTarget={proteinTarget} fibre={todayN.fibre} fibreTarget={fibreTarget} todayItems={todayItems} hour={hour} />
  )

  return (
    <div className="fade-in">
      {header}
      {!settings.onboarded && <OnboardingNudge />}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(0,0.92fr)] 3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] 3xl:gap-6">
        {/* Column 1: the day */}
        <div className="space-y-5 lg:row-span-2 xl:row-span-1">
          <div className="lg:hidden">{ring}</div>
          <Timeline
            items={todayItems}
            recipes={recipes}
            kcalOf={kcalOf}
            hour={hour}
            candidates={candidates}
            remainingKcal={kcalTarget ? kcalTarget - doneKcal - plannedKcal : null}
            servings={servings}
            onOpen={setSheet}
            onPickOther={(slot) => command.open(`tänään ${SLOT_LABELS[slot].toLowerCase()} `)}
          />
          <Upcoming items={items ?? []} recipes={recipes} nutrition={nutrition} t={t} kcalTarget={kcalTarget} onFill={(d) => fillWeek([d], capitalize(weekdayName(d)))} />
        </div>

        {/* Column 2: is it enough? */}
        <div className="space-y-5">
          <div className="hidden lg:block">{ring}</div>
          <TrendChart days={Array.from({ length: 14 }, (_, i) => addDays(t, i - 9))} t={t} dayNutrients={dayNutrients} kcalTarget={kcalTarget} proteinTarget={proteinTarget} fibreTarget={fibreTarget} />
          <WeekBalance weekDays={weekDays} t={t} items={items ?? []} recipes={recipes} candidates={candidates} />
          <Micronutrients days={weekDays} nutrition={nutrition} />
        </div>

        {/* Column 3: what to do next */}
        <div className="space-y-5 lg:col-start-2 xl:col-start-auto">
          <TonightCard items={todayItems} recipes={recipes} pantry={settings.pantry} hour={hour} />
          <SnackIdeas candidates={candidates} t={t} items={todayItems} remainingKcal={kcalTarget ? kcalTarget - doneKcal - plannedKcal : null} servings={servings} proteinGap={proteinTarget ? proteinTarget - todayN.protein : null} />
          <ShoppingCard />
          <WeightCard />
        </div>

        {/* Column 4 (1920+): the month */}
        <div className="hidden space-y-5 3xl:block">
          <MonthCard t={t} items={items ?? []} dayNutrients={dayNutrients} kcalTarget={kcalTarget} weekStartsOn={settings.weekStartsOn} />
        </div>
      </div>
      <MealSheet item={sheetItem} recipe={sheetItem?.recipeId ? recipes?.get(sheetItem.recipeId) : undefined} kcal={sheetItem ? kcalOf(sheetItem) || null : null} dayKcal={sheetItem ? dayNutrients(sheetItem.date).kcal : 0} onClose={() => setSheet(null)} />
      <p className="mt-8 text-xs text-muted">
        Kalorit ja ravintoaineet ovat arvioita yhdelle henkilölle (yksi annos kustakin ateriasta, Fineli).{' '}
        <Link to="/profiili" className="underline">Tavoitteet</Link> eivät ole lääketieteellinen ohje.
      </p>
    </div>
  )
}

function OnboardingNudge() {
  return (
    <Link to="/aloitus" className="mb-5 flex items-center gap-4 rounded-[22px] border border-brand/30 bg-brand-soft/60 p-4 transition hover:bg-brand-soft">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-on-brand"><Sparkles size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Kerro kenelle kokkaat ja mihin tähtäät</span>
        <span className="block text-sm text-ink-2">Puolen minuutin asetus: annoskoot, ostosmäärät ja päivätavoite osuvat kohdalleen.</span>
      </span>
      <ArrowRight size={18} className="shrink-0 text-brand" />
    </Link>
  )
}

function DayRing({ doneKcal, plannedKcal, target, protein, proteinTarget, fibre, fibreTarget, todayItems, hour }: { doneKcal: number; plannedKcal: number; target: number | null; protein: number; proteinTarget: number | null; fibre: number; fibreTarget: number | null; todayItems: MealItem[]; hour: number }) {
  const total = doneKcal + plannedKcal
  const left = target ? target - total : null
  const next = todayItems.find((i) => i.status !== 'eaten' && i.status !== 'skipped' && !slotPassed(i.slot, hour))
  let message: React.ReactNode
  if (!target) message = <><b>{formatNumber(total, 0)} kcal</b> suunniteltu tälle päivälle. <Link className="text-brand underline" to="/profiili">Aseta tavoite</Link>, niin näet riittääkö se.</>
  else if (left !== null && left > target * 0.15) message = <>{next ? `${SLOT_LABELS[next.slot]}n jälkeen` : 'Suunnitelluilla aterioilla'} <b className="text-brand">{formatNumber(left, 0)} kcal</b> jää vielä – {hour < 19 ? 'tilaa iltapalalle' : 'kevyt iltapala sopii'}.</>
  else if (left !== null && left < -target * 0.1) message = <>Päivä menee noin <b className="text-accent">{formatNumber(-left, 0)} kcal</b> yli tavoitteen.</>
  else message = <>Päivä osuu tavoitteeseen <b className="text-brand">±{formatNumber(Math.abs(left ?? 0), 0)} kcal</b>. Hyvä!</>
  return (
    <Panel className="flex items-center gap-5">
      <GoalRing
        done={doneKcal}
        planned={plannedKcal}
        target={target}
        size={128}
        label={
          <>
            <span className="tabular font-display text-[1.9rem] font-semibold leading-none">{formatNumber(total, 0)}</span>
            <span className="mt-1 text-xs text-muted">{target ? `/ ${formatNumber(target, 0)} kcal` : 'kcal'}</span>
          </>
        }
      />
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-sm leading-snug text-ink-2">{message}</p>
        <NutrientRow label="Proteiini" value={protein} target={proteinTarget} unit="g" tone="protein" />
        <NutrientRow label="Kuitu" value={fibre} target={fibreTarget} unit="g" tone="sun" />
      </div>
    </Panel>
  )
}

function NutrientRow({ label, value, target, unit, tone }: { label: string; value: number; target: number | null; unit: string; tone: 'protein' | 'sun' | 'fibre' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted">
          {formatNumber(value, 0)}
          {target ? ` / ${formatNumber(target, 0)}` : ''} {unit}
        </span>
      </div>
      <MiniBar value={value} max={target ?? Math.max(value, 1)} tone={tone} />
    </div>
  )
}

function Timeline({
  items, recipes, kcalOf, hour, candidates, remainingKcal, servings, onOpen, onPickOther,
}: {
  items: MealItem[]
  recipes: Map<string, Recipe> | undefined
  kcalOf: (i: MealItem) => number
  hour: number
  candidates: Candidate[] | undefined
  remainingKcal: number | null
  servings: number
  onOpen: (id: string) => void
  onPickOther: (slot: MealSlot) => void
}) {
  const toast = useToast()
  const t = today()
  const usedIds = new Set(items.map((i) => i.recipeId).filter(Boolean) as string[])
  const current = MAIN_SLOTS.find((s) => !slotPassed(s, hour) && items.some((i) => i.slot === s && i.status !== 'eaten' && i.status !== 'skipped'))
  const { kcalTarget } = useHousehold()
  return (
    <ol className="relative space-y-2.5" aria-label="Tämän päivän ateriat">
      <span aria-hidden className="absolute bottom-6 left-[11px] top-6 w-[2px] rounded bg-line" />
      {MAIN_SLOTS.map((slot) => {
        const slotItems = items.filter((i) => i.slot === slot)
        const passed = slotPassed(slot, hour)
        if (slotItems.length === 0) {
          if (slot === 'snack' && passed) return null
          return (
            <EmptySlot
              key={slot}
              slot={slot}
              passed={passed}
              candidates={candidates}
              budget={remainingKcal !== null && kcalTarget ? Math.max(150, Math.min(remainingKcal, kcalTarget * slotShare(slot) * 1.3)) : null}
              exclude={usedIds}
              servings={servings}
              onAdd={async (c) => {
                const undo = await addToSlot(c.recipe.id, t, slot, servings)
                toast(`${c.recipe.title} → ${SLOT_LABELS[slot].toLowerCase()}`, 'ok', { label: 'Kumoa', onClick: undo })
              }}
              onOther={() => onPickOther(slot)}
            />
          )
        }
        return slotItems.map((item) => {
          const recipe = item.recipeId ? recipes?.get(item.recipeId) : undefined
          const done = item.status === 'eaten' || (item.status !== 'skipped' && passed)
          const isCurrent = slot === current && !done
          const kcal = kcalOf(item)
          return (
            <li key={item.id} className="relative flex items-start gap-3">
              <button
                onClick={() => setMealStatus(item.id, item.status === 'eaten' ? null : 'eaten')}
                aria-label={item.status === 'eaten' ? `Merkitse syömättömäksi: ${recipe?.title ?? ''}` : `Merkitse syödyksi: ${recipe?.title ?? ''}`}
                className={cx(
                  'relative z-10 mt-5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition',
                  item.status === 'skipped' ? 'border-line bg-surface' : done ? 'border-brand bg-brand text-on-brand' : isCurrent ? 'border-accent bg-surface' : 'border-line bg-surface hover:border-brand',
                )}
              >
                {done && item.status !== 'skipped' && <Check size={13} strokeWidth={3} />}
              </button>
              <div className={cx('min-w-0 flex-1 rounded-[20px] border bg-surface transition', isCurrent ? 'border-accent shadow-[0_6px_20px_rgb(238_106_72/0.15)]' : 'border-line', item.status === 'skipped' && 'opacity-55')}>
                <button onClick={() => onOpen(item.id)} className="flex w-full items-center gap-3 p-3 text-left">
                  <MealThumb recipe={recipe} size={52} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[11px] font-semibold uppercase tracking-[0.08em]', isCurrent ? 'text-accent' : 'text-muted')}>
                      {SLOT_LABELS[slot]}
                      {item.status === 'skipped' ? ' · väliin' : done ? ' · syöty' : isCurrent ? ` · aloita ${SLOT_TIMES[slot]}` : ''}
                      {item.leftoverOfId ? ' · tähteet' : ''}
                    </span>
                    <span className="block truncate font-medium">{recipe?.title ?? item.note ?? 'Ateria'}</span>
                    {isCurrent && recipe && (
                      <span className="block text-xs text-muted">
                        {[recipe.totalTimeMin ? `${recipe.totalTimeMin} min` : null, `${formatNumber(item.servings, 1)} annosta`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {kcal > 0 && (
                    <span className="tabular shrink-0 text-right text-sm font-semibold leading-tight">
                      {formatNumber(kcal, 0)}
                      <span className="block text-[11px] font-normal text-muted">kcal</span>
                    </span>
                  )}
                </button>
                {isCurrent && recipe && (
                  <div className="flex gap-2 px-3 pb-3">
                    <Link to={`/reseptit/${recipe.id}?kokkaa=1&annokset=${item.servings + (item.extraServings ?? 0)}`} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-on-brand">
                      <ChefHat size={16} /> Aloita kokkaus
                    </Link>
                    <button onClick={() => onOpen(item.id)} className="h-10 rounded-xl border border-line px-4 text-sm font-medium hover:bg-surface-2">Vaihda</button>
                  </div>
                )}
              </div>
            </li>
          )
        })
      })}
    </ol>
  )
}

function EmptySlot({ slot, passed, candidates, budget, exclude, onAdd, onOther }: { slot: MealSlot; passed: boolean; candidates: Candidate[] | undefined; budget: number | null; exclude: Set<string>; servings: number; onAdd: (c: Candidate) => void; onOther: () => void }) {
  const t = today()
  const suggestion = useMemo(() => {
    if (!candidates || passed) return null
    return suggestForSlot(candidates, quickPlanOptions({ dates: [t], people: 1, maxKcalPerDay: null, seed: 3 }), t, slot, budget, exclude, 1)[0] ?? null
  }, [candidates, passed, t, slot, budget, exclude])
  return (
    <li className="relative flex items-start gap-3">
      <span className="relative z-10 mt-5 h-6 w-6 shrink-0 rounded-full border-2 border-dashed border-line bg-canvas" />
      <div className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-[20px] border border-dashed p-3', passed ? 'border-line/70 opacity-60' : 'border-line')}>
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-sun-soft text-warn"><Plus size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{SLOT_LABELS[slot]} · {passed ? 'ei merkitty' : 'tyhjä'}</span>
          {suggestion ? (
            <span className="block truncate text-sm">
              Ehdotus: <b className="font-medium">{suggestion.recipe.title}</b> <span className="text-muted">· {formatNumber(suggestion.kcal, 0)} kcal</span>
            </span>
          ) : (
            <span className="block text-sm text-muted">{passed ? 'Söitkö jotain? Lisää se.' : 'Lisää ateria'}</span>
          )}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {suggestion && (
            <button onClick={() => onAdd(suggestion)} className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-on-brand">Lisää</button>
          )}
          <button onClick={onOther} className="rounded-xl border border-line px-3 py-2 text-xs font-medium hover:bg-surface-2">{suggestion ? 'Muu' : 'Valitse'}</button>
        </span>
      </div>
    </li>
  )
}

function Upcoming({ items, recipes, nutrition, t, kcalTarget, onFill }: { items: MealItem[]; recipes: Map<string, Recipe> | undefined; nutrition: PlanNutrition | null; t: string; kcalTarget: number | null; onFill: (date: string) => void }) {
  const tomorrow = addDays(t, 1)
  const tItems = items.filter((i) => i.date === tomorrow).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
  const tKcal = nutrition?.byDay.get(tomorrow)?.nutrients.energyKcal ?? 0
  const days = Array.from({ length: 5 }, (_, i) => addDays(t, i + 2))
  return (
    <div className="space-y-3">
      <Link to={`/viikko?paiva=${tomorrow}`} className="block rounded-[22px] bg-brand p-4 text-on-brand transition hover:bg-brand-strong">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Huomenna {weekdayName(tomorrow, true)} {formatDate(tomorrow)}</p>
            <p className="truncate text-sm opacity-85">{tItems.length ? tItems.map((i) => (i.recipeId ? recipes?.get(i.recipeId)?.title : i.note) ?? '').join(' · ') : 'Ei vielä aterioita'}</p>
          </div>
          {tKcal > 0 && <span className="tabular shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{formatNumber(tKcal, 0)} kcal</span>}
        </div>
      </Link>
      <Panel className="!p-2">
        <ul>
          {days.map((d) => {
            const dayItems = items.filter((i) => i.date === d).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
            const kcal = nutrition?.byDay.get(d)?.nutrients.energyKcal ?? 0
            const missing = (['breakfast', 'lunch', 'dinner'] as MealSlot[]).filter((s) => !dayItems.some((i) => i.slot === s))
            return (
              <li key={d} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2/60">
                <Link to={`/viikko?paiva=${d}`} className="w-16 shrink-0 text-sm font-medium">
                  {capitalize(weekdayName(d, true))} {formatDate(d)}
                </Link>
                <span className="flex shrink-0 -space-x-1.5">
                  {dayItems.slice(0, 4).map((i) => (
                    <MealThumb key={i.id} recipe={i.recipeId ? recipes?.get(i.recipeId) : undefined} size={28} className="rounded-full ring-2 ring-surface" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{missing.length === 0 ? 'Valmis' : missing.length === 3 ? 'Tyhjä' : `${missing.map((s) => SLOT_LABELS[s]).join(', ')} puuttuu`}</span>
                {missing.length > 0 ? (
                  <button onClick={() => onFill(d)} className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">+ täytä</button>
                ) : (
                  <span className={cx('tabular shrink-0 text-sm', kcalTone(kcal, kcalTarget) === 'fat' ? 'text-accent' : 'text-muted')}>{formatNumber(kcal, 0)}</span>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}

function TrendChart({ days, t, dayNutrients, kcalTarget, proteinTarget, fibreTarget }: { days: string[]; t: string; dayNutrients: (d: string) => { kcal: number; protein: number; fibre: number }; kcalTarget: number | null; proteinTarget: number | null; fibreTarget: number | null }) {
  const [metric, setMetric] = useState<'kcal' | 'protein' | 'fibre'>('kcal')
  const target = metric === 'kcal' ? kcalTarget : metric === 'protein' ? proteinTarget : fibreTarget
  const values = days.map((d) => dayNutrients(d)[metric])
  const max = Math.max(target ?? 0, ...values, 1) * 1.08
  return (
    <Panel
      title="Kaksi viikkoa"
      action={<Segmented size="sm" label="Mittari" value={metric} onChange={setMetric} options={[{ value: 'kcal', label: 'Energia' }, { value: 'protein', label: 'Proteiini' }, { value: 'fibre', label: 'Kuitu' }]} />}
    >
      <div className="relative h-36">
        {target && <span className="absolute inset-x-0 border-t-2 border-dashed border-ink/40" style={{ bottom: `${(target / max) * 100}%` }} aria-hidden />}
        <div className="flex h-full items-end gap-1.5">
          {days.map((d, i) => {
            const v = values[i]
            const future = d > t
            const tone = metric === 'kcal' ? dayTone(d, t, v, target) : 'brand'
            return (
              <div key={d} className="flex h-full flex-1 flex-col justify-end" title={`${capitalize(weekdayName(d, true))} ${formatDate(d)}: ${formatNumber(v, 0)} ${metric === 'kcal' ? 'kcal' : 'g'}`}>
                <div
                  className={cx('w-full rounded-t-md', v === 0 ? 'bg-surface-2' : tone === 'fat' ? 'bg-fat' : tone === 'sun' ? 'bg-sun' : 'bg-brand', future && 'opacity-30', d === t && 'ring-2 ring-brand ring-offset-2 ring-offset-surface')}
                  style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
                />
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted">
        {days.map((d) => (
          <span key={d} className={cx('flex-1 text-center', d === t && 'font-bold text-ink')}>{weekdayName(d, true)}</span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand" />Toteutunut</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand opacity-30" />Suunniteltu</span>
        {target && <span>– – Tavoite {formatNumber(target, 0)}</span>}
      </p>
    </Panel>
  )
}

function WeekBalance({ weekDays, t, items, recipes, candidates }: { weekDays: string[]; t: string; items: MealItem[]; recipes: Map<string, Recipe> | undefined; candidates: Candidate[] | undefined }) {
  const byId = useMemo(() => new Map((candidates ?? []).map((c) => [c.recipe.id, c])), [candidates])
  const week = items.filter((i) => weekDays.includes(i.date) && i.recipeId && i.status !== 'skipped')
  const mains = week.filter((i) => i.slot === 'lunch' || i.slot === 'dinner')
  const fish = new Set(mains.filter((i) => byId.get(i.recipeId!)?.diet === 'fish').map((i) => i.leftoverOfId ?? i.id)).size
  const vegDays = weekDays.filter((d) => {
    const m = mains.filter((i) => i.date === d)
    return m.length > 0 && m.every((i) => ['vegan', 'vegetarian'].includes(byId.get(i.recipeId!)?.diet ?? ''))
  }).length
  const times = mains.map((i) => byId.get(i.recipeId!)?.time).filter((x): x is number => !!x)
  const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null
  const hour = new Date().getHours()
  const missing = weekDays.filter((d) => d >= t).flatMap((d) => (['lunch', 'dinner'] as MealSlot[]).filter((s) => !(d === t && slotPassed(s, hour)) && !items.some((i) => i.date === d && i.slot === s)).map((s) => ({ d, s })))
  const good = fish >= 2 && missing.length <= 2
  void recipes
  return (
    <Panel title="Viikon tasapaino" action={<span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', good ? 'bg-brand-soft text-brand' : 'bg-sun-soft text-warn')}>{good ? 'Hyvä' : 'Kesken'}</span>}>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-soft px-3 py-1.5 text-xs font-medium text-sky"><Fish size={13} /> Kalaa {fish}/2</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand"><Leaf size={13} /> Kasvis {vegDays} pv</span>
        {avgTime && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2"><Timer size={13} /> Ø {avgTime} min</span>}
        {missing.length > 0 && (
          <Link to="/viikko" className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
            {missing.length === 1 ? `${SLOT_LABELS[missing[0].s]} puuttuu ${weekdayName(missing[0].d, true)}` : `${missing.length} ateriaa puuttuu`}
          </Link>
        )}
      </div>
    </Panel>
  )
}

function Micronutrients({ days, nutrition }: { days: string[]; nutrition: PlanNutrition | null }) {
  const planned = days.filter((d) => (nutrition?.byDay.get(d)?.nutrients.energyKcal ?? 0) > 600)
  if (!nutrition || planned.length === 0) return null
  const avg = (k: string) => planned.reduce((s, d) => s + ((nutrition.byDay.get(d)!.nutrients as unknown as Record<string, number>)[k] ?? 0), 0) / planned.length
  const kcal = avg('energyKcal')
  const satE = kcal ? (avg('saturatedFat') * 9 * 100) / kcal : 0
  const salt = avg('salt')
  return (
    <Panel title="Viikon ravintoaineet" action={<span className="text-xs text-muted">% saantisuosituksesta · arvio</span>}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {REFERENCES.map((r) => {
          const pct = (avg(r.key) / r.ref) * 100
          return (
            <div key={r.key} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0">{r.label}</span>
              <MiniBar value={pct} max={100} tone={pct >= 90 ? 'brand' : pct >= 60 ? 'sun' : 'fat'} className="flex-1" />
              <span className="tabular w-14 shrink-0 text-right text-muted">{formatNumber(pct, 0)} %</span>
            </div>
          )
        })}
        <div className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0">Suola</span>
          <MiniBar value={salt} max={5} tone={salt > 5 ? 'fat' : 'brand'} className="flex-1" />
          <span className="tabular w-14 shrink-0 text-right text-muted">{formatNumber(salt, 1)} g</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0">Tyydytt. rasva</span>
          <MiniBar value={satE} max={10} tone={satE > 10 ? 'fat' : 'brand'} className="flex-1" />
          <span className="tabular w-14 shrink-0 text-right text-muted">{formatNumber(satE, 0)} E%</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">Keskiarvo {planned.length} suunnitellusta päivästä. Vain suunnitelluista aterioista, ei muista ruoista.</p>
    </Panel>
  )
}

function TonightCard({ items, recipes, pantry, hour }: { items: MealItem[]; recipes: Map<string, Recipe> | undefined; pantry: string[]; hour: number }) {
  const dinner = items.find((i) => i.slot === 'dinner' && i.recipeId && i.status !== 'skipped')
  const recipe = dinner?.recipeId ? recipes?.get(dinner.recipeId) : undefined
  const inPantry = useMemo(() => pantryMatcher(pantry), [pantry])
  if (!recipe || hour >= 21) return null
  const lines = recipe.ingredients.filter((i) => i.name && !/:$/.test(i.raw))
  const home = lines.filter((i) => inPantry({ key: i.name.toLowerCase(), name: i.name }))
  const need = lines.filter((i) => !home.includes(i))
  return (
    <Panel title="Tämän illan ruokaan" action={<span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{need.length} ainesta</span>}>
      <p className="-mt-1 mb-3 truncate text-sm text-muted">{recipe.title}</p>
      <ul className="divide-y divide-line">
        {need.slice(0, 6).map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate">{capitalize(i.name)}</span>
            <span className="tabular shrink-0 text-muted">{i.quantity !== null ? scaleIngredient(i, (dinner!.servings + (dinner!.extraServings ?? 0)) / recipe.servings).amountText : ''}</span>
          </li>
        ))}
      </ul>
      {need.length > 6 && <p className="pt-1 text-xs text-muted">+ {need.length - 6} muuta</p>}
      {home.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          <span className="mr-1.5 rounded bg-brand-soft px-1.5 py-0.5 font-semibold text-brand">kotona</span>
          {home.map((i) => i.name).join(', ')}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Link to="/ostokset" className="flex h-10 flex-1 items-center justify-center rounded-xl bg-brand-soft text-sm font-semibold text-brand">Ostoslistalle</Link>
        <Link to={`/reseptit/${recipe.id}`} className="flex h-10 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium">Resepti</Link>
      </div>
    </Panel>
  )
}

function SnackIdeas({ candidates, t, items, remainingKcal, servings, proteinGap }: { candidates: Candidate[] | undefined; t: string; items: MealItem[]; remainingKcal: number | null; servings: number; proteinGap: number | null }) {
  const toast = useToast()
  const hasSnack = items.some((i) => i.slot === 'snack')
  const ideas = useMemo(() => {
    if (!candidates) return []
    const budget = remainingKcal !== null ? Math.max(120, Math.min(450, remainingKcal)) : 300
    return suggestForSlot(candidates, quickPlanOptions({ dates: [t], people: 1, maxKcalPerDay: null, seed: 11 }), t, 'snack', budget, new Set(), 3)
  }, [candidates, t, remainingKcal])
  if (hasSnack || ideas.length === 0) return null
  return (
    <Panel title="Iltapalaksi" action={<span className="text-xs text-muted">{remainingKcal !== null && remainingKcal > 0 ? `tilaa ~${formatNumber(remainingKcal, 0)} kcal` : 'ideoita'}</span>}>
      <ul className="space-y-2">
        {ideas.map((c) => (
          <li key={c.recipe.id}>
            <button
              onClick={async () => {
                const undo = await addToSlot(c.recipe.id, t, 'snack', Math.min(servings, 2))
                toast(`${c.recipe.title} → iltapala`, 'ok', { label: 'Kumoa', onClick: undo })
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-line p-2.5 text-left transition hover:border-brand"
            >
              <MealThumb recipe={c.recipe} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.recipe.title}</span>
                <span className="block text-xs text-muted">{formatNumber(c.kcal, 0)} kcal{proteinGap && proteinGap > 10 ? ' · proteiinia' : ''}</span>
              </span>
              <Plus size={16} className="shrink-0 text-brand" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ShoppingCard() {
  const { settings } = useApp()
  const counts = useLiveQuery(async () => {
    const list = await db.shoppingLists.get(ROLLING_LIST_ID)
    if (!list) return null
    const home = new Set(list.homeKeys ?? [])
    const inPantry = pantryMatcher(settings.pantry)
    const all = (await db.shoppingItems.where('listId').equals(list.id).toArray()).filter((i) => i.manual || !(home.has(i.key) || inPantry(i)))
    return { total: all.length, left: all.filter((i) => !i.checked).length }
  }, [settings.pantry])
  return (
    <Panel title="Seuraava kauppareissu" action={<ShoppingCart size={18} className="text-muted" />}>
      {counts && counts.total > 0 ? (
        <>
          <div className="flex items-end gap-6">
            <div>
              <p className="tabular font-display text-3xl font-semibold leading-none">{counts.left}</p>
              <p className="mt-1 text-xs text-muted">ostettavaa</p>
            </div>
            <div>
              <p className="tabular font-display text-3xl font-semibold leading-none">{counts.total - counts.left}</p>
              <p className="mt-1 text-xs text-muted">jo korissa</p>
            </div>
          </div>
          <Link to="/ostokset" className="mt-4 flex h-10 items-center justify-center rounded-xl border border-line text-sm font-medium hover:bg-surface-2">Avaa ostokset</Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Ostoslista kootaan automaattisesti tulevista aterioista.</p>
          <Link to="/ostokset" className="mt-3 flex h-10 items-center justify-center rounded-xl border border-line text-sm font-medium hover:bg-surface-2">Avaa ostokset</Link>
        </>
      )}
    </Panel>
  )
}

function WeightCard() {
  const { settings } = useApp()
  const toast = useToast()
  const [value, setValue] = useState('')
  const weights = [...settings.weights].sort((a, b) => a.date.localeCompare(b.date))
  const last = weights.at(-1)
  const first = weights.find((w) => w.date >= addDays(today(), -42)) ?? weights[0]
  const change = last && first && last !== first ? last.kg - first.kg : null
  if (!settings.goal) return null
  async function save() {
    const kg = Number(value.replace(',', '.'))
    if (!(kg >= 30 && kg <= 300)) return toast('Anna paino kiloina, esim. 82,4', 'error')
    const t = today()
    await saveUserSettings({ ...settings, weights: [...settings.weights.filter((w) => w.date !== t), { date: t, kg }], goal: settings.goal ? { ...settings.goal, weightKg: kg } : settings.goal })
    setValue('')
    toast('Paino tallennettu')
  }
  const pts = weights.slice(-12)
  const min = Math.min(...pts.map((p) => p.kg)) - 0.5
  const max = Math.max(...pts.map((p) => p.kg)) + 0.5
  return (
    <Panel title="Paino" action={<Scale size={18} className="text-muted" />}>
      {last ? (
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="tabular font-display text-3xl font-semibold leading-none">{formatNumber(last.kg, 1)} <span className="text-base font-normal text-muted">kg</span></p>
            {change !== null && (
              <p className={cx('mt-1 text-xs font-medium', change < 0 ? 'text-brand' : 'text-muted')}>
                {change > 0 ? '+' : '−'}{formatNumber(Math.abs(change), 1)} kg {formatDate(first.date)} lähtien
              </p>
            )}
          </div>
          {pts.length > 1 && (
            <svg viewBox={`0 0 ${(pts.length - 1) * 12} 40`} className="h-10 w-28" aria-hidden preserveAspectRatio="none">
              <polyline fill="none" stroke="var(--c-brand)" strokeWidth="2" strokeLinejoin="round" points={pts.map((p, i) => `${i * 12},${40 - ((p.kg - min) / (max - min)) * 40}`).join(' ')} />
            </svg>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Punnitse kerran viikossa samaan aikaan – trendi kertoo enemmän kuin yksittäinen lukema.</p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Tämän päivän paino" aria-label="Paino kiloina" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" />
        <Button type="submit" variant="secondary">Tallenna</Button>
      </form>
    </Panel>
  )
}

function MonthCard({ t, items, dayNutrients, kcalTarget, weekStartsOn }: { t: string; items: MealItem[]; dayNutrients: (d: string) => { kcal: number }; kcalTarget: number | null; weekStartsOn: 0 | 1 }) {
  const first = startOfWeek(addDays(t, -13), weekStartsOn)
  const days = Array.from({ length: 35 }, (_, i) => addDays(first, i))
  const d = parseISODate(t)
  return (
    <Panel title={`${capitalize(d.toLocaleDateString('fi-FI', { month: 'long' }))}`} action={<Link to="/viikko?nakyma=kuukausi" className="text-xs font-medium text-brand">Kuukausi</Link>}>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted">
        {days.slice(0, 7).map((x) => (
          <span key={x}>{weekdayName(x, true)}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((x) => {
          const n = items.filter((i) => i.date === x).length
          const kcal = dayNutrients(x).kcal
          const tone = n === 0 ? null : dayTone(x, t, kcal, kcalTarget)
          return (
            <Link key={x} to={`/viikko?paiva=${x}`} className={cx('flex aspect-square flex-col items-center justify-center rounded-lg text-xs', x === t ? 'ring-2 ring-accent' : 'hover:bg-surface-2', x < t && 'text-muted')}>
              <span className="tabular">{parseISODate(x).getDate()}</span>
              <span className={cx('mt-0.5 h-1.5 w-1.5 rounded-full', tone === null ? 'bg-transparent' : tone === 'brand' ? 'bg-brand' : tone === 'sun' ? 'bg-sun' : 'bg-fat')} />
            </Link>
          )
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand" />tavoitteessa</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sun" />alle</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-fat" />yli</span>
      </p>
      <QuickAdd t={t} />
    </Panel>
  )
}

/** Small "add a meal to today" shortcut under the month (desktop). */
function QuickAdd({ t }: { t: string }) {
  const command = useCommand()
  return (
    <div className="mt-4 border-t border-line pt-4">
      <button onClick={() => command.open('huomenna ')} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-brand hover:text-brand">
        <Plus size={15} /> Lisää ateria huomiselle
      </button>
      <span className="sr-only">{t}</span>
    </div>
  )
}

