import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import { useToast } from '../AppContext'
import { BOOKMARKLET } from './bookmarklet'
import { Button, Modal } from './ui'

export function BookmarkletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET)
      setCopied(true)
      toast('Kirjanmerkki kopioitu leikepöydälle')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      areaRef.current?.focus()
      areaRef.current?.select()
      toast('Valitse teksti ja kopioi se itse', 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Kopioi sivun HTML -kirjanmerkki" footer={<Button onClick={onClose}>Valmis</Button>}>
      <div className="space-y-4 text-sm">
        <p className="text-ink-2">
          Pikkuapuri reseptien tuontiin. Kun napautat kirjanmerkkiä millä tahansa reseptisivulla, se kopioi sivun lähdekoodin leikepöydälle,
          jonka voit liittää tähän <strong>Liitä sivun HTML</strong> -välilehdelle. Kätevä etenkin iPhonella, jossa lähdekoodin saa muuten hankalasti.
          Kirjanmerkki toimii vain avoimella sivulla, eikä lähetä mitään minnekään.
        </p>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Kirjanmerkin osoite</span>
            <Button size="sm" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
              {copied ? 'Kopioitu' : 'Kopioi leikepöydälle'}
            </Button>
          </div>
          <textarea
            ref={areaRef}
            readOnly
            value={BOOKMARKLET}
            rows={5}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-none rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] leading-snug text-ink-2 focus:border-brand focus:outline-none"
            aria-label="Kirjanmerkin JavaScript-osoite"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Asennus iPhonella (Safari)</p>
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>Kopioi kirjanmerkki yllä olevalla painikkeella.</li>
            <li>Lisää <em>mikä tahansa</em> sivu kirjanmerkiksi: Jaa-painike → <strong>Lisää kirjanmerkki</strong>.</li>
            <li>Avaa Kirjanmerkit → <strong>Muokkaa</strong> → valitse juuri lisäämäsi kirjanmerkki.</li>
            <li>Poista sen <strong>osoite</strong> ja liitä kopioimasi teksti tilalle. Nimeä esim. <em>Kopioi HTML</em>.</li>
            <li>Avaa reseptisivu → napauta kirjanmerkkiä → HTML kopioituu. Palaa tänne ja liitä.</li>
          </ol>
        </div>

        <p className="text-xs text-muted">
          Tietokoneella voit myös vetää tekstin kirjanmerkkipalkkiin, tai avata lähdekoodin näppäimistöllä (Ctrl/Cmd + U).
        </p>
      </div>
    </Modal>
  )
}
