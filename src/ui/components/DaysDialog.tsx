/**
 * Copy or clear several days at once: pick days of the shown week, then copy them elsewhere
 * (only into free slots, or over what is there) or clear them. Both can be undone from the toast.
 */
import { useState } from 'react'
import { clearDays, copyMeals, undoMealChange } from '../../db/repo'
import { addDays, capitalize, formatDate, weekdayName } from '../../domain/dates'
import { useToast } from '../AppContext'
import { useMealItems } from '../hooks'
import { Button, cx, Modal, Switch } from './ui'
import { Segmented } from './v2'

export function DaysDialog({ onClose, weekDays, initial }: { onClose: () => void; weekDays: string[]; initial: string[] }) {
  const toast = useToast()
  const [selected, setSelected] = useState(() => new Set(initial))
  const [action, setAction] = useState<'copy' | 'clear'>('copy')
  const [offset, setOffset] = useState(7)
  const [replace, setReplace] = useState(false)
  const days = weekDays.filter((d) => selected.has(d))
  const first = days[0] ?? weekDays[0]
  const last = days.at(-1) ?? first
  const meals = useMealItems(first, addDays(last, Math.max(0, offset) + 7))
  const count = (from: string[]) => (meals ?? []).filter((m) => from.includes(m.date)).length
  const sourceCount = count(days)
  const targetDays = days.map((d) => addDays(d, offset))
  const targetCount = count(targetDays)
  const day = (d: string) => `${capitalize(weekdayName(d, true))} ${formatDate(d)}`
  const toggle = (d: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  const run = async () => {
    if (action === 'clear') {
      const change = await clearDays(days)
      toast(`Tyhjennetty ${change.before.filter((m) => days.includes(m.date)).length} ateriaa`, 'ok', { label: 'Kumoa', onClick: () => void undoMealChange(change) })
    } else {
      const change = await copyMeals(days, offset, replace ? 'replace' : 'empty')
      toast(change.added.length ? `Kopioitu ${change.added.length} ateriaa: ${day(targetDays[0])}${targetDays.length > 1 ? `–${day(targetDays.at(-1)!)}` : ''}` : 'Kohteessa ei ollut tyhjiä paikkoja', 'ok', change.added.length ? { label: 'Kumoa', onClick: () => void undoMealChange(change) } : undefined)
    }
    onClose()
  }

  const step = (n: number) => setOffset((o) => (o + n === 0 ? o + n + Math.sign(n) : o + n))
  return (
    <Modal
      open
      onClose={onClose}
      title="Kopioi tai tyhjennä"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button variant={action === 'clear' ? 'danger' : 'primary'} disabled={!days.length || !sourceCount} onClick={run}>
            {action === 'clear' ? `Tyhjennä ${sourceCount} ateriaa` : `Kopioi ${sourceCount} ateriaa`}
          </Button>
        </>
      }
    >
      <Segmented label="Toiminto" value={action} onChange={setAction} options={[{ value: 'copy', label: 'Kopioi' }, { value: 'clear', label: 'Tyhjennä' }]} />
      <p className="mb-2 mt-4 text-sm font-medium">Päivät</p>
      <div className="flex flex-wrap gap-1.5">
        {weekDays.map((d) => (
          <button key={d} onClick={() => toggle(d)} aria-pressed={selected.has(d)} className={cx('rounded-xl border px-2.5 py-1.5 text-sm', selected.has(d) ? 'border-brand bg-brand text-on-brand' : 'border-line hover:bg-surface-2')}>
            {capitalize(weekdayName(d, true))} {formatDate(d)}
          </button>
        ))}
        <button onClick={() => setSelected(new Set(selected.size === weekDays.length ? [] : weekDays))} className="rounded-xl px-2.5 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft">
          {selected.size === weekDays.length ? 'Ei mitään' : 'Koko viikko'}
        </button>
      </div>

      {action === 'copy' ? (
        <>
          <p className="mb-2 mt-5 text-sm font-medium">Minne</p>
          <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1.5 text-sm">
            <button onClick={() => step(-7)} className="rounded-lg px-2 py-1.5 hover:bg-surface">−1 vk</button>
            <button onClick={() => step(-1)} className="rounded-lg px-2 py-1.5 hover:bg-surface">−1 pv</button>
            <p className="flex-1 text-center font-medium">
              {days.length ? `${day(targetDays[0])}${targetDays.length > 1 ? ` – ${day(targetDays.at(-1)!)}` : ''}` : '–'}
            </p>
            <button onClick={() => step(1)} className="rounded-lg px-2 py-1.5 hover:bg-surface">+1 pv</button>
            <button onClick={() => step(7)} className="rounded-lg px-2 py-1.5 hover:bg-surface">+1 vk</button>
          </div>
          <div className="mt-4">
            <Switch
              checked={replace}
              onChange={setReplace}
              label="Korvaa kohteen ateriat"
              description={replace ? `Kohdepäivien ${targetCount} ateriaa poistetaan ensin.` : `Pois päältä: kopioidaan vain tyhjiin kohtiin${targetCount ? ` (kohteessa on jo ${targetCount} ateriaa)` : ''}.`}
            />
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-muted">{sourceCount ? `${sourceCount} ateriaa poistetaan. Voit kumota heti perään.` : 'Valituilla päivillä ei ole aterioita.'}</p>
      )}
    </Modal>
  )
}
