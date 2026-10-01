import { Search, StickyNote } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { db } from '../../db/db'
import { addMealItem, addRecipeToShoppingList, resetIngredientMapping, setIngredientMapping, updateIngredient } from '../../db/repo'
import { addDays, formatDate, today, weekdayName, capitalize } from '../../domain/dates'
import { lemmaCandidates, tokenize } from '../../domain/finnish'
import { getIngredient, INGREDIENTS, type CanonicalIngredient } from '../../domain/ingredients'
import { matchIngredient } from '../../domain/matcher'
import { resolveGrams } from '../../domain/nutrition'
import { matchesQuery, searchText } from '../../domain/recipeInfo'
import { MEAL_SLOTS, type FineliFood, type MealSlot, type Recipe, type RecipeIngredient, type ScalingRule } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp, useToast } from '../AppContext'
import { SLOT_LABELS, useAllRecipes } from '../hooks'
import { ConfidenceDot, RecipeImage } from './recipe'
import { Badge, Button, Chip, cx, Field, Modal, Select, Stepper, TextInput } from './ui'

// ---------------------------------------------------------------------------------------------

export function AddToPlanDialog({ recipe, open, onClose }: { recipe: Recipe; open: boolean; onClose: () => void }) {
  const { settings } = useApp()
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [servings, setServings] = useState(settings.defaultServings)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i))

  async function save() {
    await addMealItem({ date, slot, recipeId: recipe.id, servings })
    toast(`${recipe.title} lisätty: ${capitalize(weekdayName(date))} ${formatDate(date)}, ${SLOT_LABELS[slot].toLowerCase()}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lisää ruokalistalle"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button onClick={save}>Lisää</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-2">{recipe.title}</p>
      <div className="space-y-5">
        <div>
          <span className="mb-2 block text-sm font-medium text-ink-2">Päivä</span>
          <div className="flex flex-wrap gap-2">
            {days.map((d, i) => (
              <Chip key={d} active={date === d} onClick={() => setDate(d)}>
                {i === 0 ? 'Tänään' : i === 1 ? 'Huomenna' : capitalize(weekdayName(d, true))} {formatDate(d)}
              </Chip>
            ))}
          </div>
          <TextInput type="date" className="mt-2 max-w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Valitse päivä" />
        </div>
        <div>
          <span className="mb-2 block text-sm font-medium text-ink-2">Ateria</span>
          <div className="flex flex-wrap gap-2">
            {MEAL_SLOTS.map((s) => (
              <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>
                {SLOT_LABELS[s]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-ink-2">Annoksia</span>
            <span className="text-xs text-muted">Resepti on {formatNumber(recipe.servings, 1)} annokselle – määrät skaalataan.</span>
          </div>
          <Stepper value={servings} onChange={setServings} label="Annokset" min={0.5} step={servings < 2 ? 0.5 : 1} />
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------

interface Candidate {
  key: string
  label: string
  detail: string
  canonical?: CanonicalIngredient
  food?: FineliFood
}

function searchCandidates(query: string, foods: FineliFood[], products: FineliFood[]): Candidate[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const words = tokenize(q).map((w) => lemmaCandidates(w).filter((c) => c.length >= 2))
  const hit = (text: string) => words.every((cands) => cands.some((c) => text.includes(c)))
  const canon = INGREDIENTS.filter((i) => hit([i.fi, i.en, ...i.aliases].join(' ').toLowerCase()))
    .slice(0, 8)
    .map((i) => ({ key: `c:${i.id}`, label: i.fi, detail: 'Ainesosa', canonical: i }))
  const own = products
    .filter((f) => hit(f.fi.toLowerCase()))
    .slice(0, 8)
    .map((f) => ({ key: `p:${f.id}`, label: f.fi, detail: 'Oma tuote', food: f }))
  const fin = foods
    .filter((f) => hit(f.fi.toLowerCase()))
    .sort((a, b) => (a.type === 'FOOD' ? 0 : 1) - (b.type === 'FOOD' ? 0 : 1) || a.fi.length - b.fi.length)
    .slice(0, 12)
    .map((f) => ({ key: `f:${f.id}`, label: f.fi, detail: `Fineli ${f.id}`, food: f }))
  return [...own, ...canon, ...fin]
}

export function IngredientMappingDialog({
  recipe,
  ingredient,
  open,
  onClose,
}: {
  recipe: Recipe
  ingredient: RecipeIngredient | null
  open: boolean
  onClose: () => void
}) {
  const { fineli } = useApp()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [remember, setRemember] = useState(true)
  const [gramsText, setGramsText] = useState('')
  const [scaling, setScaling] = useState<ScalingRule>('linear')
  const [lastId, setLastId] = useState<string | null>(null)

  if (ingredient && ingredient.id !== lastId) {
    setLastId(ingredient.id)
    setQuery(getIngredient(ingredient.canonicalId)?.fi ?? ingredient.name)
    setSelected(null)
    setGramsText(ingredient.gramsOverride != null ? String(ingredient.gramsOverride) : '')
    setScaling(ingredient.scaling)
  }

  const { dataVersion } = useApp()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersion: products changed
  const candidates = useMemo(() => searchCandidates(query, fineli.all(), fineli.products()), [query, fineli, dataVersion])
  if (!ingredient) return null

  const canonical = getIngredient(ingredient.canonicalId)
  const food = ingredient.fineliId != null ? fineli.get(ingredient.fineliId) : undefined
  const grams = resolveGrams(ingredient, canonical, food)
  const explanation = ingredient.matchMethod === 'user'
    ? 'Käyttäjän valitsema vastaavuus.'
    : ingredient.matchMethod === 'source'
      ? 'Vastaavuus tulee reseptin lähteestä.'
      : matchIngredient(ingredient.name, { fineli }, ingredient.raw).explanation
  const previewFood = selected?.food ?? (selected?.canonical?.fineliId != null ? fineli.get(selected.canonical.fineliId) : undefined)

  async function save() {
    if (!ingredient) return
    if (selected) {
      const mapping = selected.canonical
        ? { canonicalId: selected.canonical.id, fineliId: selected.canonical.fineliId }
        : { canonicalId: ingredient.canonicalId ?? null, fineliId: selected.food!.id }
      // A Fineli food chosen directly replaces the nutrition source but keeps the shopping ingredient.
      if (selected.food && canonical && selected.food.id !== canonical.fineliId) mapping.canonicalId = canonical.id
      await setIngredientMapping(recipe.id, ingredient.id, mapping, remember, fineli)
    }
    const g = gramsText.trim() ? Number(gramsText.replace(',', '.')) : null
    await updateIngredient(recipe.id, ingredient.id, {
      gramsOverride: g !== null && Number.isFinite(g) && g >= 0 ? g : null,
      scaling,
    })
    toast('Aineksen tiedot päivitetty')
    onClose()
  }

  async function reset() {
    if (!ingredient) return
    await resetIngredientMapping(recipe.id, ingredient.id, fineli)
    toast('Palautettu automaattiseen tunnistukseen')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Aineksen vastaavuus"
      footer={
        <>
          {ingredient.userOverride && <Button variant="ghost" onClick={reset} className="mr-auto">Palauta automaattinen</Button>}
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button onClick={save}>Tallenna</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Reseptissä</p>
          <p className="mt-1 font-medium">{ingredient.raw}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Ainesosa (ostoslista)</dt>
              <dd>{canonical?.fi ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Ravintotieto (Fineli)</dt>
              <dd className="flex items-center gap-2">
                <ConfidenceDot confidence={ingredient.confidence} method={ingredient.matchMethod} />
                {food?.fi ?? 'Ei vastinetta'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Varmuus</dt>
              <dd>{Math.round(ingredient.confidence * 100)} %</dd>
            </div>
            <div>
              <dt className="text-muted">Määrä grammoina</dt>
              <dd>{grams.grams !== null ? `≈ ${formatNumber(grams.grams, 0)} g` : '—'} <span className="text-muted">{grams.note}</span></dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">{explanation}</p>
        </div>

        <div>
          <Field label="Hae ainesosaa tai Fineli-elintarviketta">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="esim. kevytmaito, broilerin fileesuikale" />
            </div>
          </Field>
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Hakutulokset">
            {candidates.length === 0 && <li className="px-4 py-3 text-sm text-muted">{query.trim().length < 2 ? 'Kirjoita vähintään kaksi merkkiä.' : 'Ei hakutuloksia – kokeile lyhyempää tai yleisempää hakusanaa.'}</li>}
            {candidates.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.key === c.key}
                  onClick={() => setSelected(c)}
                  className={cx('flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2', selected?.key === c.key && 'bg-brand-soft')}
                >
                  <span>{c.label}</span>
                  <Badge tone={c.canonical ? 'brand' : c.food?.custom ? 'accent' : 'neutral'}>{c.detail}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Puuttuuko tuote? <Link to="/tuotteet/uusi" className="font-medium text-brand underline" onClick={onClose}>Lisää oma tuote</Link> pakkauksen tai verkkokaupan tiedoilla.
          </p>
          {previewFood && (
            <p className="mt-2 text-xs text-muted">
              {previewFood.fi}: {formatNumber(previewFood.nutrients.energyKcal ?? 0, 0)} kcal, proteiini {formatNumber(previewFood.nutrients.protein ?? 0, 1)} g,
              hiilihydraatit {formatNumber(previewFood.nutrients.carbohydrate ?? 0, 1)} g, rasva {formatNumber(previewFood.nutrients.fat ?? 0, 1)} g / 100 g
            </p>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--c-brand)]" />
            Muista valinta ja käytä sitä myös muissa resepteissä, joissa on sama aines
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paino grammoina (valinnainen)" hint="Käytä, jos määrää ei voi muuntaa automaattisesti.">
            <TextInput inputMode="decimal" value={gramsText} onChange={(e) => setGramsText(e.target.value)} placeholder={grams.grams !== null ? formatNumber(grams.grams, 0) : 'esim. 150'} />
          </Field>
          <Field label="Skaalaus" hint="Mausteita ei aina kannata kasvattaa suoraan suhteessa.">
            <Select value={scaling} onChange={(e) => setScaling(e.target.value as ScalingRule)} className="w-full">
              <option value="linear">Suoraan suhteessa annoksiin</option>
              <option value="sublinear">Maltillisesti (mausteet, suola)</option>
              <option value="fixed">Ei skaalata</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------

const NOTE_SUGGESTIONS = ['Syödään ulkona', 'Jämät / tähteet', 'Eväät', 'Kouluruoka / työpaikkaruokailu']

export function RecipePickerDialog({
  open,
  onClose,
  onPick,
  onNote,
  title = 'Valitse resepti',
}: {
  open: boolean
  onClose: () => void
  onPick: (r: Recipe) => void
  /** When given, the dialog also offers adding a note-only meal ("Syödään ulkona"). */
  onNote?: (note: string) => void
  title?: string
}) {
  const recipes = useAllRecipes()
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [includeCatalogue, setIncludeCatalogue] = useState(false)
  const results = useMemo(() => {
    if (!recipes) return []
    return recipes
      .filter((r) => r.inCollection || includeCatalogue)
      .filter((r) => !query || matchesQuery(searchText(r), query))
      .sort((a, b) => Number(b.inCollection) - Number(a.inCollection) || a.title.localeCompare(b.title, 'fi'))
      .slice(0, 60)
  }, [recipes, query, includeCatalogue])

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" />
          <TextInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Hae nimellä tai aineksella" />
        </div>
        <Chip active={includeCatalogue} onClick={() => setIncludeCatalogue((v) => !v)}>Myös katalogi</Chip>
      </div>
      {onNote && (
        <div className="mb-4 rounded-xl bg-surface-2/60 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2"><StickyNote size={15} /> Muistiinpano ilman reseptiä</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {NOTE_SUGGESTIONS.map((n) => (
              <Chip key={n} active={false} onClick={() => onNote(n)}>{n}</Chip>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (note.trim()) {
                onNote(note)
                setNote('')
              }
            }}
          >
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Oma muistiinpano, esim. Mummolassa" aria-label="Muistiinpano" />
            <Button type="submit" variant="secondary" disabled={!note.trim()}>Lisää</Button>
          </form>
          <p className="mt-1 text-xs text-muted">Muistiinpanot näkyvät ruokalistalla, mutta eivät vaikuta ostoslistaan tai ravintosisältöön.</p>
        </div>
      )}
      <ul className="divide-y divide-line">
        {results.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
              <RecipeImage recipe={r} className="h-12 w-12 shrink-0" rounded="rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-medium leading-snug hyphens-auto [overflow-wrap:anywhere]">{r.title}</span>
                <span className="text-xs text-muted">{formatNumber(r.servings, 1)} annosta · {r.inCollection ? 'Omat reseptit' : 'Katalogi'}</span>
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="py-6 text-center text-sm text-muted">Ei hakutuloksia.</li>}
      </ul>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------

/** Add a recipe's ingredients straight to a shopping list, without planning the meal. */
export function AddToShoppingListDialog({ recipe, open, onClose, servings: initialServings }: { recipe: Recipe; open: boolean; onClose: () => void; servings: number }) {
  const { fineli } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const lists = useLiveQuery(() => db.shoppingLists.orderBy('createdAt').reverse().toArray(), [])
  const [target, setTarget] = useState<string>('')
  const [servings, setServings] = useState(initialServings)
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setServings(initialServings)
  }
  const selected = target || lists?.[0]?.id || 'new'

  async function add() {
    setBusy(true)
    const id = await addRecipeToShoppingList(selected === 'new' ? null : selected, recipe.id, servings, fineli)
    setBusy(false)
    onClose()
    toast('Ainekset lisätty ostoslistalle', 'ok', { label: 'Avaa lista', onClick: () => navigate(`/ostoslista?lista=${id}`) })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lisää ostoslistalle"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button onClick={add} disabled={busy}>Lisää ainekset</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-2">{recipe.title}</p>
      <div className="space-y-4">
        <Field label="Ostoslista">
          <Select value={selected} onChange={(e) => setTarget(e.target.value)} className="w-full">
            {(lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
            <option value="new">+ Uusi ostoslista</option>
          </Select>
        </Field>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-ink-2">Annoksia</span>
          <Stepper value={servings} onChange={setServings} label="Annokset" min={0.5} step={servings < 2 ? 0.5 : 1} />
        </div>
        <p className="text-xs text-muted">Samat ainekset yhdistetään listalla oleviin. Resepti säilyy listalla, vaikka lista päivitetään ruokalistan mukaan.</p>
      </div>
    </Modal>
  )
}
