import {
  AlertTriangle,
  ArrowLeft,
  BookmarkMinus,
  BookmarkPlus,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Heart,
  ChefHat,
  NotebookPen,
  Pencil,
  Printer,
  ShoppingCart,
  X,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { copyRecipeToUser, deleteRecipe, setInCollection, setRecipeNotes, setRecipeRating, toggleFavourite } from '../../db/repo'
import { getIngredient } from '../../domain/ingredients'
import { CONFIDENT_THRESHOLD, NUTRIENT_INFO, NUTRIENT_KEYS, type NutritionLine } from '../../domain/nutrition'
import { splitAmountText } from '../../domain/ingredientParser'
import { recipeDiet, recipeSpecialDiets, DIET_LABELS, SPECIAL_DIET_LABELS, type SpecialDiets } from '../../domain/recipeInfo'
import { scaleIngredient } from '../../domain/scaling'
import type { Nutrients, Recipe, RecipeIngredient } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { hostnameOf, safeHttpUrl } from '../../domain/url'
import { DIAGNOSTIC_FIELDS } from '../../import/pipeline'
import { useApp, useToast } from '../AppContext'
import { AddToPlanDialog, AddToShoppingListDialog, IngredientMappingDialog } from '../components/dialogs'
import { ConfidenceDot, EstimateNote, NutritionSummary, RecipeImage, SourceBadge, StarRating } from '../components/recipe'
import { Badge, Button, Card, cx, EmptyState, IconButton, SectionTitle, Spinner, Stepper } from '../components/ui'
import { useFavouriteIds, useRecipe, useRecipeNutrition, useBack } from '../hooks'

export function RecipeDetailPage() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  if (recipe === undefined) return <Spinner />
  if (recipe === null)
    return (
      <EmptyState title="Reseptiä ei löytynyt" action={<Link to="/reseptit"><Button>Takaisin resepteihin</Button></Link>}>
        Resepti on ehkä poistettu.
      </EmptyState>
    )
  return <RecipeDetail key={recipe.id} recipe={recipe} />
}

