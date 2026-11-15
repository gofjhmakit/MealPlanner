import { Pause, Play } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Recipe } from '../../domain/types'
import { encodeRecipe } from '../../share/recipeShare'
import { Button, Modal } from './ui'

/** How long each frame of a multi-part code is shown before the next. */
const FRAME_MS = 450

export function QrShareDialog({ recipe, open, onClose }: { recipe: Recipe; open: boolean; onClose: () => void }) {
  const encoded = useMemo(() => encodeRecipe(recipe), [recipe])
  const multi = encoded.total > 1
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState(0)
  const [paused, setPaused] = useState(false)

  // Restart from the first frame whenever the dialog opens or the recipe changes.
  useEffect(() => {
    if (open) {
      setFrame(0)
      setPaused(false)
    }
  }, [open, encoded.id])

  // Cycle through the frames of a multi-part code.
  useEffect(() => {
    if (!open || !multi || paused) return
    const timer = setInterval(() => setFrame((f) => (f + 1) % encoded.total), FRAME_MS)
    return () => clearInterval(timer)
  }, [open, multi, paused, encoded.total])

  // Draw the current frame. Always dark-on-white so it scans in dark mode too.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !open) return
    QRCode.toCanvas(canvas, encoded.frames[frame] ?? encoded.frames[0], {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 288,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {})
  }, [frame, open, encoded])

  return (
    <Modal open={open} onClose={onClose} title="Jaa QR-koodina" footer={<Button onClick={onClose}>Valmis</Button>}>
      <div className="flex flex-col items-center text-center">
        <p className="text-sm text-ink-2">
          Pyydä toista avaamaan <strong>Tuo reseptejä → Skannaa QR-koodi</strong> ja osoittamaan kamera tähän koodiin.
        </p>

        <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
          <canvas ref={canvasRef} width={288} height={288} className="block h-72 w-72" aria-label={`QR-koodi reseptille ${recipe.title}`} />
        </div>

        <p className="mt-3 font-display text-lg font-semibold">{recipe.title}</p>

        {multi ? (
          <div className="mt-2 w-full">
            <div className="flex items-center justify-center gap-3">
              <span className="tabular text-sm text-ink-2">Kuva {frame + 1} / {encoded.total}</span>
              <button
                onClick={() => setPaused((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2"
                aria-label={paused ? 'Jatka' : 'Pysäytä'}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Jatka' : 'Pysäytä'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1" aria-hidden>
              {encoded.frames.map((_, i) => (
                <span key={i} className={i === frame ? 'h-1.5 w-4 rounded-full bg-brand' : 'h-1.5 w-1.5 rounded-full bg-line'} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Iso resepti jaetaan {encoded.total} kuvaan, jotka vaihtuvat itsestään. Pidä koodi näkyvissä – toisen laitteen tarvitsee vain odottaa, että kaikki kuvat on luettu.
            </p>
            {encoded.total >= 6 && (
              <p className="mt-2 text-xs text-muted">
                Hyvin pitkä resepti. Jos lukeminen ei tahdo onnistua, voit jakaa sen myös tiedostona: <strong>Asetukset → Vie tiedot</strong>.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Skannaa koodi toisen puhelimen kameralla. Resepti siirtyy kokonaan ilman nettiä.</p>
        )}
      </div>
    </Modal>
  )
}
