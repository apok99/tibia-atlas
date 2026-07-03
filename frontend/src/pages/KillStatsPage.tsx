import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CountUp } from '../components/CountUp'
import { compact } from '../lib/format'
import { CreatureOrbit } from '../components/CreatureOrbit'
import { KillTicker } from '../components/KillTicker'
import { WorldPulse } from '../components/WorldPulse'
import { BossWatch } from '../components/BossWatch'
import { TopSearched } from '../components/TopSearched'
import {
  useBosses,
  useKillOverview,
  useKillRanking,
  useKillWorlds,
  useTopSearches,
  type BossRow,
  type KillOverview,
  type RankingRow,
  type SeriesPoint,
} from '../hooks/useKillStats'
import { chartTooltipStyle, useChartTheme } from '../hooks/useChartTheme'

const RED = '#d23d2f'
const CORAL = '#ec6a55'
const GREEN = '#79b169'
const VIOLET = '#b97fc4'

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

/** KPI card that auto-rotates through bosses slain today, with the server. */
function RotatingBossKpi({ bosses, label, color = VIOLET }: { bosses: BossRow[]; label: string; color?: string }) {
  const { t } = useTranslation()
  const list = bosses
    .filter((b) => b.day_killed > 0)
    .sort((a, b) => b.day_killed - a.day_killed)
    .slice(0, 12)
  const [i, setI] = useState(0)

  useEffect(() => {
    if (list.length < 2) return
    const id = setInterval(() => setI((x) => (x + 1) % list.length), 3000)
    return () => clearInterval(id)
  }, [list.length])

  const b = list.length ? list[Math.min(i, list.length - 1)] : null
  const world = b?.worlds[0]

  return (
    <div className="ks-kpi relative overflow-hidden rounded-xl border border-line bg-surface p-4" style={{ ['--glow' as string]: color }}>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-fg-mute">{label}</span>
        <span className="ks-rotate ml-auto text-[11px]" style={{ color }}>↻</span>
      </div>
      {b ? (
        <div key={b.slug ?? b.race} className="ks-kpi-rotate mt-2 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-bg-2" style={{ boxShadow: `0 0 10px -3px ${color}` }}>
            {b.image ? <img src={b.image} alt="" className="h-9 w-9 object-contain" /> : <span>☠</span>}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black leading-none" style={{ color }}>
                <CountUp value={b.day_killed} duration={800} />
              </span>
              <span className="text-[10px] uppercase tracking-wider text-fg-mute">{t('ks.kpiBossKilledUnit')}</span>
            </div>
            <p className="mt-0.5 truncate text-xs font-bold capitalize text-fg" title={b.race}>
              {b.race}
            </p>
            {world && <p className="truncate text-[11px] text-fg-mute">{t('ks.kpiInWorld', { w: world })}</p>}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-mute">{t('ks.noData')}</p>
      )}
    </div>
  )
}

/** Live players-online panel: big current count + history area (or region bars while sparse). */
function OnlinePanel({ overview }: { overview: KillOverview }) {
  const { t } = useTranslation()
  const chart = useChartTheme()
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
              <CartesianGrid stroke={chart.grid} strokeOpacity={0.6} vertical={false} />
              <XAxis dataKey="time" tick={{ fill: chart.tick, fontSize: 10 }} stroke={chart.axis} tickFormatter={(v) => String(v).slice(11)} minTickGap={28} />
              <YAxis tick={{ fill: chart.tick, fontSize: 10 }} stroke={chart.axis} width={40} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip contentStyle={chartTooltipStyle(chart)} formatter={(v) => [Number(v).toLocaleString(), t('ks.online')]} />
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
  dailyBosses,
  raidBosses,
}: {
  overview: KillOverview | undefined
  orbit: RankingRow[]
  deadliest: RankingRow[]
  globalSeries: SeriesPoint[]
  dailyBosses: BossRow[]
  raidBosses: BossRow[]
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

      {/* KPI strip — 2 headline stats + a daily-boss and a raid-boss rotator */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('ks.kpiPlayersKilled')} value={totals?.players_killed_24h ?? 0} sub={totals ? t('ks.kpi7d', { n: compact(totals.players_killed_7d) }) : undefined} color={RED} spark={{ data: globalSeries, dataKey: 'players_killed' }} />
        <KpiCard label={t('ks.kpiHunted')} value={totals?.killed_24h ?? 0} sub={totals ? t('ks.kpi7d', { n: compact(totals.killed_7d) }) : undefined} color={CORAL} spark={{ data: globalSeries, dataKey: 'killed' }} />
        <RotatingBossKpi bosses={dailyBosses} label={t('ks.kpiBossKilled')} color={GREEN} />
        <RotatingBossKpi bosses={raidBosses} label={t('ks.kpiRaidKilled')} color={VIOLET} />
      </div>
    </div>
  )
}

export function KillStatsPage() {
  const { t } = useTranslation()
  const { data: worlds } = useKillWorlds()

  const [world, setWorld] = useState('all')
  const [wall, setWall] = useState(false)

  const { data: overview } = useKillOverview(world)

  const { data: deadliest } = useKillRanking({ world, metric: 'players_killed', window: 'day', limit: 10 })
  const { data: hunted } = useKillRanking({ world, metric: 'killed', window: 'day', limit: 20 })
  const { data: bosses } = useBosses('raid', 24)
  const { data: dailyBosses } = useBosses('daily', 12)
  const { data: topSearched } = useTopSearches(10)

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

  const globalSeries = overview?.series ?? []
  const orbit = (hunted ?? []).slice(0, 10)

  return (
    <>
      <Seo title={t('nav.killstats')} path="/killstats" />
      {/* Full-bleed: break out of the layout's max-w container for a widescreen wall. */}
      <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen overflow-x-hidden px-3 sm:px-5">
        {/* Slim top bar (title/subtitle removed per request) */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
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

        <KillWall overview={overview} orbit={orbit} deadliest={deadliest ?? []} globalSeries={globalSeries} dailyBosses={dailyBosses ?? []} raidBosses={bosses ?? []} />

        {/* Raid Boss Watch (left) + most searched/viewed (right) */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <BossWatch bosses={bosses ?? []} />
          <TopSearched source={topSearched?.source ?? 'views'} items={topSearched?.data ?? []} />
        </div>

        {/* Pulse of the worlds */}
        {!!worlds?.length && <WorldPulse worlds={worlds} />}

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
          <div className="mb-4">
            <KillTicker items={hunted ?? []} />
          </div>
          <KillWall overview={overview} orbit={orbit} deadliest={deadliest ?? []} globalSeries={globalSeries} dailyBosses={dailyBosses ?? []} raidBosses={bosses ?? []} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BossWatch bosses={bosses ?? []} />
            <TopSearched source={topSearched?.source ?? 'views'} items={topSearched?.data ?? []} />
          </div>
          {!!worlds?.length && (
            <div className="mt-4">
              <WorldPulse worlds={worlds} />
            </div>
          )}
        </div>
      )}
    </>
  )
}


