/**
 * "Tulosta": pick a week and what to print (menu, the week's recipes, shopping list), then open
 * the printable page (pages/PrintPage.tsx).
 */
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { addDays, formatDate, isoWeek } from '../../domain/dates'
import { Button, Modal, Switch } from './ui'

export type PrintPart = 'ohjelma' | 'reseptit' | 'ostokset'

export function printUrl(start: string, parts: PrintPart[]): string {
  return `/tulosta?alku=${start}&osat=${parts.join(',')}`
}

export function PrintDialog({ open, onClose, initialStart }: { open: boolean; onClose: () => void; initialStart: string }) {
  const navigate = useNavigate()
  const [start, setStart] = useState(initialStart)
  const [schedule, setSchedule] = useState(true)
  const [recipes, setRecipes] = useState(false)
  const [shopping, setShopping] = useState(false)
  const parts: PrintPart[] = [...(schedule ? ['ohjelma' as const] : []), ...(recipes ? ['reseptit' as const] : []), ...(shopping ? ['ostokset' as const] : [])]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tulosta"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Peruuta</Button>
          <Button icon={<Printer size={16} />} disabled={!parts.length} onClick={() => navigate(printUrl(start, parts))}>Tulosta</Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-2 p-1.5">
        <button onClick={() => setStart(addDays(start, -7))} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface" aria-label="Edellinen viikko"><ChevronLeft size={17} /></button>
        <p className="flex-1 text-center text-sm">
          <b className="font-semibold">Viikko {isoWeek(start)}</b> · {formatDate(start)}–{formatDate(addDays(start, 6))}
        </p>
        <button onClick={() => setStart(addDays(start, 7))} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface" aria-label="Seuraava viikko"><ChevronRight size={17} /></button>
      </div>
      <div className="space-y-3">
        <Switch checked={schedule} onChange={setSchedule} label="Viikon ruokalista" description="Lukujärjestyksen tapaan, vaakasuuntaiselle sivulle." />
        <Switch checked={recipes} onChange={setRecipes} label="Viikon reseptit" description="Kaikki viikon reseptit oikeille annosmäärille, tiiviisti ilman kuvia." />
        <Switch checked={shopping} onChange={setShopping} label="Ostoslista" description="Viikon aterioiden ainekset osastoittain, ruksattavaksi." />
      </div>
      <p className="mt-4 text-xs text-muted">Avautuu tulostusikkunaan – valitse tulostin tai ”Tallenna PDF-tiedostona”.</p>
    </Modal>
  )
}
