/**
 * Command bar: ⌘K on desktop, the (+) button on phones. One field for searching recipes, adding
 * them to a day and meal ("su lounas kana"), quick actions and navigation.
 *   ↑↓ choose · ↵ run (add to the slot, or open) · ⇧↵ open the recipe · Esc close
 */
import { ArrowRight, CalendarPlus, Copy, CornerDownLeft, Search, ShoppingCart, Sparkles, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { copyRange } from '../db/repo'
import { parseCommand, type ParsedCommand } from '../domain/command'
import { addDays, startOfWeek, today } from '../domain/dates'
import { matchesQuery } from '../domain/recipeInfo'
import { nextEmptySlot } from '../domain/today'
import type { MealSlot } from '../domain/types'
import { slotShare, suggestForSlot, quickPlanOptions, type Candidate } from '../domain/weekPlanner'
import { useApp, useToast } from './AppContext'
import { PlateArt } from './components/recipe'
import { cx } from './components/ui'
import { useMealItems } from './hooks'
import { addToSlot, fillEmptySlots, slotLabel } from './planActions'
import { useCandidates, useHousehold } from './planning'

interface CommandApi {
  open: (text?: string) => void
  close: () => void
}

const CommandContext = createContext<CommandApi>({ open: () => {}, close: () => {} })

export function useCommand(): CommandApi {
  return useContext(CommandContext)
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; text: string; key: number }>({ open: false, text: '', key: 0 })
  const open = useCallback((text = '') => setState((s) => ({ open: true, text, key: s.key + 1 })), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const api = useMemo(() => ({ open, close }), [open, close])
  return (
    <CommandContext.Provider value={api}>
      {children}
      {state.open && <CommandPalette key={state.key} initial={state.text} onClose={close} />}
    </CommandContext.Provider>
  )
}

type Row =
  | { kind: 'recipe'; c: Candidate; target: { date: string; slot: MealSlot } | null; hint: string }
  | { kind: 'action'; id: string; label: string; hint?: string; icon: ReactNode; run: () => Promise<void> | void }

function rankRecipes(candidates: Candidate[], query: string, slot: MealSlot | null): Candidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const kind = slot === 'breakfast' ? 'breakfast' : slot === 'snack' ? 'snack' : slot ? 'main' : null
  const scored: { c: Candidate; s: number }[] = []
  for (const c of candidates) {
    const title = c.recipe.title.toLowerCase()
    let s = 0
    if (title.startsWith(q)) s = 3
    else if (title.includes(q)) s = 2.2
    else if (matchesQuery(c.text, q)) s = 1
    else continue
    if (c.recipe.inCollection || c.recipe.origin !== 'catalogue') s += 0.5
    if (c.favourite) s += 0.5
    if (c.recipe.rating) s += (c.recipe.rating - 3) * 0.2
    if (!c.recipe.instructions.length) s -= 0.8
    if (kind && c.kinds.has(kind)) s += 0.6
    scored.push({ c, s })
  }
  return scored.sort((a, b) => b.s - a.s || a.c.recipe.title.localeCompare(b.c.recipe.title, 'fi')).slice(0, 8).map((x) => x.c)
}

