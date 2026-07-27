import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useBoardRefresher, useLeaderboard, submitScore, type BoardRow } from '../hooks/useLeaderboard'
import {
  formatDuration,
  markSubmitted,
  runFinish,
  runStart,
  vocationShort,
  wasSubmitted,
  type GameId,
} from '../lib/gameRun'
import { fetchCharacter, loadCharProfile, saveCharProfile } from '../lib/charProfile'

/** What the page tells the board once the day's puzzle is over. */
export interface GameResult {
  solved: boolean
  /** Tries used (1 for the one-shot games). */
  attempts: number
}

interface Props {
  game: GameId
  /** The puzzle's Tibia day, so the stopwatch and the board agree on "today". */
  date: string
  /** Null while the player is still playing. */
  result: GameResult | null
}

const MEDALS = ['🥇', '🥈', '🥉']

/**
 * Today's top 10 for a daily game, plus the plumbing that gets a run onto it.
 *
 * The board ranks the Tibia character the player linked on the map — the same
 * localStorage profile the map's "tu personaje" overlay uses — so it can also
 * link one here, and the map picks that up. Mounting starts the day's stopwatch
 * (see lib/gameRun), and a solved result is posted once, automatically, as soon
 * as both the win and a linked character exist (in either order: solving first
 * and linking after still counts).
 */
export function GameLeaderboard({ game, date, result }: Props) {
  const { t } = useTranslation()
  const refreshBoard = useBoardRefresher()

  const [profile, setProfile] = useState(() => loadCharProfile())
  const charName = profile?.name ?? ''
  const board = useLeaderboard(game, charName || undefined)

  // Start the day's clock as soon as the puzzle is on screen.
  useEffect(() => {
    if (date) runStart(game, date)
  }, [game, date])

  // --- Getting the run onto the board -------------------------------------
  const posting = useRef(false)
  const [postError, setPostError] = useState<string | null>(null)

  useEffect(() => {
    if (!date || !result?.solved || !charName) return
    if (posting.current || wasSubmitted(game, date)) return
    posting.current = true
    setPostError(null)
    submitScore(game, {
      char_name: charName,
      attempts: result.attempts,
      // Frozen on the first call, so a retry posts the real time, not the wait.
      time_ms: runFinish(game, date),
    })
      .then(() => {
        markSubmitted(game, date)
        void refreshBoard(game)
      })
      .catch((err: unknown) => {
        // A name the board refuses is worth saying out loud. Everything else
        // (offline, rate limit, TibiaData not answering) retries on a later
        // visit — the run's time is already frozen, so nothing is lost.
        const res = (err as { response?: { status?: number; data?: { error?: string } } })?.response
        setPostError(
          res?.data?.error === 'char_not_found'
            ? t('board.linkNotFound')
            : t('board.submitError'),
        )
        posting.current = false
      })
  }, [game, date, result?.solved, result?.attempts, charName, refreshBoard, t])

  const onLinked = useCallback((name: string) => {
    const existing = loadCharProfile()
    // Keep the hand-picked gear set — only the name is being (re)bound.
    const next = { name, ...(existing?.gear ? { gear: existing.gear } : {}) }
    saveCharProfile(next)
    setProfile(next)
  }, [])

  const rows = board.data?.top ?? []
  const you = board.data?.you ?? null
  // The one-shot games are always 1 attempt, so the column would be dead weight.
  const showAttempts = game === 'wordle'
  const yourKey = charName.toLowerCase()

  return (
    <section className="mt-6 w-full rounded-xl border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-black uppercase tracking-wider text-fg">{t('board.title')}</h2>
        {board.data && board.data.players > 0 && (
          <span className="text-xs text-fg-mute">{t('board.players', { count: board.data.players })}</span>
        )}
      </header>
      <p className="mt-0.5 text-xs text-fg-mute">
        {t(showAttempts ? 'board.ruleAttempts' : 'board.ruleTime')}
      </p>

      {/* The board */}
      <div className="mt-3">
        {board.isLoading ? (
          <div className="space-y-1.5" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-line/40" />
            ))}
          </div>
        ) : board.isError ? (
          <p className="py-4 text-center text-xs text-fg-mute">{t('board.loadError')}</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-mute">{t('board.empty')}</p>
        ) : (
          <ol className="divide-y divide-line/60">
            {rows.map((row) => (
              <BoardLine
                key={row.rank}
                row={row}
                showAttempts={showAttempts}
                mine={row.char_name.toLowerCase() === yourKey}
              />
            ))}
          </ol>
        )}

        {/* Your own standing, when you didn't make the cut. */}
        {you && you.rank > rows.length && (
          <ol className="mt-1 border-t-2 border-dashed border-line/70 pt-1">
            <BoardLine row={you} showAttempts={showAttempts} mine />
          </ol>
        )}
      </div>

      {/* Character linking / status */}
      <div className="mt-4 border-t border-line pt-3">
        {charName ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-mute">
              {t('board.playingAs')}{' '}
              <span className="font-bold text-fg">{charName}</span>
              {result?.solved && !postError && you && (
                <span className="ml-2 text-emerald-500">{t('board.onBoard', { rank: you.rank })}</span>
              )}
              {!result && <span className="ml-2">{t('board.solveToEnter')}</span>}
              {result && !result.solved && <span className="ml-2">{t('board.missedToday')}</span>}
            </p>
            <Link to="/map" className="text-xs font-semibold text-accent hover:underline">
              {t('board.onMap')}
            </Link>
          </div>
        ) : (
          <LinkCharacter onLinked={onLinked} />
        )}
        {postError && <p className="mt-2 text-xs font-semibold text-accent">{postError}</p>}
      </div>

      {board.data?.next_save && <ResetLine target={board.data.next_save} />}
    </section>
  )
}

