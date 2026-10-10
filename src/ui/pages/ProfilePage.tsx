/**
 * Profiili ja tavoitteet: household, aim and body data, daily targets and the weight log.
 */
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { getUserSettings, saveUserSettings } from '../../db/repo'
import { formatDate } from '../../domain/dates'
import { householdServings, suggestTargets } from '../../domain/goals'
import { goalSchema, type Goal, type GoalAim, type NutritionTargets, type Person } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp } from '../AppContext'
import { PageHeader } from '../components/Layout'
import { useAutosave } from '../hooks'
import { AimPicker, BodyForm, DEFAULT_GOAL, HouseholdEditor } from '../components/profile'
import { NumberInput } from '../components/ui'
import { Panel } from '../components/v2'

const TARGET_FIELDS: { key: keyof NutritionTargets; label: string; unit: string }[] = [
  { key: 'energyKcal', label: 'Energia', unit: 'kcal' },
  { key: 'protein', label: 'Proteiini', unit: 'g' },
  { key: 'fibre', label: 'Kuitu', unit: 'g' },
  { key: 'carbohydrate', label: 'Hiilihydraatit', unit: 'g' },
  { key: 'fat', label: 'Rasva', unit: 'g' },
  { key: 'sugars', label: 'Sokerit', unit: 'g' },
  { key: 'saturatedFat', label: 'Tyydyttyneet rasvat', unit: 'g' },
  { key: 'salt', label: 'Suola', unit: 'g' },
]

export function ProfilePage() {
  const { settings } = useApp()
  const [people, setPeople] = useState<Person[]>(settings.household)
  const [aim, setAim] = useState<GoalAim | null>(settings.goal?.aim ?? null)
  const [goal, setGoal] = useState<Goal>(settings.goal ?? DEFAULT_GOAL)
  const [targets, setTargets] = useState<NutritionTargets>(settings.targets)
  const goalValid = !aim || goalSchema.safeParse({ ...goal, aim }).success

  // Saved as you go. Half-typed body measurements ("3" on the way to "36") keep the previous goal until they're valid.
  useAutosave({ people, aim, goal, targets }, async (v) => {
    const named = v.people.map((p, i) => ({ ...p, name: p.name.trim() || (i === 0 ? 'Minä' : `Henkilö ${i + 1}`) }))
    const valid = !v.aim || goalSchema.safeParse({ ...v.goal, aim: v.aim }).success
    const latest = await getUserSettings()
    await saveUserSettings({ ...latest, household: named, goal: valid ? (v.aim ? { ...v.goal, aim: v.aim } : null) : latest.goal, targets: v.targets, defaultServings: householdServings(named, latest.defaultServings), onboarded: true })
  })

  const suggested = aim ? suggestTargets({ ...goal, aim }) : null
  return (
    <div className="fade-in">
      <PageHeader title="Profiili ja tavoitteet" subtitle="Muutokset tallentuvat heti – vain tälle laitteelle." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-2 3xl:grid-cols-3">
        <Panel title="Kotitalous">
          <p className="-mt-1 mb-4 text-sm text-muted">
            Ruoka tehdään {householdServings(people, settings.defaultServings)} annokselle. Ensimmäinen henkilö olet sinä – tavoitteet koskevat sinua.
          </p>
          <HouseholdEditor people={people.length ? people : []} onChange={setPeople} />
        </Panel>
        <Panel title="Tavoite">
          <AimPicker aim={aim} onChange={setAim} />
          {aim && (
            <div className="mt-5">
              <BodyForm goal={goal} onChange={setGoal} />
              {!goalValid && <p className="mt-2 text-xs text-bad">Tarkista ikä (14–100), pituus (120–230 cm) ja paino (30–300 kg) – tavoite tallentuu, kun arvot ovat kunnossa.</p>}
            </div>
          )}
        </Panel>
        <Panel title="Päivätavoitteet" action={suggested && <button onClick={() => setTargets((t) => ({ ...t, ...suggested }))} className="text-sm font-medium text-brand hover:underline">Käytä ehdotusta</button>}>
          <p className="-mt-1 mb-4 text-sm text-muted">Tyhjä kenttä = ei tavoitetta. Energia, proteiini ja kuitu näkyvät Tänään-näkymässä.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            {TARGET_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">{f.label}</span>
                <span className="flex h-11 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-brand">
                  <NumberInput
                    bare
                    value={targets[f.key] ?? null}
                    onValueChange={(n) => setTargets((t) => ({ ...t, [f.key]: n && n > 0 ? n : null }))}
                    className="tabular w-full min-w-0 bg-transparent outline-none"
                  />
                  <span className="text-xs text-muted">{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel title="Painohistoria">
          {settings.weights.length === 0 ? (
            <p className="text-sm text-muted">Ei vielä merkintöjä. Lisää paino Tänään-näkymästä.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...settings.weights].sort((a, b) => b.date.localeCompare(a.date)).map((w) => (
                <li key={w.date} className="flex items-center justify-between py-2 text-sm">
                  <span>{formatDate(w.date, { year: true })}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular font-medium">{formatNumber(w.kg, 1)} kg</span>
                    <button
                      onClick={() => saveUserSettings({ ...settings, weights: settings.weights.filter((x) => x.date !== w.date) })}
                      className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-bad"
                      aria-label={`Poista ${formatDate(w.date)}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
