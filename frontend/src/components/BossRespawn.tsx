import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useBossRespawn } from '../hooks/useKillStats'

const GOLD = '#d8a23a'

const STATUS_STYLE: Record<string, string> = {
  due: 'text-canon',
  recent: 'text-theory',
  cooldown: 'text-fg-mute',
}

/**
 * Boss respawn tracker on a boss's entry page: per-world recency of kills plus
 * an empirical "probability it has come back" curve that fills in as our daily
 * snapshots accumulate.
 */
export function BossRespawn({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t } = useTranslation()
  const { data } = useBossRespawn(slug, enabled)

  if (!data?.linked || !data.is_boss) return null

  const { summary, worlds = [], respawn } = data

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full" style={{ background: GOLD }} />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">{t('ks.bossTitle')}</h2>
      </header>

      <div className="p-4">
        {/* Summary chips */}
        {summary && (
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Chip n={summary.due} label={t('ks.bossDue')} cls="border-canon/40 text-canon" />
            <Chip n={summary.recent} label={t('ks.bossRecent')} cls="border-theory/40 text-theory" />
            <Chip n={summary.cooldown} label={t('ks.bossCooldown')} cls="border-line text-fg-mute" />
          </div>
        )}

        {/* Respawn probability curve, or a collecting note */}
        {respawn?.method === 'empirical' && respawn.cdf.length > 0 ? (
          <>
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-fg-mute">
              {t('ks.bossCurve')}
            </h3>
            <p className="mb-2 text-[10px] text-fg-mute">
              {t('ks.bossCurveHint', {
                median: respawn.median_days,
                min: respawn.min_days,
                n: respawn.sample_size,
              })}
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={respawn.cdf} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="#2c2f38" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#76705f', fontSize: 10 }}
                  stroke="#2c2f38"
                  unit="d"
                />
                <YAxis
                  tick={{ fill: '#76705f', fontSize: 10 }}
                  stroke="#2c2f38"
                  width={38}
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1b1d24',
                    border: '1px solid #3d414c',
                    borderRadius: 8,
                    color: '#e9e3d6',
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${Math.round(Number(v) * 100)}%`, t('ks.bossProb')]}
                  labelFormatter={(d) => t('ks.bossDays', { d })}
                />
                <Area type="monotone" dataKey="prob" stroke={GOLD} fill={GOLD} fillOpacity={0.18} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </>
        ) : (
          <p className="rounded border border-theory/30 bg-theory/5 px-3 py-2 text-xs text-theory">
            {t('ks.bossCollecting')}
          </p>
        )}

        {/* Per-world recency */}
        {worlds.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-fg-mute">
              {t('ks.bossByWorld')}
            </h3>
            <div className="max-h-72 overflow-y-auto rounded border border-line">
              <table className="w-full text-sm">
                <tbody>
                  {worlds.map((w) => (
                    <tr key={w.world} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-1.5 font-medium text-fg">{w.world}</td>
                      <td className={`px-3 py-1.5 text-right text-xs font-bold ${STATUS_STYLE[w.status]}`}>
                        {w.days_since != null
                          ? t('ks.bossDaysAgo', { d: w.days_since })
                          : t(`ks.status.${w.status}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Chip({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 font-bold ${cls}`}>
      {n} · {label}
    </span>
  )
}
