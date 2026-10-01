import { BookOpen, CalendarDays, Home, Package, PieChart, Settings, ShoppingCart } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { cx } from './ui'

const NAV = [
  { to: '/', label: 'Etusivu', icon: Home, end: true },
  { to: '/reseptit', label: 'Reseptit', icon: BookOpen },
  { to: '/ruokalista', label: 'Ruokalista', icon: CalendarDays },
  { to: '/ostoslista', label: 'Ostoslista', icon: ShoppingCart },
  { to: '/ravintosisalto', label: 'Ravintosisältö', short: 'Ravinto', icon: PieChart },
  { to: '/tuotteet', label: 'Omat tuotteet', icon: Package },
  { to: '/asetukset', label: 'Asetukset', icon: Settings },
]

export function Layout() {
  const location = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Siirry sisältöön
      </a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/60 px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-3 px-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" />
          <span className="font-display text-lg font-semibold leading-tight">Ateria&shy;suunnittelija</span>
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Päävalikko">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-2 text-xs leading-relaxed text-muted">
          Ravintoarvot ovat arvioita. Lähde: Fineli, THL (CC BY 4.0). Katalogin reseptien lähteet ja lisenssit: Asetukset. Tiedot tallentuvat vain tälle laitteelle.
        </p>
      </aside>

      {/* Mobile header */}
      <header className="safe-top sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 pb-3 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <span className="font-display text-lg font-semibold">Ateriasuunnittelija</span>
        </Link>
        <span className="flex items-center">
          <NavLink to="/tuotteet" aria-label="Omat tuotteet" className="rounded-lg p-2 text-ink-2 hover:bg-surface-2">
            <Package size={20} />
          </NavLink>
          <NavLink to="/asetukset" aria-label="Asetukset" className="rounded-lg p-2 text-ink-2 hover:bg-surface-2">
            <Settings size={20} />
          </NavLink>
        </span>
      </header>

      <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Päävalikko">
        {NAV.slice(0, 5).map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand' : 'text-muted')}
          >
            <Icon size={20} />
            {short ?? label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
