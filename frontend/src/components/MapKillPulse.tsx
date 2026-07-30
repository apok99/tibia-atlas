import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { compact } from '../lib/format'
import { useCreatureWorldKills } from '../hooks/useKillStats'

/**
 * The map's per-creature kill pulse: how many of this creature died YESTERDAY
 * on the world selected on the map, and over the rolling 30 days, with a bar
 * per day in between.
 *
 * Opened from the chart button on a plotted creature's chip, and docked right
 * under the creature bar so it reads as that chip's detail — the map's other
 * cards dock bottom-centre and are mutually exclusive, this one is not: it
 * belongs to the search flow, not to a layer.
 *
 * Bars are hand-rolled divs on purpose. The map bundle doesn't pull in recharts
 * (it would be the heaviest thing on the page after leaflet) and a 30-slot
 * sparkline needs no axes, scales or tooltips beyond a title attribute.
 */
export function MapKillPulse({
  slug,
  name,
  image,
  world,
  color,
  onClose,
}: {
  slug: string
  name: string
  image?: string | null
  /** World selected on the map, or 'all'. */
  world: string
  /** The creature's plot colour, so the card reads as belonging to its chip. */
  color: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const { data, isPending, isError } = useCreatureWorldKills(slug, world)

  // One slot per day of the window, gaps included: the series only holds days
  // the ETL actually recorded, and a ragged axis would misread as a quiet day.
  const bars = useMemo(() => {
    if (!data?.month) return []
    const byDay = new Map(data.series.map((p) => [p.period, p]))
    const out: { date: string; killed: number; players_killed: number; missing: boolean }[] = []
    const end = Date.parse(data.month.to + 'T00:00:00Z')
    for (let d = Date.parse(data.month.from + 'T00:00:00Z'); d <= end; d += 86400000) {
      const date = new Date(d).toISOString().slice(0, 10)
      const p = byDay.get(date)
      out.push({
        date,
        killed: p?.killed ?? 0,
        players_killed: p?.players_killed ?? 0,
        missing: !p,
      })
    }
    return out
  }, [data])

  const peak = Math.max(1, ...bars.map((b) => b.killed))
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [i18n.language],
  )
  const day = (iso: string) => dayFmt.format(new Date(iso + 'T00:00:00Z'))

  const worldLabel = !data || data.world === 'all' ? t('ks.allWorlds') : data.world

  return (
    <div
      className="pointer-events-auto w-full max-w-lg overflow-hidden rounded-2xl border-2 bg-bg-2/95 shadow-lg backdrop-blur-md"
      style={{ borderColor: color }}
    >
      {/* Header: whose numbers these are, and on which world */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {image && <img src={image} alt="" loading="lazy" className="sprite h-7 w-7 shrink-0 object-contain" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-fg">{name}</span>
          <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('map.killPulse')} · {worldLabel}
          </span>
        </span>
        <button
          onClick={onClose}
          title={t('map.close')}
          aria-label={t('map.close')}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-mute transition hover:bg-line/40 hover:text-fg"
        >
          ✕
        </button>
      </div>

      {isPending ? (
        <p className="px-3 py-4 text-center text-xs text-fg-mute">{t('map.killPulseLoading')}</p>
      ) : isError || !data?.linked || !data.yesterday || !data.month ? (
        <p className="px-3 py-4 text-center text-xs text-fg-mute">{t('map.killPulseNone')}</p>
      ) : (
        <div className="p-3">
          {/* The two numbers the whole card exists for */}
          <div className="grid grid-cols-2 gap-2">
            <Figure
              label={t('map.killYesterday')}
              sub={day(data.yesterday.date)}
              value={data.yesterday.killed}
              share={data.yesterday.share}
              t={t}
            />
            <Figure
              label={t('map.killMonth', { days: data.month.days })}
              sub={t('map.killPerDay', { n: compact(data.month.per_day) })}
              value={data.month.killed}
              share={data.month.share}
              t={t}
            />
          </div>

          {/* Where this world sits among the worlds hunting the creature */}
          {data.rank && (
            <p className="mt-2 flex items-baseline gap-1.5 text-[11px] text-fg-dim">
              <span className="font-mono font-bold tabular-nums text-accent">#{data.rank.rank}</span>
              <span>{t('map.killWorldRank', { total: data.rank.total })}</span>
            </p>
          )}

          {/* Daily bars — one per day of the window, yesterday highlighted */}
          <div className="mt-3 flex h-16 items-end gap-px" role="img" aria-label={t('map.killBarsAria')}>
            {bars.map((b, i) => {
              const last = i === bars.length - 1
              const h = Math.max(b.killed > 0 ? 4 : 1, Math.round((b.killed / peak) * 100))
              return (
                <span
                  key={b.date}
                  title={
                    b.missing
                      ? day(b.date) + ' · ' + t('map.killNoSnapshot')
                      : day(b.date) + ' · ' + b.killed.toLocaleString() + ' ' + t('ks.creaturesKilled').toLowerCase()
                  }
                  className={`flex-1 rounded-t-sm transition ${
                    b.missing ? 'bg-line/40' : last ? 'bg-accent' : 'bg-accent/45 hover:bg-accent/70'
                  }`}
                  style={{ height: h + '%' }}
                />
              )
            })}
          </div>
          <div className="mt-1 flex items-baseline justify-between text-[10px] text-fg-mute">
            <span>{day(data.month.from)}</span>
            {data.best && (
              <span className="truncate px-1">
                {t('map.killPeak', { n: compact(data.best.killed), date: day(data.best.date) })}
              </span>
            )}
            <span>{day(data.month.to)}</span>
          </div>

          {/* Secondary read: what the creature did back */}
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-fg-dim">
            {t('map.killPlayersKilled', {
              day: data.yesterday.players_killed.toLocaleString(),
              month: compact(data.month.players_killed),
            })}
          </p>

          <Link
            to={`/entry/${slug}`}
            className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-accent hover:underline"
          >
            {t('ks.viewEntry')}
          </Link>
        </div>
      )}
    </div>
  )
}

/** One headline figure: the count, plus this world's share of the network total. */
function Figure({
  label,
  sub,
  value,
  share,
  t,
}: {
  label: string
  sub: string
  value: number
  share: number | null
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  return (
    <div className="rounded-lg border border-line bg-bg px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-fg-mute">{label}</div>
      <div className="font-mono text-xl font-bold tabular-nums text-fg">{value.toLocaleString()}</div>
      <div className="truncate text-[10px] text-fg-dim">{sub}</div>
      {share !== null && (
        <>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-bg-2">
            <span className="block h-full rounded-full bg-accent" style={{ width: Math.max(2, share) + '%' }} />
          </span>
          <div className="mt-0.5 text-[10px] text-fg-mute">{t('map.killShare', { p: share })}</div>
        </>
      )}
    </div>
  )
}
