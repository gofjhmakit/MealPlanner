import { useLiveQuery } from 'dexie-react-hooks'
import { Download, ExternalLink, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadFineliData, loadSupplementaryData } from '../../db/bootstrap'
import { db, getSetting } from '../../db/db'
import { syncOpenRecipes, type OpenRecipesIndex } from '../../db/openRecipes'
import { exportData, importData, parseExportFile } from '../../db/exportImport'
import { deleteUserMapping, matchContext, rematchUserRecipes, saveUserSettings } from '../../db/repo'
import { getIngredient } from '../../domain/ingredients'
import type { NutritionTargets, UserSettings } from '../../domain/types'
import { useApp, useToast } from '../AppContext'
import { readTheme, storeTheme, type Theme } from '../theme'
import { PageHeader } from '../components/Layout'
import { Button, Card, Field, IconButton, Select, SectionTitle, TextInput } from '../components/ui'

const MAX_IMPORT_BYTES = 25 * 1024 * 1024

const TARGET_FIELDS: { key: keyof NutritionTargets; label: string; unit: string }[] = [
  { key: 'energyKcal', label: 'Energia', unit: 'kcal' },
  { key: 'protein', label: 'Proteiini', unit: 'g' },
  { key: 'carbohydrate', label: 'Hiilihydraatit', unit: 'g' },
  { key: 'fat', label: 'Rasva', unit: 'g' },
  { key: 'fibre', label: 'Kuitu', unit: 'g' },
  { key: 'sugars', label: 'Sokerit', unit: 'g' },
  { key: 'saturatedFat', label: 'Tyydyttyneet rasvahapot', unit: 'g' },
  { key: 'salt', label: 'Suola', unit: 'g' },
]

