import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import type { FineliStore } from '../db/bootstrap'
import { db } from '../db/db'
import { DEFAULT_SETTINGS, userSettingsSchema, type UserSettings } from '../domain/types'
import type { NutritionResult } from '../domain/nutrition'

interface AppContextValue {
  fineli: FineliStore
  /** Changes whenever the user's products change (nutrition must be recalculated). */
  dataVersion: number
  settings: UserSettings
  /** Shared memo of recipe nutrition results keyed by recipe id + updatedAt. */
  nutritionCache: Map<string, NutritionResult>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ fineli, children }: { fineli: FineliStore; children: ReactNode }) {
  const stored = useLiveQuery(() => db.settings.get('userSettings'), [])
  const settings = useMemo(() => {
    const parsed = userSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...((stored?.value as object) ?? {}) })
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  }, [stored])
  const cache = useRef(new Map<string, NutritionResult>())
  // Keep the user's products in the nutrition index; results depend on them, so clear the cache.
  const products = useLiveQuery(() => db.products.toArray(), [])
  const [dataVersion, setDataVersion] = useState(0)
  useEffect(() => {
    if (!products) return
    fineli.setProducts(products)
    cache.current.clear()
    setDataVersion(fineli.version)
  }, [products, fineli])
  const value = useMemo(() => ({ fineli, settings, nutritionCache: cache.current, dataVersion }), [fineli, settings, dataVersion])
  return (
    <AppContext.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

// --- Toasts ------------------------------------------------------------------------------------

interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}
interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
  action?: ToastAction
}
type PushToast = (message: string, tone?: 'ok' | 'error', action?: ToastAction) => void
const ToastContext = createContext<PushToast>(() => {})

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback<PushToast>((message, tone = 'ok', action) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, tone, action }])
    // Toasts with an undo action stay a bit longer so there is time to react.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : action ? 7000 : 3000)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="fade-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-canvas shadow-lg">
            {t.tone === 'ok' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
            <span>{t.message}</span>
            {t.action && (
              <button
                className="ml-1 rounded-md px-2 py-0.5 font-semibold text-accent underline-offset-2 hover:underline"
                onClick={async () => {
                  setToasts((x) => x.filter((y) => y.id !== t.id))
                  await t.action!.onClick()
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="ml-2 opacity-70 hover:opacity-100" aria-label="Sulje ilmoitus" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
