import { useCallback, useEffect, useState } from 'react'

const STORE_KEY = 'atlas:huntLog'
/** Hard cap so a heavy user never blows the localStorage quota. */
const MAX_ENTRIES = 500

/**
 * One calculated session, frozen at the moment the player hit "Guardar hunt".
 * Only the economic result is kept (never the raw paste): the analyzer balance,
 * each real cost line, the resulting profit, and just enough context — hours,
 * kills, the most-killed creature — to label the row later.
 */
export type SavedHunt = {
  id: string
  /** Epoch ms when it was saved. */
  at: number
  /** Local YYYY-MM-DD — the grouping key for the day/month/year rollups. */
  day: string
  hours: number
  balance: number
  /** The analyzer's own Supplies line — the first term of the session's waste. */
  supplies: number
  /** Party size the balance was split between. 1 = solo. */
  players: number
  imbues: number
  tokens: number
  charms: number
  prey: number
  profit: number
  xp: number | null
  kills: number
  /** Most-killed creature, used as the row's name. May be empty. */
  label: string
}

export type NewHunt = Omit<SavedHunt, 'id' | 'at' | 'day'>

/** Everything the session burned: supplies plus the costs the analyzer misses. */
export const waste = (h: SavedHunt) => h.supplies + h.imbues + h.tokens + h.charms + h.prey

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Local calendar day of a date. Deliberately NOT toISOString(): a hunt closed
 * at 01:00 belongs to the day the player lived, not to whatever UTC says.
 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const numOr = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Read the log, dropping anything that does not look like a saved hunt. */
function read(): SavedHunt[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((h) => h && typeof h === 'object' && typeof h.day === 'string' && typeof h.profit === 'number')
      .map((h): SavedHunt => ({
        id: String(h.id ?? h.at ?? h.day),
        at: numOr(h.at),
        day: h.day,
        hours: numOr(h.hours),
        balance: numOr(h.balance),
        supplies: numOr(h.supplies),
        players: Math.max(1, Math.round(numOr(h.players, 1))),
        imbues: numOr(h.imbues),
        tokens: numOr(h.tokens),
        charms: numOr(h.charms),
        prey: numOr(h.prey),
        profit: numOr(h.profit),
        xp: typeof h.xp === 'number' && Number.isFinite(h.xp) ? h.xp : null,
        kills: numOr(h.kills),
        label: typeof h.label === 'string' ? h.label : '',
      }))
      .sort((a, b) => b.at - a.at)
  } catch {
    /* corrupted storage — start from an empty log rather than crashing the tool */
    return []
  }
}

/**
 * The player's own hunt history, persisted in localStorage (this site has no
 * accounts, same as the collection tracker). Newest first; synced across tabs.
 */
export function useHuntLog() {
  const [hunts, setHunts] = useState<SavedHunt[]>(read)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(hunts))
    } catch {
      /* storage full / disabled — the history just won't survive the reload */
    }
  }, [hunts])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY) setHunts(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /**
   * Append a session and hand back its id, so the caller can show "saved".
   * `when` is the moment the hunt was *played* — the analyzer's own start time
   * when the paste carries one, so pasting yesterday's session files it under
   * yesterday. Falls back to now.
   */
  const save = useCallback((entry: NewHunt, when?: Date | null): string => {
    const at = when && !Number.isNaN(when.getTime()) ? when : new Date()
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${at.getTime()}-${Math.round(Math.random() * 1e6)}`
    const hunt: SavedHunt = { ...entry, id, at: at.getTime(), day: dayKey(at) }
    // Newest first — a back-dated paste has to slot in by date, not by arrival.
    setHunts((prev) => [hunt, ...prev].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES))
    return id
  }, [])

  const remove = useCallback((id: string) => setHunts((prev) => prev.filter((h) => h.id !== id)), [])

  const clear = useCallback(() => setHunts([]), [])

  return { hunts, save, remove, clear }
}
