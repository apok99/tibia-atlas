import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CountUp, compact } from '../components/CountUp'
import { CreatureOrbit } from '../components/CreatureOrbit'
import { KillTicker } from '../components/KillTicker'
import { WorldPulse } from '../components/WorldPulse'
import {
  useKillOverview,
  useKillRanking,
  useKillSeries,
  useKillWorlds,
  type Granularity,
  type KillOverview,
  type Metric,
  type RankWindow,
  type RankingRow,
  type SeriesPoint,
} from '../hooks/useKillStats'

const RED = '#d23d2f'
const CORAL = '#ec6a55'
const GOLD = '#d8a23a'
const GREEN = '#79b169'
const BLUE = '#6fa8c4'

const PALETTE = [
  '#d23d2f',
  '#ec6a55',
  '#d8a23a',
  '#e3c069',
  '#79b169',
  '#6fa8c4',
  '#b97fc4',
  '#e08a4b',
  '#c95b6e',
  '#8fb46b',
]

const WINDOWS: RankWindow[] = ['day', 'week', 'month', 'year']

const TOOLTIP_STYLE = {
  background: '#1b1d24',
  border: '1px solid #3d414c',
  borderRadius: 8,
  color: '#e9e3d6',
  fontSize: 12,
} as const

/** Tiny gradient sparkline. */
function Sparkline({ data, dataKey, color }: { data: SeriesPoint[]; dataKey: string; color: string }) {
  const id = `spark-${dataKey}-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function KpiCard({
  label,
  value,
  sub,
  color,
  spark,
  live,
}: {
  label: string
  value: number
  sub?: string
  color: string
  spark?: { data: SeriesPoint[]; dataKey: string }
  live?: boolean
}) {
  return (
    <div className="ks-kpi group relative overflow-hidden rounded-xl border border-line bg-surface p-4" style={{ ['--glow' as string]: color }}>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-fg-mute">{label}</span>
        {live && (
          <span className="ks-live ml-auto text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
            ● live
          </span>
        )}
      </div>
      <div className="mt-2 text-3xl font-black tracking-tight" style={{ color }}>
        <CountUp value={value} />
      </div>
      {sub && <p className="mt-0.5 text-xs text-fg-mute">{sub}</p>}
      {spark && (
        <div className="mt-2 -mb-1">
          <Sparkline data={spark.data} dataKey={spark.dataKey} color={color} />
        </div>
      )}
    </div>
  )
}

/** Live players-online panel: big current count + history area (or region bars while sparse). */
function OnlinePanel({ overview }: { overview: KillOverview }) {
  const { t } = useTranslation()
  const history = overview.online_history ?? []
  const enough = history.length >= 2
  return (
    <div className="ks-panel flex h-full flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="ks-panel-title">{t('ks.onlineTitle')}</h3>
        <span className="ks-live text-[10px] font-bold uppercase tracking-wider text-canon">● live</span>
      </div>
      <div className="flex items-end gap-3">
        <CountUp value={overview.totals.players_online} className="text-4xl font-black leading-none text-canon" />
        <span className="pb-1 text-xs text-fg-mute">
          {t('ks.onlinePeak', { n: compact(overview.online_peak || overview.totals.players_online) })}
        </span>
      </div>
      <div className="mt-3 min-h-0 flex-1">
        {enough ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ left: 0, right: 4, top: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="gOnline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2c2f38" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#76705f', fontSize: 10 }} stroke="#2c2f38" tickFormatter={(v) => String(v).slice(11)} minTickGap={28} />
              <YAxis tick={{ fill: '#76705f', fontSize: 10 }} stroke="#2c2f38" width={40} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [Number(v).toLocaleString(), t('ks.online')]} />
              <Area type="monotone" dataKey="players_online" stroke={GREEN} strokeWidth={2.5} fill="url(#gOnline)" animationDuration={1400} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col">
            <div className="ks-collecting mb-3 rounded px-2 py-1 text-center text-[11px] text-canon/80">{t('ks.onlineCollecting')}</div>
            <div className="flex-1 space-y-1.5">
              {overview.regions.slice(0, 5).map((r, i) => {
                const max = overview.regions[0]?.players_online || 1
                return (
                  <div key={r.name} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-[11px] text-fg-dim">{r.name}</span>
                    <span className="ks-bar h-3 flex-1 overflow-hidden rounded-sm bg-bg-2">
                      <span
                        className="ks-bar-fill block h-full rounded-sm"
                        style={{ width: `${(r.players_online / max) * 100}%`, background: PALETTE[i % PALETTE.length], animationDelay: `${i * 90}ms` }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right text-[11px] font-bold text-fg">{compact(r.players_online)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Deadliest leaderboard: top players-killers with animated gradient bars. */
function Leaderboard({ rows }: { rows: RankingRow[] }) {
  const { t } = useTranslation()
  const top = rows.slice(0, 8)
  const max = top[0]?.players_killed || 1
  return (
    <div className="ks-panel flex h-full flex-col">
      <h3 className="ks-panel-title mb-2">{t('ks.deadliestTitle')}</h3>
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-1.5">
        {top.map((r, i) => {
          const row = (
            <div className="ks-rank-row flex items-center gap-2" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="w-4 shrink-0 text-center text-xs font-black text-fg-mute">{i + 1}</span>
              <span className="ks-rank-sprite grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded bg-bg-2">
                {r.image ? <img src={r.image} alt={r.race} className="h-6 w-6 object-contain" loading="lazy" /> : <span className="text-xs">☠</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-bold capitalize text-fg">{r.race}</span>
                  <span className="shrink-0 text-xs font-black" style={{ color: RED }}>
                    {compact(r.players_killed)}
                  </span>
                </div>
                <span className="ks-bar mt-0.5 block h-1.5 overflow-hidden rounded-full bg-bg-2">
                  <span
                    className="ks-bar-fill block h-full rounded-full"
                    style={{ width: `${(r.players_killed / max) * 100}%`, background: `linear-gradient(90deg, ${CORAL}, ${RED})`, animationDelay: `${i * 70}ms` }}
                  />
                </span>
              </div>
            </div>
          )
          return r.slug ? (
            <Link key={r.race} to={`/entry/${r.slug}`} className="transition hover:brightness-125">
              {row}
            </Link>
          ) : (
            <div key={r.race}>{row}</div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The videowall hero: online history · rotating creature orbit · deadliest
 * leaderboard, with the KPI strip below. Reused inline (full-bleed) and inside
 * the fullscreen kiosk overlay.
 */
function KillWall({
  overview,
  orbit,
  deadliest,
  globalSeries,
}: {
  overview: KillOverview | undefined
  orbit: RankingRow[]
  deadliest: RankingRow[]
  globalSeries: SeriesPoint[]
}) {
  const { t } = useTranslation()
  const totals = overview?.totals

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1.5fr_1.1fr]">
        {/* Online history */}
        <div className="ks-panel-wrap min-h-[280px]">
          {overview ? <OnlinePanel overview={overview} /> : <div className="ks-skel h-full" />}
        </div>

        {/* Rotating creature orbit */}
        <div className="ks-panel-wrap ks-orbit-panel flex min-h-[280px] items-center justify-center">
          <CreatureOrbit
            items={orbit.map((r) => ({ race: r.race, killed: r.killed, image: r.image, slug: r.slug }))}
            coreValue={totals?.killed_24h ?? 0}
            coreLabel={t('ks.orbitCore')}
            coreSub={t('ks.orbitSub')}
          />
        </div>

        {/* Deadliest leaderboard */}
        <div className="ks-panel-wrap min-h-[280px]">
          {deadliest.length ? <Leaderboard rows={deadliest} /> : <div className="ks-skel h-full" />}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('ks.kpiPlayersKilled')} value={totals?.players_killed_24h ?? 0} sub={totals ? t('ks.kpi7d', { n: compact(totals.players_killed_7d) }) : undefined} color={RED} spark={{ data: globalSeries, dataKey: 'players_killed' }} />
        <KpiCard label={t('ks.kpiHunted')} value={totals?.killed_24h ?? 0} sub={totals ? t('ks.kpi7d', { n: compact(totals.killed_7d) }) : undefined} color={CORAL} spark={{ data: globalSeries, dataKey: 'killed' }} />
        <KpiCard label={t('ks.kpiExp')} value={totals?.exp_24h ?? 0} sub={totals ? t('ks.kpiActiveRaces', { n: totals.active_races }) : undefined} color={GOLD} />
        <KpiCard label={t('ks.kpiOnline')} value={totals?.players_online ?? 0} sub={totals ? t('ks.kpiWorlds', { n: totals.worlds }) : undefined} color={GREEN} live />
      </div>
    </div>
  )
}

export function KillStatsPage() {
  const { t } = useTranslation()
  const { data: worlds } = useKillWorlds()
  const { data: overview } = useKillOverview()

  const [world, setWorld] = useState('all')
  const [metric, setMetric] = useState<Metric>('players_killed')
  const [window, setWindow] = useState<RankWindow>('week')
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [selected, setSelected] = useState<string | null>(null)
  const [wall, setWall] = useState(false)

  const { data: deadliest } = useKillRanking({ world, metric: 'players_killed', window: 'day', limit: 10 })
  const { data: hunted } = useKillRanking({ world, metric: 'killed', window: 'day', limit: 20 })

  const { data: ranking, isLoading: rankingLoading } = useKillRanking({ world, metric, window, limit: 20 })
  const { data: series, isLoading: seriesLoading } = useKillSeries({ race: selected, world, granularity })

  useEffect(() => {
    if (!ranking?.length) return
    if (!selected || !ranking.some((r) => r.race === selected)) setSelected(ranking[0].race)
  }, [ranking, selected])

  // Sync kiosk state with the browser Fullscreen API (Esc exits).
  useEffect(() => {
    const h = () => {
      if (!document.fullscreenElement) setWall(false)
    }
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  const enterWall = async () => {
    setWall(true)
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {
      /* fullscreen may be blocked — overlay still shows */
    }
  }
  const exitWall = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* ignore */
    }
    setWall(false)
  }

  const metricLabel = metric === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')
  const barColor = metric === 'players_killed' ? RED : CORAL
  const chartData = useMemo(() => (ranking ?? []).map((r) => ({ ...r, value: r[metric] })), [ranking, metric])
  const selectedSlug = ranking?.find((r) => r.race === selected)?.slug ?? null

  const globalSeries = overview?.series ?? []
  const orbit = (hunted ?? []).slice(0, 10)

  return (
    <>
      {/* Full-bleed: break out of the layout's max-w container for a widescreen wall. */}
      <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen overflow-x-hidden px-3 sm:px-5">
        {/* Slim top bar (header text removed per request) */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="ks-pulse inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          <h1 className="text-lg font-black uppercase tracking-[0.2em] text-fg">{t('ks.wallTitle')}</h1>
          <span className="hidden text-xs text-fg-mute sm:inline">{t('ks.wallSub')}</span>

          <label className="ml-auto flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('ks.world')}
            <select value={world} onChange={(e) => setWorld(e.target.value)} className="rounded-md border border-line bg-bg-2 px-2 py-1.5 text-sm font-normal normal-case text-fg">
              <option value="all">{t('ks.allWorlds')}</option>
              {worlds?.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name} ({w.players_online})
                </option>
              ))}
            </select>
          </label>
          <button onClick={enterWall} className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-fg-dim transition hover:border-accent hover:text-fg">
            ⛶ {t('ks.videowall')}
          </button>
        </div>

        {/* Live kill ticker */}
        <div className="mb-4">
          <KillTicker items={hunted ?? []} />
        </div>

        <KillWall overview={overview} orbit={orbit} deadliest={deadliest ?? []} globalSeries={globalSeries} />

        {/* Pulse of the worlds */}
        {!!worlds?.length && <WorldPulse worlds={worlds} />}

        {/* Global activity (wide) */}
        <section className="ks-panel mt-4">
          <h2 className="ks-panel-title mb-1">{t('ks.globalActivity')}</h2>
          <p className="mb-3 text-xs text-fg-mute">{t('ks.globalActivityHint')}</p>
          {globalSeries.length < 2 ? (
            <p className="py-12 text-center text-sm text-fg-mute">{t('ks.historyNote')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={globalSeries} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <defs>
                  <linearGradient id="gPlayers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RED} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={RED} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gKilled" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORAL} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={CORAL} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2c2f38" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" />
                <YAxis tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" width={52} tickFormatter={(v) => compact(Number(v))} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, key) => [Number(v).toLocaleString(), String(key) === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')]} />
                <Area type="monotone" dataKey="killed" stroke={CORAL} strokeWidth={2} fill="url(#gKilled)" animationDuration={1400} />
                <Area type="monotone" dataKey="players_killed" stroke={RED} strokeWidth={2.5} fill="url(#gPlayers)" animationDuration={1400} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex overflow-hidden rounded-md border border-line">
            {(['players_killed', 'killed'] as Metric[]).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1.5 text-xs font-bold transition ${metric === m ? 'bg-accent text-white' : 'bg-bg-2 text-fg-mute hover:text-fg'}`}>
                {m === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')}
              </button>
            ))}
          </div>
          <div className="ml-auto flex overflow-hidden rounded-md border border-line">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setWindow(w)} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${window === w ? 'bg-surface-2 text-fg' : 'bg-bg-2 text-fg-mute hover:text-fg'}`}>
                {t(`ks.win.${w}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Ranking */}
          <section className="ks-panel">
            <h2 className="ks-panel-title mb-1">{t('ks.rankingTitle', { metric: metricLabel })}</h2>
            <p className="mb-3 text-xs text-fg-mute">{t('ks.rankingHint')}</p>
            {rankingLoading ? (
              <div className="h-[480px] animate-pulse rounded bg-bg-2" />
            ) : !chartData.length ? (
              <p className="py-20 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={480}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="#2c2f38" />
                  <XAxis type="number" tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" tickFormatter={(v) => compact(Number(v))} />
                  <YAxis type="category" dataKey="race" width={140} tick={{ fill: '#aaa394', fontSize: 11 }} stroke="#2c2f38" />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={TOOLTIP_STYLE} formatter={(v) => [Number(v).toLocaleString(), metricLabel]} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]} cursor="pointer" animationDuration={900} onClick={(d) => {
                    const race = (d as { payload?: { race?: string } }).payload?.race
                    if (race) setSelected(race)
                  }}>
                    {chartData.map((row) => (
                      <Cell key={row.race} fill={row.race === selected ? GOLD : barColor} fillOpacity={row.race === selected ? 1 : 0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* Trend */}
          <section className="ks-panel">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="ks-panel-title">{t('ks.trendTitle')}</h2>
                <p className="mt-0.5 text-lg font-black capitalize text-fg">
                  {selected ?? '—'}
                  {selectedSlug && (
                    <Link to={`/entry/${selectedSlug}`} className="ml-2 align-middle text-xs font-bold uppercase tracking-wider text-accent hover:underline">
                      {t('ks.viewEntry')}
                    </Link>
                  )}
                </p>
              </div>
              <div className="flex overflow-hidden rounded-md border border-line">
                {(['month', 'day'] as Granularity[]).map((g) => (
                  <button key={g} onClick={() => setGranularity(g)} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${granularity === g ? 'bg-surface-2 text-fg' : 'bg-bg-2 text-fg-mute hover:text-fg'}`}>
                    {t(`ks.gran.${g}`)}
                  </button>
                ))}
              </div>
            </div>
            {seriesLoading ? (
              <div className="h-[420px] animate-pulse rounded bg-bg-2" />
            ) : !series?.length ? (
              <p className="py-20 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart data={series} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#2c2f38" />
                    <XAxis dataKey="period" tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" />
                    <YAxis tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" width={48} tickFormatter={(v) => compact(Number(v))} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, key) => [Number(v).toLocaleString(), String(key) === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')]} />
                    <Line type="monotone" dataKey="players_killed" stroke={RED} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="killed" stroke={CORAL} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 flex items-center justify-center gap-5 text-xs text-fg-mute">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: RED }} />{t('ks.playersKilled')}</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: CORAL }} />{t('ks.creaturesKilled')}</span>
                </div>
              </>
            )}
          </section>
        </div>

        {/* World population */}
        {overview && (
          <section className="ks-panel mt-4 mb-2">
            <h2 className="ks-panel-title mb-1">{t('ks.worldPopTitle')}</h2>
            <p className="mb-3 text-xs text-fg-mute">{t('ks.worldPopHint')}</p>
            <div className="grid gap-6 lg:grid-cols-3">
              <Donut title={t('ks.byRegion')} data={overview.regions} />
              <Donut title={t('ks.byPvp')} data={overview.pvp} />
              <div>
                <h3 className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-fg-mute">{t('ks.topWorlds')}</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={overview.top_worlds} layout="vertical" margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#2c2f38" />
                    <XAxis type="number" tick={{ fill: '#76705f', fontSize: 10 }} stroke="#2c2f38" />
                    <YAxis type="category" dataKey="name" width={84} tick={{ fill: '#aaa394', fontSize: 10 }} stroke="#2c2f38" />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={TOOLTIP_STYLE} formatter={(v) => [Number(v).toLocaleString(), t('ks.online')]} />
                    <Bar dataKey="players_online" radius={[0, 3, 3, 0]} fill={BLUE} fillOpacity={0.9} animationDuration={900} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Fullscreen kiosk overlay */}
      {wall && (
        <div className="ks-wall fixed inset-0 z-[80] overflow-hidden bg-bg p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="ks-pulse inline-block h-3 w-3 rounded-full bg-accent" />
            <h1 className="text-xl font-black uppercase tracking-[0.25em] text-fg">{t('ks.wallTitle')}</h1>
            <span className="text-sm text-fg-mute">{t('ks.wallSub')}</span>
            <button onClick={exitWall} className="ml-auto rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-fg-dim transition hover:border-accent hover:text-fg">
              ✕ {t('ks.exit')}
            </button>
          </div>
          <KillWall overview={overview} orbit={orbit} deadliest={deadliest ?? []} globalSeries={globalSeries} />
        </div>
      )}
    </>
  )
}

/** Donut with a center total. */
function Donut({ title, data }: { title: string; data: { name: string; players_online: number }[] }) {
  const total = data.reduce((s, d) => s + d.players_online, 0)
  return (
    <div>
      <h3 className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-fg-mute">{title}</h3>
      <div className="relative">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={data} dataKey="players_online" nameKey="name" innerRadius={64} outerRadius={104} paddingAngle={2} stroke="#131419" animationDuration={900}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [Number(v).toLocaleString(), String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-fg">{compact(total)}</span>
          <span className="text-[10px] uppercase tracking-wider text-fg-mute">online</span>
        </div>
      </div>
    </div>
  )
}

