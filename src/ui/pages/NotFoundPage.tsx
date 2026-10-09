import { Link } from 'react-router'
import { PageHeader } from '../components/Layout'
import { Button } from '../components/ui'
import { Panel } from '../components/v2'

export function NotFoundPage() {
  return (
    <div className="fade-in">
      <PageHeader title="Sivua ei löytynyt" />
      <Panel className="max-w-lg">
        <p className="text-sm text-ink-2">Osoitetta ei ole – ehkä linkki on vanhentunut. Palaa tämän päivän näkymään tai hae resepti ylhäältä.</p>
        <Link to="/" className="mt-4 inline-block"><Button>Tänään</Button></Link>
      </Panel>
    </div>
  )
}
