import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowLeft, Clipboard, Download, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { db } from '../../db/db'
import { deleteProduct, findProductByEan, saveProduct } from '../../db/repo'
import { INGREDIENTS } from '../../domain/ingredients'
import { matchIngredient } from '../../domain/matcher'
import { CATEGORY_LABELS } from '../../domain/shoppingList'
import { SHOPPING_CATEGORIES, type Product, type ShoppingCategory } from '../../domain/types'
import { safeHttpUrl } from '../../domain/url'
import { FETCH_AVAILABLE, fetchPageHtml } from '../../import/client'
import { detectBlockedPage } from '../../import/pipeline'
import { extractProduct, type ExtractedProduct } from '../../import/products'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { Badge, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui'
import { useBack } from '../hooks'

const NUTRIENT_FIELDS = [
  ['energyKcal', 'Energia (kcal)'],
  ['protein', 'Proteiini (g)'],
  ['carbohydrate', 'Hiilihydraatit (g)'],
  ['sugars', '– josta sokereita (g)'],
  ['fat', 'Rasva (g)'],
  ['saturatedFat', '– josta tyydyttynyttä (g)'],
  ['fibre', 'Ravintokuitu (g)'],
  ['salt', 'Suola (g)'],
] as const
type NutrientKey = (typeof NUTRIENT_FIELDS)[number][0]

type DietChoice = '' | 'VEGAN' | 'LACOVEGE' | 'MEAT'

interface FormState {
  name: string
  brand: string
  ean: string
  category: ShoppingCategory
  imageUrl: string
  sourceUrl: string
  source: Product['source']
  packageGrams: string
  pieceGrams: string
  gramsPerDl: string
  nutrients: Record<NutrientKey, string>
  diet: DietChoice
  glutenFree: boolean
  milkFree: boolean
  lactoseFree: boolean
  aliases: string
  canonicalId: string
  ingredientsText: string
  notes: string
}

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))

function toForm(p?: Product): FormState {
  return {
    name: p?.name ?? '',
    brand: p?.brand ?? '',
    ean: p?.ean ?? '',
    category: p?.category ?? 'other',
    imageUrl: p?.imageUrl ?? '',
    sourceUrl: p?.sourceUrl ?? '',
    source: p?.source ?? 'manual',
    packageGrams: str(p?.packageGrams),
    pieceGrams: str(p?.pieceGrams),
    gramsPerDl: str(p?.gramsPerDl),
    nutrients: Object.fromEntries(NUTRIENT_FIELDS.map(([k]) => [k, str(p?.nutrients[k])])) as Record<NutrientKey, string>,
    diet: (p?.diets.find((d) => d === 'VEGAN' || d === 'LACOVEGE' || d === 'MEAT') as DietChoice) ?? '',
    glutenFree: !!p?.diets.includes('GLUTFREE'),
    milkFree: !!p?.diets.includes('MILKFREE'),
    lactoseFree: !!p?.diets.includes('LACSFREE'),
    aliases: p?.aliases.join(', ') ?? '',
    canonicalId: p?.canonicalId ?? '',
    ingredientsText: p?.ingredientsText ?? '',
    notes: p?.notes ?? '',
  }
}

function suggestCanonical(name: string): string {
  // "Pirkka suomalainen naudan jauheliha 17% 400g" -> "suomalainen naudan jauheliha"
  const core = name.replace(/\d+(?:[.,]\d+)?\s*(?:%|kg|g|l|dl|cl|ml|kpl|x)(?![\p{L}])/giu, ' ')
  const m = matchIngredient(core)
  return m.canonicalId && m.confidence >= 0.8 ? m.canonicalId : ''
}

