/**
 * Viikko – the planning workspace (Draft 1 structure + Draft 3 speed).
 *   Phones: one row per day, meals as chips, a bar against the goal, gaps as "+ Lounas".
 *   1024+:  a 7 × 4 grid (days × meals) with drag and drop (drop preview shows the effect on the
 *           day), arrow-key navigation, ↵ open, ⌫ remove, N fill next empty.
 *   1280+:  plus a side panel: Reseptit (drag into the grid) · Ateria · Ostokset.
 *   Month:  the whole month at a glance; click a day to plan it.
 */
import { ChevronLeft, ChevronRight, GripVertical, Plus, Search, ShoppingCart, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { duplicateMealItem, moveMealItem, removeMealItem, restoreMealItem } from '../../db/repo'
import { addDays, capitalize, formatDate, isoWeek, parseISODate, startOfWeek, today, weekdayName } from '../../domain/dates'
import { matchesQuery } from '../../domain/recipeInfo'
import { nextEmptySlot } from '../../domain/today'
import type { MealItem, MealSlot, Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { quickPlanOptions, slotShare, suggestForSlot, type Candidate } from '../../domain/weekPlanner'
import { useApp, useToast } from '../AppContext'
import { useCommand } from '../command'
import { PageHeader, useMediaQuery } from '../components/Layout'
import { MealSheet, MealSheetBody } from '../components/MealSheet'
import { Button, cx } from '../components/ui'
import { dayTone, Eyebrow, MealThumb, MiniBar, Panel, Segmented } from '../components/v2'
import { SLOT_LABELS, useMealItems, usePlanNutrition, useRecipesById, type PlanNutrition } from '../hooks'
import { addToSlot, fillEmptySlots, slotLabel } from '../planActions'
import { useCandidates, useHousehold } from '../planning'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, other: 4 }
const DRAG_RECIPE = 'application/x-recipe'
const DRAG_MEAL = 'application/x-meal-item'

type View = 'week' | '2wk' | 'month'

export function WeekPage() {
  const { settings } = useApp()
  const toast = useToast()
  const command = useCommand()
  const [params, setParams] = useSearchParams()
  const t = today()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const wide = useMediaQuery('(min-width: 1920px)')
  const view: View = params.get('nakyma') === 'kuukausi' ? 'month' : params.get('nakyma') === '2vk' || (wide && params.get('nakyma') !== 'viikko') ? '2wk' : 'week'
  const focusDay = params.get('paiva')
  const start = params.get('alku') ?? startOfWeek(focusDay ?? t, settings.weekStartsOn)
  const { servings, kcalTarget, proteinTarget } = useHousehold()
  const candidates = useCandidates()

  const monthStart = useMemo(() => {
    const d = parseISODate(start)
    return startOfWeek(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, settings.weekStartsOn)
  }, [start, settings.weekStartsOn])
  const from = view === 'month' ? monthStart : start
  const length = view === 'month' ? 42 : view === '2wk' ? 14 : 7
  const days = useMemo(() => Array.from({ length }, (_, i) => addDays(from, i)), [from, length])
  const to = days.at(-1)!
  const items = useMealItems(addDays(from, -1), to)
  const recipes = useRecipesById((items ?? []).map((i) => i.recipeId))
  const nutrition = usePlanNutrition(items, recipes)
  const [sheet, setSheet] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ date: string; slot: MealSlot } | null>(null)

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v)
    next.delete('paiva')
    setParams(next, { replace: true })
  }
  const step = (dir: -1 | 1) => {
    if (view === 'month') {
      const d = parseISODate(start)
      const m = new Date(d.getFullYear(), d.getMonth() + dir, 1)
      go({ alku: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01` })
    } else go({ alku: addDays(start, dir * 7) })
  }

  const kcalOf = (i: MealItem) => nutrition?.byItem.get(i.id)?.nutrients.energyKcal ?? 0
  const dayKcal = (d: string) => (items ?? []).filter((i) => i.date === d && i.status !== 'skipped').reduce((s, i) => s + kcalOf(i), 0)
  const planDays = view === 'month' ? days : days
  const emptyCount = planDays.filter((d) => d >= t).reduce((n, d) => n + (['breakfast', 'lunch', 'dinner'] as MealSlot[]).filter((s) => !(items ?? []).some((i) => i.date === d && i.slot === s)).length, 0)

  async function fill() {
    if (!candidates) return
    const dates = (view === 'month' ? days.filter((d) => parseISODate(d).getMonth() === parseISODate(start).getMonth()) : days).filter((d) => d >= t)
    const { added, undo } = await fillEmptySlots(candidates, dates, { servings, kcalTarget })
    toast(added ? `Lisättiin ${added} ateriaa` : 'Ei tyhjiä paikkoja', 'ok', added ? { label: 'Kumoa', onClick: undo } : undefined)
  }

  const sheetItem = sheet ? ((items ?? []).find((i) => i.id === sheet) ?? null) : null
  const thisWeek = startOfWeek(t, settings.weekStartsOn)
  const title =
    view === 'month'
      ? capitalize(parseISODate(start).toLocaleDateString('fi-FI', { month: 'long', year: 'numeric' }))
      : start === thisWeek
        ? 'Tämä viikko'
        : start === addDays(thisWeek, 7)
          ? 'Ensi viikko'
          : `Viikko ${isoWeek(start)}`

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={view === 'month' ? undefined : `Viikko ${isoWeek(start)} · ${formatDate(start)}–${formatDate(addDays(start, view === '2wk' ? 13 : 6))}`}
        title={title}
        actions={
          <>
            <Link to="/viikko/suunnittele" className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2">Säädä ja suunnittele</Link>
            <Button icon={<Sparkles size={16} />} onClick={fill} disabled={!candidates || emptyCount === 0}>
              {emptyCount ? `Täytä ${emptyCount} tyhjää` : 'Kaikki täynnä'}
            </Button>
          </>
        }
        mobileActions={null}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface hover:bg-surface-2" aria-label="Edellinen">
            <ChevronLeft size={17} />
          </button>
          <button onClick={() => step(1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface hover:bg-surface-2" aria-label="Seuraava">
            <ChevronRight size={17} />
          </button>
          {start !== thisWeek && (
            <button onClick={() => go({ alku: null })} className="h-9 rounded-xl px-3 text-sm font-medium text-brand hover:bg-brand-soft">Tämä viikko</button>
          )}
        </div>
        <div className="ml-auto">
          <Segmented
            label="Näkymä"
            size="sm"
            value={view}
            onChange={(v) => go({ nakyma: v === 'week' ? (wide ? 'viikko' : null) : v === 'month' ? 'kuukausi' : '2vk' })}
            options={[
              { value: 'week', label: 'Viikko' },
              ...(desktop ? [{ value: '2wk' as View, label: '2 vk' }] : []),
              { value: 'month', label: 'Kuukausi' },
            ]}
          />
        </div>
      </div>

      {view === 'month' ? (
        <MonthView days={days} month={parseISODate(start).getMonth()} items={items ?? []} recipes={recipes} dayKcal={dayKcal} kcalTarget={kcalTarget} onDay={(d) => go({ nakyma: null, alku: startOfWeek(d, settings.weekStartsOn) })} />
      ) : desktop ? (
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1 space-y-6">
            {(view === '2wk' ? [days.slice(0, 7), days.slice(7)] : [days]).map((week) => (
              <WeekGrid
                key={week[0]}
                days={week}
                items={items ?? []}
                recipes={recipes}
                nutrition={nutrition}
                kcalOf={kcalOf}
                dayKcal={dayKcal}
                kcalTarget={kcalTarget}
                proteinTarget={proteinTarget}
                servings={servings}
                selected={selected}
                onSelect={setSelected}
                onOpen={setSheet}
                onEmpty={(date, slot) => command.open(`${date === t ? 'tänään' : formatDate(date)} ${SLOT_LABELS[slot].toLowerCase()} `)}
              />
            ))}
            <ShortcutBar />
          </div>
          <SidePanel days={days} items={items ?? []} recipes={recipes} selected={selected} candidates={candidates} kcalOf={kcalOf} dayKcal={dayKcal} />
        </div>
      ) : (
        <DayRows days={days} items={items ?? []} recipes={recipes} nutrition={nutrition} kcalTarget={kcalTarget} onOpen={setSheet} onAdd={(date, slot) => command.open(`${date === t ? 'tänään' : formatDate(date)} ${SLOT_LABELS[slot].toLowerCase()} `)} />
      )}

      {/* Phones: thumb-reach actions */}
      {!desktop && view !== 'month' && (
        <div className="no-print fixed inset-x-0 bottom-[84px] z-20 flex justify-center gap-2 px-4">
          {emptyCount > 0 && (
            <button onClick={fill} disabled={!candidates} className="flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-on-brand shadow-lg shadow-brand/25 disabled:opacity-60">
              <Sparkles size={17} /> Täytä {emptyCount} tyhjää
            </button>
          )}
          <Link to="/ostokset" className="flex h-12 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold shadow-lg">
            <ShoppingCart size={17} /> Ostokset
          </Link>
        </div>
      )}

      <MealSheet item={sheetItem} recipe={sheetItem?.recipeId ? recipes?.get(sheetItem.recipeId) : undefined} kcal={sheetItem ? kcalOf(sheetItem) || null : null} dayKcal={sheetItem ? dayKcal(sheetItem.date) : 0} onClose={() => setSheet(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Phones: day rows

function DayRows({ days, items, recipes, nutrition, kcalTarget, onOpen, onAdd }: { days: string[]; items: MealItem[]; recipes: Map<string, Recipe> | undefined; nutrition: PlanNutrition | null; kcalTarget: number | null; onOpen: (id: string) => void; onAdd: (date: string, slot: MealSlot) => void }) {
  const t = today()
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-today]')?.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
  }, [])
  return (
    <ol ref={ref} className="space-y-2.5 pb-20">
      {days.map((d) => {
        const dayItems = items.filter((i) => i.date === d).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.position - b.position)
        const kcal = nutrition?.byDay.get(d)?.nutrients.energyKcal ?? 0
        const missing = (['breakfast', 'lunch', 'dinner'] as MealSlot[]).filter((s) => !dayItems.some((i) => i.slot === s))
        const past = d < t
        if (past && dayItems.length === 0)
          return (
            <li key={d} className="flex items-center gap-3 px-3 py-1 text-sm text-muted">
              <span className="w-10 text-center text-[11px] font-semibold uppercase">{weekdayName(d, true)} {parseISODate(d).getDate()}</span>
              <span>ei merkintöjä</span>
            </li>
          )
        return (
          <li key={d} data-today={d === t ? '' : undefined} className={cx('scroll-mt-4 rounded-[22px] border bg-surface p-3', d === t ? 'border-brand' : 'border-line', past && 'opacity-60')}>
            <div className="flex gap-3">
              <div className="w-10 shrink-0 pt-0.5 text-center">
                <p className={cx('text-[11px] font-semibold uppercase', d === t ? 'text-brand' : 'text-muted')}>{weekdayName(d, true)}</p>
                <p className="tabular font-display text-xl font-semibold leading-tight">{parseISODate(d).getDate()}</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {dayItems.map((i) => {
                  const r = i.recipeId ? recipes?.get(i.recipeId) : undefined
                  return (
                    <button
                      key={i.id}
                      onClick={() => onOpen(i.id)}
                      className={cx('flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-left text-[13px]', i.leftoverOfId ? 'border-brand/30 bg-brand-soft/60 text-brand' : 'border-line bg-surface', i.status === 'skipped' && 'line-through opacity-60')}
                    >
                      <MealThumb recipe={r} size={22} className="rounded-full" />
                      <span className="truncate">{i.leftoverOfId ? '↻ ' : ''}{r?.title ?? i.note ?? 'Ateria'}</span>
                    </button>
                  )
                })}
                {!past &&
                  missing.map((s) => (
                    <button key={s} onClick={() => onAdd(d, s)} className="rounded-full border border-dashed border-accent/50 px-3 py-1 text-[13px] font-medium text-accent">
                      + {SLOT_LABELS[s]}
                    </button>
                  ))}
              </div>
            </div>
            {kcal > 0 && (
              <div className="mt-2.5 flex items-center gap-2 pl-[52px]">
                <MiniBar value={kcal} max={kcalTarget ? kcalTarget * 1.25 : kcal} tone={dayTone(d, t, kcal, kcalTarget)} tick={kcalTarget ? 80 : undefined} className="flex-1" />
                <span className="tabular w-16 shrink-0 text-right text-xs text-muted">{formatNumber(kcal, 0)} kcal</span>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------
// Desktop: the grid

function WeekGrid({
  days, items, recipes, nutrition, kcalOf, dayKcal, kcalTarget, proteinTarget, servings, selected, onSelect, onOpen, onEmpty,
}: {
  days: string[]
  items: MealItem[]
  recipes: Map<string, Recipe> | undefined
  nutrition: PlanNutrition | null
  kcalOf: (i: MealItem) => number
  dayKcal: (d: string) => number
  kcalTarget: number | null
  proteinTarget: number | null
  servings: number
  selected: { date: string; slot: MealSlot } | null
  onSelect: (s: { date: string; slot: MealSlot } | null) => void
  onOpen: (id: string) => void
  onEmpty: (date: string, slot: MealSlot) => void
}) {
  const toast = useToast()
  const t = today()
  const [drop, setDrop] = useState<{ date: string; slot: MealSlot; text: string } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const cellItems = (date: string, slot: MealSlot) => items.filter((i) => i.date === date && i.slot === slot).sort((a, b) => a.position - b.position)

  function preview(e: DragEvent, date: string, slot: MealSlot) {
    e.preventDefault()
    const types = Array.from(e.dataTransfer.types)
    const isMeal = types.includes(DRAG_MEAL)
    e.dataTransfer.dropEffect = isMeal ? (e.altKey ? 'copy' : 'move') : 'copy'
    if (drop?.date === date && drop.slot === slot) return
    const draggedKcal = Number(types.find((x) => x.startsWith('x-kcal/'))?.slice(7) ?? 0)
    const before = dayKcal(date)
    const after = before + draggedKcal
    setDrop({ date, slot, text: `päivä ${formatNumber(before, 0)} → ${formatNumber(after, 0)}${kcalTarget ? ` / ${formatNumber(kcalTarget, 0)}` : ''} kcal` })
  }

  async function onDrop(e: DragEvent, date: string, slot: MealSlot) {
    e.preventDefault()
    setDrop(null)
    const mealId = e.dataTransfer.getData(DRAG_MEAL)
    const recipeId = e.dataTransfer.getData(DRAG_RECIPE)
    if (mealId) {
      const meal = items.find((i) => i.id === mealId)
      if (!meal || (meal.date === date && meal.slot === slot)) return
      if (e.altKey) {
        await duplicateMealItem(mealId, { date, slot })
        toast(`Kopioitu: ${slotLabel(date, slot)}`)
      } else {
        const prev = { date: meal.date, slot: meal.slot }
        await moveMealItem(mealId, date, slot)
        toast(`Siirretty: ${slotLabel(date, slot)}`, 'ok', { label: 'Kumoa', onClick: () => moveMealItem(mealId, prev.date, prev.slot) })
      }
    } else if (recipeId) {
      const undo = await addToSlot(recipeId, date, slot, servings)
      toast(`Lisätty: ${slotLabel(date, slot)}`, 'ok', { label: 'Kumoa', onClick: undo })
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!selected) return
    const di = days.indexOf(selected.date)
    const si = SLOTS.indexOf(selected.slot)
    const move = (d: number, s: number) => {
      e.preventDefault()
      const nd = days[Math.max(0, Math.min(days.length - 1, di + d))]
      const ns = SLOTS[Math.max(0, Math.min(SLOTS.length - 1, si + s))]
      onSelect({ date: nd, slot: ns })
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${nd}|${ns}"]`)?.focus()
    }
    const cell = cellItems(selected.date, selected.slot)
    if (e.key === 'ArrowRight') move(1, 0)
    else if (e.key === 'ArrowLeft') move(-1, 0)
    else if (e.key === 'ArrowDown') move(0, 1)
    else if (e.key === 'ArrowUp') move(0, -1)
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (cell[0]) onOpen(cell[0].id)
      else onEmpty(selected.date, selected.slot)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && cell[0]) {
      e.preventDefault()
      removeMealItem(cell[0].id).then((snap) => toast('Ateria poistettu', 'ok', { label: 'Kumoa', onClick: () => restoreMealItem(snap) }))
    } else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const next = nextEmptySlot(items, t, new Date().getHours())
      onSelect(next)
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next.date}|${next.slot}"]`)?.focus()
    }
  }

  return (
    <div ref={gridRef} className="overflow-x-auto" onKeyDown={onKey} role="grid" aria-label="Viikon ateriat">
      <div className="grid min-w-[860px] grid-cols-[84px_repeat(7,minmax(0,1fr))] gap-2 3xl:grid-cols-[96px_repeat(7,minmax(0,1fr))] 3xl:gap-2.5">
        <div />
        {days.map((d) => {
          const kcal = dayKcal(d)
          return (
            <div key={d} role="columnheader" className={cx('px-1', d < t && 'opacity-55')}>
              <p className={cx('text-[11px] font-semibold uppercase tracking-wider', d === t ? 'text-accent' : 'text-muted')}>{weekdayName(d, true)}{d === t ? ' · tänään' : ''}</p>
              <p className="tabular font-display text-xl font-semibold">{formatDate(d)}</p>
              <MiniBar value={kcal} max={kcalTarget ? kcalTarget * 1.25 : Math.max(kcal, 1)} tone={dayTone(d, t, kcal, kcalTarget)} tick={kcalTarget ? 80 : undefined} className="mt-1.5" />
            </div>
          )
        })}
        {SLOTS.map((slot) => (
          <Row key={slot}>
            <div role="rowheader" className="pt-3 text-sm font-medium text-ink-2">{SLOT_LABELS[slot]}</div>
            {days.map((d) => {
              const cell = cellItems(d, slot)
              const isSel = selected?.date === d && selected.slot === slot
              const isDrop = drop?.date === d && drop.slot === slot
              return (
                <div
                  key={d}
                  data-cell={`${d}|${slot}`}
                  role="gridcell"
                  tabIndex={isSel || (!selected && d === days[0] && slot === 'breakfast') ? 0 : -1}
                  aria-selected={isSel}
                  onFocus={() => onSelect({ date: d, slot })}
                  onClick={() => onSelect({ date: d, slot })}
                  onDragOver={(e) => preview(e, d, slot)}
                  onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}
                  onDrop={(e) => onDrop(e, d, slot)}
                  className={cx(
                    'group relative min-h-[112px] rounded-2xl outline-none transition 3xl:min-h-[132px]',
                    cell.length === 0 ? 'border border-dashed border-line' : '',
                    isSel && 'ring-2 ring-brand ring-offset-2 ring-offset-canvas',
                    isDrop && 'bg-brand-soft/60 ring-2 ring-brand',
                    d < t && 'opacity-55',
                  )}
                >
                  {cell.length === 0 ? (
                    <button onClick={() => onEmpty(d, slot)} tabIndex={-1} className="flex h-full min-h-[112px] w-full items-center justify-center text-muted opacity-60 transition group-hover:opacity-100 3xl:min-h-[132px]" aria-label={`Lisää ${slotLabel(d, slot)}`}>
                      <Plus size={18} />
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      {cell.map((i) => (
                        <MealCell key={i.id} item={i} recipe={i.recipeId ? recipes?.get(i.recipeId) : undefined} kcal={kcalOf(i)} compact={cell.length > 1} onOpen={() => onOpen(i.id)} />
                      ))}
                    </div>
                  )}
                  {isDrop && (
                    <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-max -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs text-canvas shadow-xl">
                      <p className="font-semibold">Pudota: {slotLabel(d, slot)}</p>
                      <p className="opacity-80">{drop!.text}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </Row>
        ))}
        <div className="pt-2 text-sm font-medium text-ink-2">Päivä / hlö</div>
        {days.map((d) => {
          const n = nutrition?.byDay.get(d)?.nutrients
          const kcal = dayKcal(d)
          const tone = dayTone(d, t, kcal, kcalTarget)
          return (
            <div key={d} className="border-t border-line px-1 pt-2">
              <p className={cx('tabular font-display text-lg font-semibold', kcal === 0 ? 'text-muted' : tone === 'fat' ? 'text-accent' : tone === 'sun' ? 'text-warn' : '')}>{kcal ? formatNumber(kcal, 0) : '–'}</p>
              {n && (
                <>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span className="bg-protein" style={{ width: `${((n.protein * 4) / Math.max(1, n.energyKcal)) * 100}%` }} />
                    <span className="bg-carb" style={{ width: `${((n.carbohydrate * 4) / Math.max(1, n.energyKcal)) * 100}%` }} />
                    <span className="bg-fat" style={{ width: `${((n.fat * 9) / Math.max(1, n.energyKcal)) * 100}%` }} />
                  </div>
                  <p className={cx('tabular mt-1 text-xs', proteinTarget && n.protein < proteinTarget * 0.8 ? 'text-warn' : 'text-muted')}>P {formatNumber(n.protein, 0)} g</p>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div role="row" className="contents">{children}</div>
}

function MealCell({ item, recipe, kcal, compact, onOpen }: { item: MealItem; recipe: Recipe | undefined; kcal: number; compact: boolean; onOpen: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MEAL, item.id)
        e.dataTransfer.setData(`x-kcal/${Math.round(kcal)}`, '')
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onDoubleClick={onOpen}
      className={cx(
        'group/cell relative cursor-grab overflow-hidden rounded-2xl border bg-surface transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing',
        item.leftoverOfId ? 'border-brand/25 bg-brand-soft/50' : 'border-line',
        item.status === 'skipped' && 'opacity-50',
      )}
    >
      <button onClick={onOpen} className="block w-full text-left" tabIndex={-1}>
        {!compact && !item.leftoverOfId && <MealThumb recipe={recipe} size={0} className="!h-14 !w-full !rounded-none 3xl:!h-[72px]" />}
        <span className="block px-2.5 pb-2 pt-1.5">
          <span className={cx('line-clamp-2 text-[13px] font-medium leading-snug', item.leftoverOfId && 'text-brand')}>
            {item.leftoverOfId ? '↻ ' : ''}
            {recipe?.title ?? item.note ?? 'Ateria'}
          </span>
          <span className="tabular mt-0.5 block text-[11px] text-muted">
            {kcal ? `${formatNumber(kcal, 0)} kcal` : ''}
            {item.leftoverOfId ? ' · tähde' : ''}
            {item.status === 'eaten' ? ' · syöty' : ''}
          </span>
        </span>
      </button>
    </div>
  )
}

function ShortcutBar() {
  return (
    <p className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-muted xl:flex">
      <span>←↑→↓ liiku</span>
      <span>↵ avaa</span>
      <span>⌫ poista</span>
      <span>N seuraava tyhjä</span>
      <span>vedä siirtää · ⌥ + vedä kopioi</span>
      <span>⌘K lisää komennolla</span>
    </p>
  )
}

// ---------------------------------------------------------------------------------------------
// Desktop side panel

function SidePanel({ days, items, recipes, selected, candidates, kcalOf, dayKcal }: { days: string[]; items: MealItem[]; recipes: Map<string, Recipe> | undefined; selected: { date: string; slot: MealSlot } | null; candidates: Candidate[] | undefined; kcalOf: (i: MealItem) => number; dayKcal: (d: string) => number }) {
  const [tab, setTab] = useState<'recipes' | 'meal' | 'shop'>('recipes')
  const selItem = selected ? items.find((i) => i.date === selected.date && i.slot === selected.slot) : undefined
  useEffect(() => {
    if (selected) setTab(selItem ? 'meal' : 'recipes')
  }, [selItem?.id, selected?.date, selected?.slot]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside className="sticky top-[88px] hidden max-h-[calc(100vh-110px)] w-[330px] shrink-0 flex-col overflow-hidden rounded-[22px] border border-line bg-surface xl:flex 3xl:w-[400px]">
      <div className="flex gap-1 border-b border-line p-2">
        {(
          [
            ['recipes', 'Reseptit'],
            ['meal', 'Ateria'],
            ['shop', 'Ostokset'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={cx('flex-1 rounded-xl py-2 text-sm font-medium', tab === v ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink')}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'recipes' && <RecipeDrawer candidates={candidates} selected={selected} items={items} dayKcal={dayKcal} />}
        {tab === 'meal' &&
          (selItem ? (
            <div>
              <Eyebrow>{slotLabel(selItem.date, selItem.slot)}</Eyebrow>
              <h3 className="mb-4 mt-0.5 font-display text-xl font-semibold">{(selItem.recipeId && recipes?.get(selItem.recipeId)?.title) || selItem.note || 'Ateria'}</h3>
              <MealSheetBody key={selItem.id} item={selItem} recipe={selItem.recipeId ? recipes?.get(selItem.recipeId) : undefined} kcal={kcalOf(selItem) || null} dayKcal={dayKcal(selItem.date)} onClose={() => {}} />
            </div>
          ) : (
            <p className="text-sm text-muted">Valitse ruudukosta ateria, niin sen tiedot ja vaihtoehdot näkyvät tässä.</p>
          ))}
        {tab === 'shop' && <ShopPreview days={days} items={items} recipes={recipes} />}
      </div>
    </aside>
  )
}

function RecipeDrawer({ candidates, selected, items, dayKcal }: { candidates: Candidate[] | undefined; selected: { date: string; slot: MealSlot } | null; items: MealItem[]; dayKcal: (d: string) => number }) {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'fit' | 'fav' | 'quick' | 'veg'>('fit')
  const { kcalTarget } = useHousehold()
  const t = today()
  const target = selected ?? nextEmptySlot(items, t, new Date().getHours())
  const list = useMemo(() => {
    if (!candidates) return []
    if (q.trim()) return candidates.filter((c) => matchesQuery(c.text, q)).sort((a, b) => Number(!!b.recipe.instructions.length) - Number(!!a.recipe.instructions.length) || Number(b.favourite) - Number(a.favourite)).slice(0, 40)
    if (mode === 'fit') {
      const budget = kcalTarget ? Math.max(200, Math.min(kcalTarget - dayKcal(target.date), kcalTarget * slotShare(target.slot) * 1.3)) : null
      return suggestForSlot(candidates, quickPlanOptions({ dates: [target.date], people: 1, maxKcalPerDay: kcalTarget, seed: 5 }), target.date, target.slot, budget, new Set(items.map((i) => i.recipeId!).filter(Boolean)), 12)
    }
    const pool = candidates.filter((c) => c.recipe.instructions.length > 0 && c.kcal > 150)
    if (mode === 'fav') return pool.filter((c) => c.favourite || (c.recipe.rating ?? 0) >= 4 || c.recipe.inCollection).slice(0, 40)
    if (mode === 'quick') return pool.filter((c) => c.time !== null && c.time <= 30 && c.kinds.has('main')).slice(0, 40)
    return pool.filter((c) => (c.diet === 'vegan' || c.diet === 'vegetarian') && c.kinds.has('main')).slice(0, 40)
  }, [candidates, q, mode, target.date, target.slot, kcalTarget, items, dayKcal])
  return (
    <div>
      <label className="flex h-10 items-center gap-2 rounded-xl border border-line px-3 focus-within:border-brand">
        <Search size={15} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Hae ${candidates ? formatNumber(candidates.length, 0) : ''} reseptistä`} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Hae reseptiä" />
      </label>
      {!q && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ['fit', 'Sopii aukkoon'],
              ['fav', 'Suosikit'],
              ['quick', '≤ 30 min'],
              ['veg', 'Kasvis'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} className={cx('rounded-full px-3 py-1 text-xs font-medium', mode === v ? 'bg-ink text-canvas' : 'border border-line text-ink-2')}>
              {l}
            </button>
          ))}
        </div>
      )}
      {!q && mode === 'fit' && <Eyebrow className="mt-4">{slotLabel(target.date, target.slot)}</Eyebrow>}
      <ul className="mt-2 space-y-1">
        {!candidates && <li className="py-6 text-center text-sm text-muted">Ladataan…</li>}
        {list.map((c) => (
          <li
            key={c.recipe.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_RECIPE, c.recipe.id)
              e.dataTransfer.setData(`x-kcal/${Math.round(c.kcal)}`, '')
              e.dataTransfer.effectAllowed = 'copy'
            }}
            className="group flex cursor-grab items-center gap-3 rounded-xl p-2 hover:bg-surface-2 active:cursor-grabbing"
          >
            <MealThumb recipe={c.recipe} size={40} />
            <span className="min-w-0 flex-1">
              <Link to={`/reseptit/${c.recipe.id}`} className="block truncate text-sm font-medium hover:underline">{c.recipe.title}</Link>
              <span className="block text-xs text-muted">{[c.time ? `${c.time} min` : null, `${Math.round(c.kcal)} kcal`, c.recipe.rating ? `★ ${c.recipe.rating}` : null].filter(Boolean).join(' · ')}</span>
            </span>
            <GripVertical size={15} className="shrink-0 text-muted opacity-0 group-hover:opacity-100" />
            <AddButton recipeId={c.recipe.id} target={target} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddButton({ recipeId, target }: { recipeId: string; target: { date: string; slot: MealSlot } }) {
  const toast = useToast()
  const { servings } = useHousehold()
  return (
    <button
      onClick={async () => {
        const undo = await addToSlot(recipeId, target.date, target.slot, servings)
        toast(`Lisätty: ${slotLabel(target.date, target.slot)}`, 'ok', { label: 'Kumoa', onClick: undo })
      }}
      className="shrink-0 rounded-lg p-1.5 text-brand hover:bg-brand-soft"
      aria-label={`Lisää ${slotLabel(target.date, target.slot)}`}
      title={`Lisää ${slotLabel(target.date, target.slot)}`}
    >
      <Plus size={16} />
    </button>
  )
}

function ShopPreview({ days, items, recipes }: { days: string[]; items: MealItem[]; recipes: Map<string, Recipe> | undefined }) {
  const t = today()
  const upcoming = items.filter((i) => i.date >= t && days.includes(i.date) && i.recipeId && !i.leftoverOfId && i.status !== 'skipped')
  const names = new Map<string, number>()
  for (const i of upcoming) for (const ing of recipes?.get(i.recipeId!)?.ingredients ?? []) if (ing.name && !/:$/.test(ing.raw)) names.set(ing.name.toLowerCase(), (names.get(ing.name.toLowerCase()) ?? 0) + 1)
  return (
    <div>
      <p className="text-sm text-ink-2">
        {upcoming.length} tulevaa ateriaa, noin {names.size} eri ainesta.
      </p>
      <ul className="mt-3 columns-2 gap-4 text-sm">
        {[...names.keys()].sort((a, b) => a.localeCompare(b, 'fi')).slice(0, 40).map((n) => (
          <li key={n} className="truncate py-0.5">{capitalize(n)}</li>
        ))}
      </ul>
      <Link to="/ostokset" className="mt-4 flex h-10 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-on-brand">Avaa ostoslista</Link>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Month

function MonthView({ days, month, items, recipes, dayKcal, kcalTarget, onDay }: { days: string[]; month: number; items: MealItem[]; recipes: Map<string, Recipe> | undefined; dayKcal: (d: string) => number; kcalTarget: number | null; onDay: (d: string) => void }) {
  const t = today()
  return (
    <Panel className="!p-3 lg:!p-4">
      <div className="grid grid-cols-7 gap-1 pb-2 text-center text-[11px] font-semibold uppercase text-muted lg:gap-2">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{weekdayName(d, true)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 lg:gap-2">
        {days.map((d) => {
          const dayItems = items.filter((i) => i.date === d).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
          const kcal = dayKcal(d)
          const tone = dayItems.length ? dayTone(d, t, kcal, kcalTarget) : null
          const other = parseISODate(d).getMonth() !== month
          return (
            <button key={d} onClick={() => onDay(d)} className={cx('flex min-h-[64px] flex-col rounded-xl border p-1.5 text-left transition hover:border-brand lg:min-h-[120px] lg:p-2.5', d === t ? 'border-accent' : 'border-line', other && 'opacity-40')}>
              <span className="flex items-center justify-between">
                <span className="tabular text-sm font-semibold">{parseISODate(d).getDate()}</span>
                {tone && <span className={cx('h-2 w-2 rounded-full', tone === 'brand' ? 'bg-brand' : tone === 'sun' ? 'bg-sun' : 'bg-fat')} />}
              </span>
              <span className="mt-1 hidden space-y-0.5 lg:block">
                {dayItems.slice(0, 4).map((i) => (
                  <span key={i.id} className="block truncate text-[11px] text-ink-2">{(i.recipeId ? recipes?.get(i.recipeId)?.title : i.note) ?? ''}</span>
                ))}
              </span>
              <span className="mt-auto flex gap-0.5 lg:hidden">
                {dayItems.slice(0, 4).map((i) => (
                  <span key={i.id} className="h-1.5 w-1.5 rounded-full bg-brand/60" />
                ))}
              </span>
              {kcal > 0 && <span className="tabular mt-1 hidden text-[11px] text-muted lg:block">{formatNumber(kcal, 0)} kcal</span>}
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

