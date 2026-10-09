/**
 * App shell. Responsive by window width (see design/ux-review/REVIEW.md §6):
 *   < 1024      bottom tab bar: Tänään · Viikko · (+) · Reseptit · Ostokset; profile under the avatar
 *   1024–1279   72 px icon rail + top bar with the command field
 *   ≥ 1280      236 px sidebar with the household (264 px from 1920)
 * Keyboard: 1–4 switch sections, ⌘K / Ctrl+K / "/" open the command bar.
 */
import { BookOpen, CalendarDays, Download, Monitor, Moon, Package, Plus, Search, Settings, ShoppingCart, Sun, SunMedium, User } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { readTheme, storeTheme, type Theme } from '../theme'
import { useApp } from '../AppContext'
import { CommandProvider, useCommand } from '../command'
import { cx } from './ui'

export const NAV = [
  { to: '/', label: 'Tänään', icon: SunMedium, end: true, key: '1' },
  { to: '/viikko', label: 'Viikko', icon: CalendarDays, key: '2' },
  { to: '/reseptit', label: 'Reseptit', icon: BookOpen, key: '3' },
  { to: '/ostokset', label: 'Ostokset', icon: ShoppingCart, key: '4' },
]

const MORE = [
  { to: '/profiili', label: 'Profiili ja tavoitteet', icon: User },
  { to: '/tuotteet', label: 'Omat tuotteet', icon: Package },
  { to: '/reseptit/tuo', label: 'Tuo resepti', icon: Download },
  { to: '/asetukset', label: 'Asetukset', icon: Settings },
]

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function Layout() {
  return (
    <CommandProvider>
      <Shell />
    </CommandProvider>
  )
}

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const command = useCommand()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        command.open()
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      if (e.key === '/') {
        e.preventDefault()
        command.open()
      }
      const nav = NAV.find((n) => n.key === e.key)
      if (nav) navigate(nav.to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [command, navigate])

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Siirry sisältöön
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="safe-x min-w-0 flex-1 pb-28 pt-4 md:px-8 lg:px-8 lg:pb-12 lg:pt-6 3xl:px-12">
          <div className="mx-auto w-full max-w-[720px] lg:max-w-[1640px] 3xl:max-w-[2400px]">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomTabs />
    </div>
  )
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Ateria – etusivu">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand font-display text-xl font-semibold text-on-brand">A</span>
      {!compact && <span className="font-display text-xl font-semibold tracking-tight">Ateria</span>}
    </Link>
  )
}

