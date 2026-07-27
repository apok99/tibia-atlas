import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAltarToday, postAltarGuess, type AltarPoolItem, type AltarReveal } from '../hooks/useAltar'
import { Skeleton } from '../components/Skeleton'
import { GameLeaderboard } from '../components/GameLeaderboard'
import { Seo } from '../lib/seo'

type Status = 'playing' | 'won' | 'lost'
interface SavedGame {
  slug: string
  solved: boolean
  answer: AltarReveal
}

/** Which light hints the player has chosen to reveal. */
type HintKey = 'class' | 'hitpoints' | 'difficulty' | 'weak_to'

/** Per-mote layout + timing for the altar's rising particles. Built once so the
 *  swarm stays stable across renders; negative delays start it mid-flight. */
const MOTES = Array.from({ length: 16 }, () => ({
  x: `${8 + Math.random() * 84}%`,
  size: `${3 + Math.random() * 4}px`,
  dur: `${3.5 + Math.random() * 3}s`,
  delay: `${-Math.random() * 6}s`,
  drift: `${(Math.random() - 0.5) * 44}px`,
  peak: (0.5 + Math.random() * 0.45).toFixed(2),
}))

export function AltarPage() {
  const { t } = useTranslation()
  const today = useAltarToday()
  const data = today.data

  const date = data?.date ?? ''
  const storageKey = date ? `altar:v1:${date}` : ''
  const pool = useMemo(() => data?.pool ?? [], [data?.pool])

  const [status, setStatus] = useState<Status>('playing')
  const [reveal, setReveal] = useState<AltarReveal | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AltarPoolItem | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [revealed, setRevealed] = useState<Set<HintKey>>(new Set())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Rehydrate today's result (this game is one-and-done) when the date is known.
  useEffect(() => {
    if (!storageKey) return
    setQuery('')
    setSelected(null)
    setRevealed(new Set())
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const game = JSON.parse(saved) as SavedGame
        setStatus(game.solved ? 'won' : 'lost')
        setReveal(game.answer)
        return
      }
    } catch {
      /* corrupt save — start fresh */
    }
    setStatus('playing')
    setReveal(null)
  }, [storageKey])

  // Close the suggestion dropdown on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 1800)
  }, [])

  // Up to 8 name matches for the current query.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return pool.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, pool])

  const pick = useCallback((c: AltarPoolItem) => {
    setSelected(c)
    setQuery(c.name)
    setOpen(false)
  }, [])

  const submit = useCallback(async () => {
    if (busy || status !== 'playing') return
    // Resolve the guess: an explicit pick, else an exact name match.
    const q = query.trim().toLowerCase()
    const guess = selected ?? pool.find((c) => c.name.toLowerCase() === q) ?? null
    if (!guess) {
      flash(t('altar.pickOne'))
      return
    }

    setBusy(true)
    try {
      const res = await postAltarGuess(guess.slug)
      if (!res.valid || !res.answer) {
        flash(t('altar.notInList'))
        return
      }
      const nextStatus: Status = res.solved ? 'won' : 'lost'
      setStatus(nextStatus)
      setReveal(res.answer)
      setOpen(false)
      if (storageKey) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ slug: guess.slug, solved: !!res.solved, answer: res.answer } satisfies SavedGame),
        )
      }
    } catch {
      flash(t('altar.loadError'))
    } finally {
      setBusy(false)
    }
  }, [busy, status, query, selected, pool, storageKey, flash, t])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && matches[highlight]) pick(matches[highlight])
      else void submit()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const countdown = useCountdown(today.data?.next_save ?? '')

  if (today.isLoading) return <AltarSkeleton />
  if (today.isError || !data) {
    return <div className="py-20 text-center text-fg-mute">{t('altar.loadError')}</div>
  }

  const finished = status !== 'playing'
  const shape = data.word_shape
  const hints = data.hints

  return (
    <div className="mx-auto flex max-w-md flex-col items-center">
      <Seo title={t('altar.brand')} description={t('altar.subtitle')} path="/altar" />

      <header className="mb-5 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.25em] text-accent">{t('altar.kicker')}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{t('altar.title')}</h1>
        <p className="mt-2 text-sm text-fg-mute">{t('altar.subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-line px-3 py-1 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('altar.oneShot')}
          </span>
          {hints.difficulty && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent">
              {t('altar.hint.difficulty')}: {hints.difficulty}
            </span>
          )}
        </div>
      </header>

      {/* The altar + creature */}
      <Altar
        date={date}
        reveal={finished ? reveal : null}
        solved={status === 'won'}
      />

      {/* Word shape — the always-visible clue. */}
      <div className="mt-5 flex flex-wrap items-end justify-center gap-x-4 gap-y-2">
        {shape.map((len, wi) => (
          <div key={wi} className="flex gap-1">
            {Array.from({ length: len }).map((_, i) => (
              <span key={i} className="h-0.5 w-3.5 rounded bg-line-2 sm:w-4" />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-fg-mute">
        {t('altar.lettersHint', { n: shape.reduce((a, b) => a + b, 0), words: shape.length })}
      </p>

      {/* Server-save countdown — the creature changes when it hits zero. */}
      {!finished && (
        <p className="mt-1 text-xs text-fg-mute">
          {t('altar.changesIn')}{' '}
          <span className="font-mono font-semibold text-fg">{countdown}</span>
        </p>
      )}

      {/* Revealable stat hints */}
      {!finished && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {(['class', 'weak_to', 'hitpoints'] as HintKey[])
            .filter((k) => hints[k] !== undefined && hints[k] !== null && hints[k] !== '')
            .map((k) => {
              const shown = revealed.has(k)
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRevealed((s) => new Set(s).add(k))}
                  disabled={shown}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    shown
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
                  }`}
                >
                  {shown ? (
                    <span>
                      <span className="uppercase tracking-wider">{t(`altar.hint.${k}`)}:</span>{' '}
                      <span className="font-bold text-fg">{hints[k]}</span>
                    </span>
                  ) : (
                    <span>👁 {t(`altar.hint.${k}`)}</span>
                  )}
                </button>
              )
            })}
        </div>
      )}

      {/* Guess box */}
      {!finished && (
        <div ref={boxRef} className="relative mt-6 w-full">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
                setOpen(true)
                setHighlight(0)
              }}
              onFocus={() => query && setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={t('altar.placeholder')}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !query.trim()}
              className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {t('altar.guess')}
            </button>
          </div>

          {open && matches.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
              {matches.map((c, i) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(c)}
                    className={`block w-full px-4 py-2 text-left text-sm ${
                      i === highlight ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-line/40'
                    }`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Toast */}
      <div className="mt-3 h-5 text-center text-sm font-semibold text-fg">{toast ?? ''}</div>

      {/* End-of-game panel */}
      {finished && (
        <ResultPanel status={status} reveal={reveal} date={date} nextSave={data.next_save} />
      )}

      {/* Today's top 10 — one guess, so it's a pure race against the clock. */}
      <GameLeaderboard
        game="altar"
        date={date}
        result={finished ? { solved: status === 'won', attempts: 1 } : null}
      />
    </div>
  )
}

/** The stone altar with the creature resting on it — grey silhouette while
 *  playing, revealed in full colour once the guess is spent. */
function Altar({ date, reveal, solved }: { date: string; reveal: AltarReveal | null; solved: boolean }) {
  const { t } = useTranslation()
  const silhouetteSrc = `/api/altar/silhouette?date=${encodeURIComponent(date)}`

  // Mote palette follows the play state: lilac while veiled, emerald on a win,
  // accent on a miss.
  const palette = (
    reveal
      ? solved
        ? { '--mote-color': 'rgb(52 211 153)', '--mote-glow': 'rgba(52, 211, 153, 0.7)' }
        : { '--mote-color': 'var(--color-accent)', '--mote-glow': 'rgba(210, 120, 90, 0.6)' }
      : { '--mote-color': 'rgb(196 167 240)', '--mote-glow': 'rgba(196, 167, 240, 0.75)' }
  ) as React.CSSProperties

  return (
    <div className="relative mx-auto flex h-64 w-full max-w-xs items-center justify-center">
      {/* Soft aura behind the creature */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl transition-colors ${
          reveal ? (solved ? 'bg-emerald-500/25' : 'bg-accent/20') : 'bg-[rgba(196,167,240,0.2)]'
        }`}
      />

      {/* Rising motes */}
      <div className="altar-particles" style={palette} aria-hidden="true">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="altar-mote"
            style={
              {
                '--x': m.x,
                '--size': m.size,
                '--dur': m.dur,
                '--delay': m.delay,
                '--drift': m.drift,
                '--peak': m.peak,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Creature — centered, floating amid the motes */}
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        {reveal ? (
          reveal.image ? (
            <img
              src={reveal.image}
              alt={reveal.name}
              className="h-40 w-auto object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.55)] [image-rendering:pixelated]"
            />
          ) : (
            <span className="text-2xl font-black text-fg">{reveal.name}</span>
          )
        ) : (
          <img
            src={silhouetteSrc}
            alt={t('altar.silhouetteAlt')}
            draggable={false}
            className="pointer-events-none h-40 w-auto select-none object-contain [-webkit-user-drag:none] [filter:grayscale(1)_contrast(0)_brightness(0.4)] [image-rendering:pixelated]"
          />
        )}
      </div>
    </div>
  )
}

function ResultPanel({
  status,
  reveal,
  date,
  nextSave,
}: {
  status: Status
  reveal: AltarReveal | null
  date: string
  nextSave: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const countdown = useCountdown(nextSave)

  const share = () => {
    const mark = status === 'won' ? '🟩' : '🟥'
    const header = `${t('altar.brand')} ${date}`
    const url = `${window.location.origin}/altar`
    const text = `${header}\n${mark} ${t(status === 'won' ? 'altar.shareWon' : 'altar.shareLost')}\n${url}`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-line bg-surface p-5 text-center">
      <p className={`text-lg font-black ${status === 'won' ? 'text-emerald-500' : 'text-accent'}`}>
        {t(status === 'won' ? 'altar.won' : 'altar.lost')}
      </p>

      {reveal && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <p className="text-xs uppercase tracking-widest text-fg-mute">{t('altar.answerWas')}</p>
          {reveal.slug ? (
            <Link to={`/entry/${reveal.slug}`} className="text-xl font-black text-accent hover:underline">
              {reveal.name}
            </Link>
          ) : (
            <span className="text-xl font-black">{reveal.name}</span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={share}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
        >
          {copied ? t('altar.copied') : t('altar.share')}
        </button>
        {reveal?.slug && (
          <Link
            to={`/entry/${reveal.slug}`}
            className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-fg transition hover:border-line-2"
          >
            {t('altar.viewCreature')}
          </Link>
        )}
      </div>

      <p className="mt-4 text-xs text-fg-mute">
        {t('altar.nextIn')} <span className="font-mono font-bold text-fg">{countdown}</span>
      </p>
    </div>
  )
}

function AltarSkeleton() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center" aria-busy="true">
      <div className="mb-6 flex flex-col items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-40 w-40 rounded-lg" />
      <Skeleton className="mt-4 h-3 w-40" />
      <Skeleton className="mt-6 h-11 w-full rounded-lg" />
    </div>
  )
}

/** HH:MM:SS until the next server save; reloads the page when it hits zero. */
function useCountdown(target: string): string {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) {
    window.setTimeout(() => window.location.reload(), 500)
    return '00:00:00'
  }
  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