export function SettingsPage() {
  const { settings, fineli } = useApp()
  const toast = useToast()
  const [draft, setDraft] = useState<UserSettings>(settings)
  const [pantryText, setPantryText] = useState(settings.pantry.join(', '))
  const [theme, setTheme] = useState<Theme>(readTheme())
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const mappings = useLiveQuery(() => db.ingredientMappings.toArray(), [])
  const [reloading, setReloading] = useState(false)

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => storeTheme(theme), [theme])

  async function save() {
    const pantry = pantryText.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    await saveUserSettings({ ...draft, pantry })
    toast('Asetukset tallennettu')
  }

  function setTarget(key: keyof NutritionTargets, value: string) {
    const n = Number(value.replace(',', '.'))
    setDraft((d) => ({ ...d, targets: { ...d.targets, [key]: value.trim() && n > 0 ? n : null } }))
  }

  async function doExport() {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ateriasuunnittelija-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Viety ${data.data.recipes.length} reseptiä, ${data.data.mealItems.length} ateriamerkintää`)
  }

  async function doImport(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast(`Tiedosto on liian suuri (${Math.round(file.size / 1e6)} Mt). Enimmäiskoko on 25 Mt.`, 'error')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try {
      const parsed = parseExportFile(await file.text())
      if (importMode === 'replace' && !confirm('Korvataanko nykyiset reseptit, ruokalistat ja ostoslistat tiedoston sisällöllä?')) return
      const summary = await importData(parsed, importMode)
      toast(`Tuotu ${summary.recipes} reseptiä, ${summary.mealItems} ateriamerkintää, ${summary.shoppingLists} ostoslistaa${summary.skippedMealItems ? ` (${summary.skippedMealItems} ohitettu)` : ''}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function resetAll() {
    if (!confirm('Poistetaanko KAIKKI tiedot tältä laitteelta? Tätä ei voi perua. Vie tiedot ensin, jos haluat säilyttää ne.')) return
    await db.delete()
    location.href = import.meta.env.BASE_URL
  }

  async function reloadFineli() {
    setReloading(true)
    try {
      const fetchImpl = fetch.bind(globalThis)
      await loadFineliData(db, fetchImpl, () => {}, true)
      const supplementary = await loadSupplementaryData(db, fetchImpl, () => {}, true)
      fineli.setSupplementary(await db.supplementaryFoods.toArray(), supplementary.meta)
      await rematchUserRecipes(fineli, db)
      const open = await syncOpenRecipes(db, fetchImpl, await matchContext(fineli), () => {}, true)
      const count = open?.sources.reduce((s, x) => s + x.count, 0) ?? 0
      toast(`Ravintotiedot${count ? ` ja ${count.toLocaleString('fi-FI')} katalogireseptiä` : ''} ladattu uudelleen – päivitä sivu`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setReloading(false)
  }

  return (
    <div className="fade-in">
      <PageHeader title="Asetukset" subtitle="Kaikki asetukset ja tiedot tallentuvat vain tälle laitteelle." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>Päivittäiset ravintotavoitteet</SectionTitle>
          <p className="mb-4 text-sm text-ink-2">Valinnaisia. Sovellus ei anna ravitsemussuosituksia – aseta omat tavoitteesi, jos haluat nähdä edistymispalkit.</p>
          <div className="grid grid-cols-2 gap-3">
            {TARGET_FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label} (${f.unit})`}>
                <TextInput inputMode="decimal" value={draft.targets[f.key] ?? ''} onChange={(e) => setTarget(f.key, e.target.value)} placeholder="–" />
              </Field>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <SectionTitle>Kotitalous</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Oletusannosmäärä" hint="Käytetään, kun ateria lisätään ruokalistalle.">
                <TextInput inputMode="decimal" value={draft.defaultServings} onChange={(e) => setDraft((d) => ({ ...d, defaultServings: Math.max(0.5, Number(e.target.value.replace(',', '.')) || 1) }))} />
              </Field>
              <Field label="Viikko alkaa">
                <Select value={draft.weekStartsOn} onChange={(e) => setDraft((d) => ({ ...d, weekStartsOn: Number(e.target.value) as 0 | 1 }))} className="w-full">
                  <option value={1}>Maanantaista</option>
                  <option value={0}>Sunnuntaista</option>
                </Select>
              </Field>
            </div>
            <Field label="Kotona olevat ainekset" hint="Pilkulla erotettuna. Käytetään reseptihaun ”Ainekset kotona” -suodattimessa.">
              <textarea value={pantryText} onChange={(e) => setPantryText(e.target.value)} rows={3} className="w-full rounded-xl border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none" />
            </Field>
            <Field label="Teema">
              <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">Järjestelmän mukaan</option>
                <option value="light">Vaalea</option>
                <option value="dark">Tumma</option>
              </Select>
            </Field>
          </Card>
          <div className="flex justify-end">
            <Button onClick={save}>Tallenna asetukset</Button>
          </div>
        </div>

        <Card className="p-5">
          <SectionTitle>Omat ainesvastaavuudet</SectionTitle>
          <p className="mb-3 text-sm text-ink-2">Muistetut korjaukset: kun sama aines esiintyy uudessa reseptissä, käytetään valintaasi.</p>
          {mappings && mappings.length > 0 ? (
            <ul className="divide-y divide-line text-sm">
              {mappings.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{m.key}</span>
                    <span className="text-muted"> → {getIngredient(m.canonicalId)?.fi ?? ''}{m.fineliId ? ` (${fineli.get(m.fineliId)?.fi ?? `Fineli ${m.fineliId}`})` : ''}</span>
                  </span>
                  <IconButton label="Poista vastaavuus" onClick={() => deleteUserMapping(m.key)}><Trash2 size={16} /></IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Ei muistettuja korjauksia.</p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <SectionTitle>Tietojen vienti ja tuonti</SectionTitle>
          <p className="text-sm text-ink-2">Vie reseptit, ruokalistat, suosikit, ainesvastaavuudet, ostoslistat ja asetukset JSON-tiedostoon (versioitu muoto). Voit tuoda tiedoston myöhemmin tai toisella laitteella.</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Download size={16} />} onClick={doExport}>Vie tiedot (JSON)</Button>
            <Button variant="secondary" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>Tuo tiedosto</Button>
            <Select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')} aria-label="Tuontitapa">
              <option value="merge">Yhdistä nykyisiin</option>
              <option value="replace">Korvaa nykyiset</option>
            </Select>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </div>
          <div className="border-t border-line pt-4">
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={resetAll}>Poista kaikki tiedot</Button>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>Ravintotietokanta</SectionTitle>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Lähde</dt>
            <dd>Fineli, THL</dd>
            <dt className="text-muted">Julkaisu</dt>
            <dd>{fineli.meta?.release ?? '–'}</dd>
            <dt className="text-muted">Elintarvikkeita</dt>
            <dd>{fineli.size.toLocaleString('fi-FI')}</dd>
            <dt className="text-muted">Katalogireseptejä</dt>
            <dd>{fineli.meta?.dishCount?.toLocaleString('fi-FI') ?? '–'}</dd>
            <dt className="text-muted">Lisenssi</dt>
            <dd>{fineli.meta?.license ?? 'CC BY 4.0'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">{fineli.meta?.attribution ?? 'Fineli – Terveyden ja hyvinvoinnin laitos (THL)'}. THL ei vastaa tietojen tulkinnasta. Ravintoarvot ovat arvioita.</p>
          <SupplementaryDataInfo />
          <Button variant="secondary" size="sm" className="mt-3" icon={<RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />} onClick={reloadFineli}>Lataa ravintotiedot ja katalogireseptit uudelleen</Button>
        </Card>

        <OpenRecipeSources />

        <Card className="p-5 lg:col-span-2">
          <SectionTitle>Yksityisyys ja tekijänoikeudet</SectionTitle>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            <li>Reseptit, ruokalistat, ostoslistat ja asetukset tallennetaan selaimen IndexedDB-tietokantaan tällä laitteella. Sovellus ei käytä analytiikkaa eikä pilvipalveluita.</li>
            <li>Reseptin tuonti verkosta tapahtuu sovelluksen omalla hakupalvelulla, joka hakee vain tuettujen reseptisivustojen sivuja. Sivustolle välittyy tavallinen sivupyyntö; henkilötietojasi ei lähetetä.</li>
            <li>Tuotujen reseptien tekstit ja kuvat kuuluvat alkuperäisille julkaisijoille. Ne tallennetaan vain omaan käyttöösi lähdetietoineen.</li>
            <li>Ravintotiedot: Fineli, Terveyden ja hyvinvoinnin laitos, lisenssi CC BY 4.0. Katalogin ruokalajit perustuvat Finelin reseptiriveihin.</li>
            <li>Täydentävät ravintotiedot (vain kun Finelistä ei löydy sopivaa elintarviketta): Livsmedelsverketin Livsmedelsdatabasen (CC BY 4.0) ja USDA SR Legacy (public domain). Elintarvikkeiden nimet on suomennettu ja aineistoa karsittu; muutokset eivät ole lähteiden tekemiä.</li>
            <li>Katalogin muut reseptit ovat avoimesti lisensoiduista kokoelmista (ks. Reseptiaineistot). Jokaisen reseptin sivulla näkyvät lähde, tekijä, lisenssi ja kuvan tekijä.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

function OpenRecipeSources() {
  const index = useLiveQuery(() => getSetting<OpenRecipesIndex | null>('openRecipes', null), [])
  if (!index?.sources.length) return null
  return (
    <Card className="p-5 lg:col-span-2">
      <SectionTitle>Reseptiaineistot</SectionTitle>
      <p className="mb-3 text-sm text-ink-2">
        Katalogin reseptit on suomennettu ja mitat muunnettu metrisiksi seuraavista avoimesti lisensoiduista kokoelmista. Kiitos tekijöille!
        CC BY-SA -lisensoitujen reseptien suomennokset ovat saatavilla samalla lisenssillä.
      </p>
      <ul className="space-y-3">
        {index.sources.map((s) => (
          <li key={s.id} className="rounded-xl bg-surface-2 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-brand">
                {s.name} <ExternalLink size={12} />
              </a>
              <span className="tabular text-xs text-muted">{s.count.toLocaleString('fi-FI')} reseptiä{s.withImage ? `, ${s.withImage.toLocaleString('fi-FI')} kuvalla` : ''}</span>
            </div>
            <p className="mt-1 text-xs text-ink-2">{s.attribution}</p>
            <p className="mt-1 text-xs text-muted">Lisenssi: {s.license}. {s.changes}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SupplementaryDataInfo() {
  const { fineli } = useApp()
  const meta = fineli.supplementaryMeta
  if (!meta) return null
  return (
    <div className="mt-4 border-t border-line pt-4 text-sm">
      <p className="font-medium">Täydentävät aineistot</p>
      <p className="mt-1 text-xs text-muted">Fineli on ensisijainen lähde. Näitä suomennettuja elintarvikkeita käytetään vain, kun Finelistä ei löydy sopivaa vastinetta; ne on merkitty lähteen nimellä.</p>
      <ul className="mt-2 space-y-1.5">
        {meta.sources.map((s) => (
          <li key={s.id}>
            <a href={s.homepage} target="_blank" rel="noreferrer" className="underline">{s.name}</a>
            <span className="text-muted"> · {s.count.toLocaleString('fi-FI')} elintarviketta · {s.license}</span>
            <span className="block text-xs text-muted">{s.attribution}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
