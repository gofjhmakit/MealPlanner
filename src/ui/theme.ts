/** Per-viewer theme preference (system / light / dark), stored in localStorage when available. */
export type Theme = 'system' | 'light' | 'dark'

export function readTheme(): Theme {
  try {
    return (localStorage.getItem('theme') as Theme) || 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

export function storeTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', theme)
  } catch {
    /* storage unavailable – theme applies for this session only */
  }
  applyTheme(theme)
}
