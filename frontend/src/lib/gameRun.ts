// Per-day stopwatch for the three daily puzzle games. The board ranks by
// attempts and then by elapsed time, so "elapsed" needs a definition that can't
// be gamed by a reload: the clock starts the first time the player opens the
// puzzle and is persisted, so refreshing the page never buys a fresh 0:00.
//
// Deliberately localStorage-only, like the games' own saved state — there is no
// account to hang a server-side timer on, and the submitted run is bounded and
// verified against a real character on the way in.

export type GameId = 'wordle' | 'altar' | 'geo'

const PREFIX = 'gameRun:v1:'

const keyFor = (game: GameId, date: string) => `${PREFIX}${game}:${date}`

interface Run {
  /** Epoch ms of the first time this day's puzzle was opened. */
  startedAt: number
  /** Elapsed ms at the moment the puzzle was solved, frozen once. */
  finishedMs?: number
  /** Set once the run has been accepted by the board, so we never post twice. */
  submitted?: boolean
}

function read(game: GameId, date: string): Run | null {
  try {
    const raw = localStorage.getItem(keyFor(game, date))
    if (!raw) return null
    const run = JSON.parse(raw) as Run
    return typeof run?.startedAt === 'number' && run.startedAt > 0 ? run : null
  } catch {
    return null
  }
}

function write(game: GameId, date: string, run: Run): void {
  try {
    localStorage.setItem(keyFor(game, date), JSON.stringify(run))
  } catch {
    /* quota / private mode — the run just won't be timed across reloads */
  }
}

/** Drop this game's runs from other days; only the current one is ever read. */
function prune(game: GameId, date: string): void {
  try {
    const keep = keyFor(game, date)
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${PREFIX}${game}:`) && k !== keep) stale.push(k)
    }
    stale.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

/**
 * Start (or resume) the clock for today's puzzle and return the start instant.
 * Idempotent: called on every mount, it only writes the first time.
 */
export function runStart(game: GameId, date: string): number {
  const existing = read(game, date)
  if (existing) return existing.startedAt
  prune(game, date)
  const startedAt = Date.now()
  write(game, date, { startedAt })
  return startedAt
}

/**
 * The run's final time, frozen on first call. Freezing matters because a
 * submission can fail (offline, TibiaData not answering) and be retried on a
 * later visit — the retry must post the time the player actually took, not the
 * hours that have passed since.
 */
export function runFinish(game: GameId, date: string): number {
  const startedAt = runStart(game, date)
  const run = read(game, date)
  if (run?.finishedMs !== undefined) return run.finishedMs
  const finishedMs = Date.now() - startedAt
  write(game, date, { ...(run ?? { startedAt }), finishedMs })
  return finishedMs
}

export function wasSubmitted(game: GameId, date: string): boolean {
  return read(game, date)?.submitted === true
}

export function markSubmitted(game: GameId, date: string): void {
  const run = read(game, date) ?? { startedAt: Date.now() }
  write(game, date, { ...run, submitted: true })
}

/** m:ss (or h:mm:ss past an hour) — how the board prints a time. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/**
 * "Elite Knight" → "EK", for the board's cramped player column. An unpromoted
 * vocation is a single word ("Knight") and stays whole — clipping it to "Kni"
 * reads as a bug, and it's short enough already.
 */
export function vocationShort(vocation: string | null): string {
  const words = (vocation ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0]
  return words.map((w) => w[0].toUpperCase()).join('')
}
