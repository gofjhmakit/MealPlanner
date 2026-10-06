import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { matchContext, saveRecipe } from '../../db/repo'
import { buildRecipeIngredient, isGroupHeading, newId } from '../../domain/recipeIngredients'
import { RECIPE_TYPES, recipeType, type RecipeType } from '../../domain/recipeType'
import type { Recipe, RecipeIngredient } from '../../domain/types'
import { safeHttpUrl } from '../../domain/url'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { Button, Card, EmptyState, Field, Select, Spinner, TextInput } from '../components/ui'
import { useRecipe, useBack } from '../hooks'

export function RecipeEditPage() {
  const { id } = useParams()
  const existing = useRecipe(id)
  if (id && existing === undefined) return <Spinner />
  if (id && existing === null) return <EmptyState title="Reseptiä ei löytynyt" action={<Link to="/reseptit"><Button>Reseptit</Button></Link>} />
  if (existing?.origin === 'catalogue') {
    return <EmptyState title="Katalogireseptejä ei muokata suoraan" action={<Link to={`/reseptit/${existing.id}`}><Button>Takaisin</Button></Link>}>Avaa resepti ja valitse Muokkaa – sinulle tehdään oma kopio.</EmptyState>
  }
  return <RecipeForm key={existing?.id ?? 'new'} existing={existing ?? null} />
}

function ingredientsToText(ings: RecipeIngredient[]): string {
  const lines: string[] = []
  let group: string | null = null
  for (const i of ings) {
    if ((i.group ?? null) !== group) {
      group = i.group ?? null
      if (group) lines.push(`${group}:`)
    }
    lines.push(i.raw)
  }
  return lines.join('\n')
}

