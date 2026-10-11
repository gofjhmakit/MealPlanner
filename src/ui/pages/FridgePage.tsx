/**
 * Mitä kaapista? – recipes from what is at home (components/FridgeView.tsx). Its own item in the
 * side menu; on phones it is reached from the switch at the top of Ostokset.
 */
import { useNavigate } from 'react-router'
import { FridgeView } from '../components/FridgeView'
import { PageHeader } from '../components/Layout'
import { Segmented } from '../components/v2'

/** Phones only: switch between the shopping list and the fridge view. */
export function FridgeSwitch({ current }: { current: 'list' | 'fridge' }) {
  const navigate = useNavigate()
  return (
    <div className="no-print mb-4 lg:hidden">
      <Segmented
        label="Näkymä"
        value={current}
        onChange={(v) => navigate(v === 'fridge' ? '/kaappi' : '/ostokset', { replace: true })}
        options={[{ value: 'list', label: 'Ostoslista' }, { value: 'fridge', label: 'Mitä kaapista?' }]}
      />
    </div>
  )
}

export function FridgePage() {
  return (
    <div className="fade-in">
      <FridgeSwitch current="fridge" />
      <PageHeader title="Mitä kaapista?" subtitle="Kerro mitä kotona on, niin katsotaan mitä siitä saa tehtyä." />
      <FridgeView />
    </div>
  )
}
