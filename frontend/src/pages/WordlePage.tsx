import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useWordleToday, postGuess, type Tile } from '../hooks/useWordle'
import { WordleSkeleton } from '../components/Skeleton'
import { Seo } from '../lib/seo'

type Status = 'playing' | 'won' | 'lost'
interface Row {
  guess: string
  result: Tile[]
}
interface SavedGame {
  rows: Row[]
  status: Status
  reveal?: { name: string; slug: string | null; image: string | null }
}

const KEY_ROWS = [
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  ['Enter', ...'zxcvbnm'.split(''), 'Backspace'],
]

const EMOJI: Record<Tile, string> = { correct: '🟩', present: '🟨', absent: '⬛' }

function tileClass(state: Tile | 'filled' | 'empty'): string {
  switch (state) {
    case 'correct':
      return 'bg-emerald-600 border-emerald-600 text-white'
    case 'present':
      return 'bg-amber-500 border-amber-500 text-white'
    case 'absent':
      return 'bg-zinc-600 border-zinc-600 text-white'
    case 'filled':
      return 'border-line-2 text-fg'
    default:
      return 'border-line text-fg-mute'
  }
}

const RANK: Record<Tile, number> = { absent: 0, present: 1, correct: 2 }

function diffClass(d: string): string {
  switch (d) {
    case 'easy':
      return 'bg-emerald-600/15 text-emerald-400 border border-emerald-600/40'
    case 'medium':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
    case 'hard':
      return 'bg-orange-500/15 text-orange-400 border border-orange-500/40'
    default:
      return 'bg-accent/15 text-accent border border-accent/40'
  }
}

export function WordlePage() {
  const { t, i18n } = useTranslation()
  const esLang = (i18n.language || 'es').slice(0, 2) === 'es'
  const today = useWordleToday()
  const data = today.data

  const date = data?.date ?? ''
  const length = data?.length ?? 6
  const maxAttempts = data?.max_attempts ?? 6
  const storageKey = date ? `bestiordle:v1:${date}` : ''
  const dictionary = useMemo(() => new Set(data?.words ?? []), [data?.words])

  const [rows, setRows] = useState<Row[]>([])
  const [current, setCurrent] = useState('')
  const [status, setStatus] = useState<Status>('playing')
  const [reveal, setReveal] = useState<SavedGame['reveal']>()
  const [toast, setToast] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  // Rehydrate today's progress whenever the puzzle date is known.
  useEffect(() => {
    if (!storageKey) return
    setCurrent('')
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const game = JSON.parse(saved) as SavedGame
        setRows(game.rows ?? [])
        setStatus(game.status ?? 'playing')
        setReveal(game.reveal)
        return
      }
    } catch {
      /* corrupt save — start fresh */
    }
    setRows([])
    setStatus('playing')
    setReveal(undefined)
  }, [storageKey])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 1600)
  }, [])

  const submit = useCallback(async () => {
    if (busy || status !== 'playing') return
    if (current.length < length) {
      flash(t('wordle.needLetters', { n: length }))
      setShake(true)
      window.setTimeout(() => setShake(false), 450)
      return
    }
    const guess = current.toLowerCase()
    if (!dictionary.has(guess)) {
      flash(t('wordle.notInList'))
      setShake(true)
      window.setTimeout(() => setShake(false), 450)
      return
    }

    setBusy(true)
    try {
      const attempt = rows.length + 1
      const res = await postGuess(guess, attempt)
      if (!res.valid || !res.result) {
        flash(t('wordle.notInList'))
        return
      }
      const nextRows = [...rows, { guess, result: res.result }]
      let nextStatus: Status = 'playing'
      if (res.solved) nextStatus = 'won'
      else if (attempt >= maxAttempts) nextStatus = 'lost'

      const nextReveal =
        nextStatus !== 'playing' && res.answer
          ? { name: res.name ?? res.answer, slug: res.slug ?? null, image: res.image ?? null }
          : undefined

      setRows(nextRows)
      setStatus(nextStatus)
      setReveal(nextReveal)
      setCurrent('')
      if (storageKey) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ rows: nextRows, status: nextStatus, reveal: nextReveal }),
        )
      }
    } catch {
      flash(t('wordle.loadError'))
    } finally {
      setBusy(false)
    }
  }, [busy, status, current, length, dictionary, rows, maxAttempts, storageKey, flash, t])

  const onKey = useCallback(
    (key: string) => {
      if (status !== 'playing' || busy) return
      if (key === 'Enter') {
        void submit()
      } else if (key === 'Backspace') {
        setCurrent((c) => c.slice(0, -1))
      } else if (/^[a-z]$/i.test(key)) {
        setCurrent((c) => (c.length < length ? c + key.toLowerCase() : c))
      }
    },
    [status, busy, submit, length],
  )

  // Physical keyboard — route through a ref so the listener never goes stale.
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault()
        onKeyRef.current(e.key)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Best-known state per letter, for colouring the on-screen keyboard.
  const keyState = useMemo(() => {
    const map: Record<string, Tile> = {}
    for (const row of rows) {
      row.guess.split('').forEach((ch, i) => {
        const s = row.result[i]
        if (!map[ch] || RANK[s] > RANK[map[ch]]) map[ch] = s
      })
    }
    return map
  }, [rows])

  if (today.isLoading) {
    return <WordleSkeleton length={length} rows={maxAttempts} />
  }
  if (today.isError || !data) {
    return <div className="py-20 text-center text-fg-mute">{t('wordle.loadError')}</div>
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center">
      {/* Titles target "tibia wordle" searches; mirrored in PrerenderController::staticMeta (wordle). */}
      <Seo
        title={esLang ? 'Bestiordle — el wordle de criaturas de Tibia' : 'Bestiordle — the Tibia creature wordle'}
        description={
          esLang
            ? 'El wordle de Tibia: adivina la criatura del día por sus pistas. Un juego diario gratuito para jugadores de Tibia.'
            : 'The Tibia wordle: guess the creature of the day from its clues. A free daily game for Tibia players.'
        }
        path="/wordle"
      />
      <header className="mb-6 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.25em] text-accent">
          {t('wordle.kicker')}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{t('wordle.title')}</h1>
        <p className="mt-2 text-sm text-fg-mute">{t('wordle.subtitle')}</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${diffClass(data.difficulty)}`}>
            {t('wordle.difficulty')}: {t(`wordle.diff.${data.difficulty}`)}
          </span>
          <span className="rounded-full border border-line px-3 py-1 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('wordle.lettersBadge', { n: length })}
          </span>
        </div>
      </header>

      {/* Grid */}
      <div className="grid gap-1.5" style={{ gridTemplateRows: `repeat(${maxAttempts}, 1fr)` }}>
        {Array.from({ length: maxAttempts }).map((_, r) => {
          const submitted = rows[r]
          const isCurrent = r === rows.length && status === 'playing'
          return (
            <div
              key={r}
              className={`grid gap-1.5 ${isCurrent && shake ? 'animate-[shake_0.4s]' : ''}`}
              style={{ gridTemplateColumns: `repeat(${length}, 1fr)` }}
            >
              {Array.from({ length }).map((_, c) => {
                let ch = ''
                let state: Tile | 'filled' | 'empty' = 'empty'
                if (submitted) {
                  ch = submitted.guess[c]?.toUpperCase() ?? ''
                  state = submitted.result[c]
                } else if (isCurrent && current[c]) {
                  ch = current[c].toUpperCase()
                  state = 'filled'
                }
                return (
                  <div
                    key={c}
                    className={`flex h-12 w-12 items-center justify-center rounded border-2 text-xl font-black uppercase transition-colors sm:h-14 sm:w-14 ${tileClass(state)}`}
                  >
                    {ch}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Toast / status line */}
      <div className="mt-4 h-6 text-center text-sm font-semibold text-fg">
        {toast ?? (status === 'playing' ? t('wordle.attemptsLeft', { n: rows.length + 1, max: maxAttempts }) : '')}
      </div>

      {/* End-of-game panel */}
      {status !== 'playing' && (
        <ResultPanel
          status={status}
          reveal={reveal}
          rows={rows}
          maxAttempts={maxAttempts}
          date={date}
          nextSave={data.next_save}
        />
      )}

      {/* On-screen keyboard — hidden once solved (you're done); still shown on a
          loss so the final used/green/yellow letters remain readable. */}
      {status !== 'won' && (
      <div className="mt-6 flex w-full select-none flex-col gap-1.5">
        {KEY_ROWS.map((krow, i) => (
          <div key={i} className="flex justify-center gap-1.5">
            {krow.map((key) => {
              const wide = key === 'Enter' || key === 'Backspace'
              const st = key.length === 1 ? keyState[key] : undefined
              const label = key === 'Backspace' ? '⌫' : key === 'Enter' ? t('wordle.enter') : key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onKey(key)}
                  disabled={busy || status !== 'playing'}
                  className={`flex h-12 items-center justify-center rounded text-sm font-bold uppercase transition active:scale-95 disabled:cursor-default ${
                    wide ? 'px-3 text-xs' : 'w-8 sm:w-9'
                  } ${
                    st
                      ? tileClass(st)
                      : 'bg-surface text-fg hover:bg-line/60 border border-line disabled:opacity-50'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      )}

      <p className="mt-6 max-w-sm text-center text-xs leading-relaxed text-fg-mute">
        {t('wordle.howTo')}
      </p>
    </div>
  )
}

