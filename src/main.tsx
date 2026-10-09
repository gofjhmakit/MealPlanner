import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'
import { applyTheme, readTheme } from './ui/theme'
import { reloadForNewVersion } from './ui/reload'

applyTheme(readTheme())

// After a new deployment, an open tab may ask for code chunks that no longer exist.
// Reload once to get the new version instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForNewVersion()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
