import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { bootstrap, type FineliStore } from '../db/bootstrap'
import { AppProvider } from './AppContext'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { TodayPage } from './pages/TodayPage'
import { NotFoundPage } from './pages/NotFoundPage'

// Secondary pages are code-split to keep the first load small.
const page = (loader: () => Promise<Record<string, unknown>>, name: string) => {
  const Lazy = lazy(async () => ({ default: (await loader())[name] as ComponentType }))
  return (
    <Suspense fallback={<Spinner />}>
      <Lazy />
    </Suspense>
  )
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayPage /> },
      { path: '/aloitus', element: page(() => import('./pages/OnboardingPage'), 'OnboardingPage') },
      { path: '/viikko', element: page(() => import('./pages/WeekPage'), 'WeekPage') },
      { path: '/viikko/suunnittele', element: page(() => import('./pages/PlanWeekPage'), 'PlanWeekPage') },
      { path: '/reseptit', element: page(() => import('./pages/RecipesPage'), 'RecipesPage') },
      { path: '/reseptit/uusi', element: page(() => import('./pages/RecipeEditPage'), 'RecipeEditPage') },
      { path: '/reseptit/tuo', element: page(() => import('./pages/ImportPage'), 'ImportPage') },
      { path: '/reseptit/:id', element: page(() => import('./pages/RecipeDetailPage'), 'RecipeDetailPage') },
      { path: '/reseptit/:id/muokkaa', element: page(() => import('./pages/RecipeEditPage'), 'RecipeEditPage') },
      { path: '/ostokset', element: page(() => import('./pages/ShoppingPage'), 'ShoppingPage') },
      { path: '/profiili', element: page(() => import('./pages/ProfilePage'), 'ProfilePage') },
      { path: '/tuotteet', element: page(() => import('./pages/ProductsPage'), 'ProductsPage') },
      { path: '/tuotteet/uusi', element: page(() => import('./pages/ProductEditPage'), 'ProductEditPage') },
      { path: '/tuotteet/:id', element: page(() => import('./pages/ProductEditPage'), 'ProductEditPage') },
      { path: '/asetukset', element: page(() => import('./pages/SettingsPage'), 'SettingsPage') },
      // v1 addresses
      { path: '/ruokalista', element: <Navigate to="/viikko" replace /> },
      { path: '/ruokalista/suunnittele', element: <Navigate to="/viikko/suunnittele" replace /> },
      { path: '/ostoslista', element: <Navigate to="/ostokset" replace /> },
      { path: '/ravintosisalto', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })

export function App() {
  const [store, setStore] = useState<FineliStore | null>(null)
  const [progress, setProgress] = useState('Käynnistetään…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    bootstrap((m) => !cancelled && setProgress(m))
      .then((s) => !cancelled && setStore(s))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
          <h1 className="font-display text-2xl font-semibold">Käynnistys epäonnistui</h1>
          <p className="mt-2 text-sm text-ink-2">{error}</p>
          <button className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-on-brand" onClick={() => location.reload()}>
            Yritä uudelleen
          </button>
        </div>
      </div>
    )
  }
  if (!store) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-14 w-14" />
        <h1 className="font-display text-2xl font-semibold">Ateria</h1>
        <div className="flex items-center gap-3 text-sm text-muted" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
          {progress}
        </div>
      </div>
    )
  }
  return (
    <AppProvider fineli={store}>
      <RouterProvider router={router} />
    </AppProvider>
  )
}
