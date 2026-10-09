import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { useScrollLock } from '../scrollLock'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-bad text-white hover:opacity-90',
  soft: 'bg-brand-soft text-brand hover:brightness-95',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-2 transition hover:bg-surface-2 hover:text-ink disabled:opacity-40', className)}
    >
      {children}
    </button>
  )
}

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' }) {
  return <As className={cx('rounded-[22px] border border-line bg-surface', className)}>{children}</As>
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: 'neutral' | 'brand' | 'warn' | 'bad' | 'accent' | 'ok'; children: ReactNode; className?: string; title?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    brand: 'bg-brand-soft text-brand',
    ok: 'bg-brand-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    accent: 'bg-accent-soft text-accent',
  }
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition',
        active ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:border-ink-2/40',
      )}
    >
      {children}
    </button>
  )
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  label,
  suffix,
  size = 'md',
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  suffix?: string
  size?: 'xs' | 'sm' | 'md'
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100))
  const btn = size === 'xs' ? 'h-6 w-6' : size === 'sm' ? 'h-8 w-8' : ''
  const icon = size === 'xs' ? 12 : 16
  return (
    <div className={cx('inline-flex items-center rounded-xl border border-line bg-surface', size === 'xs' ? 'h-7 rounded-lg' : size === 'sm' ? 'h-8' : 'h-10')} role="group" aria-label={label}>
      <IconButton label={`Vähennä: ${label}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min} className={btn}>
        <Minus size={icon} />
      </IconButton>
      <span className={cx('tabular text-center font-medium', size === 'xs' ? 'min-w-[1.25rem] text-xs' : size === 'sm' ? 'min-w-[2.5rem] text-sm' : 'min-w-[2.5rem]')} aria-live="polite">
        {value.toLocaleString('fi-FI')}
        {suffix ? <span className="ml-1 text-muted font-normal">{suffix}</span> : null}
      </span>
      <IconButton label={`Lisää: ${label}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max} className={btn}>
        <Plus size={icon} />
      </IconButton>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useScrollLock(open)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cx(
        'm-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <IconButton label="Sulje" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Ladataan…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  )
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none',
        className,
      )}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx('h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none', className)}
    >
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="font-display text-lg font-semibold">{children}</h2>
      {action}
    </div>
  )
}

export function ProgressBar({ value, max, tone = 'brand', label }: { value: number; max: number; tone?: 'brand' | 'accent' | 'protein' | 'carb' | 'fat' | 'fibre' | 'warn'; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const over = max > 0 && value > max * 1.05
  const colors = { brand: 'bg-brand', accent: 'bg-accent', protein: 'bg-protein', carb: 'bg-carb', fat: 'bg-fat', fibre: 'bg-fibre', warn: 'bg-warn' }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={Math.round(max)} aria-label={label}>
      <div className={cx('h-full rounded-full transition-all', over ? 'bg-warn' : colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition', checked ? 'bg-brand' : 'bg-line')}
      >
        <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  )
}
