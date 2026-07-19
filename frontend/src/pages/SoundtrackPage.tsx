import { useTranslation } from 'react-i18next'
import { usePlayer } from '../context/PlayerContext'
import { Seo } from '../lib/seo'

export function SoundtrackPage() {
  const { t, i18n } = useTranslation()
  const esLang = (i18n.language || 'es').slice(0, 2) === 'es'
  const { tracks, current, isPlaying, playTrack, togglePlay } = usePlayer()

  return (
    <div className="space-y-8">
      {/* Mirrored in PrerenderController::staticMeta (soundtrack). */}
      <Seo
        title={esLang ? 'La música de Tibia' : 'The Music of Tibia'}
        description={
          esLang
            ? 'La banda sonora de Tibia para escuchar mientras exploras el mapa.'
            : 'The Tibia soundtrack to listen to while you explore the map.'
        }
        path="/soundtrack"
      />
      {/* Header */}
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:p-8">
          <div className="grid h-36 w-36 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent/30 via-surface-2 to-bg shadow-lg">
            <DiscIcon className="h-16 w-16 text-accent" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-fg-mute">
              {t('soundtrack.kicker')}
            </div>
            <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              {t('soundtrack.title')}
            </h1>
            <p className="mt-3 max-w-xl text-fg-dim">{t('soundtrack.intro')}</p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => (current ? togglePlay() : playTrack(tracks[0].id))}
                className="btn"
              >
                {current && isPlaying ? (
                  <>
                    <PauseIcon className="h-4 w-4" /> {t('soundtrack.pause')}
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-4 w-4" /> {t('soundtrack.playAll')}
                  </>
                )}
              </button>
              <span className="text-xs text-fg-mute">
                {tracks.length} {t('soundtrack.tracks')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Track list */}
      <section className="panel overflow-hidden">
        <ol>
          {tracks.map((track, i) => {
            const isCurrent = current?.id === track.id
            const playingThis = isCurrent && isPlaying
            return (
              <li key={track.id}>
                <button
                  onClick={() => playTrack(track.id)}
                  className={`group flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-surface-2 ${
                    i > 0 ? 'border-t border-line' : ''
                  } ${isCurrent ? 'bg-surface-2/60' : ''}`}
                >
                  <span className="grid w-6 shrink-0 place-items-center text-sm tabular-nums text-fg-mute">
                    {playingThis ? (
                      <Bars className="h-4 w-4 text-accent" />
                    ) : (
                      <>
                        <span className="group-hover:hidden">{i + 1}</span>
                        <PlayIcon className="hidden h-4 w-4 text-fg group-hover:block" />
                      </>
                    )}
                  </span>
                  <span
                    className={`flex-1 truncate text-sm font-medium ${
                      isCurrent ? 'text-accent' : 'text-fg'
                    }`}
                  >
                    {track.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <p className="text-center text-xs text-fg-mute">{t('soundtrack.disclaimer')}</p>
    </div>
  )
}

type IP = { className?: string }
const PlayIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M8 5v14l11-7z" /></svg>
)
const PauseIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
)
const DiscIcon = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" /></svg>
)
const Bars = ({ className }: IP) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <rect x="3" y="10" width="3" height="11"><animate attributeName="height" values="11;4;11" dur="0.9s" repeatCount="indefinite" /><animate attributeName="y" values="10;17;10" dur="0.9s" repeatCount="indefinite" /></rect>
    <rect x="9" y="4" width="3" height="17"><animate attributeName="height" values="17;7;17" dur="1.1s" repeatCount="indefinite" /><animate attributeName="y" values="4;14;4" dur="1.1s" repeatCount="indefinite" /></rect>
    <rect x="15" y="7" width="3" height="14"><animate attributeName="height" values="14;5;14" dur="0.8s" repeatCount="indefinite" /><animate attributeName="y" values="7;16;7" dur="0.8s" repeatCount="indefinite" /></rect>
  </svg>
)
