import { ChevronRight, Link2, QrCode } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Recipe } from '../../domain/types'
import { useToast } from '../AppContext'
import { QrShareDialog } from './QrShareDialog'
import { Sheet } from './v2'

/**
 * The link a recipe can be shared as, or null if it only lives on this device.
 * Imported recipes keep their original web address; catalogue recipes have a
 * stable in-app address; a person's own recipes have neither – those travel by QR.
 */
function shareLinkFor(recipe: Recipe): string | null {
  if (recipe.sourceUrl) return recipe.sourceUrl
  if (recipe.origin === 'catalogue') return `${location.origin}${import.meta.env.BASE_URL}reseptit/${encodeURIComponent(recipe.id)}`
  return null
}

/** Choose how to share a selection of recipes: as QR codes (always works, offline) or as links (where one exists). */
export function ShareRecipesSheet({ recipes, open, onClose }: { recipes: Recipe[]; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [qrOpen, setQrOpen] = useState(false)

  const linked = recipes.map((r) => shareLinkFor(r)).filter((u): u is string => !!u)
  const linkCount = linked.length
  const total = recipes.length

  async function shareLinks() {
    const pairs = recipes.map((r) => ({ r, url: shareLinkFor(r) })).filter((p): p is { r: Recipe; url: string } => !!p.url)
    if (pairs.length === 0) return
    const text = pairs.map((p) => `${p.r.title}\n${p.url}`).join('\n\n')
    const data: ShareData = { title: pairs.length === 1 ? pairs[0].r.title : `${pairs.length} reseptiä`, text }
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data)
        onClose()
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast(pairs.length === 1 ? 'Linkki kopioitu' : `${pairs.length} linkkiä kopioitu`)
      onClose()
    } catch {
      toast('Jakaminen ei onnistunut')
    }
  }

  const linkHint =
    linkCount === 0
      ? 'Näillä resepteillä ei ole jaettavaa linkkiä – käytä QR-koodia.'
      : linkCount === total
        ? `Jaa ${linkCount} ${linkCount === 1 ? 'linkki' : 'linkkiä'} (avautuvat selaimessa).`
        : `${linkCount} / ${total} reseptillä on jaettava linkki. Loput siirtyvät vain QR-koodilla.`

  return (
    <>
      <Sheet open={open && !qrOpen} onClose={onClose} title={<h2 className="font-display text-xl font-semibold">Jaa {total} reseptiä</h2>}>
        <div className="space-y-3">
          <Choice
            icon={<QrCode size={22} />}
            title="QR-koodeina"
            subtitle="Toiselle laitteelle ilman nettiä. Toimii kaikille resepteille, myös omille."
            onClick={() => setQrOpen(true)}
          />
          <Choice
            icon={<Link2 size={22} />}
            title="Linkkeinä"
            subtitle={linkHint}
            onClick={shareLinks}
            disabled={linkCount === 0}
          />
          <p className="pt-1 text-xs text-muted">
            QR-koodi siirtää koko reseptin sisällön laitteelta toiselle ilman verkkoa. Vastaanottaja avaa <strong>Tuo reseptejä → Skannaa QR-koodi</strong>.
          </p>
        </div>
      </Sheet>
      <QrShareDialog
        recipes={recipes}
        open={qrOpen}
        onClose={() => {
          setQrOpen(false)
          onClose()
        }}
      />
    </>
  )
}

function Choice({ icon, title, subtitle, onClick, disabled }: { icon: ReactNode; title: string; subtitle: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line disabled:hover:bg-surface"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{subtitle}</span>
      </span>
      {!disabled && <ChevronRight size={18} className="shrink-0 text-muted" />}
    </button>
  )
}
