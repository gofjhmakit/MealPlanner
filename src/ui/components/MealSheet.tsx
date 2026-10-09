/**
 * The meal sheet: everything you do to one planned meal. Swaps that are already worked out
 * ("−192 kcal"), leftovers for tomorrow, move, copy, servings, eaten/skipped, open, remove.
 * A bottom sheet on phones, a side panel on desktop.
 */
import { ArrowRight, Check, ChefHat, Copy, MoveRight, RefreshCw, Repeat2, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { duplicateMealItem, moveMealItem, planLeftover, removeMealItem, restoreMealItem, setMealServings, setMealStatus, swapMealRecipe } from '../../db/repo'
import { addDays, capitalize, formatDate, today, weekdayName } from '../../domain/dates'
import { recipeTime } from '../../domain/recipeInfo'
import type { MealItem, MealSlot, Recipe } from '../../domain/types'
import { quickPlanOptions, slotShare, suggestForSlot } from '../../domain/weekPlanner'
import { useToast } from '../AppContext'
import { SLOT_LABELS } from '../hooks'
import { slotLabel } from '../planActions'
import { useCandidates, useHousehold } from '../planning'
import { cx, Stepper } from './ui'
import { MealThumb, Sheet } from './v2'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']

export function MealSheet({ item, recipe, kcal, dayKcal, onClose }: { item: MealItem | null; recipe: Recipe | undefined; kcal: number | null; dayKcal: number; onClose: () => void }) {
  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={
        item && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {capitalize(weekdayName(item.date, true))} {formatDate(item.date)} · {SLOT_LABELS[item.slot]}
              {item.leftoverOfId ? ' · tähteet' : ''}
            </p>
            <h2 className="mt-0.5 font-display text-xl font-semibold leading-snug">{recipe?.title ?? item.note ?? 'Ateria'}</h2>
          </div>
        )
      }
    >
      {item && <MealSheetBody key={item.id} item={item} recipe={recipe} kcal={kcal} dayKcal={dayKcal} onClose={onClose} />}
    </Sheet>
  )
}

