/** Reload once to pick up a new deployment (guarded against reload loops). */
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem('reloadedForUpdate') ?? 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem('reloadedForUpdate', String(Date.now()))
  } catch {
    /* storage unavailable – reload anyway */
  }
  location.reload()
}

/** Errors that mean "this tab runs an older version than the server has". */
export function isStaleChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /module script|dynamically imported module|Failed to fetch|Loading chunk|Unable to preload/i.test(msg)
}
