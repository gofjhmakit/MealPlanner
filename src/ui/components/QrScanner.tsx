import { AlertTriangle, Camera, ClipboardPaste, Loader2, Square } from 'lucide-react'
import jsQR from 'jsqr'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createFrameCollector, type SharePayload } from '../../share/recipeShare'
import { Button, Card, cx } from './ui'

type Phase = 'idle' | 'starting' | 'scanning' | 'error'

/** Scan a shared recipe QR (one or many frames, one or many recipes) with the device camera, fully offline. */
export function QrScanner({ onComplete }: { onComplete: (payloads: SharePayload[]) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastScanRef = useRef(0)
  const collectorRef = useRef(createFrameCollector())
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ have: number; total: number } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const handleText = useCallback(
    (text: string) => {
      const result = collectorRef.current.add(text)
      if (result.status === 'progress') {
        setError('')
        setProgress({ have: result.have, total: result.total })
      } else if (result.status === 'error') {
        setError(result.message)
        setProgress(null)
      } else if (result.status === 'complete') {
        stop()
        setPhase('idle')
        setProgress(null)
        onComplete(result.payloads)
      }
    },
    [onComplete, stop],
  )

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState >= 2) {
      const now = performance.now()
      // ~11 reads/s is plenty and keeps a phone cool.
      if (now - lastScanRef.current > 90) {
        lastScanRef.current = now
        const w = video.videoWidth
        const h = video.videoHeight
        if (w && h) {
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })
            if (code?.data) handleText(code.data)
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [handleText])

  const start = useCallback(async () => {
    setError('')
    setProgress(null)
    collectorRef.current.reset()
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('error')
      setError('Tämä selain tai yhteys ei tue kameraa. Liitä jaettu teksti alta.')
      setPasteOpen(true)
      return
    }
    setPhase('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stop()
        return
      }
      video.srcObject = stream
      await video.play()
      setPhase('scanning')
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      setPhase('error')
      setError(cameraErrorMessage(e))
      setPasteOpen(true)
    }
  }, [stop, tick])

  const handleStop = useCallback(() => {
    stop()
    setPhase('idle')
    setProgress(null)
  }, [stop])

  // Always release the camera when this component goes away.
  useEffect(() => stop, [stop])

  function readPaste() {
    setError('')
    collectorRef.current.reset()
    const lines = pasteText.split(/\s+/).filter(Boolean)
    if (lines.length === 0) return
    for (const line of lines) handleText(line)
    setPasteText('')
  }

  return (
    <Card className="p-5">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className={cx('h-full w-full object-cover', phase === 'scanning' ? 'opacity-100' : 'opacity-0')} />
        <canvas ref={canvasRef} className="hidden" />

        {/* viewfinder frame */}
        {phase === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-3/5 w-3/5 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        )}

        {phase !== 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/90">
            {phase === 'starting' ? (
              <>
                <Loader2 size={28} className="animate-spin" />
                <p className="text-sm">Käynnistetään kameraa…</p>
              </>
            ) : phase === 'error' ? (
              <>
                <AlertTriangle size={28} className="text-warn" />
                <p className="max-w-xs text-sm">{error}</p>
              </>
            ) : (
              <>
                <Camera size={30} />
                <p className="max-w-xs text-sm">Osoita kamera toisen laitteen näyttämään QR-koodiin.</p>
              </>
            )}
          </div>
        )}

        {/* progress badge */}
        {phase === 'scanning' && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-center text-sm text-white">
            {progress ? (
              progress.total > 1 ? (
                <span>Luetaan kuvia: {progress.have} / {progress.total} — pidä koodi näkyvissä</span>
              ) : (
                <span>Resepti luettu…</span>
              )
            ) : (
              <span>Etsitään QR-koodia…</span>
            )}
            {progress && progress.total > 1 && (
              <div className="mx-auto mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/30">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(progress.have / progress.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {phase === 'scanning' ? (
          <Button variant="secondary" onClick={handleStop} icon={<Square size={16} />}>Pysäytä</Button>
        ) : (
          <Button onClick={start} disabled={phase === 'starting'} icon={<Camera size={16} />}>{phase === 'error' ? 'Yritä uudelleen' : 'Käynnistä kamera'}</Button>
        )}
        <button className="inline-flex items-center gap-1.5 text-sm text-brand underline" onClick={() => setPasteOpen((v) => !v)}>
          <ClipboardPaste size={14} /> Liitä jaettu teksti
        </button>
      </div>

      {pasteOpen && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-ink-2">Jos et voi skannata, pyydä jakajaa kopioimaan koodin teksti ja liitä se tähän (myös moniosainen onnistuu – liitä kaikki osat).</p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="LR1.…"
            className="mt-2 w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs focus:border-brand focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="secondary" onClick={readPaste}>Lue teksti</Button>
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-muted">Resepti luetaan kokonaan laitteellasi. Mitään ei lähetetä verkkoon.</p>
    </Card>
  )
}

function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Kameran käyttö estettiin. Salli kamera selaimen asetuksista, tai liitä jaettu teksti alta.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kameraa ei löytynyt tältä laitteelta. Liitä jaettu teksti alta.'
  if (!window.isSecureContext) return 'Kamera vaatii suojatun yhteyden (https). Liitä jaettu teksti alta.'
  return 'Kameraa ei voitu käynnistää. Liitä jaettu teksti alta.'
}
