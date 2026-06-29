import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useKillExperience, useKillMeta, useKillRanking } from '../hooks/useKillStats'

const RED = '#d23d2f'
const CORAL = '#ec6a55'
const GOLD = '#d8a23a'

/** Auto-rotate interval for the dual "deadliest" card (ms). */
const DEADLIEST_ROTATE_MS = 6000

/**
 * The five Tibiadrome arena creatures (killstats race names, lowercase plurals).
 * They top the players-killed ranking because the arena is run constantly, but
 * they aren't open-world hunting creatures — so we surface them in their own
 * "deadliest" variant instead of letting them eclipse the real world ranking.
 */
const TIBIADROME = new Set(['domestikions', 'hoodinions', 'mearidions', 'murmillions', 'scissorions'])
const isTibiadrome = (race: string) => TIBIADROME.has(race.trim().toLowerCase())

/** Compact number: 1_457_335 → "1.46M", 824_120 → "824k". */
function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

/**
 * Live kill-statistics highlights on the home page: headline "creature of the
 * day" cards (most killed / deadliest / most XP in the last 24h) plus a
 * sprite-based "most hunted" leaderboard across every world.
 */
export function HomeKillStats() {
  const { t } = useTranslation()
  const { data: meta } = useKillMeta()
  const { data: topKilled } = useKillRanking({ world: 'all', metric: 'killed', window: 'day', limit: 14 })
  const { data: deadliest } = useKillRanking({ world: 'all', metric: 'players_killed', window: 'day', limit: 20 })
  const { data: topExp } = useKillExperience({ world: 'all', window: 'day', limit: 1 })

  // Drop non-monster pseudo-races: "players" (PvP deaths) and bracketed groups
  // like "(elemental forces)". Real creatures stay even if they lack a lore entry.
  const isMonster = (race: string) =>
    race.toLowerCase() !== 'players' && !race.trim().startsWith('(')

  const creatures = (topKilled ?? []).filter((r) => isMonster(r.race))
  const mostKilled = creatures[0]
  const board = creatures.slice(0, 8)
  const maxKilled = board[0]?.killed ?? 1
  const xp = topExp?.[0]

  // Two flavours of "deadliest": the deadliest open-world creature and the
  // deadliest Tibiadrome arena creature. The card carousels between them.
  const deadlyMonsters = (deadliest ?? []).filter((r) => isMonster(r.race))
  const killerWorld = deadlyMonsters.find((r) => !isTibiadrome(r.race))
  const killerDrome = deadlyMonsters.find((r) => isTibiadrome(r.race))
  const deadliestVariants = [
    killerWorld && {
      kicker: t('home.deadliestWorld'),
      race: killerWorld.race,
      slug: killerWorld.slug,
      image: killerWorld.image,
      value: killerWorld.players_killed.toLocaleString(),
      unit: t('ks.playersKilled'),
      color: RED,
    },
    killerDrome && {
      kicker: t('home.deadliestDrome'),
      race: killerDrome.race,
      slug: killerDrome.slug,
      image: killerDrome.image,
      value: killerDrome.players_killed.toLocaleString(),
      unit: t('ks.playersKilled'),
      color: RED,
    },
  ].filter((v): v is HighlightCardProps => Boolean(v))

  if (!mostKilled && deadliestVariants.length === 0 && !xp) return null

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-fg">{t('home.liveStats')}</h2>
        <span className="h-px flex-1 bg-line" />
        <Link
          to="/killstats"
          className="text-[11px] font-bold uppercase tracking-wider text-accent hover:underline"
        >
          {t('ks.openDashboard')}
        </Link>
      </div>

      {/* Headline cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {mostKilled && (
          <HighlightCard
            kicker={t('home.mostKilled')}
            race={mostKilled.race}
            slug={mostKilled.slug}
            image={mostKilled.image}
            value={mostKilled.killed.toLocaleString()}
            unit={t('ks.creaturesKilled')}
            color={CORAL}
          />
        )}
        {deadliestVariants.length > 0 && <RotatingHighlight variants={deadliestVariants} />}
        {xp && (
          <HighlightCard
            kicker={t('home.topExp')}
            race={xp.race}
            slug={xp.slug}
            image={xp.image}
            value={xp.exp_total.toLocaleString()}
            unit={`XP · → ${t('ks.levelN', { n: xp.level })}`}
            color={GOLD}
          />
        )}
      </div>

      {/* "Most hunted" leaderboard — sprite list, not a chart */}
      {board.length > 1 && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-fg-dim">
              {t('home.mostHunted')}
            </h3>
            {meta?.players_online ? (
              <span className="text-xs text-fg-mute">
                <b className="text-canon">{meta.players_online.toLocaleString()}</b> {t('ks.online')}
              </span>
            ) : null}
          </div>

          <ol className="space-y-1">
            {board.map((r, i) => {
              const row = (
                <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-bg-2">
                  <span className="w-5 shrink-0 text-right font-mono text-xs font-bold text-fg-mute">
                    {i + 1}
                  </span>
                  <div className="sprite-tile grid h-9 w-9 shrink-0 place-items-center rounded border border-line">
                    {r.image ? (
                      <img src={r.image} alt={r.race} className="sprite max-h-7 max-w-7 object-contain" />
                    ) : (
                      <span className="text-sm text-fg-mute">☠</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold capitalize text-fg">{r.race}</span>
                      <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-fg-dim">
                        {compact(r.killed)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-2">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (r.killed / maxKilled) * 100)}%`,
                          background: `linear-gradient(90deg, ${CORAL}, ${RED})`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
              return (
                <li key={r.race}>
                  {r.slug ? (
                    <Link to={`/entry/${r.slug}`} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ol>
          <p className="mt-2 text-[10px] text-fg-mute">{t('home.last24hAllWorlds')}</p>
        </div>
      )}
    </section>
  )
}

interface HighlightCardProps {
  kicker: string
  race: string
  slug: string | null
  image: string | null
  value: string
  unit: string
  color: string
}

/**
 * One headline card that cycles through several variants (used for the dual
 * open-world / Tibiadrome "deadliest" card). Auto-rotates; dots jump directly.
 */
function RotatingHighlight({ variants }: { variants: HighlightCardProps[] }) {
  const [i, setI] = useState(0)
  const n = variants.length

  useEffect(() => {
    if (n < 2) return
    const id = setInterval(() => setI((p) => (p + 1) % n), DEADLIEST_ROTATE_MS)
    return () => clearInterval(id)
  }, [n])

  const active = variants[i % n]

  return (
    <div className="relative h-full">
      <HighlightCard {...active} />
      {n > 1 && (
        <div className="absolute bottom-2 right-3 flex gap-1.5">
          {variants.map((v, j) => (
            <button
              key={v.kicker}
              type="button"
              aria-label={v.kicker}
              onClick={() => setI(j)}
              className={`h-1.5 w-1.5 rounded-full transition ${
                j === i % n ? 'bg-fg-dim' : 'bg-line hover:bg-fg-mute'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HighlightCard({ kicker, race, slug, image, value, unit, color }: HighlightCardProps) {
  const inner = (
    <div className="flex h-full items-center gap-3 rounded-lg border border-line bg-surface p-4 transition hover:border-line-2">
      <div className="sprite-tile grid h-16 w-16 shrink-0 place-items-center rounded border border-line">
        {image ? (
          <img src={image} alt={race} className="sprite max-h-12 max-w-12 object-contain" />
        ) : (
          <span className="text-2xl" style={{ color }}>
            ☠
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          {kicker}
        </div>
        <div className="truncate text-lg font-black capitalize text-fg">{race}</div>
        <div className="font-mono text-sm font-bold tabular-nums text-fg-dim">
          {value} <span className="text-[10px] font-normal text-fg-mute">{unit}</span>
        </div>
      </div>
    </div>
  )

  return slug ? (
    <Link to={`/entry/${slug}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  )
}