function Sidebar() {
  const { settings } = useApp()
  return (
    <aside className="no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface/50 lg:flex lg:w-[72px] lg:items-center lg:px-2 lg:py-5 xl:w-[236px] xl:items-stretch xl:px-4 3xl:w-[264px]">
      <div className="mb-7 xl:px-2">
        <span className="xl:hidden"><Logo compact /></span>
        <span className="hidden xl:block"><Logo /></span>
      </div>
      <nav className="flex flex-col gap-1" aria-label="Päävalikko">
        {NAV.map(({ to, label, icon: Icon, end, key }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={`${label} (${key})`}
            className={({ isActive }) =>
              cx(
                'group flex items-center gap-3 rounded-xl text-sm font-medium transition lg:h-11 lg:w-11 lg:justify-center xl:h-auto xl:w-auto xl:justify-start xl:px-3 xl:py-2.5',
                isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            <Icon size={19} />
            <span className="hidden flex-1 xl:inline">{label}</span>
            <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] font-medium text-muted xl:inline">{key}</kbd>
          </NavLink>
        ))}
      </nav>
      {settings.household.length > 0 && (
        <div className="mt-6 hidden border-t border-line pt-5 xl:block">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Kotitalous</p>
          <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
            {settings.household.map((p, i) => (
              <li key={p.id}>
                <Link to="/profiili" className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
                  <Avatar name={p.name} index={i} size={26} />
                  <span className="truncate">
                    {p.name}
                    {i === 0 && settings.targets.energyKcal ? <span className="text-muted"> · {settings.targets.energyKcal.toLocaleString('fi-FI')} kcal</span> : null}
                    {p.kind === 'child' ? <span className="text-muted"> · lapsi</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1 lg:items-center xl:items-stretch">
        <ProfileMenu placement="sidebar" />
      </div>
    </aside>
  )
}

function TopBar() {
  const command = useCommand()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <header className="no-print sticky top-0 z-30 hidden h-[68px] items-center gap-4 border-b border-line bg-canvas/85 px-8 backdrop-blur lg:flex 3xl:px-12">
      <button
        onClick={() => command.open()}
        className="flex h-10 w-full max-w-[460px] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-muted transition hover:border-ink-2/30"
      >
        <Search size={16} />
        <span className="flex-1 truncate">Hae reseptiä tai kirjoita ”huomenna päivälliseksi lohi”</span>
        <kbd className="rounded-md border border-line px-1.5 text-[11px] font-medium">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div id="topbar-actions" className="ml-auto flex items-center gap-2" />
    </header>
  )
}

function BottomTabs() {
  const command = useCommand()
  const item = ({ to, label, icon: Icon, end }: (typeof NAV)[number]) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2.5 text-[11.5px] font-medium', isActive ? 'text-brand' : 'text-muted')}>
      <Icon size={21} />
      {label}
    </NavLink>
  )
  return (
    <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Päävalikko">
      <div className="mx-auto grid max-w-[720px] grid-cols-5 items-center">
        {item(NAV[0])}
        {item(NAV[1])}
        <div className="flex justify-center">
          <button
            onClick={() => command.open()}
            aria-label="Lisää ateria tai hae"
            className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg shadow-brand/25 transition active:scale-95"
          >
            <Plus size={26} />
          </button>
        </div>
        {item(NAV[2])}
        {item(NAV[3])}
      </div>
    </nav>
  )
}

const AVATAR_COLORS = ['from-[#f59a6e] to-[#ee6a48]', 'from-[#5aa883] to-[#2e7a5b]', 'from-[#7aa7f0] to-[#4c83d9]', 'from-[#f2c14e] to-[#d9a13b]', 'from-[#b48be0] to-[#7a55c0]']

export function Avatar({ name, index = 0, size = 36 }: { name: string; index?: number; size?: number }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white', AVATAR_COLORS[index % AVATAR_COLORS.length])}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** Avatar button with the secondary destinations (profile, products, import, settings) and theme. */
export function ProfileMenu({ placement = 'header' }: { placement?: 'header' | 'sidebar' }) {
  const { settings } = useApp()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(readTheme())
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const me = settings.household[0]
  const sidebar = placement === 'sidebar'
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profiili ja asetukset"
        className={cx('flex items-center gap-3 rounded-xl transition hover:bg-surface-2', sidebar ? 'p-1.5 xl:w-full xl:px-3 xl:py-2' : 'p-0.5')}
      >
        {me ? <Avatar name={me.name} size={sidebar ? 30 : 36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2"><User size={18} /></span>}
        {sidebar && <span className="hidden truncate text-sm font-medium text-ink-2 xl:inline">{me?.name ?? 'Profiili'} · asetukset</span>}
      </button>
      {open && (
        <div role="menu" className={cx('fade-in absolute z-50 w-64 rounded-2xl border border-line bg-surface p-2 shadow-xl', sidebar ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2')}>
          {MORE.map(({ to, label, icon: Icon }) => (
            <Link key={to} role="menuitem" to={to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Icon size={17} />
              {label}
            </Link>
          ))}
          <div className="mt-1 border-t border-line px-1 pt-2">
            <p className="px-2 pb-1.5 text-xs text-muted">Teema</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Teema">
              {(
                [
                  ['light', 'Vaalea', Sun],
                  ['dark', 'Tumma', Moon],
                  ['system', 'Auto', Monitor],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => {
                    storeTheme(value)
                    setTheme(value)
                  }}
                  className={cx('flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium', theme === value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Page title row. On phones the actions sit in the row (with the avatar); on desktop they move to
 * the top bar next to the command field.
 */
export function PageHeader({ title, eyebrow, subtitle, actions, mobileActions }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; mobileActions?: ReactNode }) {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setTarget(document.getElementById('topbar-actions')), [desktop])
  return (
    <div className="mb-5 lg:mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>}
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight lg:text-[2.1rem] 3xl:text-[2.4rem]">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
        </div>
        <div className="no-print flex shrink-0 items-center gap-2 lg:hidden">
          {mobileActions ?? null}
          <ProfileMenu />
        </div>
      </div>
      {!desktop && actions && mobileActions === undefined && <div className="no-print mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      {desktop && target && actions ? createPortal(actions, target) : null}
    </div>
  )
}