function CommandPalette({ initial, onClose }: { initial: string; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { settings } = useApp()
  const { servings, kcalTarget } = useHousehold()
  const candidates = useCandidates()
  const [text, setText] = useState(initial)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const t = today()
  const items = useMealItems(t, addDays(t, 27))
  const parsed: ParsedCommand = useMemo(() => parseCommand(text, t), [text, t])
  const hour = new Date().getHours()

  // Where a chosen recipe goes: the parsed day/slot, filled in with the first empty slot.
  const target = useMemo(() => {
    if (!items || (!parsed.date && !parsed.slot)) return null
    if (parsed.date && parsed.slot) return { date: parsed.date, slot: parsed.slot }
    const pool = parsed.date ? items.filter((i) => i.date === parsed.date) : items
    const from = parsed.date ?? t
    const next = nextEmptySlot(pool, from, from === t ? hour : 0, { preferSlot: parsed.slot, days: parsed.date ? 1 : 14 })
    return parsed.date && !parsed.slot && next.date !== parsed.date ? { date: parsed.date, slot: 'dinner' as MealSlot } : next
  }, [items, parsed.date, parsed.slot, t, hour])
  const nextFree = useMemo(() => (items ? nextEmptySlot(items, t, hour) : null), [items, t, hour])

  const rows: Row[] = useMemo(() => {
    if (!candidates) return []
    const out: Row[] = []
    const weekEnd = addDays(startOfWeek(t, settings.weekStartsOn), 6)
    const remainingDays: string[] = []
    for (let d = t; d <= weekEnd; d = addDays(d, 1)) remainingDays.push(d)
    const actions: Row[] = [
      {
        kind: 'action', id: 'fill', label: `Täytä tämän viikon tyhjät ateriat`, hint: 'täytä', icon: <Sparkles size={17} />,
        run: async () => {
          const { added, undo } = await fillEmptySlots(candidates, remainingDays, { servings, kcalTarget })
          toast(added ? `Lisättiin ${added} ateriaa` : 'Ei tyhjiä aterioita tällä viikolla', 'ok', added ? { label: 'Kumoa', onClick: undo } : undefined)
          navigate('/viikko')
        },
      },
      {
        kind: 'action', id: 'fill-next', label: 'Täytä ensi viikko', hint: 'täytä ensi', icon: <Sparkles size={17} />,
        run: async () => {
          const start = addDays(startOfWeek(t, settings.weekStartsOn), 7)
          const { added, undo } = await fillEmptySlots(candidates, Array.from({ length: 7 }, (_, i) => addDays(start, i)), { servings, kcalTarget })
          toast(`Lisättiin ${added} ateriaa ensi viikolle`, 'ok', added ? { label: 'Kumoa', onClick: undo } : undefined)
          navigate(`/viikko?alku=${start}`)
        },
      },
      { kind: 'action', id: 'shop', label: 'Avaa ostokset', hint: 'osta', icon: <ShoppingCart size={17} />, run: () => navigate('/ostokset') },
      {
        kind: 'action', id: 'copy-week', label: 'Kopioi tämä viikko ensi viikolle', hint: 'kopioi', icon: <Copy size={17} />,
        run: async () => {
          const start = startOfWeek(t, settings.weekStartsOn)
          const n = await copyRange(start, addDays(start, 6), 7)
          toast(`Kopioitiin ${n} ateriaa ensi viikolle`)
          navigate(`/viikko?alku=${addDays(start, 7)}`)
        },
      },
      { kind: 'action', id: 'go-today', label: 'Tänään', icon: <ArrowRight size={17} />, run: () => navigate('/') },
      { kind: 'action', id: 'go-week', label: 'Viikko', icon: <ArrowRight size={17} />, run: () => navigate('/viikko') },
      { kind: 'action', id: 'go-recipes', label: 'Reseptit', icon: <ArrowRight size={17} />, run: () => navigate('/reseptit') },
      { kind: 'action', id: 'go-new', label: 'Uusi resepti', icon: <ArrowRight size={17} />, run: () => navigate('/reseptit/uusi') },
      { kind: 'action', id: 'go-import', label: 'Tuo resepti', icon: <ArrowRight size={17} />, run: () => navigate('/reseptit/tuo') },
      { kind: 'action', id: 'go-profile', label: 'Profiili ja tavoitteet', icon: <ArrowRight size={17} />, run: () => navigate('/profiili') },
      { kind: 'action', id: 'go-settings', label: 'Asetukset', icon: <ArrowRight size={17} />, run: () => navigate('/asetukset') },
    ]
    const actionMap: Record<string, string> = { fill: 'fill', shop: 'shop', 'copy-week': 'copy-week' }

    if (parsed.action) {
      const a = actions.find((x) => x.kind === 'action' && x.id === actionMap[parsed.action!])
      if (a) out.push(a)
    }
    let recipes: Candidate[]
    if (parsed.query) recipes = rankRecipes(candidates, parsed.query, target?.slot ?? null)
    else if (target) {
      const budget = kcalTarget ? Math.max(200, kcalTarget * slotShare(target.slot) * 1.15) : null
      recipes = suggestForSlot(candidates, quickPlanOptions({ dates: [target.date], people: servings, maxKcalPerDay: kcalTarget, seed: 7 }), target.date, target.slot, budget, new Set(), 6)
    } else recipes = []
    const where = target ?? nextFree
    for (const c of recipes) out.push({ kind: 'recipe', c, target: where, hint: where ? slotLabel(where.date, where.slot) : '' })
    const q = parsed.query.toLowerCase()
    for (const a of actions) {
      if (a.kind !== 'action' || out.includes(a)) continue
      if (!q ? !parsed.date && !parsed.slot : a.label.toLowerCase().includes(q) || (a.hint && a.hint.startsWith(q))) out.push(a)
    }
    return out
  }, [candidates, parsed, target, nextFree, items, t, settings.weekStartsOn, servings, kcalTarget, toast, navigate])

  useEffect(() => setIndex(0), [text])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  useEffect(() => {
    inputRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  async function run(row: Row, open = false) {
    onClose()
    if (row.kind === 'action') return row.run()
    const explicit = !!(parsed.date || parsed.slot)
    if (open || !explicit || !row.target) return navigate(`/reseptit/${row.c.recipe.id}`)
    const where = row.target!
    const undo = await addToSlot(row.c.recipe.id, where.date, where.slot, servings)
    toast(`${row.c.recipe.title} → ${slotLabel(where.date, where.slot)}`, 'ok', { label: 'Kumoa', onClick: undo })
  }

  async function addRow(row: Extract<Row, { kind: 'recipe' }>) {
    if (!row.target) return
    onClose()
    const undo = await addToSlot(row.c.recipe.id, row.target.date, row.target.slot, servings)
    toast(`${row.c.recipe.title} → ${slotLabel(row.target.date, row.target.slot)}`, 'ok', { label: 'Kumoa', onClick: undo })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && rows[index]) {
      e.preventDefault()
      const row = rows[index]
      if (row.kind === 'recipe' && e.altKey) addRow(row)
      else run(row, e.shiftKey)
    }
  }

  const explicit = !!(parsed.date || parsed.slot)
  let lastKind: Row['kind'] | null = null
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgb(10_14_12/0.45)] backdrop-blur-[2px] sm:px-4 sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Komentorivi" className="fade-in flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:max-h-[70vh] sm:max-w-[640px] sm:rounded-2xl sm:border sm:border-line">
        <div className="safe-top flex items-center gap-3 border-b border-line pb-3">
          <Search size={18} className="shrink-0 text-muted" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {parsed.tokens.map((tok) => (
              <span key={tok.kind} className={cx('rounded-md px-1.5 py-0.5 text-xs font-semibold', tok.kind === 'day' ? 'bg-sky-soft text-sky' : tok.kind === 'slot' ? 'bg-sun-soft text-warn' : 'bg-brand-soft text-brand')}>
                {tok.label}
              </span>
            ))}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Hae tai kirjoita ”su lounas kana”"
              aria-label="Hae reseptiä tai anna komento"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-results"
              aria-activedescendant={rows[index] ? `cmd-${index}` : undefined}
              className="h-9 min-w-[8rem] flex-1 bg-transparent text-base outline-none placeholder:text-muted sm:text-[15px]"
              autoComplete="off"
              enterKeyHint="go"
            />
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Sulje">
            <X size={18} />
          </button>
        </div>
        <ul ref={listRef} id="command-results" role="listbox" className="flex-1 overflow-y-auto p-2">
          {!candidates && <li className="px-3 py-6 text-center text-sm text-muted">Ladataan reseptejä…</li>}
          {candidates && rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Ei osumia. Kokeile toista sanaa.</li>}
          {rows.map((row, i) => {
            const header = row.kind !== lastKind ? (row.kind === 'recipe' ? (explicit && target ? `Reseptit · ${slotLabel(target.date, target.slot)}` : 'Reseptit') : 'Toiminnot') : null
            lastKind = row.kind
            return (
              <li key={row.kind === 'recipe' ? row.c.recipe.id : row.id} role="presentation">
                {header && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted first:pt-1">{header}</p>}
                <div
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(row)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', i === index ? 'bg-surface-2' : '')}
                >
                  {row.kind === 'recipe' ? (
                    <>
                      <PlateArtOrImage c={row.c} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.c.recipe.title}</span>
                        <span className="block truncate text-xs text-muted">
                          {[row.c.time ? `${row.c.time} min` : null, row.c.kcal ? `${Math.round(row.c.kcal)} kcal` : null, row.c.recipe.rating ? `★ ${row.c.recipe.rating}` : null, row.c.recipe.origin === 'catalogue' ? row.c.recipe.sourceName : 'oma'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {row.target && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            addRow(row)
                          }}
                          className="hidden shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand sm:inline-flex"
                          title={`Lisää: ${row.hint}`}
                        >
                          <CalendarPlus size={13} /> {row.hint}
                        </button>
                      )}
                      {i === index && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
                    </>
                  ) : (
                    <>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">{row.icon}</span>
                      <span className="flex-1 text-sm font-medium">{row.label}</span>
                      {row.hint && <span className="text-xs text-muted">{row.hint}</span>}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="hidden items-center gap-4 border-t border-line bg-surface-2/50 px-4 py-2 text-[11px] text-muted sm:flex">
          <span>↑↓ valitse</span>
          <span>↵ {explicit ? 'lisää' : 'avaa'}</span>
          <span>⇧↵ avaa resepti</span>
          <span>⌥↵ lisää ensimmäiseen tyhjään</span>
          <span className="ml-auto">Esim. ”huomenna lounas”, ”ensi ma pasta”, ”täytä”</span>
        </div>
      </div>
    </div>
  )
}

function PlateArtOrImage({ c }: { c: Candidate }) {
  const r = c.recipe
  return r.imageUrl ? (
    <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
  ) : (
    <PlateArt recipe={r} className="h-9 w-9 shrink-0" rounded="rounded-lg" />
  )
}
