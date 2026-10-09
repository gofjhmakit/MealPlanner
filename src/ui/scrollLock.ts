/**
 * Keeps the page behind an overlay (sheet, command bar, cook mode, store mode) from scrolling.
 * Locks both html and body: iOS Safari scrolls the document behind a fixed overlay when only
 * body is locked. Reference-counted, so a sheet opened over another overlay doesn't unlock early.
 */
import { useEffect } from 'react'

let locks = 0
let saved: [string, string] = ['', '']

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const html = document.documentElement
    if (locks++ === 0) {
      saved = [html.style.overflow, document.body.style.overflow]
      html.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    }
    return () => {
      if (--locks === 0) {
        html.style.overflow = saved[0]
        document.body.style.overflow = saved[1]
      }
    }
  }, [active])
}