function BoardLine({ row, showAttempts, mine }: { row: BoardRow; showAttempts: boolean; mine: boolean }) {
  const { t } = useTranslation()
  const medal = row.rank <= 3 ? MEDALS[row.rank - 1] : null
  const voc = vocationShort(row.vocation)

  return (
    <li
      className={`flex items-center gap-2 rounded px-1.5 py-1.5 text-sm ${
        mine ? 'bg-accent/10 font-bold text-fg' : 'text-fg'
      }`}
    >
      <span className="w-7 shrink-0 text-center text-xs font-bold text-fg-mute">
        {medal ?? row.rank}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {row.char_name}
        {mine && <span className="ml-1.5 text-[0.65rem] uppercase tracking-wider text-accent">{t('board.you')}</span>}
      </span>
      <span className="hidden shrink-0 text-xs text-fg-mute sm:inline">
        {[voc, row.level].filter(Boolean).join(' ')}
      </span>
      {showAttempts && (
        <span className="w-8 shrink-0 text-center text-xs font-semibold text-fg-mute" title={t('board.attempts')}>
          {row.attempts}
        </span>
      )}
      <span className="w-14 shrink-0 text-right font-mono text-xs text-fg-mute">
        {formatDuration(row.time_ms)}
      </span>
    </li>
  )
}

/** Name box that checks the character exists before binding it to the profile. */
function LinkCharacter({ onLinked }: { onLinked: (name: string) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const value = name.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      const char = await fetchCharacter(value)
      if (!char) {
        setError(t('board.linkNotFound'))
        return
      }
      onLinked(char.name)
    } catch {
      setError(t('board.linkError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-fg">{t('board.linkTitle')}</p>
      <p className="mt-0.5 text-xs text-fg-mute">{t('board.linkHint')}</p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={t('board.linkPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? t('board.linking') : t('board.link')}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-accent">{error}</p>}
    </div>
  )
}

/** "Resets in HH:MM:SS" — the board wipes itself at server save. */
function ResetLine({ target }: { target: string }) {
  const { t } = useTranslation()
  return (
    <p className="mt-3 text-center text-[0.7rem] text-fg-mute">
      {t('board.resetIn')} <span className="font-mono font-bold text-fg">{useResetCountdown(target)}</span>
    </p>
  )
}

/** HH:MM:SS until the board wipes (server save). */
function useResetCountdown(target: string): string {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
