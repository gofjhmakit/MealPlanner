/**
 * Household and goal editors, shared by the first-run setup (/aloitus) and the profile page.
 */
import { Plus, Trash2 } from 'lucide-react'
import { newId } from '../../domain/recipeIngredients'
import { ACTIVITY_LEVELS, AIM_LABELS, bmi, maintenanceEnergy, PERSON_KINDS, suggestTargets } from '../../domain/goals'
import type { Goal, GoalAim, Person } from '../../domain/types'
import { GOAL_AIMS } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { Avatar } from './Layout'
import { cx, NumberInput } from './ui'

export function newPerson(kind: Person['kind'] = 'adult', name = ''): Person {
  return { id: newId(), name, kind, portion: PERSON_KINDS[kind].portion }
}

export function HouseholdEditor({ people, onChange }: { people: Person[]; onChange: (p: Person[]) => void }) {
  const update = (id: string, patch: Partial<Person>) => onChange(people.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  return (
    <div className="space-y-2.5">
      {people.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          <Avatar name={p.name || '?'} index={i} size={38} />
          <div className="min-w-[9rem] flex-1">
            <input
              value={p.name}
              onChange={(e) => update(p.id, { name: e.target.value })}
              placeholder={i === 0 ? 'Sinun nimesi' : 'Nimi'}
              aria-label={i === 0 ? 'Sinun nimesi' : `Henkilö ${i + 1}: nimi`}
              className="w-full bg-transparent font-medium outline-none placeholder:text-muted"
              maxLength={40}
            />
            <p className="text-xs text-muted">
              {i === 0 ? 'Sinä · ' : ''}
              {PERSON_KINDS[p.kind].label} · ≈ {formatNumber(p.portion, 1)} annosta
            </p>
          </div>
          <div className="order-last flex w-full items-center gap-1 rounded-xl bg-surface-2 p-1 sm:order-none sm:w-auto" role="radiogroup" aria-label="Ikäryhmä">
            {(Object.keys(PERSON_KINDS) as Person['kind'][]).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={p.kind === k}
                onClick={() => update(p.id, { kind: k, portion: PERSON_KINDS[k].portion })}
                className={cx('flex-1 rounded-lg px-2.5 py-1 text-xs font-medium sm:flex-none', p.kind === k ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
              >
                {PERSON_KINDS[k].label}
              </button>
            ))}
          </div>
          {i > 0 && (
            <button onClick={() => onChange(people.filter((x) => x.id !== p.id))} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-bad" aria-label={`Poista ${p.name || 'henkilö'}`}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...people, newPerson()])} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm font-medium text-brand hover:bg-brand-soft/40">
        <Plus size={16} /> Lisää henkilö
      </button>
    </div>
  )
}

export const DEFAULT_GOAL: Goal = { sex: 'female', age: 35, heightCm: 168, weightKg: 70, activity: 1.5, aim: 'maintain' }

export function AimPicker({ aim, onChange }: { aim: GoalAim | null; onChange: (a: GoalAim | null) => void }) {
  const options: [GoalAim | null, string, string][] = [
    ...GOAL_AIMS.map((a) => [a, AIM_LABELS[a].label, AIM_LABELS[a].hint] as [GoalAim, string, string]),
    [null, 'Ei kaloritavoitetta', 'Vain ruoka järjestykseen'],
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(([value, label, hint]) => (
        <button
          key={label}
          role="radio"
          aria-checked={aim === value}
          onClick={() => onChange(value)}
          className={cx('flex items-start gap-2.5 rounded-2xl border p-3 text-left transition', aim === value ? 'border-brand bg-brand-soft/50 ring-1 ring-brand' : 'border-line hover:bg-surface-2')}
        >
          <span className={cx('mt-0.5 h-4 w-4 shrink-0 rounded-full border-2', aim === value ? 'border-brand bg-brand shadow-[inset_0_0_0_2px_var(--c-surface)]' : 'border-line')} />
          <span>
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function NumberField({ label, value, onChange, unit, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; unit: string; min: number; max: number; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      <span className="flex h-11 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-brand">
        <NumberInput
          bare
          value={value}
          onValueChange={(v) => onChange(v ?? NaN)}
          aria-valuemin={min}
          aria-valuemax={max}
          data-step={step}
          className="tabular w-full min-w-0 bg-transparent outline-none"
        />
        <span className="text-sm text-muted">{unit}</span>
      </span>
    </label>
  )
}

/** Body data and activity; shows the suggested daily targets live. */
export function BodyForm({ goal, onChange }: { goal: Goal; onChange: (g: Goal) => void }) {
  const valid = goal.age >= 14 && goal.age <= 100 && goal.heightCm >= 120 && goal.heightCm <= 230 && goal.weightKg >= 30 && goal.weightKg <= 300
  const targets = valid ? suggestTargets(goal) : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Sukupuoli (energiankulutuksen laskentaan)">
        {(
          [
            ['female', 'Nainen'],
            ['male', 'Mies'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} role="radio" aria-checked={goal.sex === v} onClick={() => onChange({ ...goal, sex: v })} className={cx('rounded-lg py-2 text-sm font-medium', goal.sex === v ? 'bg-surface shadow-sm' : 'text-muted')}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Ikä" value={goal.age} onChange={(age) => onChange({ ...goal, age })} unit="v" min={14} max={100} />
        <NumberField label="Pituus" value={goal.heightCm} onChange={(heightCm) => onChange({ ...goal, heightCm })} unit="cm" min={120} max={230} />
        <NumberField label="Paino" value={goal.weightKg} onChange={(weightKg) => onChange({ ...goal, weightKg })} unit="kg" min={30} max={300} step={0.1} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-2">Liikkuminen</p>
        <div className="grid grid-cols-2 gap-2">
          {ACTIVITY_LEVELS.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={goal.activity === a.value}
              onClick={() => onChange({ ...goal, activity: a.value })}
              className={cx('rounded-xl border p-2.5 text-left', goal.activity === a.value ? 'border-brand bg-brand-soft/50' : 'border-line hover:bg-surface-2')}
            >
              <span className="block text-sm font-medium">{a.label}</span>
              <span className="block text-[11px] leading-snug text-muted">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
      {targets && (
        <div className="rounded-2xl bg-brand-soft/60 p-4">
          <p className="text-sm text-ink-2">
            Kulutuksesi on arviolta <b>{formatNumber(maintenanceEnergy(goal), 0)} kcal</b> päivässä (BMI {formatNumber(bmi(goal), 1)}). Ehdotetut päivätavoitteet:
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Target value={targets.energyKcal!} unit="kcal" label="energia" />
            <Target value={targets.protein!} unit="g" label="proteiini" />
            <Target value={targets.fibre!} unit="g" label="kuitu" />
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted">Arvio Mifflin–St Jeor-kaavalla. Ei lääketieteellinen ohje – raskaana, imettäessä tai sairauden hoidossa kysy ammattilaiselta.</p>
        </div>
      )}
    </div>
  )
}

function Target({ value, unit, label }: { value: number; unit: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface p-2.5">
      <p className="tabular font-display text-xl font-semibold leading-none">{formatNumber(value, 0)}</p>
      <p className="mt-1 text-[11px] text-muted">
        {unit} {label}
      </p>
    </div>
  )
}
