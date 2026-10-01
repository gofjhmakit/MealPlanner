import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, Eye, EyeOff, Plus, Printer, RefreshCw, RotateCcw, Share2, ShoppingCart, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { db } from '../../db/db'
import {
  addManualShoppingItem,
  createShoppingList,
  removeExtraRecipe,
  removeShoppingItem,
  restoreShoppingItem,
  deleteShoppingList,
  planHash,
  regenerateShoppingList,
  saveUserSettings,
  setShoppingItemCategory,
  toggleShoppingItem,
  uncheckAll,
} from '../../db/repo'
import { addDays, formatDate, isoWeek, startOfWeek, today } from '../../domain/dates'
import { CATEGORY_LABELS, formatShoppingAmount, pantryMatcher, shoppingListText } from '../../domain/shoppingList'
import { SHOPPING_CATEGORIES, type ShoppingCategory, type ShoppingItem } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp, useToast } from '../AppContext'
import { useRecipesById } from '../hooks'
import { PageHeader } from '../components/Layout'
import { Button, Card, cx, EmptyState, Field, IconButton, Modal, ProgressBar, Select, Spinner, TextInput } from '../components/ui'

export function ShoppingPage() {
  const lists = useLiveQuery(() => db.shoppingLists.orderBy('createdAt').reverse().toArray(), [])
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  // An id from an old link may point at a deleted list – fall back to the newest one.
  const requested = params.get('lista')
  const list = lists?.find((l) => l.id === requested) ?? lists?.[0] ?? null
  const selectedId = list?.id ?? null

  if (!lists) return <Spinner />
  return (
    <div className="fade-in">
      <PageHeader
        title="Ostoslista"
        subtitle="Koottu automaattisesti ruokalistan resepteistä. Merkinnät säilyvät tällä laitteella."
        actions={
          <>
            {lists.length > 1 && (
              <Select value={selectedId ?? ''} onChange={(e) => setParams({ lista: e.target.value })} aria-label="Valitse ostoslista">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            )}
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>Uusi lista</Button>
          </>
        }
      />
      {list ? (
        <ListView key={list.id} listId={list.id} onDeleted={() => setParams({})} />
      ) : (
        <EmptyState icon={<ShoppingCart size={32} />} title="Ei vielä ostoslistaa" action={<Button onClick={() => setCreateOpen(true)}>Luo ostoslista ruokalistasta</Button>}>
          Suunnittele ateriat <Link to="/ruokalista" className="underline">ruokalistalle</Link>, niin ostoslista kootaan niiden aineksista.
        </EmptyState>
      )}
      <CreateListDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => setParams({ lista: id })} />
    </div>
  )
}

function CreateListDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const weekStart = startOfWeek(today(), settings.weekStartsOn)
  const [from, setFrom] = useState(weekStart)
  const [to, setTo] = useState(addDays(weekStart, 6))
  const [name, setName] = useState('')
  const count = useLiveQuery(() => db.mealItems.where('date').between(from, to, true, true).count(), [from, to])

  async function create() {
    const listName = name.trim() || `Viikko ${isoWeek(from)} (${formatDate(from)}–${formatDate(to)})`
    const id = await createShoppingList(from <= to ? from : to, from <= to ? to : from, listName, fineli)
    toast('Ostoslista luotu')
    onCreated(id)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Uusi ostoslista"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button onClick={create}>Luo lista</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Alkaen"><TextInput type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="Päättyen"><TextInput type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
        <Field label="Nimi (valinnainen)"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={`Viikko ${isoWeek(from)}`} /></Field>
        <p className="text-sm text-ink-2">{count ?? 0} ateriamerkintää valitulla aikavälillä.</p>
      </div>
    </Modal>
  )
}

