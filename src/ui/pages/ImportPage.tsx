import { AlertTriangle, CheckCircle2, Clipboard, ExternalLink, Link2, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { findRecipeBySourceUrl, matchContext, saveRecipe } from '../../db/repo'
import { getIngredient } from '../../domain/ingredients'
import { CONFIDENT_THRESHOLD } from '../../domain/nutrition'
import type { Recipe } from '../../domain/types'
import { ADAPTERS } from '../../import/adapters'
import { FETCH_AVAILABLE, importFromHtml, importFromUrl, parseUrlList, type ImportOutcome } from '../../import/client'
import type { ImportError } from '../../import/pipeline'
import { useApp, useToast } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { ConfidenceDot, RecipeImage } from '../components/recipe'
import { Badge, Button, Card, cx, Field, TextInput } from '../components/ui'

type RowState =
  | { url: string; status: 'pending' }
  | { url: string; status: 'working' }
  | { url: string; status: 'done'; outcome: ImportOutcome; saved: boolean; existing?: { id: string; title: string } }
  | { url: string; status: 'error'; error: string; code: string }

const EXAMPLES = [
  'https://www.valio.fi/reseptit/maukas-kasvislasagne/',
  'https://yhteishyva.fi/reseptit/marry-me-keitto/7EDLGkBh6ltuuGI38fTrob',
  'https://www.k-ruoka.fi/reseptit/texmex-salaatti',
]

export function ImportPage() {
  const { fineli, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'url' | 'html'>(FETCH_AVAILABLE ? 'url' : 'html')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [busy, setBusy] = useState(false)
  const [htmlUrl, setHtmlUrl] = useState('')
  const [html, setHtml] = useState('')

  const update = (i: number, row: RowState) => setRows((r) => r.map((x, j) => (j === i ? row : x)))

  async function runUrls() {
    const urls = parseUrlList(text)
    if (urls.length === 0) {
      toast('Liitä yksi tai useampi reseptin verkko-osoite', 'error')
      return
    }
    setBusy(true)
    const start: RowState[] = urls.map((url) => ({ url, status: 'pending' }))
    setRows(start)
    const ctx = await matchContext(fineli)
    for (let i = 0; i < urls.length; i++) {
      update(i, { url: urls[i], status: 'working' })
      try {
        const outcome = await importFromUrl(urls[i], ctx, settings.defaultServings)
        const existing = await findRecipeBySourceUrl([outcome.recipe.sourceUrl, urls[i]])
        update(i, { url: urls[i], status: 'done', outcome, saved: false, existing: existing && { id: existing.id, title: existing.title } })
      } catch (e) {
        const err = e as ImportError
        update(i, { url: urls[i], status: 'error', error: err.message, code: err.code ?? 'fetch-failed' })
      }
    }
    setBusy(false)
  }

  async function runHtml() {
    if (!html.trim() || !htmlUrl.trim()) {
      toast('Anna reseptin osoite ja liitä sivun HTML-lähdekoodi', 'error')
      return
    }
    try {
      const ctx = await matchContext(fineli)
      const outcome = importFromHtml(html, htmlUrl.trim(), ctx, settings.defaultServings)
      const existing = await findRecipeBySourceUrl([outcome.recipe.sourceUrl, htmlUrl])
      setRows([{ url: htmlUrl.trim(), status: 'done', outcome, saved: false, existing: existing && { id: existing.id, title: existing.title } }])
      setHtml('')
    } catch (e) {
      const err = e as ImportError
      setRows([{ url: htmlUrl.trim(), status: 'error', error: err.message, code: err.code ?? 'not-a-recipe' }])
    }
  }

  async function save(i: number, openAfter: 'view' | 'edit' | null) {
    const row = rows[i]
    if (row.status !== 'done') return
    await saveRecipe(row.outcome.recipe)
    update(i, { ...row, saved: true })
    toast(`Tallennettu: ${row.outcome.recipe.title}`)
    if (openAfter === 'view') navigate(`/reseptit/${row.outcome.recipe.id}`)
    if (openAfter === 'edit') navigate(`/reseptit/${row.outcome.recipe.id}/muokkaa`)
  }

  async function saveAll() {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.status === 'done' && !row.saved && !row.existing) await save(i, null)
    }
  }

  const unsaved = rows.filter((r) => r.status === 'done' && !r.saved && !r.existing).length

  return (
    <div className="fade-in">
      <PageHeader title="Tuo reseptejä" subtitle={FETCH_AVAILABLE ? 'Liitä reseptien verkko-osoitteet. Tuetut sivustot: K-Ruoka, Yhteishyvä / S-kaupat, Valio, Arla ja Kotikokki.net. Muilta sivuilta voit liittää sivun HTML-koodin.' : 'Liitä reseptisivun HTML-lähdekoodi. Tunnistus toimii parhaiten K-Ruoan, Yhteishyvän / S-kauppojen, Valion, Arlan ja Kotikokki.netin sivuilla.'} />

      {FETCH_AVAILABLE && <div className="mb-4 inline-flex rounded-xl bg-surface-2 p-1" role="tablist">
        {(
          [
            ['url', 'Verkko-osoitteista', Link2],
            ['html', 'Liitä sivun HTML', Clipboard],
          ] as const
        ).map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', mode === m ? 'bg-surface shadow-sm' : 'text-ink-2')}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>}

      {mode === 'url' ? (
        <Card className="p-5">
          <Field label="Reseptien osoitteet (yksi tai useampi)">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={EXAMPLES.join('\n')}
              className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-sm focus:border-brand focus:outline-none"
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={runUrls} disabled={busy} icon={busy ? <Loader2 size={16} className="animate-spin" /> : undefined}>
              {busy ? 'Tuodaan…' : 'Tuo reseptit'}
            </Button>
            <button className="text-sm text-brand underline" onClick={() => setText(EXAMPLES.join('\n'))}>Käytä esimerkkiosoitteita</button>
          </div>
          <p className="mt-4 text-xs text-muted">
            Sivut haetaan sovelluksen omalla, rajatulla hakupalvelulla (vain tuetut reseptisivustot) ja käsitellään selaimessasi. Ruokalistojasi tai muita tietojasi ei lähetetä minnekään.
          </p>
        </Card>
      ) : (
        <Card className="space-y-4 p-5">
          <p className="text-sm text-ink-2">
            {FETCH_AVAILABLE ? 'Jos sivusto estää automaattisen haun (esim. K-Ruoka käyttää bottisuojausta), avaa' : 'Tässä versiossa reseptejä ei haeta osoitteesta, vaan sivun lähdekoodi liitetään: avaa'} resepti selaimessa, valitse <em>Näytä sivun lähdekoodi</em> (Ctrl/Cmd + U), kopioi kaikki ja liitä alle. Sivu käsitellään kokonaan selaimessasi.
          </p>
          <Field label="Reseptin osoite (lähdetiedoksi)">
            <TextInput value={htmlUrl} onChange={(e) => setHtmlUrl(e.target.value)} placeholder="https://www.k-ruoka.fi/reseptit/…" />
          </Field>
          <Field label="Sivun HTML-lähdekoodi">
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={8} className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-xs focus:border-brand focus:outline-none" placeholder="<!doctype html>…" />
          </Field>
          <Button onClick={runHtml}>Lue resepti</Button>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Tuonnin tulokset</h2>
            {unsaved > 1 && <Button variant="soft" onClick={saveAll}>Tallenna kaikki ({unsaved})</Button>}
          </div>
          {rows.map((row, i) => (
            <ResultRow
              key={row.url + i}
              row={row}
              onSave={(open) => save(i, open)}
              onPasteHtml={() => {
                setMode('html')
                setHtmlUrl(row.url)
              }}
            />
          ))}
        </div>
      )}

      <Card className="mt-8 p-5">
        <h2 className="font-display text-lg font-semibold">Tuetut lähteet</h2>
        <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          {ADAPTERS.map((a) => (
            <li key={a.id} className="rounded-xl bg-surface-2 p-3">
              <a href={a.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-brand">
                {a.name} <ExternalLink size={12} />
              </a>
              <p className="mt-1 text-xs text-muted">{a.domains.join(', ')}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-2">Lisäksi {FETCH_AVAILABLE ? 'automaattinen haku' : 'tunnistus'} toimii sivustoilla <strong>arla.fi</strong> ja <strong>kotikokki.net</strong> (Schema.org-reseptitiedot).</p>
        <p className="mt-2 text-xs text-muted">
          Tuodut reseptit tallennetaan vain omaan käyttöösi tälle laitteelle lähdetietoineen. Reseptien tekstit ovat lähdesivustojen tekijänoikeudenalaista sisältöä.
        </p>
      </Card>
    </div>
  )
}

function ResultRow({ row, onSave, onPasteHtml }: { row: RowState; onSave: (open: 'view' | 'edit' | null) => void; onPasteHtml: () => void }) {
  if (row.status === 'pending' || row.status === 'working') {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm">
        {row.status === 'working' ? <Loader2 size={18} className="animate-spin text-brand" /> : <span className="h-[18px] w-[18px] rounded-full border-2 border-line" />}
        <span className="truncate">{row.url}</span>
        <span className="ml-auto text-muted">{row.status === 'working' ? 'Haetaan ja luetaan…' : 'Jonossa'}</span>
      </Card>
    )
  }
  if (row.status === 'error') {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <XCircle size={20} className="mt-0.5 shrink-0 text-bad" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.url}</p>
            <p className="mt-1 text-sm text-ink-2">{row.error}</p>
            {(row.code === 'blocked' || row.code === 'not-allowed' || row.code === 'fetch-failed') && (
              <Button variant="soft" size="sm" className="mt-3" onClick={onPasteHtml} icon={<Clipboard size={14} />}>Liitä sivun HTML käsin</Button>
            )}
          </div>
        </div>
      </Card>
    )
  }
  return <ImportResultCard recipe={row.outcome.recipe} diagnostics={row.outcome.diagnostics} saved={row.saved} existing={row.existing} onSave={onSave} />
}

function ImportResultCard({
  recipe,
  diagnostics,
  saved,
  existing,
  onSave,
}: {
  recipe: Recipe
  diagnostics: ImportOutcome['diagnostics']
  saved: boolean
  existing?: { id: string; title: string }
  onSave: (open: 'view' | 'edit' | null) => void
}) {
  const confident = recipe.ingredients.filter((i) => i.confidence >= CONFIDENT_THRESHOLD)
  const approximate = recipe.ingredients.filter((i) => i.confidence > 0 && i.confidence < CONFIDENT_THRESHOLD)
  const unmatched = recipe.ingredients.filter((i) => i.confidence === 0 && getIngredient(i.canonicalId)?.id !== 'water')
  const ambiguous = [...approximate, ...unmatched]
  const f = diagnostics.found
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <RecipeImage recipe={recipe} className="h-28 w-full shrink-0 sm:w-40" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 size={18} className="text-ok" />
            <p className="font-medium">{saved ? 'Resepti tallennettu' : 'Resepti luettu'}</p>
            <Badge tone="accent">{recipe.sourceName}</Badge>
          </div>
          <h3 className="mt-1 font-display text-xl font-semibold">{recipe.title}</h3>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Check ok={!!f.title} label="Reseptin nimi" />
            <Check ok={!!f.ingredients} label={`${recipe.ingredients.length} ainesta`} />
            <Check ok={!!f.instructions} label={`${recipe.instructions.length} valmistusvaihetta`} />
            <Check ok={!!f.servings} label={f.servings ? `${recipe.servings} annosta` : 'Annosmäärä (oletettu)'} />
            <Check ok={!!(f.prepTimeMin || f.cookTimeMin || f.totalTimeMin)} label="Valmistusaika" />
            <Check ok={!!f.images} label="Kuva" />
            <Check ok={!!f.sourceNutrition} label="Lähteen ravintotiedot" optional />
          </ul>
          <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
            <p className="font-medium">Ravintosisältö</p>
            <p className="mt-1 flex items-center gap-2"><CheckCircle2 size={15} className="text-ok" /> {confident.length} / {recipe.ingredients.length} ainesta tunnistettu luotettavasti</p>
            {approximate.length > 0 && <p className="mt-1 flex items-center gap-2 text-warn"><AlertTriangle size={15} /> {approximate.length} ainesta arvioitu</p>}
            {unmatched.length > 0 && <p className="mt-1 flex items-center gap-2 text-bad"><XCircle size={15} /> {unmatched.length} ilman vastinetta</p>}
          </div>
          {ambiguous.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium">Tarkistettavat ainekset</p>
              <ul className="mt-1 space-y-1 text-sm">
                {ambiguous.slice(0, 8).map((i) => {
                  const c = getIngredient(i.canonicalId)
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <ConfidenceDot confidence={i.confidence} />
                      <span>“{i.raw}”</span>
                      <span className="text-muted">→ {c?.fi ?? 'ei vastinetta'} · varmuus {Math.round(i.confidence * 100)} %</span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1 text-xs text-muted">Voit korjata vastaavuudet reseptin sivulla tallennuksen jälkeen napauttamalla ainesta.</p>
            </div>
          )}
          {diagnostics.warnings.map((w, i) => (
            <p key={i} className="mt-2 text-xs text-warn">⚠ {w}</p>
          ))}
        </div>
      </div>
      {existing && !saved && (
        <p className="flex flex-wrap items-center gap-2 border-t border-line bg-warn-soft px-4 py-2.5 text-sm text-warn">
          <AlertTriangle size={15} /> Tämä resepti on jo tallennettu: “{existing.title}”.
          <Link to={`/reseptit/${existing.id}`} className="font-medium underline">Avaa olemassa oleva</Link>
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-4 py-3">
        {saved ? (
          <Link to={`/reseptit/${recipe.id}`}><Button variant="secondary">Avaa resepti</Button></Link>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onSave('edit')}>Tallenna ja muokkaa</Button>
            <Button variant="secondary" onClick={() => onSave(null)}>Tallenna</Button>
            <Button onClick={() => onSave('view')}>{existing ? 'Tallenna kopiona ja avaa' : 'Tallenna ja avaa'}</Button>
          </>
        )}
      </div>
    </Card>
  )
}

function Check({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 size={15} className="text-ok" /> : optional ? <span className="h-[15px] w-[15px] rounded-full border border-line" /> : <AlertTriangle size={15} className="text-warn" />}
      <span className={ok ? '' : 'text-ink-2'}>{label}</span>
    </li>
  )
}
