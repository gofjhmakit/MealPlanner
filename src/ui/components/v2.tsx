/**
 * Building blocks of the v2 design: goal ring, meal thumbnails, kcal bars, segmented control,
 * panels and sheets.
 */
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Recipe } from '../../domain/types'
import { PlateArt } from './recipe'
import { cx } from './ui'

/** Day ring: `done` kcal solid, `planned` kcal (still to come) light, against `target`. */
export function GoalRing({ done, planned, target, size = 132, stroke = 12, label }: { done: number; planned: number; target: number | null; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const max = Math.max(target ?? 0, done + planned, 1)
  const doneLen = (Math.min(done, max) / max) * c
  const planLen = (Math.min(planned, max - Math.min(done, max)) / max) * c
  const over = target !== null && done + planned > target * 1.05
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--c-fat)' : 'var(--c-brand)'} strokeOpacity={0.3} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${planLen} ${c}`} strokeDashoffset={-doneLen} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--c-fat)' : 'var(--c-brand)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${doneLen} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{label}</div>
    </div>
  )
}

export function MealThumb({ recipe, size = 44, className }: { recipe: Pick<Recipe, 'id' | 'title' | 'imageUrl' | 'category'> | null | undefined; size?: number; className?: string }) {
  const style = { width: size, height: size }
  if (!recipe) return <span className={cx('inline-block shrink-0 rounded-xl bg-surface-2', className)} style={style} />
  if (recipe.imageUrl)
    return <img src={recipe.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={cx('shrink-0 rounded-xl object-cover', className)} style={style} />
  return <PlateArt recipe={recipe} className={cx('shrink-0', className)} rounded="rounded-xl" style={size ? style : undefined} />
}

/** Thin progress bar with an optional target tick. */
export function MiniBar({ value, max, tone = 'brand', className, tick }: { value: number; max: number; tone?: 'brand' | 'sun' | 'fat' | 'fibre' | 'protein'; className?: string; tick?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = { brand: 'bg-brand', sun: 'bg-sun', fat: 'bg-fat', fibre: 'bg-fibre', protein: 'bg-protein' }[tone]
  return (
    <div className={cx('relative h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={cx('h-full rounded-full transition-[width]', color)} style={{ width: `${pct}%` }} />
      {tick !== undefined && <span className="absolute top-[-2px] h-[10px] w-[2px] rounded bg-ink/70" style={{ left: `${Math.min(99, tick)}%` }} />}
    </div>
  )
}

/** Day kcal against the target: green when within ±12 %, sun when well under, coral when over. */
export function kcalTone(kcal: number, target: number | null): 'brand' | 'sun' | 'fat' {
  if (!target) return 'brand'
  if (kcal > target * 1.12) return 'fat'
  if (kcal < target * 0.8) return 'sun'
  return 'brand'
}

/** Like kcalTone, but a day still in progress (or ahead) is never "under" – only "over" counts. */
export function dayTone(date: string, today: string, kcal: number, target: number | null): 'brand' | 'sun' | 'fat' {
  const tone = kcalTone(kcal, target)
  return date < today || tone === 'fat' ? tone : 'brand'
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Panel({ title, action, children, className, as: As = 'section' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  return (
    <As className={cx('rounded-[22px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(var(--c-shadow)/0.04)]', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </As>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[11px] font-semibold uppercase tracking-[0.08em] text-muted', className)}>{children}</p>
}

/**
 * Bottom sheet on phones, right-hand side panel on desktop. Closes on Esc and backdrop click.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-[rgb(10_14_12/0.35)] lg:items-stretch" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="sheet-in safe-bottom flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[26px] border border-line bg-surface shadow-2xl outline-none lg:max-h-none lg:w-[420px] lg:rounded-none lg:rounded-l-[26px] 3xl:w-[480px]"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line lg:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 lg:pt-5">
          <div className="min-w-0 flex-1">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Sulje">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
