/**
 * Cooking timers live outside cook mode: they keep running when cook mode is closed or the page
 * is reloaded (stored in localStorage), and they ring wherever you are in the app.
 */
import { useSyncExternalStore } from 'react'

export interface CookTimer {
  id: number
  label: string
  end: number
  recipeId: string
  recipeTitle: string
}

const KEY = 'cook.timers'
const RING_EVERY_MS = 15_000
const RING_TIMES = 4

function load(): CookTimer[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CookTimer[]
    // Finished more than an hour ago: nobody is waiting for it any more.
    return Array.isArray(list) ? list.filter((t) => t.end > Date.now() - 3_600_000) : []
  } catch {
    return []
  }
}

let state = { timers: load(), now: Date.now() }
const listeners = new Set<() => void>()
const rung = new Map<number, number>()
let interval: ReturnType<typeof setInterval> | null = null
let audio: AudioContext | null = null

function emit(timers = state.timers) {
  state = { timers, now: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(timers))
  } catch {
    // private window: timers just don't survive a reload
  }
  listeners.forEach((l) => l())
  if (timers.length && !interval) interval = setInterval(tick, 1000)
  if (!timers.length && interval) {
    clearInterval(interval)
    interval = null
  }
}

function tick() {
  const now = Date.now()
  for (const t of state.timers) {
    if (t.end > now) continue
    const times = rung.get(t.id) ?? 0
    if (times < RING_TIMES && now - t.end >= times * RING_EVERY_MS) {
      rung.set(t.id, times + 1)
      ring()
    }
  }
  state = { ...state, now }
  listeners.forEach((l) => l())
}

/** Three short beeps and a buzz. The audio context is unlocked by the tap that started a timer. */
function ring() {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300])
  } catch {
    // not supported
  }
  if (!audio) return
  void audio.resume()
  for (let i = 0; i < 3; i++) {
    const at = audio.currentTime + i * 0.35
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
    osc.connect(gain).connect(audio.destination)
    osc.start(at)
    osc.stop(at + 0.3)
  }
}

export function startTimer(t: Omit<CookTimer, 'id'>) {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch {
    // no Web Audio: vibration only
  }
  emit([...state.timers, { ...t, id: Date.now() }])
}

export function removeTimer(id: number) {
  rung.delete(id)
  emit(state.timers.filter((t) => t.id !== id))
}

export function secondsLeft(t: CookTimer, now: number): number {
  return Math.max(0, Math.round((t.end - now) / 1000))
}

export function formatLeft(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useCookTimers(): { timers: CookTimer[]; now: number } {
  return useSyncExternalStore(subscribe, () => state)
}

if (state.timers.length) emit()
