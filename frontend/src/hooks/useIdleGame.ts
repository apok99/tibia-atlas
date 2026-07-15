import { useCallback, useEffect, useRef, useState } from 'react'
import type { HuntZone } from './useHunts'
import {
  clearSave,
  loadSave,
  newSave,
  persistSave,
  simulate,
  snapshotZone,
  upgradeCost,
  type IdleSave,
  type IdleSimResult,
  type IdleUpgradeKind,
  type IdleVocation,
} from '../lib/idle'

// How often the live game advances while the tab is open.
const TICK_MS = 1000
// Persist at most this often (plus always on pagehide), so localStorage isn't
// hammered every second.
const PERSIST_MS = 5000
// Offline gains shorter than this aren't worth a welcome-back panel.
const WELCOME_MIN_SEC = 120

/**
 * The AFK Hero game state: rehydrates the save, applies offline progress once
 * on mount (surfacing it as `welcome`), then ticks the simulation forward every
 * second while the page is open. All game math lives in lib/idle.
 */
export function useIdleGame() {
  // Rehydrate + catch up in one lazy init so the first render already shows
  // the post-offline state (no flash of stale numbers).
  const [boot] = useState(() => {
    const saved = loadSave()
    if (!saved) return { save: null as IdleSave | null, welcome: null as IdleSimResult | null }
    const now = Date.now()
    const elapsed = (now - saved.lastTick) / 1000
    const { save, result } = simulate(saved, elapsed)
    const caught = { ...save, lastTick: now }
    persistSave(caught)
    return { save: caught, welcome: result.simulatedSec >= WELCOME_MIN_SEC ? result : null }
  })

  const [save, setSave] = useState<IdleSave | null>(boot.save)
  const [welcome, setWelcome] = useState<IdleSimResult | null>(boot.welcome)
  const lastPersist = useRef(Date.now())

  // The live tick: simulate the real elapsed time since the last tick (not a
  // fixed step — timers stall in background tabs and that time still counts).
  const running = save !== null
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      setSave((prev) => {
        if (!prev) return prev
        const now = Date.now()
        const { save: next } = simulate(prev, (now - prev.lastTick) / 1000)
        const ticked = { ...next, lastTick: now }
        if (now - lastPersist.current >= PERSIST_MS) {
          persistSave(ticked)
          lastPersist.current = now
        }
        return ticked
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [running])

  // Flush on tab close/hide so offline catch-up resumes from the true instant.
  useEffect(() => {
    const flush = () => {
      setSave((prev) => {
        if (prev) persistSave(prev)
        return prev
      })
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [])

  const createCharacter = useCallback((name: string, vocation: IdleVocation) => {
    const s = newSave(name, vocation, Date.now())
    persistSave(s)
    setSave(s)
    setWelcome(null)
  }, [])

  const selectZone = useCallback((zone: HuntZone, level: number) => {
    setSave((prev) => {
      if (!prev) return prev
      const next = { ...prev, zone: snapshotZone(zone, level), lastTick: Date.now() }
      persistSave(next)
      return next
    })
  }, [])

  const buyUpgrade = useCallback((kind: IdleUpgradeKind) => {
    setSave((prev) => {
      if (!prev) return prev
      const cost = upgradeCost(kind, prev.upgrades[kind])
      if (prev.gold < cost) return prev
      const next: IdleSave = {
        ...prev,
        gold: prev.gold - cost,
        upgrades: { ...prev.upgrades, [kind]: prev.upgrades[kind] + 1 },
      }
      persistSave(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    clearSave()
    setSave(null)
    setWelcome(null)
  }, [])

  const dismissWelcome = useCallback(() => setWelcome(null), [])

  return { save, welcome, createCharacter, selectZone, buyUpgrade, reset, dismissWelcome }
}