const parseNum = (s: string) => {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function ProductEditPage() {
  const { id } = useParams()
  const existing = useLiveQuery(async () => (id ? ((await db.products.get(id)) ?? null) : undefined), [id])
  if (id && existing === undefined) return <Spinner />
  if (id && existing === null) return <p className="text-muted">Tuotetta ei löytynyt. <Link className="underline" to="/tuotteet">Takaisin tuotteisiin</Link></p>
  return <ProductForm key={id ?? 'new'} existing={existing ?? undefined} />
}

function ProductForm({ existing }: { existing?: Product }) {
  const { fineli } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const back = useBack('/tuotteet')
  const [form, setForm] = useState<FormState>(() => toForm(existing))
  const [importUrl, setImportUrl] = useState('')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [importInfo, setImportInfo] = useState<{ ok: boolean; text: string; warnings: string[] } | null>(null)
  const [duplicate, setDuplicate] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function applyExtracted(p: ExtractedProduct) {
    setForm((f) => ({
      ...f,
      name: p.name ?? f.name,
      brand: p.brand ?? f.brand,
      ean: p.ean ?? f.ean,
      category: p.category ?? f.category,
      imageUrl: p.imageUrl ?? f.imageUrl,
      sourceUrl: p.sourceUrl ?? f.sourceUrl,
      source: p.source,
      packageGrams: p.packageGrams ? str(p.packageGrams) : f.packageGrams,
      gramsPerDl: p.basis && /ml/i.test(p.basis) && !f.gramsPerDl ? '100' : f.gramsPerDl,
      nutrients: Object.fromEntries(NUTRIENT_FIELDS.map(([k]) => [k, p.nutrients[k] !== null ? str(p.nutrients[k]) : f.nutrients[k]])) as Record<NutrientKey, string>,
      glutenFree: f.glutenFree || p.diets.includes('GLUTFREE'),
      milkFree: f.milkFree || p.diets.includes('MILKFREE'),
      lactoseFree: f.lactoseFree || p.diets.includes('LACSFREE'),
      ingredientsText: p.ingredientsText ?? f.ingredientsText,
      // Suggest the dictionary ingredient the product is (shopping list grouping), if clearly recognized.
      canonicalId: f.canonicalId || (p.name ? suggestCanonical(p.name) : ''),
    }))
    const label = { 'k-ruoka': 'K-Ruoan tuotesivulta', 's-kaupat': 'S-kauppojen tuotesivulta', 'json-ld': 'sivun tuotetiedoista', text: 'kopioidusta tekstistä' }[p.source]
    setImportInfo({ ok: true, text: `Tiedot luettu ${label}. Tarkista ja tallenna.`, warnings: p.warnings })
    const dup = p.ean ? await findProductByEan(p.ean) : undefined
    setDuplicate(dup && dup.id !== existing?.id ? dup : null)
  }

  async function fetchFromUrl() {
    const url = safeHttpUrl(importUrl)
    if (!url) {
      toast('Anna tuotesivun täydellinen osoite', 'error')
      return
    }
    setBusy(true)
    try {
      const page = await fetchPageHtml(url)
      if (detectBlockedPage(page.html)) throw new Error('blocked')
      const p = extractProduct(page.html, page.finalUrl)
      if (!p) throw new Error('Sivulta ei löytynyt tuotetietoja.')
      await applyExtracted(p)
    } catch (e) {
      const msg = (e as Error).message
      setImportInfo({
        ok: false,
        text:
          msg === 'blocked' || /bottisuoj|estää/i.test(msg)
            ? 'Kauppa estää automaattisen haun. Avaa tuotesivu selaimessa, paina Cmd/Ctrl + U, kopioi kaikki (Cmd/Ctrl + A, C) ja liitä alle.'
            : msg,
        warnings: [],
      })
    }
    setBusy(false)
  }

  async function readPasted() {
    const p = extractProduct(pasted, importUrl || null)
    if (!p) {
      setImportInfo({ ok: false, text: 'Liitetystä sisällöstä ei löytynyt tuotetietoja. Kopioi tuotesivun lähdekoodi (Cmd/Ctrl + U) tai ravintosisältötaulukko.', warnings: [] })
      return
    }
    await applyExtracted(p)
    setPasted('')
  }

  async function save() {
    if (!form.name.trim()) return toast('Anna tuotteelle nimi', 'error')
    const kcal = parseNum(form.nutrients.energyKcal)
    if (kcal === null || Number.isNaN(kcal)) return toast('Energiasisältö (kcal / 100 g) tarvitaan ravintolaskentaan', 'error')
    const nutrients = Object.fromEntries(NUTRIENT_FIELDS.map(([k]) => [k, parseNum(form.nutrients[k])])) as Record<NutrientKey, number | null>
    const bad = NUTRIENT_FIELDS.find(([k]) => Number.isNaN(nutrients[k]))
    if (bad) return toast(`Tarkista kenttä: ${bad[1]}`, 'error')
    for (const [label, v] of [['Pakkauskoko', form.packageGrams], ['Kappalepaino', form.pieceGrams], ['1 dl painaa', form.gramsPerDl]] as const) {
      if (Number.isNaN(parseNum(v))) return toast(`Tarkista kenttä: ${label}`, 'error')
    }
    const ean = form.ean.replace(/\s/g, '')
    if (ean && !/^\d{8,14}$/.test(ean)) return toast('EAN-koodissa pitää olla 8–14 numeroa', 'error')
    if (form.imageUrl.trim() && !safeHttpUrl(form.imageUrl)) return toast('Kuvan osoitteen pitää olla http(s)-osoite', 'error')
    const diets: Product['diets'] = []
    if (form.diet) diets.push(form.diet)
    if (form.glutenFree) diets.push('GLUTFREE')
    if (form.milkFree) diets.push('MILKFREE')
    if (form.lactoseFree) diets.push('LACSFREE')
    setSaving(true)
    try {
      const saved = await saveProduct(
        {
          id: existing?.id,
          name: form.name.trim(),
          brand: form.brand.trim() || null,
          ean: ean || null,
          category: form.category,
          aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
          canonicalId: form.canonicalId || null,
          nutrients: { ...nutrients, energyKcal: kcal } as Product['nutrients'],
          packageGrams: parseNum(form.packageGrams),
          pieceGrams: parseNum(form.pieceGrams),
          gramsPerDl: parseNum(form.gramsPerDl),
          diets,
          imageUrl: safeHttpUrl(form.imageUrl),
          sourceUrl: safeHttpUrl(form.sourceUrl),
          source: form.source,
          ingredientsText: form.ingredientsText.trim() || null,
          notes: form.notes.trim() || null,
        },
        fineli,
      )
      toast(`Tuote tallennettu: ${saved.name}`)
      navigate('/tuotteet')
    } catch (e) {
      toast(`Tallennus epäonnistui: ${(e as Error).message}`, 'error')
    }
    setSaving(false)
  }

  async function remove() {
    if (!existing || !confirm(`Poistetaanko tuote "${existing.name}"? Sitä käyttävät reseptirivit palautetaan automaattiseen tunnistukseen.`)) return
    await deleteProduct(existing.id, fineli)
    toast('Tuote poistettu')
    navigate('/tuotteet')
  }

  const image = safeHttpUrl(form.imageUrl)

  return (
    <div className="fade-in">
      <button onClick={back} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> Takaisin
      </button>
      <PageHeader
        title={existing ? 'Muokkaa tuotetta' : 'Lisää tuote'}
        subtitle="Omat tuotteet täydentävät Fineliä: ravintoarvot pakkauksesta tai verkkokaupan tuotesivulta."
      />

      <Card className="mb-6 space-y-4 p-5">
        <h2 className="font-display text-lg font-semibold">Tuo verkkokaupasta</h2>
        <p className="text-sm text-ink-2">
          Tuetut: <strong>K-Ruoka</strong> ja <strong>S-kaupat</strong> (sekä sivut, joilla on Schema.org-tuotetiedot). {FETCH_AVAILABLE ? 'Kaupat estävät usein automaattisen haun – silloin avaa tuotesivu' : 'Avaa tuotesivu'}, paina <kbd>Cmd/Ctrl + U</kbd>, kopioi koko lähdekoodi ja liitä se alle. Myös pelkkä kopioitu ravintosisältötaulukko käy.
        </p>
        <div className="flex flex-wrap gap-2">
          <TextInput value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://www.k-ruoka.fi/kauppa/tuote/…" className="min-w-[16rem] flex-1" aria-label="Tuotesivun osoite" />
          {FETCH_AVAILABLE && <Button variant="secondary" onClick={fetchFromUrl} disabled={busy || !importUrl.trim()} icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}>Hae</Button>}
        </div>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={4}
          placeholder="Liitä tuotesivun lähdekoodi tai ravintosisältötaulukko (esim. Energia 944 kJ / 227 kcal …)"
          className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-xs focus:border-brand focus:outline-none"
          aria-label="Liitetty tuotesivu"
        />
        <Button variant="soft" onClick={readPasted} disabled={!pasted.trim()} icon={<Clipboard size={16} />}>Lue tiedot</Button>
        {importInfo && (
          <div className={`rounded-lg px-3 py-2 text-sm ${importInfo.ok ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-warn'}`}>
            <p>{importInfo.text}</p>
            {importInfo.warnings.map((w, i) => <p key={i} className="mt-1 text-xs">⚠ {w}</p>)}
          </div>
        )}
        {duplicate && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            <AlertTriangle size={15} /> Samalla EAN-koodilla on jo tuote “{duplicate.name}”.
            <Link to={`/tuotteet/${duplicate.id}`} className="font-medium underline">Avaa olemassa oleva</Link>
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">Perustiedot</h2>
          <div className="flex gap-4">
            {image && <img src={image} alt="" referrerPolicy="no-referrer" className="h-24 w-24 shrink-0 rounded-xl border border-line bg-white object-contain" />}
            <div className="flex-1 space-y-3">
              <Field label="Nimi *"><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="esim. Oivariini normaalisuolainen 400 g" /></Field>
              <Field label="Tuotemerkki"><TextInput value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="esim. Valio" /></Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="EAN"><TextInput inputMode="numeric" value={form.ean} onChange={(e) => set('ean', e.target.value)} placeholder="6410405338204" /></Field>
            <Field label="Kategoria (ostoslista)">
              <Select value={form.category} onChange={(e) => set('category', e.target.value as ShoppingCategory)} className="w-full">
                {SHOPPING_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Pakkauskoko (g)" hint="”1 pkt” reseptissä"><TextInput inputMode="decimal" value={form.packageGrams} onChange={(e) => set('packageGrams', e.target.value)} /></Field>
            <Field label="Kappalepaino (g)" hint="”1 kpl”"><TextInput inputMode="decimal" value={form.pieceGrams} onChange={(e) => set('pieceGrams', e.target.value)} /></Field>
            <Field label="1 dl painaa (g)" hint="dl, rkl, tl"><TextInput inputMode="decimal" value={form.gramsPerDl} onChange={(e) => set('gramsPerDl', e.target.value)} /></Field>
          </div>
          <Field label="Kuvan osoite"><TextInput value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
          <Field label="Tunnistetaan resepteissä sanoilla" hint="Pilkulla erotettuna, esim. ”oivariini, voi-rypsiöljyseos”. Myös tuotteen nimi ja merkki + nimi tunnistetaan.">
            <TextInput value={form.aliases} onChange={(e) => set('aliases', e.target.value)} />
          </Field>
          <Field label="Vastaa sanakirjan ainesosaa (valinnainen)" hint="Ryhmittelee ostoslistalla saman aineksen kanssa.">
            <Select value={form.canonicalId} onChange={(e) => set('canonicalId', e.target.value)} className="w-full">
              <option value="">–</option>
              {[...INGREDIENTS].sort((a, b) => a.fi.localeCompare(b.fi, 'fi')).map((i) => <option key={i.id} value={i.id}>{i.fi}</option>)}
            </Select>
          </Field>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Ravintosisältö / 100 g</h2>
              {form.source !== 'manual' && <Badge tone="accent">{form.source === 'k-ruoka' ? 'K-Ruoka' : form.source === 's-kaupat' ? 'S-kaupat' : 'tuotu'}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {NUTRIENT_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}>
                  <TextInput inputMode="decimal" value={form.nutrients[k]} onChange={(e) => set('nutrients', { ...form.nutrients, [k]: e.target.value })} placeholder={k === 'energyKcal' ? 'pakollinen' : '–'} />
                </Field>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Jos pakkaus ilmoittaa arvot 100 ml kohden, anna myös ”1 dl painaa” (esim. maito ≈ 103 g).</p>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">Ruokavalio</h2>
            <Select value={form.diet} onChange={(e) => set('diet', e.target.value as DietChoice)} className="w-full" aria-label="Ruokavalio">
              <option value="">Ei tiedossa</option>
              <option value="VEGAN">Vegaaninen</option>
              <option value="LACOVEGE">Kasvis (voi sisältää maitoa tai munaa)</option>
              <option value="MEAT">Sisältää lihaa tai kalaa</option>
            </Select>
            <div className="flex flex-wrap gap-4 text-sm">
              {([['glutenFree', 'Gluteeniton'], ['milkFree', 'Maidoton'], ['lactoseFree', 'Laktoositon']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-[var(--c-brand)]" /> {label}
                </label>
              ))}
            </div>
            <Field label="Ainesosat (valinnainen)"><textarea value={form.ingredientsText} onChange={(e) => set('ingredientsText', e.target.value)} rows={2} className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none" /></Field>
            <Field label="Muistiinpanot"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none" /></Field>
          </Card>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {existing && <Button variant="ghost" className="mr-auto text-bad" icon={<Trash2 size={16} />} onClick={remove}>Poista tuote</Button>}
        <Button variant="secondary" onClick={back}>Peruuta</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Tallennetaan…' : 'Tallenna tuote'}</Button>
      </div>
    </div>
  )
}
