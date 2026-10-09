/**
 * First-run setup in three steps: who you cook for → what you aim for → your first week.
 */
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { saveUserSettings } from '../../db/repo'
import { addDays, startOfWeek, today } from '../../domain/dates'
import { householdServings, suggestTargets } from '../../domain/goals'
import { goalSchema, type Goal, type GoalAim, type Person } from '../../domain/types'
import { useApp, useToast } from '../AppContext'
import { AimPicker, BodyForm, DEFAULT_GOAL, HouseholdEditor, newPerson } from '../components/profile'
import { Button, cx } from '../components/ui'
import { fillEmptySlots } from '../planActions'
import { useCandidates } from '../planning'

export function OnboardingPage() {
  const { settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const candidates = useCandidates()
  const [step, setStep] = useState(1)
  const [people, setPeople] = useState<Person[]>(settings.household.length ? settings.household : [newPerson('adult')])
  const [aim, setAim] = useState<GoalAim | null>(settings.goal?.aim ?? 'maintain')
  const [goal, setGoal] = useState<Goal>(settings.goal ?? DEFAULT_GOAL)
  const [busy, setBusy] = useState(false)

  const named = people.map((p, i) => ({ ...p, name: p.name.trim() || (i === 0 ? 'Minä' : `Henkilö ${i + 1}`) }))

  async function finish(fill: boolean) {
    const finalGoal = aim ? { ...goal, aim } : null
    if (finalGoal && !goalSchema.safeParse(finalGoal).success) {
      toast('Tarkista ikä (14–100), pituus (120–230 cm) ja paino (30–300 kg).', 'error')
      return setStep(2)
    }
    setBusy(true)
    const targets = finalGoal ? { ...settings.targets, ...suggestTargets(finalGoal) } : settings.targets
    const servings = householdServings(named, settings.defaultServings)
    await saveUserSettings({
      ...settings,
      household: named,
      goal: finalGoal,
      targets,
      defaultServings: servings,
      onboarded: true,
      weights: finalGoal ? [...settings.weights.filter((w) => w.date !== today()), { date: today(), kg: finalGoal.weightKg }] : settings.weights,
    })
    if (fill && candidates) {
      const t = today()
      const end = addDays(startOfWeek(t, settings.weekStartsOn), 6)
      const days: string[] = []
      for (let d = t; d <= end || days.length < 3; d = addDays(d, 1)) days.push(d)
      const { added } = await fillEmptySlots(candidates, days, { servings, kcalTarget: targets.energyKcal ?? null })
      toast(`Valmista! Ensimmäiseen viikkoon tuli ${added} ateriaa – vaihda mitä tahansa napauttamalla.`)
    } else toast('Asetukset tallennettu')
    navigate('/')
  }

  async function skip() {
    await saveUserSettings({ ...settings, onboarded: true })
    navigate('/')
  }

  return (
    <div className="fade-in mx-auto max-w-xl pb-10">
      <div className="mb-6 flex items-center gap-3">
        {step > 1 ? (
          <button onClick={() => setStep((s) => s - 1)} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Edellinen vaihe">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <div className="flex flex-1 gap-1.5" aria-label={`Vaihe ${step}/3`}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-brand' : 'bg-line')} />
          ))}
        </div>
        <button onClick={skip} className="text-sm text-muted hover:text-ink">Ohita</button>
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">Vaihe {step}/3 · noin 40 s</p>

      {step === 1 && (
        <>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Kenelle kokkaat?</h1>
          <p className="mb-5 mt-2 text-sm text-ink-2">Annoskoot ja ostosmäärät lasketaan ihmisistä – lapsi ei syö aikuisen annosta.</p>
          <HouseholdEditor people={people} onChange={setPeople} />
          <Button size="lg" className="mt-6 w-full" onClick={() => setStep(2)}>Jatka</Button>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Mihin sinä tähtäät?</h1>
          <p className="mb-5 mt-2 text-sm text-ink-2">Tavoite ohjaa ehdotuksia ja näyttää, riittääkö päivän ruoka. Voit muuttaa sitä milloin vain.</p>
          <AimPicker aim={aim} onChange={setAim} />
          {aim && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium">Tiedot kulutuksen arvioon</p>
              <BodyForm goal={goal} onChange={setGoal} />
            </div>
          )}
          <Button size="lg" className="mt-6 w-full" onClick={() => setStep(3)}>Jatka</Button>
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Tehdäänkö ensimmäinen viikko?</h1>
          <p className="mb-6 mt-2 text-sm text-ink-2">
            Ehdotan aamiaiset, lounaat ja päivälliset tästä päivästä viikon loppuun {named.length > 1 ? `${householdServings(named, 4)} annokselle` : 'sinulle'}. Mikä tahansa ateria vaihtuu yhdellä napautuksella.
          </p>
          <div className="space-y-3">
            <Button size="lg" className="w-full" icon={<Sparkles size={18} />} disabled={busy || !candidates} onClick={() => finish(true)}>
              {candidates ? 'Tee ensimmäinen viikko' : 'Ladataan reseptejä…'}
            </Button>
            <Button size="lg" variant="secondary" className="w-full" disabled={busy} onClick={() => finish(false)}>Aloitan itse</Button>
          </div>
        </>
      )}
    </div>
  )
}
