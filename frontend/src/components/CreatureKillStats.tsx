import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useEntryKillStats } from '../hooks/useKillStats'

const RED = '#d23d2f'
const CORAL = '#ec6a55'

/**
 * Kill-statistics panel shown on a creature's entry page: the latest 24h / 7d
 * totals across all worlds plus a daily trend. Renders nothing unless the
 * creature is linked to a TibiaData race with data.
 */
export function CreatureKillStats({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t } = useTranslation()
  const { data } = useEntryKillStats(slug, enabled)

  if (!data?.linked || !data.latest) return null

  const { latest, series } = data

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">{t('ks.entryTitle')}</h2>
        <Link
          to="/killstats"
          className="ml-auto text-[10px] font-bold uppercase tracking-wider text-accent hover:underline"
        >
          {t('ks.openDashboard')}
        </Link>
      </header>

      <div className="p-4">
        {/* Latest totals */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('ks.playersKilled')} sub={t('ks.last24h')} value={latest.players_killed} color={RED} />
          <Stat label={t('ks.creaturesKilled')} sub={t('ks.last24h')} value={latest.killed} color={CORAL} />
          <Stat label={t('ks.playersKilled')} sub={t('ks.last7d')} value={latest.week_players_killed} color={RED} />
          <Stat label={t('ks.creaturesKilled')} sub={t('ks.last7d')} value={latest.week_killed} color={CORAL} />
        </div>
        <p className="mt-2 text-[10px] text-fg-mute">
          {t('ks.acrossWorlds')} · {t('ks.lastSnapshot')}: {latest.date}
        </p>

        {/* Experience handed out */}
        {latest.exp_each ? (
          <div className="mt-3 rounded border border-theory/30 bg-theory/5 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-theory">
              {t('ks.expGiven')} · {latest.exp_each.toLocaleString()} {t('ks.expEach')}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <div>
                <div className="font-mono text-lg font-bold tabular-nums text-fg">
                  {(latest.exp_24h ?? 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-fg-dim">
                  {t('ks.last24h')} · → {t('ks.levelN', { n: latest.level_24h ?? 1 })}
                </div>
              </div>
              <div>
                <div className="font-mono text-lg font-bold tabular-nums text-fg">
                  {(latest.exp_7d ?? 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-fg-dim">
                  {t('ks.last7d')} · → {t('ks.levelN', { n: latest.level_7d ?? 1 })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Daily trend */}
        <h3 className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-fg-mute">
          {t('ks.trendDaily')}
        </h3>
        {series.length < 2 ? (
          <p className="rounded border border-theory/30 bg-theory/5 px-3 py-2 text-xs text-theory">
            {t('ks.historyNote')}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="#2c2f38" />
              <XAxis dataKey="period" tick={{ fill: '#76705f', fontSize: 10 }} stroke="#2c2f38" />
              <YAxis tick={{ fill: '#76705f', fontSize: 10 }} stroke="#2c2f38" width={42} />
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
                  String(key) === 'players_killed' ? t('ks.playersKilled') : t('ks.creaturesKilled'),
                ]}
              />
              <Line type="monotone" dataKey="players_killed" stroke={RED} strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="killed" stroke={CORAL} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function Stat({
  label,
  sub,
  value,
  color,
}: {
  label: string
  sub: string
  value: number
  color: string
}) {
  return (
    <div className="rounded border border-line bg-bg-2 px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-fg-mute">{sub}</div>
      <div className="font-mono text-xl font-bold tabular-nums" style={{ color }}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-fg-dim">{label}</div>
    </div>
  )
}