function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const back = useBack('/reseptit')
  const favourites = useFavouriteIds()
  const [servings, setServings] = useState(recipe.servings)
  const [planOpen, setPlanOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [editing, setEditing] = useState<RecipeIngredient | null>(null)
  const [perServing, setPerServing] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const nutrition = useRecipeNutrition(recipe, servings)
  const sourceUrl = safeHttpUrl(recipe.sourceUrl)
  const factor = servings / recipe.servings
  const diet = recipeDiet(recipe, fineli)
  const specialDiets = recipeSpecialDiets(recipe, fineli)
  const isFav = favourites.has(recipe.id)
  const lowConfidence = recipe.ingredients.filter((i) => i.confidence < CONFIDENT_THRESHOLD && i.quantity != null)

  const groups: [string | null, RecipeIngredient[]][] = []
  for (const ing of recipe.ingredients) {
    const g = ing.group ?? null
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(ing)
    else groups.push([g, [ing]])
  }

  async function onEdit() {
    if (recipe.origin === 'catalogue') {
      const copy = await copyRecipeToUser(recipe)
      toast('Katalogireseptistä tehtiin oma kopio muokattavaksi')
      navigate(`/reseptit/${copy.id}/muokkaa`)
    } else navigate(`/reseptit/${recipe.id}/muokkaa`)
  }

  async function onDelete() {
    if (!confirm(`Poistetaanko resepti "${recipe.title}"? Myös sen ruokalistamerkinnät poistetaan.`)) return
    await deleteRecipe(recipe.id)
    toast('Resepti poistettu')
    navigate('/reseptit')
  }

  const nutrients = nutrition ? (perServing ? nutrition.perServing : nutrition.total) : null

  return (
    <div className="fade-in">
      <button onClick={back} className="no-print mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> Takaisin
      </button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <figure className="min-w-0">
          <RecipeImage recipe={recipe} className="aspect-[4/3] w-full" rounded="rounded-2xl" emojiSize="text-8xl" />
          {recipe.imageUrl && recipe.attribution?.imageCredit && (
            <figcaption className="mt-1.5 text-xs text-muted">
              Kuva: {recipe.attribution.imageCredit}
              {recipe.attribution.imageLicense && (
                <>
                  {' · '}
                  {safeHttpUrl(recipe.attribution.imageLicenseUrl) ? (
                    <a href={safeHttpUrl(recipe.attribution.imageLicenseUrl)!} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">{recipe.attribution.imageLicense}</a>
                  ) : (
                    recipe.attribution.imageLicense
                  )}
                </>
              )}
            </figcaption>
          )}
        </figure>
        <div className="flex flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SourceBadge recipe={recipe} />
            {diet && <Badge tone={diet === 'vegan' || diet === 'vegetarian' ? 'ok' : 'neutral'}>{DIET_LABELS[diet]}</Badge>}
            {(Object.keys(SPECIAL_DIET_LABELS) as (keyof SpecialDiets)[])
              .filter((k) => specialDiets[k] && !(k === 'lactoseFree' && specialDiets.milkFree))
              .map((k) => (
                <Badge key={k} tone="ok" title="Arvio Finelin erityisruokavaliotietojen perusteella – tarkista tuotteiden pakkausmerkinnät">{SPECIAL_DIET_LABELS[k]}*</Badge>
              ))}
            {recipe.category && <Badge>{recipe.category}</Badge>}
          </div>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{recipe.title}</h1>
          <div className="no-print mt-2">
            <StarRating
              value={recipe.rating}
              onChange={async (v) => {
                await setRecipeRating(recipe.id, v)
                toast(v ? `Arvio tallennettu: ${v}/5` : 'Arvio poistettu')
              }}
            />
          </div>
          {recipe.description && <p className="mt-3 whitespace-pre-line text-ink-2">{recipe.description}</p>}

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {recipe.prepTimeMin ? <TimeItem label="Valmisteluaika" value={recipe.prepTimeMin} /> : null}
            {recipe.cookTimeMin ? <TimeItem label="Kypsennysaika" value={recipe.cookTimeMin} /> : null}
            {recipe.totalTimeMin ? <TimeItem label="Valmistusaika yhteensä" value={recipe.totalTimeMin} /> : null}
            {!recipe.totalTimeMin && recipe.timeText ? <div><dt className="text-muted">Valmistusaika</dt><dd>{recipe.timeText}</dd></div> : null}
          </dl>

          {sourceUrl && (
            <p className="mt-3 text-sm text-ink-2">
              Lähde:{' '}
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                {recipe.sourceName ?? hostnameOf(sourceUrl)} <ExternalLink size={13} />
              </a>
              {recipe.author ? ` · ${recipe.author}` : ''}
            </p>
          )}
          {recipe.attribution && <AttributionNote attribution={recipe.attribution} />}

          <div className="no-print mt-5 flex flex-wrap items-center gap-2">
            <Button icon={<CalendarPlus size={16} />} onClick={() => setPlanOpen(true)}>Lisää ruokalistalle</Button>
            <Button variant="secondary" icon={<ShoppingCart size={16} />} onClick={() => setShopOpen(true)}>Lisää ostoslistalle</Button>
            <Button
              variant="secondary"
              icon={<Heart size={16} className={isFav ? 'fill-accent text-accent' : ''} />}
              onClick={async () => toast((await toggleFavourite(recipe.id)) ? 'Lisätty suosikkeihin' : 'Poistettu suosikeista')}
              aria-pressed={isFav}
            >
              {isFav ? 'Suosikki' : 'Lisää suosikkeihin'}
            </Button>
            {recipe.origin === 'catalogue' && (
              <Button
                variant="secondary"
                icon={recipe.inCollection ? <BookmarkMinus size={16} /> : <BookmarkPlus size={16} />}
                onClick={async () => {
                  await setInCollection(recipe.id, !recipe.inCollection)
                  toast(recipe.inCollection ? 'Poistettu omista resepteistä' : 'Lisätty omiin resepteihin')
                }}
              >
                {recipe.inCollection ? 'Poista omista' : 'Lisää omiin'}
              </Button>
            )}
            {recipe.instructions.length > 0 && (
              <IconButton label="Kokkaustila – näyttö pysyy päällä" onClick={() => setCooking(true)}>
                <ChefHat size={18} />
              </IconButton>
            )}
            <IconButton label="Tulosta resepti" onClick={() => window.print()}>
              <Printer size={18} />
            </IconButton>
            <IconButton label={recipe.origin === 'catalogue' ? 'Muokkaa (tekee oman kopion)' : 'Muokkaa'} onClick={onEdit}>
              <Pencil size={18} />
            </IconButton>
            {recipe.origin !== 'catalogue' && (
              <IconButton label="Poista resepti" onClick={onDelete}>
                <Trash2 size={18} />
              </IconButton>
            )}
          </div>
        </div>
      </div>

      {recipe.importReport && <ImportReport recipe={recipe} />}
      <NotesCard recipe={recipe} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="h-fit p-5">
          <SectionTitle action={<span className="no-print"><Stepper value={servings} onChange={setServings} label="Annokset" min={0.5} step={servings < 2 ? 0.5 : 1} suffix="annosta" size="sm" /></span>}>
            Ainekset
          </SectionTitle>
          {factor !== 1 && (
            <p className="-mt-1 mb-3 text-xs text-muted">Määrät skaalattu {formatNumber(recipe.servings, 1)} annoksesta {formatNumber(servings, 1)} annokseen.</p>
          )}
          {lowConfidence.length > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              {lowConfidence.length} aineksen ravintotieto on epävarma. Napauta ainesta tarkistaaksesi vastaavuuden.
            </p>
          )}
          {groups.map(([group, items], gi) => (
            <div key={gi} className="mb-3 last:mb-0">
              {group && <h3 className="mb-1 mt-3 text-sm font-semibold text-ink-2">{group}</h3>}
              <ul className="divide-y divide-line">
                {items.map((ing) => {
                  const scaled = scaleIngredient(ing, factor)
                  const canonical = getIngredient(ing.canonicalId)
                  const split = splitAmountText(ing.raw)
                  const amountLabel =
                    factor === 1 ? split.amount : scaled.quantity != null ? scaled.amountText : scaled.explicitGrams ? `${formatNumber(scaled.explicitGrams, 0)} g` : ''
                  return (
                    <li key={ing.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(ing)}
                        className="group flex w-full items-start gap-3 py-2 text-left"
                        title="Tarkista tai korjaa aineksen vastaavuus"
                      >
                        <span className="tabular w-20 shrink-0 text-right text-sm font-medium">{amountLabel}</span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="group-hover:text-brand">{split.rest || ing.raw}</span>
                          {canonical && canonical.fi.toLowerCase() !== ing.name && ing.confidence < 0.95 && (
                            <span className="block text-xs text-muted">→ {canonical.fi}</span>
                          )}
                        </span>
                        <span className="mt-1.5 flex items-center gap-1">
                          {ing.confidence < CONFIDENT_THRESHOLD && ing.quantity != null && <Badge tone="warn" className="hidden sm:inline-flex">tarkista</Badge>}
                          <ConfidenceDot confidence={ing.confidence} method={ing.matchMethod} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Valmistusohje</SectionTitle>
            {recipe.instructions.length === 0 ? (
              <p className="text-sm text-muted">
                {recipe.sourceId === 'fineli'
                  ? 'Fineli-aineisto sisältää vain raaka-aineet ja määrät. Valmistusohjetta ei ole saatavilla.'
                  : 'Valmistusohjetta ei ole lisätty.'}
                {sourceUrl && recipe.origin !== 'catalogue' && (
                  <> Katso ohje <a className="text-brand underline" href={sourceUrl} target="_blank" rel="noopener noreferrer">alkuperäiseltä sivulta</a>.</>
                )}
              </p>
            ) : (
              <ol className="space-y-4">
                {recipe.instructions.map((step, i) =>
                  step.endsWith(':') ? (
                    <li key={i} className="list-none pt-2 text-sm font-semibold text-ink-2">{step.slice(0, -1)}</li>
                  ) : (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
                      <p className="pt-0.5 leading-relaxed">{step}</p>
                    </li>
                  ),
                )}
              </ol>
            )}
            {recipe.origin === 'imported' && recipe.instructions.length > 0 && (
              <p className="mt-4 text-xs text-muted">Tuotu ohje on tallennettu vain omaan käyttöösi tälle laitteelle. Tekijänoikeudet: {recipe.sourceName}.</p>
            )}
          </Card>

          {nutrition && nutrients && (
            <Card className="p-5">
              <SectionTitle
                action={
                  <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs">
                    {[true, false].map((ps) => (
                      <button key={String(ps)} onClick={() => setPerServing(ps)} className={cx('rounded-md px-2.5 py-1 font-medium', perServing === ps ? 'bg-surface shadow-sm' : 'text-ink-2')}>
                        {ps ? 'Annos' : `Koko resepti (${formatNumber(servings, 1)} annosta)`}
                      </button>
                    ))}
                  </div>
                }
              >
                Ravintosisältö
              </SectionTitle>
              <NutritionSummary nutrients={nutrients} />
              <EstimateNote coverage={nutrition.coverage} className="mt-4" />
              <button onClick={() => setShowDetails((v) => !v)} className="no-print mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand">
                <ChevronDown size={16} className={cx('transition', showDetails && 'rotate-180')} /> {showDetails ? 'Piilota erittely' : 'Näytä ravintosisällön erittely'}
              </button>
              {showDetails && <NutritionDetails lines={nutrition.lines} nutrients={nutrients} perServing={perServing} servings={servings} />}
              {recipe.sourceNutrition && (
                <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
                  <p className="font-medium">Lähteen ilmoittamat ravintotiedot ({basisLabel(recipe.sourceNutrition.basis)})</p>
                  <p className="mt-1">
                    {Object.entries(recipe.sourceNutrition.raw)
                      .filter(([, v]) => v !== '' && v != null)
                      .map(([k, v]) => `${k}: ${typeof v === 'number' ? formatNumber(v, 1) : v}`)
                      .join(' · ')}
                  </p>
                </div>
              )}
              {settings.targets.energyKcal ? null : (
                <p className="no-print mt-3 text-xs text-muted">Voit asettaa päivittäiset tavoitteet <Link to="/asetukset" className="underline">asetuksissa</Link>.</p>
              )}
            </Card>
          )}
        </div>
      </div>

      <AddToPlanDialog recipe={recipe} open={planOpen} onClose={() => setPlanOpen(false)} />
      <AddToShoppingListDialog recipe={recipe} servings={servings} open={shopOpen} onClose={() => setShopOpen(false)} />
      {cooking && <CookingMode recipe={recipe} factor={factor} servings={servings} onClose={() => setCooking(false)} />}
      <IngredientMappingDialog recipe={recipe} ingredient={editing} open={!!editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function basisLabel(b: string): string {
  return b === 'total' ? 'koko resepti' : b === 'per-serving' ? 'annosta kohden' : b === 'per-100g' ? '100 g kohden' : 'peruste ei tiedossa'
}

function TimeItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-1 font-medium">
        <Clock size={14} /> {value >= 60 ? `${Math.floor(value / 60)} h ${value % 60 ? `${value % 60} min` : ''}` : `${value} min`}
      </dd>
    </div>
  )
}

const STATUS_LABEL: Record<NutritionLine['status'], string> = {
  confident: 'Luotettava',
  approximate: 'Arvio',
  unmatched: 'Ei vastinetta',
  unquantified: 'Ei määrää',
  'no-weight': 'Paino puuttuu',
}

function NutritionDetails({ lines, nutrients, perServing, servings }: { lines: NutritionLine[]; nutrients: Nutrients; perServing: boolean; servings: number }) {
  const div = perServing ? servings : 1
  return (
    <div className="mt-4 space-y-5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left text-xs text-muted">Kaikki ravintotekijät ({perServing ? 'annos' : 'koko resepti'}), Fineli-arvoihin perustuva arvio</caption>
          <tbody className="divide-y divide-line">
            {NUTRIENT_KEYS.filter((k) => k !== 'energyKj').map((k) => (
              <tr key={k}>
                <td className="py-1.5 text-ink-2">{NUTRIENT_INFO[k].label}</td>
                <td className="tabular py-1.5 text-right">
                  {formatNumber(nutrients[k], NUTRIENT_INFO[k].decimals)} {NUTRIENT_INFO[k].unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="mb-2 text-left text-xs text-muted">Ainesten osuudet ({perServing ? 'annos' : 'koko resepti'})</caption>
          <thead className="text-xs text-muted">
            <tr className="text-left">
              <th className="py-1 font-medium">Aines</th>
              <th className="py-1 text-right font-medium">g</th>
              <th className="py-1 text-right font-medium">kcal</th>
              <th className="py-1 text-right font-medium">Prot.</th>
              <th className="py-1 pl-3 font-medium">Tila</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => (
              <tr key={l.ingredientId} className="align-top">
                <td className="py-1.5 pr-2">
                  <span className="block">{l.raw}</span>
                  <span className="block text-xs text-muted">{l.food?.fi ?? '—'}{l.gramsResolution.note ? ` · ${l.gramsResolution.note}` : ''}</span>
                </td>
                <td className="tabular py-1.5 text-right">{l.grams !== null ? formatNumber(l.grams / div, 0) : '—'}</td>
                <td className="tabular py-1.5 text-right">{formatNumber(l.nutrients.energyKcal / div, 0)}</td>
                <td className="tabular py-1.5 text-right">{formatNumber(l.nutrients.protein / div, 1)}</td>
                <td className="py-1.5 pl-3">
                  <span className="inline-flex items-center gap-1 text-xs">
                    {l.status === 'confident' ? <CheckCircle2 size={13} className="text-ok" /> : l.status === 'approximate' ? <AlertTriangle size={13} className="text-warn" /> : <XCircle size={13} className="text-bad" />}
                    {STATUS_LABEL[l.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ImportReport({ recipe }: { recipe: Recipe }) {
  const [open, setOpen] = useState(false)
  const r = recipe.importReport!
  const matched = recipe.ingredients.filter((i) => i.confidence >= CONFIDENT_THRESHOLD).length
  const approx = recipe.ingredients.filter((i) => i.confidence > 0 && i.confidence < CONFIDENT_THRESHOLD).length
  return (
    <Card className="mt-6 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-sm">
          <span className="font-medium">Tuontiraportti</span>
          <span className="text-muted"> · {matched}/{recipe.ingredients.length} ainesta tunnistettu{approx ? `, ${approx} arvioitu` : ''}{r.missing.length ? ` · puuttuu: ${r.missing.join(', ')}` : ''}</span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <ul className="space-y-1">
            {DIAGNOSTIC_FIELDS.map(({ field, label }) => (
              <li key={field} className="flex items-center gap-2">
                {r.found[field] ? <CheckCircle2 size={15} className="text-ok" /> : <XCircle size={15} className="text-muted" />}
                {label}
              </li>
            ))}
          </ul>
          <div className="space-y-2 text-xs text-muted">
            <p>Lähdeadapteri: {r.adapter}. Menetelmät: {r.methods.join(', ')}.</p>
            <p>Tuotu {new Date(r.importedAt).toLocaleString('fi-FI')}.</p>
            {r.warnings.map((w, i) => (
              <p key={i} className="text-warn">⚠ {w}</p>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function NotesCard({ recipe }: { recipe: Recipe }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(recipe.notes ?? '')
  if (!editing && !recipe.notes) {
    return (
      <button onClick={() => setEditing(true)} className="no-print mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
        <NotebookPen size={16} /> Lisää omia muistiinpanoja
      </button>
    )
  }
  return (
    <Card className="mt-6 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium"><NotebookPen size={16} /> Omat muistiinpanot</h2>
        {!editing && <Button size="sm" variant="ghost" className="no-print" onClick={() => { setText(recipe.notes ?? ''); setEditing(true) }}>Muokkaa</Button>}
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="esim. Vähemmän chiliä, lapset tykkäsi. Tuplaa kastike."
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Peruuta</Button>
            <Button
              size="sm"
              onClick={async () => {
                await setRecipeNotes(recipe.id, text)
                setEditing(false)
                toast('Muistiinpanot tallennettu')
              }}
            >
              Tallenna
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm text-ink-2">{recipe.notes}</p>
      )}
    </Card>
  )
}

/** Full-screen cooking view: large text, tick-off steps, screen kept awake where the browser allows. */
function CookingMode({ recipe, factor, servings, onClose }: { recipe: Recipe; factor: number; servings: number; onClose: () => void }) {
  const [done, setDone] = useState<Set<number>>(new Set())
  const [wakeLock, setWakeLock] = useState<'on' | 'unsupported' | 'off'>('off')

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const request = async () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      if (!wl) return setWakeLock('unsupported')
      try {
        lock = await wl.request('screen')
        if (cancelled) void lock.release()
        else setWakeLock('on')
      } catch {
        setWakeLock('unsupported')
      }
    }
    void request()
    // The lock is released when the tab is hidden; take it again when the user comes back.
    const onVisible = () => document.visibilityState === 'visible' && void request()
    document.addEventListener('visibilitychange', onVisible)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('keydown', onKey)
      void lock?.release().catch(() => {})
    }
  }, [onClose])

  const steps = recipe.instructions
  const toggle = (i: number) => setDone((d) => {
    const n = new Set(d)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    return n
  })

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas" role="dialog" aria-modal="true" aria-label={`Kokkaustila: ${recipe.title}`}>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Kokkaustila · {formatNumber(servings, 1)} annosta{wakeLock === 'on' ? ' · näyttö pysyy päällä' : wakeLock === 'unsupported' ? ' · selain ei tue näytön pitämistä päällä' : ''}</p>
            <h2 className="font-display text-3xl font-semibold">{recipe.title}</h2>
          </div>
          <IconButton label="Sulje kokkaustila" onClick={onClose} className="h-11 w-11"><X size={24} /></IconButton>
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section>
            <h3 className="mb-3 font-display text-xl font-semibold">Ainekset</h3>
            <ul className="space-y-2 text-lg">
              {recipe.ingredients.map((ing) => {
                const scaled = scaleIngredient(ing, factor)
                const split = splitAmountText(ing.raw)
                return (
                  <li key={ing.id} className="flex gap-3">
                    <span className="tabular w-24 shrink-0 text-right font-semibold">{factor === 1 ? split.amount : scaled.quantity != null ? scaled.amountText : ''}</span>
                    <span>{split.rest || ing.raw}</span>
                  </li>
                )
              })}
            </ul>
          </section>
          <section>
            <h3 className="mb-3 font-display text-xl font-semibold">Valmistus</h3>
            <ol className="space-y-3">
              {steps.map((step, i) =>
                step.endsWith(':') ? (
                  <li key={i} className="pt-2 text-lg font-semibold text-ink-2">{step.slice(0, -1)}</li>
                ) : (
                  <li key={i}>
                    <button
                      onClick={() => toggle(i)}
                      aria-pressed={done.has(i)}
                      className={cx('flex w-full gap-4 rounded-2xl border p-4 text-left text-xl leading-relaxed transition', done.has(i) ? 'border-line bg-surface-2 text-muted line-through' : 'border-line bg-surface hover:border-brand')}
                    >
                      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold', done.has(i) ? 'bg-ok text-white' : 'bg-brand-soft text-brand')}>
                        {done.has(i) ? <CheckCircle2 size={20} /> : i + 1}
                      </span>
                      <span>{step}</span>
                    </button>
                  </li>
                ),
              )}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}

function AttributionNote({ attribution: a }: { attribution: NonNullable<Recipe['attribution']> }) {
  const licenseUrl = safeHttpUrl(a.licenseUrl)
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted">
      <p>
        Lisenssi:{' '}
        {licenseUrl ? (
          <a href={licenseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">{a.license}</a>
        ) : (
          a.license
        )}
        {a.originalTitle ? <> · Alkuperäinen nimi: <span lang="en">{a.originalTitle}</span></> : null}
      </p>
      {a.changes && <p>{a.changes}</p>}
    </div>
  )
}
