import { Link } from 'react-router'
import { Button, EmptyState } from '../components/ui'

export function NotFoundPage() {
  return (
    <EmptyState title="Sivua ei löytynyt" action={<Link to="/"><Button>Etusivulle</Button></Link>}>
      Tarkista osoite tai palaa etusivulle.
    </EmptyState>
  )
}
