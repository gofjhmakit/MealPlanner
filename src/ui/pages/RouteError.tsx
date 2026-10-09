import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { isStaleChunkError, reloadForNewVersion } from '../reload'

/** Shown instead of a crashed page. A missing code chunk after an update reloads the app. */
export function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  useEffect(() => {
    if (stale) reloadForNewVersion()
  }, [stale])
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-[22px] border border-line bg-surface p-6 text-center">
        <h1 className="font-display text-2xl font-semibold">{stale ? 'Sovellus päivittyi' : 'Jokin meni pieleen'}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {stale ? 'Ladataan uusi versio…' : 'Sivua ei voitu näyttää. Tietosi ovat tallessa – lataa sivu uudelleen.'}
        </p>
        {!stale && <p className="mt-2 break-words text-xs text-muted">{error instanceof Error ? error.message : String(error)}</p>}
        <button className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-on-brand" onClick={() => location.reload()}>
          Lataa uudelleen
        </button>
      </div>
    </div>
  )
}
