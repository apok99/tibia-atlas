import { useTranslation } from 'react-i18next'
import { usePlayer } from '../context/PlayerContext'

function fmt(s: number): string {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function PlayerBar() {
  const { t } = useTranslation()
  const {
    current,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
  } = usePlayer()

  if (!current) return null

  return (
    <div className="sticky bottom-0 z-30 border-t border-line bg-bg-2/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[86rem] items-center gap-4 px-4 py-2.5">
        {/* Track info */}
        <div className="flex min-w-0 items-center gap-3 sm:w-56">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-accent/15 text-accent">
            <NoteIcon className={`h-5 w-5 ${isPlaying ? 'animate-pulse' : ''}`} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{current.title}</div>
            <div className="truncate text-[11px] uppercase tracking-wider text-fg-mute">
              {t('soundtrack.subtitle')}
            </div>
          </div>
        </div>

        {/* Controls + progress */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="flex items-center gap-3">
            <IconBtn
              active={shuffle}
              onClick={toggleShuffle}
              title={t('soundtrack.shuffle')}
            >
              <ShuffleIcon className="h-4 w-4" />
            </IconBtn>
            <IconBtn onClick={prev} title={t('soundtrack.prev')}>
              <PrevIcon className="h-5 w-5" />
            </IconBtn>
            <button
              onClick={togglePlay}
              title={isPlaying ? t('soundtrack.pause') : t('soundtrack.play')}
              className="grid h-9 w-9 place-items-center rounded-full bg-fg text-bg transition hover:scale-105"
            >
              {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            </button>
            <IconBtn onClick={next} title={t('soundtrack.next')}>
              <NextIcon className="h-5 w-5" />
            </IconBtn>
            <IconBtn
              active={repeat !== 'off'}
              onClick={cycleRepeat}
              title={t('soundtrack.repeat')}
            >
              {repeat === 'one' ? (
                <RepeatOneIcon className="h-4 w-4" />
              ) : (
                <RepeatIcon className="h-4 w-4" />
              )}
            </IconBtn>
          </div>

          <div className="flex w-full max-w-xl items-center gap-2">
            <span className="w-9 text-right text-[10px] tabular-nums text-fg-mute">
              {fmt(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="player-range flex-1"
              style={{ '--pct': `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span className="w-9 text-[10px] tabular-nums text-fg-mute">{fmt(duration)}</span>
          </div>
        </div>

        {/* Volume */}
        <div className="hidden items-center gap-2 sm:flex sm:w-32">
          <IconBtn onClick={toggleMute} title={t('soundtrack.mute')}>
            {muted || volume === 0 ? (
              <MuteIcon className="h-4 w-4" />
            ) : (
              <VolumeIcon className="h-4 w-4" />
            )}
          </IconBtn>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="player-range flex-1"
            style={{ '--pct': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`transition hover:text-fg ${active ? 'text-accent' : 'text-fg-dim'}`}
    >
      {children}
    </button>
  )
}

/* --- Icons --- */
type IP = { className?: string }
const PlayIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M8 5v14l11-7z" /></svg>
)
const PauseIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
)
const PrevIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
)
const NextIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" /></svg>
)
const ShuffleIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
)
const RepeatIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m17 2 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" /></svg>
)
const RepeatOneIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m17 2 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" /><text x="9" y="16" fontSize="9" fill="currentColor" stroke="none">1</text></svg>
)
const VolumeIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" /></svg>
)
const MuteIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M3 9v6h4l5 5V4L7 9zm18.5 3-2.5 2.5M16.5 9.5 19 12" stroke="currentColor" strokeWidth="2" /><path d="M3 9v6h4l5 5V4L7 9z" /></svg>
)
const NoteIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
)