function RecipeForm({ existing }: { existing: Recipe | null }) {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const back = useBack('/reseptit')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [servings, setServings] = useState(String(existing?.servings ?? settings.defaultServings))
  const [prep, setPrep] = useState(existing?.prepTimeMin != null ? String(existing.prepTimeMin) : '')
  const [cook, setCook] = useState(existing?.cookTimeMin != null ? String(existing.cookTimeMin) : '')
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [tags, setTags] = useState(existing?.tags.filter((tag) => !tag.startsWith('tyyppi:')).join(', ') ?? '')
  const [typeOverride, setTypeOverride] = useState<RecipeType | ''>('')
  const [sourceUrl, setSourceUrl] = useState(existing?.sourceUrl ?? '')
  const [ingredientsText, setIngredientsText] = useState(existing ? ingredientsToText(existing.ingredients) : '')
  const [instructionsText, setInstructionsText] = useState(existing?.instructions.join('\n\n') ?? '')
  const [saving, setSaving] = useState(false)

  const num = (s: string) => {
    const n = Number(s.replace(',', '.'))
    return s.trim() && Number.isFinite(n) && n > 0 ? n : null
  }

  async function save() {
    if (!title.trim()) {
      toast('Anna reseptille nimi', 'error')
      return
    }
    const servingsN = num(servings)
    if (!servingsN) {
      toast('Annosmäärän pitää olla positiivinen luku', 'error')
      return
    }
    for (const [label, value] of [['Kuvan osoite', imageUrl], ['Lähde', sourceUrl]] as const) {
      if (value.trim() && !safeHttpUrl(value)) {
        toast(`${label}: anna täydellinen http(s)-osoite`, 'error')
        return
      }
    }
    setSaving(true)
    const ctx = await matchContext(fineli)
    // Keep existing ingredient records (and their manual corrections) for unchanged lines.
    const previous = new Map((existing?.ingredients ?? []).map((i) => [i.raw, i]))
    const ingredients: RecipeIngredient[] = []
    let group: string | null = null
    for (const line of ingredientsText.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (isGroupHeading(t)) {
        group = t.replace(/:$/, '')
        continue
      }
      const prev = previous.get(t)
      ingredients.push(prev ? { ...prev, group } : buildRecipeIngredient(t, ctx, group))
    }
    const instructions = instructionsText
      .split(/\n\s*\n|\n(?=\d+[.)]\s)/)
      .map((s) => s.replace(/^\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const prepN = num(prep)
    const cookN = num(cook)
    const now = new Date().toISOString()
    const recipe: Recipe = {
      ...(existing ?? {
        id: newId(),
        origin: 'user' as const,
        sourceId: 'user',
        sourceName: null,
        author: null,
        sourceNutrition: null,
        importReport: null,
        cuisine: null,
        timeText: null,
        servingsText: null,
        inCollection: true,
        createdAt: now,
        updatedAt: now,
      }),
      title: title.trim(),
      description: description.trim() || null,
      servings: servingsN,
      prepTimeMin: prepN,
      cookTimeMin: cookN,
      totalTimeMin: prepN || cookN ? (prepN ?? 0) + (cookN ?? 0) : (existing?.totalTimeMin ?? null),
      imageUrl: safeHttpUrl(imageUrl),
      category: category.trim() || null,
      tags: (() => {
        const userTags = tags.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t && !t.startsWith('tyyppi:'))
        return [...userTags, `tyyppi:${typeOverride || recipeType({ title: title.trim(), category: category.trim(), tags: userTags })}`]
      })(),
      sourceUrl: safeHttpUrl(sourceUrl),
      ingredients,
      instructions,
    }
    await saveRecipe(recipe)
    setSaving(false)
    toast('Resepti tallennettu')
    navigate(`/reseptit/${recipe.id}`, { replace: true })
  }

  return (
    <div className="fade-in">
      <button onClick={back} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> Takaisin
      </button>
      <PageHeader title={existing ? 'Muokkaa reseptiä' : 'Uusi resepti'} subtitle="Ainekset tunnistetaan automaattisesti. Voit tarkistaa vastaavuudet tallennuksen jälkeen." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <Field label="Nimi">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="esim. Kermainen lohikeitto" />
          </Field>
          <Field label="Kuvaus">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Annoksia">
              <TextInput inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} />
            </Field>
            <Field label="Valmistelu (min)">
              <TextInput inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
            </Field>
            <Field label="Kypsennys (min)">
              <TextInput inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kategoria">
              <TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Pääruoat" />
            </Field>
            <Field label="Tunnisteet" hint="Pilkulla erotettuna">
              <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="kasvis, nopea" />
            </Field>
          </div>
          <Field label="Reseptin tyyppi">
            <Select value={typeOverride} onChange={(e) => setTypeOverride(e.target.value as RecipeType | '')}>
              <option value="">Päättele nimestä ja kategoriasta</option>
              {Object.entries(RECIPE_TYPES).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Kuvan osoite (valinnainen)">
            <TextInput value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Lähde (valinnainen)">
            <TextInput value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </Card>
        <div className="space-y-6">
          <Card className="p-5">
            <Field label="Ainekset" hint="Yksi aines per rivi, esim. “2 dl kevytmaitoa”. Väliotsikko kaksoispisteellä, esim. “Kastike:”.">
              <textarea
                value={ingredientsText}
                onChange={(e) => setIngredientsText(e.target.value)}
                rows={12}
                className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-sm focus:border-brand focus:outline-none"
                placeholder={'400 g broilerin fileesuikaleita\n1 sipuli\n2 dl ruokakermaa\nsuolaa'}
              />
            </Field>
          </Card>
          <Card className="p-5">
            <Field label="Valmistusohje" hint="Erota vaiheet tyhjällä rivillä tai numeroinnilla.">
              <textarea
                value={instructionsText}
                onChange={(e) => setInstructionsText(e.target.value)}
                rows={10}
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none"
              />
            </Field>
          </Card>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={back}>Peruuta</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Tallennetaan…' : 'Tallenna resepti'}</Button>
      </div>
    </div>
  )
}
