import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useKillExperience,
  useKillMeta,
  useKillRanking,
  useKillSeries,
  useKillWorlds,
  type Granularity,
  type Metric,
  type RankWindow,
} from '../hooks/useKillStats'

const RED = '#d23d2f'
const CORAL = '#ec6a55'
const GOLD = '#d8a23a'

const WINDOWS: RankWindow[] = ['day', 'week', 'month', 'year']

export function KillStatsPage() {
  const { t } = useTranslation()
  const { data: meta } = useKillMeta()
  const { data: worlds } = useKillWorlds()

  const [world, setWorld] = useState('all')
  const [metric, setMetric] = useState<Metric>('players_killed')
  const [window, setWindow] = useState<RankWindow>('week')
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [selected, setSelected] = useState<string | null>(null)
  const [expWindow, setExpWindow] = useState<'day' | 'week'>('week')

  const { data: expRanking } = useKillExperience({ world, window: expWindow, limit: 15 })

  const { data: ranking, isLoading: rankingLoading } = useKillRanking({
    world,
    metric,
    window,
    limit: 20,
  })
  const { data: series, isLoading: seriesLoading } = useKillSeries({
    race: selected,
    world,
    granularity,
  })

  // Auto-select the top race once a ranking arrives (keep selection if still present).
  useEffect(() => {
    if (!ranking?.length) return
    if (!selected || !ranking.some((r) => r.race === selected)) {
      setSelected(ranking[0].race)
    }
  }, [ranking, selected])

  const metricLabel = metric === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')
  const barColor = metric === 'players_killed' ? RED : CORAL

  const chartData = useMemo(
    () => (ranking ?? []).map((r) => ({ ...r, value: r[metric] })),
    [ranking, metric],
  )
  const selectedSlug = ranking?.find((r) => r.race === selected)?.slug ?? null

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">{t('ks.kicker')}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{t('ks.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-dim">{t('ks.intro')}</p>
        {meta && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-mute">
            <span>
              <b className="text-fg-dim">{meta.worlds}</b> {t('ks.worlds')}
            </span>
            <span>
              <b className="text-fg-dim">{meta.races.toLocaleString()}</b> {t('ks.races')}
            </span>
            <span>
              <b className="text-canon">{meta.players_online.toLocaleString()}</b> {t('ks.online')}
            </span>
            {meta.latest_snapshot && (
              <span>
                {t('ks.lastSnapshot')}: <b className="text-fg-dim">{meta.latest_snapshot}</b>
              </span>
            )}
          </div>
        )}
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-mute">
          {t('ks.world')}
          <select
            value={world}
            onChange={(e) => setWorld(e.target.value)}
            className="rounded-md border border-line bg-bg-2 px-2 py-1.5 text-sm font-normal normal-case text-fg"
          >
            <option value="all">{t('ks.allWorlds')}</option>
            {worlds?.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name} ({w.players_online})
              </option>
            ))}
          </select>
        </label>

        {/* Metric toggle */}
        <div className="flex overflow-hidden rounded-md border border-line">
          {(['players_killed', 'killed'] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1.5 text-xs font-bold transition ${
                metric === m ? 'bg-accent text-white' : 'bg-bg-2 text-fg-mute hover:text-fg'
              }`}
            >
              {m === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled')}
            </button>
          ))}
        </div>

        {/* Ranking window */}
        <div className="ml-auto flex overflow-hidden rounded-md border border-line">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                window === w ? 'bg-surface-2 text-fg' : 'bg-bg-2 text-fg-mute hover:text-fg'
              }`}
            >
              {t(`ks.win.${w}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ranking bar chart */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-fg-dim">
            {t('ks.rankingTitle', { metric: metricLabel })}
          </h2>
          <p className="mb-3 text-xs text-fg-mute">{t('ks.rankingHint')}</p>
          {rankingLoading ? (
            <div className="h-[520px] animate-pulse rounded bg-bg-2" />
          ) : !chartData.length ? (
            <p className="py-20 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={520}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="#2c2f38" />
                <XAxis type="number" tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" />
                <YAxis
                  type="category"
                  dataKey="race"
                  width={140}
                  tick={{ fill: '#aaa394', fontSize: 11 }}
                  stroke="#2c2f38"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: '#1b1d24',
                    border: '1px solid #3d414c',
                    borderRadius: 8,
                    color: '#e9e3d6',
                    fontSize: 12,
                  }}
                  formatter={(v) => [Number(v).toLocaleString(), metricLabel]}
                />
                <Bar
                  dataKey="value"
                  radius={[0, 3, 3, 0]}
                  cursor="pointer"
                  onClick={(d) => {
                    const race = (d as { payload?: { race?: string } }).payload?.race
                    if (race) setSelected(race)
                  }}
                >
                  {chartData.map((row) => (
                    <Cell
                      key={row.race}
                      fill={row.race === selected ? GOLD : barColor}
                      fillOpacity={row.race === selected ? 1 : 0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Time series for the selected race */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-fg-dim">
                {t('ks.trendTitle')}
              </h2>
              <p className="mt-0.5 text-lg font-black capitalize text-fg">
                {selected ?? '—'}
                {selectedSlug && (
                  <Link
                    to={`/entry/${selectedSlug}`}
                    className="ml-2 align-middle text-xs font-bold uppercase tracking-wider text-accent hover:underline"
                  >
                    {t('ks.viewEntry')}
                  </Link>
                )}
              </p>
            </div>
            <div className="flex overflow-hidden rounded-md border border-line">
              {(['month', 'day'] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                    granularity === g ? 'bg-surface-2 text-fg' : 'bg-bg-2 text-fg-mute hover:text-fg'
                  }`}
                >
                  {t(`ks.gran.${g}`)}
                </button>
              ))}
            </div>
          </div>

          {seriesLoading ? (
            <div className="h-[440px] animate-pulse rounded bg-bg-2" />
          ) : !series?.length ? (
            <p className="py-20 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={440}>
                <LineChart data={series} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#2c2f38" />
                  <XAxis dataKey="period" tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" />
                  <YAxis tick={{ fill: '#76705f', fontSize: 11 }} stroke="#2c2f38" width={48} />
                  <Tooltip
                    contentStyle={{
                      background: '#1b1d24',
                      border: '1px solid #3d414c',
                      borderRadius: 8,
                      color: '#e9e3d6',
                      fontSize: 12,
                    }}
                    formatter={(v, key) => [
                      Number(v).toLocaleString(),
                      String(key) === 'players_killed'
                        ? t('ks.playersKilled')
                        : t('ks.creaturesKilled'),
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="players_killed"
                    stroke={RED}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="killed"
                    stroke={CORAL}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 flex items-center justify-center gap-5 text-xs text-fg-mute">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: RED }} />
                  {t('ks.playersKilled')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: CORAL }} />
                  {t('ks.creaturesKilled')}
                </span>
              </div>
            </>
          )}

          {meta && meta.months_available < 2 && (
            <p className="mt-3 rounded border border-theory/30 bg-theory/5 px-3 py-2 text-xs text-theory">
              {t('ks.historyNote')}
            </p>
          )}
        </section>
      </div>

      {/* Experience handed out */}
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-fg-dim">
              {t('ks.expRankingTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-fg-mute">{t('ks.expRankingHint')}</p>
          </div>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(['day', 'week'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setExpWindow(w)}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                  expWindow === w ? 'bg-surface-2 text-fg' : 'bg-bg-2 text-fg-mute hover:text-fg'
                }`}
              >
                {t(`ks.win.${w === 'day' ? 'day' : 'week'}`)}
              </button>
            ))}
          </div>
        </div>
        {!expRanking?.length ? (
          <p className="py-16 text-center text-sm text-fg-mute">{t('ks.noData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={460}>
            <BarChart
              data={expRanking}
              layout="vertical"
              margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} stroke="#2c2f38" />
              <XAxis
                type="number"
                tick={{ fill: '#76705f', fontSize: 11 }}
                stroke="#2c2f38"
                tickFormatter={(v) => `${(v / 1e9).toFixed(0)}B`}
              />
              <YAxis
                type="category"
                dataKey="race"
                width={150}
                tick={{ fill: '#aaa394', fontSize: 11 }}
                stroke="#2c2f38"
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{
                  background: '#1b1d24',
                  border: '1px solid #3d414c',
                  borderRadius: 8,
                  color: '#e9e3d6',
                  fontSize: 12,
                }}
                formatter={(v, _n, item) => [
                  `${Number(v).toLocaleString()} XP · → ${t('ks.levelN', {
                    n: (item?.payload as { level?: number })?.level ?? 1,
                  })}`,
                  t('ks.expGiven'),
                ]}
              />
              <Bar dataKey="exp_total" radius={[0, 3, 3, 0]} fill={GOLD} fillOpacity={0.9} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  )
}
