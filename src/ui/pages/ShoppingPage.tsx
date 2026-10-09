/**
 * Ostokset – one always-current list for the next trip (Draft 1 + Draft 3):
 *   • covers today → N days and follows the meal plan automatically (no "update" button)
 *   • "onko kotona?" check first: seasonings and small amounts go to "Kotona" with one tap
 *   • by aisle or by dish; amounts rounded to what you buy
 *   • Kaupassa-tila: big one-hand rows, tap to tick, bought items sink
 * Older named lists from v1 stay reachable at the bottom (?lista=id).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, Home, Plus, Printer, RotateCcw, Share2, ShoppingBasket, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { db } from '../../db/db'
import {
  addManualShoppingItem,
  deleteShoppingList,
  newShoppingTrip,
  regenerateShoppingList,
  removeExtraRecipe,
  removeShoppingItem,
  restoreShoppingItem,
  ROLLING_LIST_ID,
  saveUserSettings,
  setShoppingHome,
  setShoppingItemCategory,
  syncRollingList,
  toggleShoppingItem,
} from '../../db/repo'
import { capitalize, formatDate, today, weekdayName } from '../../domain/dates'
import { CATEGORY_LABELS, formatShoppingAmount, isStapleLike, pantryMatcher, shoppingListText } from '../../domain/shoppingList'
import { SHOPPING_CATEGORIES, type Recipe, type ShoppingCategory, type ShoppingItem, type ShoppingList } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { Button, cx, Select, Spinner } from '../components/ui'
import { MealThumb, Panel, Segmented } from '../components/v2'
import { useMealItems, useRecipesById } from '../hooks'

type View = 'aisle' | 'dish' | 'home'
type RecipeMap = Map<string, Recipe> | undefined

export function ShoppingPage() {
  const { fineli } = useApp()
  const [params, setParams] = useSearchParams()
  const requested = params.get('lista')
  const [ready, setReady] = useState(false)
  // Keep the rolling list in step with today's date and the plan.
  const t = today()
  const planStamp = useLiveQuery(async () => {
    const items = await db.mealItems.where('date').aboveOrEqual(t).toArray()
    return items.map((i) => `${i.id}:${i.recipeId}:${i.servings}:${i.extraServings ?? 0}:${i.date}:${i.slot}`).join('|')
  }, [t])
  useEffect(() => {
    if (planStamp === undefined) return
    let cancelled = false
    syncRollingList(fineli).then(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
  }, [planStamp, fineli])

  const others = useLiveQuery(() => db.shoppingLists.filter((l) => l.id !== ROLLING_LIST_ID).reverse().sortBy('createdAt'), [])
  const listId = requested && others?.some((l) => l.id === requested) ? requested : ROLLING_LIST_ID
  if (!ready && listId === ROLLING_LIST_ID) return <Spinner label="Kootaan ostoksia…" />
  return (
    <div className="fade-in">
      <ListView key={listId} listId={listId} onBack={() => setParams({})} />
      {others && others.length > 0 && (
        <details className="no-print mt-8 text-sm text-muted">
          <summary className="cursor-pointer">Aiemmat ostoslistat ({others.length})</summary>
          <ul className="mt-2 space-y-1">
            {others.map((l) => (
              <li key={l.id}>
                <button onClick={() => setParams({ lista: l.id })} className="text-brand hover:underline">{l.name}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ListView({ listId, onBack }: { listId: string; onBack: () => void }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const list = useLiveQuery(() => db.shoppingLists.get(listId), [listId])
  const items = useLiveQuery(() => db.shoppingItems.where('listId').equals(listId).toArray(), [listId])
  const [view, setView] = useState<View>('aisle')
  const [storeMode, setStoreMode] = useState(false)
  const [adding, setAdding] = useState(false)
  const inPantry = useMemo(() => pantryMatcher(settings.pantry), [settings.pantry])
  const rolling = !!list?.rolling
  const hasRange = !!list && list.from <= list.to
  const meals = useMealItems(hasRange ? list!.from : '9999-12-31', hasRange ? list!.to : '0000-01-01')
  const mealRecipes = useRecipesById((meals ?? []).map((m) => m.recipeId))

  const homeKeys = list?.homeKeys
  const { toBuy, home, triage } = useMemo(() => {
    const homeSet = new Set(homeKeys ?? [])
    const isHome = (i: ShoppingItem) => !i.manual && (homeSet.has(i.key) || inPantry(i))
    const all = items ?? []
    return {
      toBuy: all.filter((i) => !isHome(i)),
      home: all.filter(isHome),
      triage: all.filter((i) => !i.checked && !inPantry(i) && isStapleLike(i)),
    }
  }, [items, homeKeys, inPantry])

  if (!list || !items) return <Spinner />
  const homeSet = new Set(list.homeKeys ?? [])
  const checked = toBuy.filter((i) => i.checked).length
  const amountText = (i: ShoppingItem) => (i.manual ? (i.manualAmount ?? '') : formatShoppingAmount(i.amount))
  const planned = (meals ?? []).filter((m) => m.recipeId && m.status !== 'skipped')
  const cooked = planned.filter((m) => !m.leftoverOfId)
  const days = rolling ? `${capitalize(weekdayName(list.from, true))}–${weekdayName(list.to, true)}` : hasRange ? `${formatDate(list.from)}–${formatDate(list.to)}` : 'Suoraan lisätyt reseptit'

  async function share() {
    const text = shoppingListText(rolling ? `Ostokset ${days}` : list!.name, toBuy.map((i) => ({ name: i.name, amountText: amountText(i), category: i.category, checked: i.checked })))
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Ostokset', text })
        return
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast('Ostoslista kopioitu leikepöydälle')
    } catch {
      toast('Kopiointi ei onnistunut tässä selaimessa', 'error')
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={rolling ? 'Seuraava kauppareissu' : 'Ostoslista'}
        title={rolling ? 'Ostokset' : list.name}
        actions={
          <>
            <Button variant="secondary" icon={<Share2 size={16} />} onClick={share}>Jaa</Button>
            <Button icon={<ShoppingBasket size={16} />} onClick={() => setStoreMode(true)} disabled={toBuy.length === 0}>Kaupassa</Button>
          </>
        }
        mobileActions={
          <button onClick={share} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2" aria-label="Jaa ostoslista">
            <Share2 size={17} />
          </button>
        }
      />
      {!rolling && (
        <button onClick={onBack} className="mb-4 text-sm font-medium text-brand hover:underline">← Takaisin nykyiseen ostoslistaan</button>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 3xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Panel className="!p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold">{rolling ? `Ruoat ${days}` : days} · {cooked.length} ateriaa</p>
                <p className="text-sm text-muted">
                  {toBuy.length} ostettavaa{home.length ? ` · ${home.length} kotona` : ''}
                </p>
              </div>
              <p className="tabular shrink-0 font-display text-3xl font-semibold leading-none">
                {checked}
                <span className="text-lg text-muted">/{toBuy.length}</span>
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${toBuy.length ? (checked / toBuy.length) * 100 : 0}%` }} />
            </div>
            {rolling && (
              <div className="no-print mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Kattaa</span>
                <Segmented
                  size="sm"
                  label="Kuinka monen päivän ruoat"
                  value={String(list.horizonDays ?? 7)}
                  onChange={(v) => void syncRollingList(fineli, Number(v))}
                  options={[
                    { value: '2', label: '2 pv' },
                    { value: '3', label: '3 pv' },
                    { value: '7', label: 'Viikko' },
                    { value: '14', label: '2 vk' },
                  ]}
                />
                {checked > 0 && (
                  <button onClick={() => newShoppingTrip(listId)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                    <RotateCcw size={13} /> Uusi reissu
                  </button>
                )}
              </div>
            )}
          </Panel>

          {!list.triaged && triage.length > 0 && (
            <div className="no-print rounded-[22px] border border-sun/50 bg-sun-soft p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">Ennen kauppaa: onko kotona?</p>
                  <p className="text-sm text-ink-2">Napauta, mitkä löytyvät jo kaapista – ne jäävät pois ostettavista.</p>
                </div>
                <button onClick={() => db.shoppingLists.update(listId, { triaged: true })} className="shrink-0 rounded-xl bg-surface px-3 py-1.5 text-sm font-semibold shadow-sm">Valmis</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {triage.map((i) => {
                  const atHome = homeSet.has(i.key)
                  return (
                    <button
                      key={i.id}
                      onClick={() => setShoppingHome(listId, i.key, !atHome)}
                      aria-pressed={atHome}
                      className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition', atHome ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink')}
                    >
                      {atHome ? <Check size={14} /> : null}
                      {i.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="no-print flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              label="Järjestys"
              value={view}
              onChange={setView}
              options={[
                { value: 'aisle', label: 'Hyllyjärjestys' },
                { value: 'dish', label: 'Aterioittain' },
                { value: 'home', label: `Kotona ${home.length}` },
              ]}
            />
            <button onClick={() => setAdding((a) => !a)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2">
              <Plus size={15} /> Lisää tuote
            </button>
          </div>
          {adding && <AddItemForm listId={listId} onDone={() => setAdding(false)} />}

          {items.length === 0 ? (
            <Panel className="text-center">
              <p className="font-medium">Ei ostettavaa</p>
              <p className="mt-1 text-sm text-muted">{rolling ? 'Tuleville päiville ei ole suunniteltu aterioita.' : 'Lista on tyhjä.'}</p>
              {rolling && <Link to="/viikko" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Suunnittele viikko</Link>}
            </Panel>
          ) : view === 'home' ? (
            <HomeList items={home} listId={listId} amountText={amountText} />
          ) : view === 'dish' ? (
            <ByDish items={toBuy} amountText={amountText} recipes={mealRecipes} />
          ) : (
            <ByAisle items={toBuy} amountText={amountText} recipes={mealRecipes} />
          )}
          {toBuy.length > 0 && checked === toBuy.length && <p className="text-center text-sm font-medium text-brand">Kaikki ostettu – hyvä reissu!</p>}
        </div>

        <aside className="hidden space-y-4 xl:sticky xl:top-[88px] xl:block">
          <Panel title="Mukana olevat ateriat">
            {planned.length === 0 && !(list.extraRecipes?.length ?? 0) ? (
              <p className="text-sm text-muted">Ei aterioita tällä aikavälillä.</p>
            ) : (
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                {planned.map((m) => {
                  const r = m.recipeId ? mealRecipes?.get(m.recipeId) : undefined
                  return (
                    <li key={m.id} className="flex items-center gap-3">
                      <MealThumb recipe={r} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r?.title}</span>
                        <span className="block text-xs text-muted">
                          {capitalize(weekdayName(m.date, true))} {formatDate(m.date)}
                          {m.leftoverOfId ? ' · tähteet, ei ostettavaa' : ` · ${formatNumber(m.servings + (m.extraServings ?? 0), 1)} annosta`}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {(list.extraRecipes?.length ?? 0) > 0 && <ExtraRecipes list={list} />}
          </Panel>
          <Panel title="Toiminnot">
            <div className="grid gap-2">
              <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()}>Tulosta</Button>
              <Button variant="secondary" icon={<Home size={16} />} onClick={() => db.shoppingLists.update(listId, { triaged: false })}>Kysy taas ”onko kotona?”</Button>
              <Button variant="ghost" onClick={() => saveUserSettings({ ...settings, hideCheckedShoppingItems: !settings.hideCheckedShoppingItems })}>
                {settings.hideCheckedShoppingItems ? 'Näytä ostetut' : 'Piilota ostetut'}
              </Button>
              {!rolling && (
                <>
                  <Button variant="ghost" onClick={() => regenerateShoppingList(listId, fineli).then(() => toast('Päivitetty ruokalistan mukaan'))}>Päivitä ruokalistasta</Button>
                  <Button
                    variant="ghost"
                    className="text-bad"
                    onClick={async () => {
                      if (!confirm('Poistetaanko ostoslista?')) return
                      await deleteShoppingList(listId)
                      onBack()
                    }}
                  >
                    Poista tämä lista
                  </Button>
                </>
              )}
            </div>
          </Panel>
        </aside>
      </div>

      {toBuy.length > 0 && (
        <div className="no-print fixed inset-x-0 bottom-[84px] z-20 flex justify-center px-4 lg:hidden">
          <button onClick={() => setStoreMode(true)} className="flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-on-brand shadow-lg shadow-brand/25">
            <ShoppingBasket size={18} /> Kaupassa-tila · {toBuy.length - checked} jäljellä
          </button>
        </div>
      )}
      <div className="h-16 lg:hidden" />
      {storeMode && <StoreMode items={toBuy} amountText={amountText} onClose={() => setStoreMode(false)} />}
    </div>
  )
}

function useHideChecked(items: ShoppingItem[]): ShoppingItem[] {
  const { settings } = useApp()
  return settings.hideCheckedShoppingItems ? items.filter((i) => !i.checked) : items
}

function ByAisle({ items, amountText, recipes }: { items: ShoppingItem[]; amountText: (i: ShoppingItem) => string; recipes: RecipeMap }) {
  const visible = useHideChecked(items)
  const groups = SHOPPING_CATEGORIES.map((c) => [c, visible.filter((i) => i.category === c).sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'fi'))] as const).filter(([, l]) => l.length)
  return (
    <div className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-3">
      {groups.map(([category, list]) => (
        <section key={category} className="h-fit overflow-hidden rounded-[22px] border border-line bg-surface">
          <h3 className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted">
            {CATEGORY_LABELS[category]}
            <span className="tabular">{list.filter((i) => !i.checked).length} jäljellä</span>
          </h3>
          <ul className="divide-y divide-line">
            {list.map((item) => (
              <ShoppingRow key={item.id} item={item} amount={amountText(item)} recipes={recipes} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ByDish({ items, amountText, recipes }: { items: ShoppingItem[]; amountText: (i: ShoppingItem) => string; recipes: RecipeMap }) {
  const visible = useHideChecked(items)
  const groups = new Map<string, { title: string; recipeId: string | null; items: ShoppingItem[] }>()
  for (const i of visible) {
    const s = i.sources[0]
    const key = s?.recipeId ?? 'manual'
    const g = groups.get(key) ?? { title: s?.title ?? 'Lisätyt tuotteet', recipeId: s?.recipeId ?? null, items: [] }
    g.items.push(i)
    groups.set(key, g)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-3">
      {[...groups.entries()].map(([key, g]) => (
        <section key={key} className="h-fit overflow-hidden rounded-[22px] border border-line bg-surface">
          <h3 className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <MealThumb recipe={g.recipeId ? recipes?.get(g.recipeId) : undefined} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.title}</span>
          </h3>
          <ul className="divide-y divide-line">
            {g.items.map((item) => (
              <ShoppingRow key={item.id} item={item} amount={amountText(item)} recipes={recipes} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function HomeList({ items, listId, amountText }: { items: ShoppingItem[]; listId: string; amountText: (i: ShoppingItem) => string }) {
  const { settings } = useApp()
  const inPantry = pantryMatcher(settings.pantry)
  if (!items.length) return <Panel><p className="text-sm text-muted">Ei mitään merkitty kotona olevaksi.</p></Panel>
  return (
    <section className="overflow-hidden rounded-[22px] border border-line bg-surface">
      <ul className="divide-y divide-line">
        {items.map((i) => {
          const permanent = inPantry(i)
          return (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3">
              <Home size={16} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{i.name}</span>
                <span className="block text-xs text-muted">
                  {amountText(i)}
                  {permanent ? ' · aina kotona (asetukset)' : ' · tällä reissulla'}
                </span>
              </span>
              {permanent ? (
                <Link to="/asetukset" className="text-xs font-medium text-muted hover:text-ink">Muokkaa</Link>
              ) : (
                <span className="flex shrink-0 gap-1">
                  <button
                    onClick={() => saveUserSettings({ ...settings, pantry: [...new Set([...settings.pantry, i.name.toLowerCase()])] })}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2"
                    title="Älä kysy tätä enää – merkitse aina kotona olevaksi"
                  >
                    Aina kotona
                  </button>
                  <button onClick={() => setShoppingHome(listId, i.key, false)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-soft">Ostettavaksi</button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ShoppingRow({ item, amount, recipes }: { item: ShoppingItem; amount: string; recipes: RecipeMap }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const sourceIds = [...new Set(item.sources.map((s) => s.recipeId))]
  return (
    <li className={cx(item.checked && 'bg-surface-2/40')}>
      <div className="flex items-center gap-1 pl-4 pr-2">
        <button role="checkbox" aria-checked={item.checked} aria-label={`${item.name} ${amount}`} onClick={() => toggleShoppingItem(item.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
          <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition', item.checked ? 'border-brand bg-brand text-on-brand' : 'border-line')}>
            {item.checked && <Check size={15} strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cx('block truncate', item.checked && 'text-muted line-through')}>{item.name}</span>
            {item.sources.length > 0 && <span className="block truncate text-xs text-muted">{[...new Set(item.sources.map((s) => s.title))].join(' · ')}</span>}
          </span>
          <span className="hidden shrink-0 -space-x-1.5 sm:flex">
            {sourceIds.slice(0, 3).map((id) => (
              <MealThumb key={id} recipe={recipes?.get(id)} size={20} className="rounded-full ring-2 ring-surface" />
            ))}
          </span>
          <span className={cx('tabular shrink-0 text-right text-sm', item.checked ? 'text-muted' : 'font-medium text-ink-2')}>{amount}</span>
        </button>
        <button onClick={() => setOpen((o) => !o)} className="no-print rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Lisätiedot: ${item.name}`} aria-expanded={open}>
          <ChevronDown size={15} className={cx('transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 px-4 pb-3 pl-[52px] text-xs text-ink-2">
          {item.sources.length > 0 && (
            <ul className="space-y-0.5">
              {item.sources.map((s, i) => (
                <li key={i}>
                  <Link to={`/reseptit/${s.recipeId}`} className="hover:text-brand">{s.title}</Link>: <span className="text-muted">{s.raw}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={item.category}
              onChange={async (e) => {
                await setShoppingItemCategory(item.id, e.target.value as ShoppingCategory, true)
                toast('Hylly vaihdettu – valinta muistetaan')
              }}
              className="h-8 text-xs"
              aria-label="Hylly"
            >
              {SHOPPING_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
            {!item.manual && (
              <button onClick={() => setShoppingHome(item.listId, item.key, true)} className="inline-flex items-center gap-1 hover:text-brand">
                <Home size={13} /> Kotona
              </button>
            )}
            <button
              onClick={async () => {
                const removed = await removeShoppingItem(item.id)
                if (removed) toast(`Poistettu: ${removed.name}`, 'ok', { label: 'Kumoa', onClick: () => restoreShoppingItem(removed) })
              }}
              className="inline-flex items-center gap-1 text-bad hover:underline"
            >
              <Trash2 size={13} /> Poista
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function AddItemForm({ listId, onDone }: { listId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ShoppingCategory>('other')
  async function add() {
    if (!name.trim()) return
    await addManualShoppingItem(listId, name.trim(), amount.trim(), category)
    setName('')
    setAmount('')
  }
  return (
    <div className="flex flex-wrap gap-2 rounded-[22px] border border-line bg-surface p-3">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Tuote, esim. kahvi" aria-label="Tuote" className="h-10 min-w-[9rem] flex-[2] rounded-xl border border-line bg-surface px-3 text-sm" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Määrä" aria-label="Määrä" className="h-10 w-24 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" />
      <Select value={category} onChange={(e) => setCategory(e.target.value as ShoppingCategory)} aria-label="Hylly">
        {SHOPPING_CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
        ))}
      </Select>
      <Button onClick={add} icon={<Plus size={16} />}>Lisää</Button>
      <Button variant="ghost" onClick={onDone} aria-label="Sulje">
        <X size={16} />
      </Button>
    </div>
  )
}

function ExtraRecipes({ list }: { list: ShoppingList }) {
  const { fineli } = useApp()
  const recipes = useRecipesById(list.extraRecipes.map((e) => e.recipeId))
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Suoraan lisätyt reseptit</p>
      <div className="flex flex-wrap gap-2">
        {list.extraRecipes.map((e) => (
          <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
            <Link to={`/reseptit/${e.recipeId}`} className="hover:text-brand">{recipes?.get(e.recipeId)?.title ?? 'Resepti'}</Link>
            <span className="text-muted">· {formatNumber(e.servings, 1)}</span>
            <button className="rounded-full p-1 text-muted hover:bg-surface hover:text-bad" aria-label="Poista resepti listalta" onClick={() => removeExtraRecipe(list.id, e.id, fineli)}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Kaupassa-tila: large rows for one hand, aisle order, tap to tick, bought items sink to the bottom. */
