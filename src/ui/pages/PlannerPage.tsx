import { CalendarPlus, ChevronLeft, ChevronRight, Copy, CopyPlus, MoreHorizontal, MoveRight, Plus, Printer, ShoppingCart, Soup, Sparkles, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { addMealItem, addNoteMeal, clearRange, copyDay, copyRange, createShoppingList, duplicateMealItem, moveMealItem, planLeftover, removeMealItem, restoreMealItem, setMealServings } from '../../db/repo'
import { addDays, capitalize, daysBetween, formatDate, isoWeek, startOfWeek, today, weekdayName } from '../../domain/dates'
import { MEAL_SLOTS, type MealItem, type MealSlot, type Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp, useToast } from '../AppContext'
import { RecipePickerDialog } from '../components/dialogs'
import { PageHeader } from '../components/Layout'
import { RecipeImage } from '../components/recipe'
import { Button, Chip, cx, IconButton, Modal, Stepper, TextInput } from '../components/ui'
import { SLOT_LABELS, useMealItems, usePlanNutrition, useRecipesById, type PlanNutrition } from '../hooks'

type ViewMode = 'day' | 'week' | 'range'
const DRAG_TYPE = 'application/x-meal-item'

export function PlannerPage() {
  const { settings, fineli } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [mode, setMode] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(today())
  const [rangeFrom, setRangeFrom] = useState(today())
  const [rangeTo, setRangeTo] = useState(addDays(today(), 13))
  const [picker, setPicker] = useState<{ date: string; slot: MealSlot } | null>(null)
  const [moving, setMoving] = useState<MealItem | null>(null)
  const [copyingDay, setCopyingDay] = useState<string | null>(null)

  const { from, to } = useMemo(() => {
    if (mode === 'day') return { from: anchor, to: anchor }
    if (mode === 'week') {
      const start = startOfWeek(anchor, settings.weekStartsOn)
      return { from: start, to: addDays(start, 6) }
    }
    return rangeFrom <= rangeTo ? { from: rangeFrom, to: rangeTo } : { from: rangeTo, to: rangeFrom }
  }, [mode, anchor, rangeFrom, rangeTo, settings.weekStartsOn])
  const days = useMemo(() => daysBetween(from, to).slice(0, 62), [from, to])

  const items = useMealItems(from, to)
  const recipes = useRecipesById((items ?? []).map((i) => i.recipeId))
  const nutrition = usePlanNutrition(items, recipes)

  const step = (dir: -1 | 1) => setAnchor((a) => addDays(a, dir * (mode === 'day' ? 1 : 7)))

  async function pick(recipe: Recipe) {
    if (!picker) return
    await addMealItem({ date: picker.date, slot: picker.slot, recipeId: recipe.id, servings: settings.defaultServings })
    toast(`${recipe.title} lisätty`)
    setPicker(null)
  }

  async function addNote(note: string) {
    if (!picker || !note.trim()) return
    await addNoteMeal(picker.date, picker.slot, note)
    toast('Muistiinpano lisätty')
    setPicker(null)
  }

  async function copyToNext() {
    if (!items?.length) return
    const offset = mode === 'week' ? 7 : days.length
    const n = await copyRange(from, to, offset)
    toast(`${n} ateriaa kopioitu ${mode === 'week' ? 'seuraavalle viikolle' : 'seuraavalle jaksolle'}`)
    setAnchor((a) => addDays(a, offset))
    if (mode === 'range') {
      setRangeFrom(addDays(from, offset))
      setRangeTo(addDays(to, offset))
    }
  }

  async function makeShoppingList() {
    const name = mode === 'week' ? `Viikko ${isoWeek(from)} (${formatDate(from)}–${formatDate(to)})` : `${formatDate(from)}–${formatDate(to)}`
    const id = await createShoppingList(from, to, name, fineli)
    toast('Ostoslista luotu')
    navigate(`/ostoslista?lista=${id}`)
  }

  async function clear() {
    if (!items?.length) return
    if (!confirm(`Poistetaanko kaikki ${items.length} ateriamerkintää väliltä ${formatDate(from)}–${formatDate(to)}?`)) return
    await clearRange(from, to)
    toast('Ruokalista tyhjennetty')
  }

  const title =
    mode === 'week'
      ? `Viikko ${isoWeek(from)}`
      : mode === 'day'
        ? `${capitalize(weekdayName(anchor))} ${formatDate(anchor)}`
        : `${formatDate(from)} – ${formatDate(to, { year: true })}`

  return (
    <div className="fade-in">
      <PageHeader
        title="Ruokalista"
        subtitle={mode === 'week' ? `${formatDate(from)} – ${formatDate(to, { year: true })}` : undefined}
        actions={
          <>
            <Link to="/ruokalista/suunnittele"><Button icon={<Sparkles size={16} />}>Suunnittele puolestani</Button></Link>
            <Button variant="secondary" icon={<ShoppingCart size={16} />} onClick={makeShoppingList} disabled={!items?.some((i) => i.recipeId)}>Luo ostoslista</Button>
            <IconButton label={mode === 'week' ? 'Kopioi viikko seuraavalle viikolle' : 'Kopioi jakso eteenpäin'} onClick={copyToNext} disabled={!items?.length}><CalendarPlus size={18} /></IconButton>
            <IconButton label="Tulosta ruokalista" onClick={() => window.print()}><Printer size={18} /></IconButton>
            <IconButton label="Tyhjennä näkyvä ajanjakso" onClick={clear} disabled={!items?.length}><Trash2 size={18} /></IconButton>
          </>
        }
      />

      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-surface-2 p-1">
          {(['day', 'week', 'range'] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-surface shadow-sm' : 'text-ink-2')} aria-pressed={mode === m}>
              {m === 'day' ? 'Päivä' : m === 'week' ? 'Viikko' : 'Aikaväli'}
            </button>
          ))}
        </div>
        {mode !== 'range' ? (
          <div className="flex items-center gap-1">
            <IconButton label="Edellinen" onClick={() => step(-1)}><ChevronLeft size={18} /></IconButton>
            <span className="min-w-[9rem] text-center font-medium">{title}</span>
            <IconButton label="Seuraava" onClick={() => step(1)}><ChevronRight size={18} /></IconButton>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(today())}>Tänään</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <TextInput type="date" value={rangeFrom} onChange={(e) => e.target.value && setRangeFrom(e.target.value)} className="max-w-44" aria-label="Alkaen" />
            –
            <TextInput type="date" value={rangeTo} onChange={(e) => e.target.value && setRangeTo(e.target.value)} className="max-w-44" aria-label="Päättyen" />
          </div>
        )}
      </div>

      {mode === 'week' ? (
        <>
          <div className="hidden lg:block">
            <WeekGrid days={days} items={items ?? []} recipes={recipes} nutrition={nutrition} onAdd={setPicker} onMove={setMoving} onCopyDay={setCopyingDay} />
          </div>
          <div className="lg:hidden">
            <DayList days={days} items={items ?? []} recipes={recipes} nutrition={nutrition} onAdd={setPicker} onMove={setMoving} onCopyDay={setCopyingDay} />
          </div>
        </>
      ) : (
        <DayList days={days} items={items ?? []} recipes={recipes} nutrition={nutrition} onAdd={setPicker} onMove={setMoving} onCopyDay={setCopyingDay} />
      )}

      <p className="no-print mt-4 text-xs text-muted">
        Vinkki: vedä ateria toiseen päivään tai ateriaan. Pidä Alt/Option-näppäin pohjassa pudottaessa, niin ateria kopioidaan. Kalorit ovat Fineli-pohjaisia arvioita yhdelle henkilölle (yksi annos kustakin ateriasta).
      </p>

      <RecipePickerDialog open={!!picker} onClose={() => setPicker(null)} onPick={pick} onNote={addNote} title={picker ? `Lisää: ${capitalize(weekdayName(picker.date))} ${formatDate(picker.date)} · ${SLOT_LABELS[picker.slot]}` : ''} />
      <MoveDialog item={moving} onClose={() => setMoving(null)} />
      <CopyDayDialog from={copyingDay} onClose={() => setCopyingDay(null)} />
    </div>
  )
}