function ListView({ listId, onDeleted }: { listId: string; onDeleted: () => void }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const list = useLiveQuery(() => db.shoppingLists.get(listId), [listId])
  const items = useLiveQuery(() => db.shoppingItems.where('listId').equals(listId).toArray(), [listId])
  const hideChecked = settings.hideCheckedShoppingItems
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newCategory, setNewCategory] = useState<ShoppingCategory>('other')
  const [refreshing, setRefreshing] = useState(false)

  // The list remembers which plan it was generated from; warn when the plan has changed since.
  const currentHash = useLiveQuery(async () => (list ? planHash(list.from, list.to) : null), [list?.from, list?.to])
  const outOfDate = !!list && currentHash != null && list.planHash != null && currentHash !== list.planHash

  const extraRecipeIds = (list?.extraRecipes ?? []).map((e) => e.recipeId)
  const extraRecipes = useRecipesById(extraRecipeIds)
  const [showPantry, setShowPantry] = useState(false)
  const inPantry = useMemo(() => pantryMatcher(settings.pantry), [settings.pantry])
  const pantryItems = useMemo(() => (items ?? []).filter((i) => !i.manual && inPantry(i)), [items, inPantry])
  const toBuy = useMemo(() => (items ?? []).filter((i) => i.manual || !inPantry(i)), [items, inPantry])

  const grouped = useMemo(() => {
    const map = new Map<ShoppingCategory, ShoppingItem[]>()
    for (const it of toBuy) {
      if (hideChecked && it.checked) continue
      map.set(it.category, [...(map.get(it.category) ?? []), it])
    }
    for (const arr of map.values()) arr.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'fi'))
    return SHOPPING_CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const)
  }, [toBuy, hideChecked])

  if (!list || !items) return <Spinner />
  const checked = toBuy.filter((i) => i.checked).length
  const planless = list.from > list.to

  const amountText = (i: ShoppingItem) => (i.manual ? (i.manualAmount ?? '') : formatShoppingAmount(i.amount))

  async function share() {
    const text = shoppingListText(list!.name, toBuy.map((i) => ({ name: i.name, amountText: amountText(i), category: i.category, checked: i.checked })))
    try {
      if (navigator.share) {
        await navigator.share({ title: list!.name, text })
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

  async function refresh() {
    setRefreshing(true)
    await regenerateShoppingList(listId, fineli)
    setRefreshing(false)
    toast('Ostoslista päivitetty ruokalistan mukaan')
  }

  async function addItem() {
    if (!newName.trim()) return
    await addManualShoppingItem(listId, newName.trim(), newAmount.trim(), newCategory)
    setNewName('')
    setNewAmount('')
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{list.name}</h2>
            <p className="text-sm text-muted">{planless ? 'Suoraan lisätyt reseptit' : `Ruokalista ${formatDate(list.from)}–${formatDate(list.to, { year: true })}`}</p>
          </div>
          <div className="no-print flex flex-wrap gap-1">
            <Button variant="secondary" size="sm" icon={<Share2 size={14} />} onClick={share}>Jaa</Button>
            <IconButton label="Tulosta ostoslista" onClick={() => window.print()}><Printer size={18} /></IconButton>
            {!planless && <Button variant="secondary" size="sm" icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />} onClick={refresh}>Päivitä</Button>}
            <IconButton label={hideChecked ? 'Näytä ostetut' : 'Piilota ostetut'} onClick={() => saveUserSettings({ ...settings, hideCheckedShoppingItems: !hideChecked })}>
              {hideChecked ? <Eye size={18} /> : <EyeOff size={18} />}
            </IconButton>
            <IconButton label="Poista kaikki rastit" onClick={() => uncheckAll(listId)}><RotateCcw size={18} /></IconButton>
            <IconButton
              label="Poista lista"
              onClick={async () => {
                if (!confirm('Poistetaanko ostoslista?')) return
                await deleteShoppingList(listId)
                onDeleted()
              }}
            >
              <Trash2 size={18} />
            </IconButton>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <ProgressBar value={checked} max={toBuy.length || 1} label="Ostettu" />
          <span className="tabular shrink-0 text-sm text-ink-2">{checked} / {toBuy.length}</span>
        </div>
        {(list.extraRecipes?.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Suoraan lisätyt reseptit</p>
            <div className="flex flex-wrap gap-2">
              {list.extraRecipes.map((e) => (
                <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                  <Link to={`/reseptit/${e.recipeId}`} className="hover:text-brand">{extraRecipes?.get(e.recipeId)?.title ?? 'Resepti'}</Link>
                  <span className="text-muted">· {formatNumber(e.servings, 1)} ann.</span>
                  <button className="no-print rounded-full p-1 text-muted hover:bg-surface hover:text-bad" aria-label="Poista resepti listalta" onClick={() => removeExtraRecipe(listId, e.id, fineli)}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {outOfDate && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Ruokalista on muuttunut listan luomisen jälkeen.
            <button className="font-medium underline" onClick={refresh}>Päivitä ostoslista</button>
          </p>
        )}
      </Card>

      {grouped.length === 0 ? (
        <EmptyState title={items.length ? 'Kaikki ostettu!' : 'Lista on tyhjä'}>
          {items.length ? 'Hienoa – kaikki tuotteet on merkitty ostetuiksi.' : 'Valitulla aikavälillä ei ole aterioita. Lisää aterioita ruokalistalle tai lisää tuotteita käsin.'}
        </EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {grouped.map(([category, list]) => (
            <Card key={category} className="h-fit overflow-hidden">
              <h3 className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-sm font-semibold text-ink-2">{CATEGORY_LABELS[category]}</h3>
              <ul className="divide-y divide-line">
                {list.map((item) => (
                  <ShoppingRow key={item.id} item={item} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {pantryItems.length > 0 && (
        <Card className="no-print overflow-hidden">
          <button onClick={() => setShowPantry((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={showPantry}>
            <span className="text-sm">
              <span className="font-semibold text-ink-2">Löytyy kotoa</span>
              <span className="text-muted"> · {pantryItems.length} perustarviketta, joita ei lasketa ostettaviin</span>
            </span>
            <ChevronDown size={16} className={cx('shrink-0 text-muted transition', showPantry && 'rotate-180')} />
          </button>
          {showPantry && (
            <>
              <ul className="divide-y divide-line border-t border-line">
                {pantryItems.map((item) => <ShoppingRow key={item.id} item={item} />)}
              </ul>
              <p className="border-t border-line px-4 py-2 text-xs text-muted">Muokkaa kotona olevia aineksia <Link to="/asetukset" className="underline">asetuksissa</Link>.</p>
            </>
          )}
        </Card>
      )}

      <Card className="no-print p-4">
        <p className="mb-2 text-sm font-medium">Lisää tuote käsin</p>
        <div className="flex flex-wrap gap-2">
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tuote, esim. kahvi" className="min-w-[10rem] flex-[2]" onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <TextInput value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="Määrä" className="w-28 flex-1" onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <Select value={newCategory} onChange={(e) => setNewCategory(e.target.value as ShoppingCategory)} aria-label="Kategoria">
            {SHOPPING_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
          <Button onClick={addItem} icon={<Plus size={16} />}>Lisää</Button>
        </div>
      </Card>
    </div>
  )
}

function ShoppingRow({ item }: { item: ShoppingItem }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const amount = item.manual ? (item.manualAmount ?? '') : formatShoppingAmount(item.amount)
  return (
    <li className={cx('px-4 py-2.5', item.checked && 'bg-surface-2/40')}>
      <div className="flex items-center gap-3">
        <button
          role="checkbox"
          aria-checked={item.checked}
          aria-label={`${item.name} ${amount}`}
          onClick={() => toggleShoppingItem(item.id)}
          className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition', item.checked ? 'border-brand bg-brand text-white dark:text-canvas' : 'border-line hover:border-brand')}
        >
          {item.checked && <Check size={15} strokeWidth={3} />}
        </button>
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <span className={cx('truncate', item.checked && 'text-muted line-through')}>{item.name}</span>
          <span className={cx('tabular shrink-0 text-sm', item.checked ? 'text-muted' : 'text-ink-2')}>{amount}</span>
        </button>
        <ChevronDown size={15} className={cx('shrink-0 text-muted transition print:hidden', open && 'rotate-180')} />
      </div>
      {open && (
        <div className="ml-9 mt-2 space-y-2 text-xs text-ink-2">
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
                toast('Kategoria vaihdettu – valinta muistetaan jatkossa')
              }}
              className="h-8 text-xs"
              aria-label="Kategoria"
            >
              {SHOPPING_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
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
