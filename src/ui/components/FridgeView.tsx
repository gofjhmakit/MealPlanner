/**
 * "Mitä kaapista?" under Ostokset: list what you have, see what you can make (domain/fridge.ts).
 * The list is remembered on this device.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { allergensIn, householdAllergies } from '../../domain/allergies'
import { fridgeMatches, type FridgeMatch } from '../../domain/fridge'
import { capitalize } from '../../domain/dates'
import { useApp } from '../AppContext'
import { useAllRecipes } from '../hooks'
import { Spinner } from './ui'
import { MealThumb, Panel } from './v2'

const KEY = 'fridge.items'
const PAGE = 20

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function FridgeView() {
  const { fineli, settings } = useApp()
  const recipes = useAllRecipes()
  const [text, setText] = useState(load)
  // Matched once typing pauses, not on every key.
  const [deferred, setDeferred] = useState(text)
  useEffect(() => {
    const t = setTimeout(() => setDeferred(text), 350)
    return () => clearTimeout(t)
  }, [text])
  const [shown, setShown] = useState({ full: PAGE, near: PAGE })
  const items = useMemo(() => deferred.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean), [deferred])
  const result = useMemo(() => (recipes ? fridgeMatches(recipes, items, { pantry: settings.pantry, lookup: fineli }) : null), [recipes, items, settings.pantry, fineli])
  const allergies = useMemo(() => householdAllergies(settings.household), [settings.household])

  const onChange = (v: string) => {
    setText(v)
    setShown({ full: PAGE, near: PAGE })
    try {
      localStorage.setItem(KEY, v)
    } catch {
      // private window: just not remembered
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Mitä kotona on?</span>
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            placeholder="esim. riisi, jauheliha, wokkivihannekset, nuudelit, pakasteherne, kananmuna"
            className="w-full rounded-xl border border-line bg-surface p-3 text-base focus:border-brand focus:outline-none sm:text-sm"
          />
        </label>
        <p className="mt-2 text-xs text-muted">
          Pilkulla erotettuna. Vesi, suola, pippuri, öljy, kuivatut mausteet ja asetusten ”aina kotona” -ainekset oletetaan löytyvän. Kastikkeet,
          sipuli, valkosipuli ja yrtit näkyvät kohdassa ”lisäksi” – ne on helppo korvata, joten niitä ei lasketa puuttuviksi.
        </p>
      </Panel>

      {!result ? (
        <Spinner />
      ) : items.length === 0 ? null : result.full.length === 0 && result.near.length === 0 ? (
        <p className="text-sm text-muted">Ei osumia vielä – lisää muutama aines lisää (vähintään kaksi pitää löytyä samasta reseptistä).</p>
      ) : (
        <>
          {result.full.length > 0 && (
            <Section title="Nämä voit tehdä" count={result.full.length} list={result.full} shown={shown.full} more={() => setShown((s) => ({ ...s, full: s.full + PAGE }))} allergies={allergies} />
          )}
          {result.near.length > 0 && (
            <Section
              title="Tarkista, voisitko tehdä nämä"
              hint="Puuttuu yksi aines tai korkeintaan viidesosa – usein sen voi korvata tai jättää pois."
              count={result.near.length}
              list={result.near}
              shown={shown.near}
              more={() => setShown((s) => ({ ...s, near: s.near + PAGE }))}
              allergies={allergies}
            />
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, hint, count, list, shown, more, allergies }: { title: string; hint?: string; count: number; list: FridgeMatch[]; shown: number; more: () => void; allergies: string[] }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">
        {title} <span className="text-base font-normal text-muted">{count}</span>
      </h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <ul className="mt-3 grid gap-2 lg:grid-cols-2">
        {list.slice(0, shown).map((m) => {
          const allergens = allergensIn(m.recipe, allergies)
          return (
            <li key={m.recipe.id}>
              <Link to={`/reseptit/${m.recipe.id}`} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:border-brand">
                <MealThumb recipe={m.recipe} size={52} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium leading-snug">{m.recipe.title}</span>
                  {allergens.length > 0 && <span className="mt-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Allergia: {allergens.join(', ')}</span>}
                  {m.missing.length > 0 && <span className="mt-1 block text-bad">Puuttuu: {m.missing.map(capitalize).join(', ')}</span>}
                  <span className="mt-0.5 block text-muted">Sinulla: {m.have.map(capitalize).join(', ')}</span>
                  {m.also.length > 0 && <span className="mt-0.5 block text-xs text-muted">Lisäksi: {m.also.map(capitalize).join(', ')}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {list.length > shown && (
        <button onClick={more} className="mt-3 text-sm font-medium text-brand hover:underline">Näytä lisää ({list.length - shown})</button>
      )}
    </section>
  )
}