interface GridProps {
  days: string[]
  items: MealItem[]
  recipes: Map<string, Recipe> | undefined
  nutrition: PlanNutrition | null
  onAdd: (t: { date: string; slot: MealSlot }) => void
  onMove: (item: MealItem) => void
  onCopyDay: (date: string) => void
}

function itemsFor(items: MealItem[], date: string, slot: MealSlot) {
  return items.filter((i) => i.date === date && i.slot === slot).sort((a, b) => a.position - b.position)
}

function useDropTarget(date: string, slot: MealSlot) {
  const [over, setOver] = useState(false)
  const toast = useToast()
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
          setOver(true)
        }
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: DragEvent) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData(DRAG_TYPE)
        if (!id) return
        if (e.altKey) {
          await duplicateMealItem(id, { date, slot })
          toast('Ateria kopioitu')
        } else await moveMealItem(id, date, slot)
      },
    },
  }
}

function WeekGrid({ days, items, recipes, nutrition, onAdd, onMove, onCopyDay }: GridProps) {
  const t = today()
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="grid min-w-[980px]" style={{ gridTemplateColumns: `6.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-line" />
        {days.map((d) => (
          <div key={d} className={cx('group/day relative border-b border-l border-line px-3 py-2.5', d === t && 'bg-brand-soft/60')}>
            <p className={cx('text-xs font-medium uppercase tracking-wide', d === t ? 'text-brand' : 'text-muted')}>{weekdayName(d, true)}</p>
            <p className="font-display text-lg font-semibold leading-tight">{formatDate(d)}</p>
            {items.some((i) => i.date === d) && (
              <IconButton label={`Kopioi päivä ${formatDate(d)}`} onClick={() => onCopyDay(d)} className="no-print absolute right-1 top-1.5 h-7 w-7 opacity-0 focus:opacity-100 group-hover/day:opacity-100">
                <Copy size={14} />
              </IconButton>
            )}
          </div>
        ))}
        {MEAL_SLOTS.map((slot) => (
          <div key={slot} className="contents">
            <div className="border-b border-line px-3 py-3 text-sm font-medium text-ink-2">{SLOT_LABELS[slot]}</div>
            {days.map((d) => (
              <Cell key={d + slot} date={d} slot={slot} items={itemsFor(items, d, slot)} recipes={recipes} nutrition={nutrition} onAdd={onAdd} onMove={onMove} isToday={d === t} />
            ))}
          </div>
        ))}
        <div className="px-3 py-3 text-xs font-medium text-muted">Yhteensä / henkilö</div>
        {days.map((d) => {
          const n = nutrition?.byDay.get(d)
          return (
            <div key={d} className="border-l border-line px-3 py-3 text-sm">
              {n ? (
                <Link to={`/ravintosisalto?paiva=${d}`} className="tabular hover:text-brand" title="Arvioitu energia – avaa ravintosisältö">
                  ≈ {formatNumber(Math.round(n.nutrients.energyKcal), 0)} kcal
                  <span className="block text-xs text-muted">P {formatNumber(n.nutrients.protein, 0)} g</span>
                </Link>
              ) : (
                <span className="text-muted">–</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Cell({ date, slot, items, recipes, nutrition, onAdd, onMove, isToday }: { date: string; slot: MealSlot; items: MealItem[]; isToday: boolean } & Pick<GridProps, 'recipes' | 'nutrition' | 'onAdd' | 'onMove'>) {
  const drop = useDropTarget(date, slot)
  return (
    <div {...drop.props} className={cx('group/cell min-h-[5.5rem] border-b border-l border-line p-1.5 transition', drop.over && 'bg-brand-soft', isToday && !drop.over && 'bg-brand-soft/30')}>
      <div className="space-y-1.5">
        {items.map((item) => (
          <MealItemCard key={item.id} item={item} recipe={item.recipeId ? recipes?.get(item.recipeId) : undefined} kcal={nutrition?.byItem.get(item.id)?.nutrients.energyKcal} onMove={onMove} compact />
        ))}
      </div>
      <button
        onClick={() => onAdd({ date, slot })}
        className={cx('mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink', items.length > 0 && 'opacity-0 focus:opacity-100 group-hover/cell:opacity-100')}
        aria-label={`Lisää ${SLOT_LABELS[slot].toLowerCase()} ${formatDate(date)}`}
      >
        <Plus size={14} /> Lisää
      </button>
    </div>
  )
}

function DayList({ days, items, recipes, nutrition, onAdd, onMove, onCopyDay }: GridProps) {
  const t = today()
  return (
    <div className="space-y-4">
      {days.map((d) => {
        const n = nutrition?.byDay.get(d)
        const dayItems = items.filter((i) => i.date === d)
        return (
          <section key={d} className={cx('rounded-2xl border bg-surface', d === t ? 'border-brand' : 'border-line')}>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="font-display text-lg font-semibold">
                {capitalize(weekdayName(d))} <span className="text-ink-2">{formatDate(d)}</span>
                {d === t && <span className="ml-2 align-middle text-xs font-medium text-brand">Tänään</span>}
              </h2>
              <span className="flex items-center gap-1">
                {n && (
                  <Link to={`/ravintosisalto?paiva=${d}`} className="tabular text-sm text-ink-2 hover:text-brand">
                    ≈ {formatNumber(Math.round(n.nutrients.energyKcal), 0)} kcal/hlö
                  </Link>
                )}
                {dayItems.length > 0 && (
                  <IconButton label={`Kopioi päivä ${formatDate(d)}`} onClick={() => onCopyDay(d)} className="no-print h-8 w-8">
                    <Copy size={15} />
                  </IconButton>
                )}
              </span>
            </header>
            <div className="divide-y divide-line">
              {MEAL_SLOTS.map((slot) => {
                const slotItems = itemsFor(dayItems, d, slot)
                if (slotItems.length === 0 && slot === 'other') return null
                return <DaySlot key={slot} date={d} slot={slot} items={slotItems} recipes={recipes} nutrition={nutrition} onAdd={onAdd} onMove={onMove} />
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function DaySlot({ date, slot, items, recipes, nutrition, onAdd, onMove }: { date: string; slot: MealSlot; items: MealItem[] } & Pick<GridProps, 'recipes' | 'nutrition' | 'onAdd' | 'onMove'>) {
  const drop = useDropTarget(date, slot)
  return (
    <div {...drop.props} className={cx('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start', drop.over && 'bg-brand-soft')}>
      <span className="w-28 shrink-0 pt-1 text-sm font-medium text-ink-2">{SLOT_LABELS[slot]}</span>
      <div className="flex-1 space-y-2">
        {items.map((item) => (
          <MealItemCard key={item.id} item={item} recipe={item.recipeId ? recipes?.get(item.recipeId) : undefined} kcal={nutrition?.byItem.get(item.id)?.nutrients.energyKcal} onMove={onMove} />
        ))}
        <button onClick={() => onAdd({ date, slot })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <Plus size={15} /> {items.length ? 'Lisää toinen' : 'Lisää'}
        </button>
      </div>
    </div>
  )
}

function MealItemCard({ item, recipe, kcal, onMove, compact }: { item: MealItem; recipe: Recipe | undefined; kcal?: number; onMove: (i: MealItem) => void; compact?: boolean }) {
  const [menu, setMenu] = useState(false)
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const isNote = !item.recipeId
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      className={cx('relative cursor-grab rounded-xl border border-line bg-canvas active:cursor-grabbing', compact ? 'p-2' : 'flex items-center gap-3 p-2')}
    >
      {!compact && recipe && <RecipeImage recipe={recipe} className="h-12 w-12 shrink-0" rounded="rounded-lg" />}
      {!compact && isNote && (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><StickyNote size={20} /></span>
      )}
      <div className="min-w-0 flex-1">
        {isNote ? (
          <p className={cx('flex items-start gap-1 font-medium leading-snug text-ink-2', compact ? 'line-clamp-3 pr-7 text-xs' : 'text-sm')}>
            {compact && <StickyNote size={12} className="mt-0.5 shrink-0" />}
            {item.note}
          </p>
        ) : (
          <Link to={`/reseptit/${item.recipeId}`} className={cx('block font-medium leading-snug hover:text-brand', compact ? 'line-clamp-2 pr-7 text-xs' : 'truncate text-sm')}>
            {recipe?.title ?? 'Poistettu resepti'}
          </Link>
        )}
        {(item.extraServings ?? 0) > 0 && (
          <p className={cx('mt-1 flex items-center gap-1 font-medium text-accent', compact ? 'text-[10px] leading-tight' : 'text-xs')} title="Näistä annoksista syödään myöhemmin tähteinä">
            <Soup size={compact ? 11 : 13} /> +{formatNumber(item.extraServings!, 1)} ann. tähteiksi
          </p>
        )}
        {item.leftoverOfId && (
          <p className={cx('mt-1 flex items-center gap-1 font-medium text-brand', compact ? 'text-[10px] leading-tight' : 'text-xs')} title="Syödään aiemmin valmistettuja tähteitä – ei lisätä ostoslistalle uudelleen">
            <Soup size={compact ? 11 : 13} /> Tähteet
          </p>
        )}
        {!isNote && (
          <div className={cx('mt-1 flex items-center gap-2', compact && 'justify-between')}>
            <Stepper size={compact ? 'xs' : 'sm'} value={item.servings} onChange={(v) => setMealServings(item.id, v)} min={0.5} step={item.servings < 2 ? 0.5 : 1} label="Annokset" />
            {kcal && !compact ? <span className="tabular text-xs text-muted" title="Arvio yhtä annosta kohden">≈ {Math.round(kcal)} kcal/annos</span> : null}
          </div>
        )}
      </div>
      <IconButton label="Toiminnot" onClick={() => setMenu((m) => !m)} className={cx(compact ? 'absolute right-0.5 top-0.5 h-7 w-7' : '')} aria-expanded={menu}>
        <MoreHorizontal size={16} />
      </IconButton>
      {menu && (
        <div className="absolute right-1 top-9 z-20 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-lg" role="menu">
          <MenuItem icon={<Copy size={15} />} onClick={async () => { await duplicateMealItem(item.id); toast('Ateria monistettu'); setMenu(false) }}>Monista</MenuItem>
          <MenuItem icon={<CopyPlus size={15} />} onClick={async () => { await duplicateMealItem(item.id, { date: addDays(item.date, 1), slot: item.slot }); toast('Kopioitu seuraavalle päivälle'); setMenu(false) }}>Kopioi huomiselle</MenuItem>
          <MenuItem icon={<MoveRight size={15} />} onClick={() => { onMove(item); setMenu(false) }}>Siirrä…</MenuItem>
          {!isNote && !item.leftoverOfId && (
            <MenuItem
              icon={<Soup size={15} />}
              onClick={async () => {
                setMenu(false)
                await planLeftover(item.id)
                toast(`Tehdään ${formatNumber(item.servings, 1)} annosta lisää huomisen lounaaksi`)
              }}
            >
              Tähteet huomisen lounaaksi
            </MenuItem>
          )}
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            onClick={async () => {
              setMenu(false)
              const snapshot = await removeMealItem(item.id)
              if (snapshot.length) {
                const extra = snapshot.length > 1 && !item.leftoverOfId ? ' ja sen tähdeateriat' : ''
                toast(`Poistettu: ${recipe?.title ?? item.note ?? 'ateria'}${extra}`, 'ok', { label: 'Kumoa', onClick: () => restoreMealItem(snapshot) })
              }
            }}
          >
            Poista
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cx('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2', danger && 'text-bad')}>
      {icon}
      {children}
    </button>
  )
}

function MoveDialog({ item, onClose }: { item: MealItem | null; onClose: () => void }) {
  const [date, setDate] = useState(today())
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [lastId, setLastId] = useState<string | null>(null)
  if (item && item.id !== lastId) {
    setLastId(item.id)
    setDate(item.date)
    setSlot(item.slot)
  }
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title="Siirrä ateria"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              if (item) await duplicateMealItem(item.id, { date, slot })
              onClose()
            }}
          >
            Kopioi
          </Button>
          <Button
            onClick={async () => {
              if (item) await moveMealItem(item.id, date, slot)
              onClose()
            }}
          >
            Siirrä
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextInput type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Päivä" className="max-w-44" />
        <div className="flex flex-wrap gap-2">
          {MEAL_SLOTS.map((s) => (
            <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>{SLOT_LABELS[s]}</Chip>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function CopyDayDialog({ from, onClose }: { from: string | null; onClose: () => void }) {
  const toast = useToast()
  const [target, setTarget] = useState(today())
  const [last, setLast] = useState<string | null>(null)
  if (from && from !== last) {
    setLast(from)
    setTarget(addDays(from, 7))
  }
  return (
    <Modal
      open={!!from}
      onClose={onClose}
      title={from ? `Kopioi ${weekdayName(from)} ${formatDate(from)}` : 'Kopioi päivä'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button
            onClick={async () => {
              if (!from) return
              const n = await copyDay(from, target)
              toast(`${n} ateriaa kopioitu päivälle ${formatDate(target)}`)
              onClose()
            }}
          >
            Kopioi
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">Päivän kaikki ateriat kopioidaan valitulle päivälle (olemassa olevat ateriat säilyvät).</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {from && [1, 7].map((n) => (
          <Chip key={n} active={target === addDays(from, n)} onClick={() => setTarget(addDays(from, n))}>{n === 1 ? 'Seuraava päivä' : 'Sama päivä ensi viikolla'}</Chip>
        ))}
      </div>
      <TextInput type="date" value={target} onChange={(e) => e.target.value && setTarget(e.target.value)} aria-label="Kohdepäivä" className="max-w-44" />
    </Modal>
  )
}