function ResultPanel({
  status,
  reveal,
  rows,
  maxAttempts,
  date,
  nextSave,
}: {
  status: Status
  reveal: SavedGame['reveal']
  rows: Row[]
  maxAttempts: number
  date: string
  nextSave: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const countdown = useCountdown(nextSave)

  const share = () => {
    const header = `${t('wordle.brand')} ${date} ${status === 'won' ? rows.length : 'X'}/${maxAttempts}`
    const grid = rows.map((r) => r.result.map((s) => EMOJI[s]).join('')).join('\n')
    const url = `${window.location.origin}/wordle`
    const text = `${header}\n${grid}\n${url}`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-line bg-surface p-5 text-center">
      <p className={`text-lg font-black ${status === 'won' ? 'text-emerald-500' : 'text-accent'}`}>
        {t(status === 'won' ? 'wordle.won' : 'wordle.lost')}
      </p>

      {reveal && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <p className="text-xs uppercase tracking-widest text-fg-mute">{t('wordle.answerWas')}</p>
          {reveal.image && (
            <img
              src={reveal.image}
              alt={reveal.name}
              className="h-16 w-16 object-contain [image-rendering:pixelated]"
            />
          )}
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
          {copied ? t('wordle.copied') : t('wordle.share')}
        </button>
        {reveal?.slug && (
          <Link
            to={`/entry/${reveal.slug}`}
            className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-fg transition hover:border-line-2"
          >
            {t('wordle.viewCreature')}
          </Link>
        )}
      </div>

      <p className="mt-4 text-xs text-fg-mute">
        {t('wordle.nextIn')} <span className="font-mono font-bold text-fg">{countdown}</span>
      </p>
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