function StoreMode({ items, amountText, onClose }: { items: ShoppingItem[]; amountText: (i: ShoppingItem) => string; onClose: () => void }) {
  const order = new Map(SHOPPING_CATEGORIES.map((c, i) => [c, i]))
  const sorted = [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || order.get(a.category)! - order.get(b.category)! || a.name.localeCompare(b.name, 'fi'))
  const left = items.filter((i) => !i.checked).length
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  let lastCat: ShoppingCategory | null = null
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-canvas" role="dialog" aria-modal="true" aria-label="Kaupassa-tila">
      <header className="safe-top border-b border-line pb-3">
        <div className="mx-auto flex max-w-2xl items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Kaupassa</p>
            <p className="font-display text-3xl font-semibold">{left ? `${left} jäljellä` : 'Kaikki korissa!'}</p>
          </div>
          <Button size="lg" onClick={onClose}>Valmis</Button>
        </div>
        <div className="mx-auto mt-3 h-2 max-w-2xl overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${items.length ? ((items.length - left) / items.length) * 100 : 0}%` }} />
        </div>
      </header>
      <ul className="safe-bottom mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-3 py-2">
        {sorted.map((i) => {
          const header = !i.checked && i.category !== lastCat ? CATEGORY_LABELS[i.category] : null
          if (!i.checked) lastCat = i.category
          return (
            <li key={i.id}>
              {header && <p className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">{header}</p>}
              <button
                onClick={() => toggleShoppingItem(i.id)}
                role="checkbox"
                aria-checked={i.checked}
                className={cx('my-1 flex min-h-16 w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition', i.checked ? 'border-transparent bg-surface-2/60 text-muted' : 'border-line bg-surface active:scale-[0.99]')}
              >
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2', i.checked ? 'border-brand bg-brand text-on-brand' : 'border-line')}>
                  {i.checked && <Check size={18} strokeWidth={3} />}
                </span>
                <span className={cx('min-w-0 flex-1 text-lg font-medium', i.checked && 'line-through')}>{i.name}</span>
                <span className="tabular shrink-0 text-base text-ink-2">{amountText(i)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