export function MealSheetBody({ item, recipe, kcal, dayKcal, onClose }: { item: MealItem; recipe: Recipe | undefined; kcal: number | null; dayKcal: number; onClose: () => void }) {
  const toast = useToast()
  const candidates = useCandidates()
  const { servings: householdServings, kcalTarget } = useHousehold()
  const [seed, setSeed] = useState(1)
  const [mode, setMode] = useState<'main' | 'move' | 'copy'>('main')

  const swaps = useMemo(() => {
    if (!candidates || !recipe) return []
    const opts = quickPlanOptions({ dates: [item.date], people: householdServings, maxKcalPerDay: kcalTarget, seed })
    // Room for this meal: what's left of the day's target without it, else about its own size.
    const budget = kcalTarget ? Math.max(200, Math.min(kcalTarget - (dayKcal - (kcal ?? 0)), kcalTarget * slotShare(item.slot) * 1.5)) : kcal ? kcal * 1.3 : null
    return suggestForSlot(candidates, opts, item.date, item.slot, budget, new Set([recipe.id]), 3)
  }, [candidates, recipe, item.date, item.slot, householdServings, kcalTarget, seed, dayKcal, kcal])

  async function swap(id: string, title: string) {
    const snapshot = await swapMealRecipe(item.id, id)
    toast(`Vaihdettu: ${title}`, 'ok', { label: 'Kumoa', onClick: () => restoreMealItem(snapshot) })
    onClose()
  }

  async function remove() {
    const snapshot = await removeMealItem(item.id)
    toast('Ateria poistettu', 'ok', { label: 'Kumoa', onClick: () => restoreMealItem(snapshot) })
    onClose()
  }

  if (mode !== 'main') {
    return (
      <SlotPicker
        title={mode === 'move' ? 'Siirrä' : 'Kopioi'}
        from={item.date}
        exclude={{ date: item.date, slot: item.slot }}
        onCancel={() => setMode('main')}
        onPick={async (date, slot) => {
          if (mode === 'move') {
            const prev = { date: item.date, slot: item.slot }
            await moveMealItem(item.id, date, slot)
            toast(`Siirretty: ${slotLabel(date, slot)}`, 'ok', { label: 'Kumoa', onClick: () => moveMealItem(item.id, prev.date, prev.slot) })
          } else {
            await duplicateMealItem(item.id, { date, slot })
            toast(`Kopioitu: ${slotLabel(date, slot)}`)
          }
          onClose()
        }}
      />
    )
  }

  const tomorrow = addDays(item.date, 1)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Stepper size="sm" value={item.servings} onChange={(v) => setMealServings(item.id, v)} min={0.5} step={item.servings < 2 ? 0.5 : 1} label="Annokset" suffix="annosta" />
        {kcal !== null && <span className="tabular text-sm text-ink-2">≈ {Math.round(kcal)} kcal / annos</span>}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Tila">
        {(
          [
            [null, 'Suunniteltu'],
            ['eaten', 'Syöty'],
            ['skipped', 'Jätetty väliin'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            role="radio"
            aria-checked={(item.status ?? null) === value}
            onClick={() => setMealStatus(item.id, value)}
            className={cx('flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium', (item.status ?? null) === value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
          >
            {value === 'eaten' && <Check size={13} />}
            {label}
          </button>
        ))}
      </div>

      {recipe && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Vaihda · sopii päivään</p>
            <button onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2" aria-label="Uudet ehdotukset">
              <RefreshCw size={13} /> Uudet
            </button>
          </div>
          {!candidates ? (
            <p className="text-sm text-muted">Haetaan ehdotuksia…</p>
          ) : swaps.length === 0 ? (
            <p className="text-sm text-muted">Ei sopivia vaihtoehtoja.</p>
          ) : (
            <ul className="grid gap-2">
              {swaps.map((c) => {
                const delta = kcal !== null ? Math.round(c.kcal - kcal) : null
                const time = recipeTime(c.recipe)
                return (
                  <li key={c.recipe.id}>
                    <button onClick={() => swap(c.recipe.id, c.recipe.title)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-2.5 text-left transition hover:border-brand hover:bg-brand-soft/40">
                      <MealThumb recipe={c.recipe} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.recipe.title}</span>
                        <span className="block text-xs text-muted">{[time ? `${time} min` : null, `${Math.round(c.kcal)} kcal`].filter(Boolean).join(' · ')}</span>
                      </span>
                      {delta !== null && (
                        <span className={cx('tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', delta <= 0 ? 'bg-brand-soft text-brand' : 'bg-accent-soft text-accent')}>
                          {delta > 0 ? '+' : '−'}
                          {Math.abs(delta)} kcal
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {recipe && !item.leftoverOfId && (
          <SheetAction
            icon={<Repeat2 size={18} />}
            label="Tähteet huomiseksi"
            onClick={async () => {
              const left = await planLeftover(item.id, { date: tomorrow, slot: 'lunch' })
              toast(`Tähteet: ${slotLabel(tomorrow, 'lunch')}`, 'ok', left ? { label: 'Kumoa', onClick: async () => void (await removeMealItem(left.id)) } : undefined)
              onClose()
            }}
          />
        )}
        <SheetAction icon={<MoveRight size={18} />} label="Siirrä" onClick={() => setMode('move')} />
        <SheetAction icon={<Copy size={18} />} label="Kopioi" onClick={() => setMode('copy')} />
        <SheetAction icon={<Trash2 size={18} />} label="Poista" onClick={remove} tone="bad" />
      </div>

      {recipe && (
        <div className="flex gap-2">
          <Link to={`/reseptit/${recipe.id}?kokkaa=1&annokset=${item.servings + (item.extraServings ?? 0)}`} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-on-brand">
            <ChefHat size={17} /> Aloita kokkaus
          </Link>
          <Link to={`/reseptit/${recipe.id}`} className="flex h-11 items-center justify-center gap-1 rounded-xl border border-line px-4 text-sm font-medium">
            Resepti <ArrowRight size={15} />
          </Link>
        </div>
      )}
      {item.status && (
        <button onClick={() => setMealStatus(item.id, null)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <Undo2 size={12} /> Palauta suunnitelluksi
        </button>
      )}
    </div>
  )
}

function SheetAction({ icon, label, onClick, tone }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: 'bad' }) {
  return (
    <button onClick={onClick} className={cx('flex flex-col items-center gap-1.5 rounded-2xl border border-line px-2 py-3 text-xs font-medium transition hover:bg-surface-2', tone === 'bad' ? 'text-bad' : 'text-ink-2')}>
      {icon}
      {label}
    </button>
  )
}

/** Pick a day (next 14 days) and a meal. */
export function SlotPicker({ title, from, exclude, onPick, onCancel }: { title: string; from: string; exclude?: { date: string; slot: MealSlot }; onPick: (date: string, slot: MealSlot) => void; onCancel: () => void }) {
  const start = from < today() ? from : today()
  const [date, setDate] = useState(from)
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i))
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{title}: valitse päivä ja ateria</p>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => (
          <button key={d} onClick={() => setDate(d)} className={cx('flex flex-col items-center rounded-xl border py-1.5 text-xs', d === date ? 'border-brand bg-brand text-on-brand' : 'border-line hover:bg-surface-2')}>
            <span className="font-semibold uppercase">{weekdayName(d, true)}</span>
            <span className="tabular">{formatDate(d)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((slot) => (
          <button
            key={slot}
            disabled={exclude?.date === date && exclude.slot === slot}
            onClick={() => onPick(date, slot)}
            className="rounded-xl border border-line px-3 py-3 text-sm font-medium hover:border-brand hover:text-brand disabled:opacity-40"
          >
            {SLOT_LABELS[slot]}
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="text-sm text-muted hover:text-ink">
        Takaisin
      </button>
    </div>
  )
}
