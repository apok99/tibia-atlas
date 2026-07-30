import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { chartTooltipStyle, useChartTheme } from '../hooks/useChartTheme'
import { dayKey, type SavedHunt } from '../hooks/useHuntLog'
import { compact } from '../lib/format'

const gp = (n: number) => Math.round(n).toLocaleString()
const signed = (n: number) => (n >= 0 ? '+' : '−') + compact(Math.abs(n))

/** Bucket of sessions — one calendar day, one month, or a whole period. */
type Bucket = { hunts: number; hours: number; profit: number; xp: number }

const EMPTY: Bucket = { hunts: 0, hours: 0, profit: 0, xp: 0 }

function add(b: Bucket, h: SavedHunt): Bucket {
  return {
    hunts: b.hunts + 1,
    hours: b.hours + h.hours,
    profit: b.profit + h.profit,
    xp: b.xp + (h.xp ?? 0),
  }
}

/** Roll a list of sessions into a single total. */
function total(list: SavedHunt[]): Bucket {
  return list.reduce(add, EMPTY)
}

/** Headline number for the summary cards. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-canon' : tone === 'bad' ? 'text-accent' : 'text-fg'
  return (
    <div className="min-w-0 rounded-lg border border-line bg-bg-2 px-2 py-1.5 text-center">
      <div className={`truncate text-base font-bold leading-tight tabular-nums ${color}`}>{value}</div>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-fg-mute">{label}</div>
    </div>
  )
}

/**
 * The saved-hunt history: what the player actually earned, day by day.
 *
 * Everything here is derived from the local log — the last 30 calendar days as
 * a bar chart (one bar per day, gilt when the day made money, red when it lost
 * it) plus an expandable day list, and two rollups: the current month and the
 * current year (with its twelve monthly bars).
 */
export default function HuntLog({
  hunts,
  onRemove,
  onClear,
}: {
  hunts: SavedHunt[]
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const { t, i18n } = useTranslation()
  const chart = useChartTheme()
  const [openDay, setOpenDay] = useState<string | null>(null)

  const locale = i18n.language?.startsWith('en') ? 'en-GB' : 'es-ES'

  // Sessions bucketed by their local calendar day, plus the same list per day
  // so a row can expand into the individual hunts it is made of.
  const byDay = useMemo(() => {
    const map = new Map<string, SavedHunt[]>()
    for (const h of hunts) {
      const list = map.get(h.day)
      if (list) list.push(h)
      else map.set(h.day, [h])
    }
    return map
  }, [hunts])

  // The last 30 calendar days, oldest → newest, zero-filled: an empty day is
  // information too, and gaps would make the chart lie about the cadence.
  const days = useMemo(() => {
    const out: { day: string; short: string; hunts: number; hours: number; profit: number }[] = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dayKey(d)
      const b = total(byDay.get(key) ?? [])
      out.push({
        day: key,
        short: d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
        hunts: b.hunts,
        hours: b.hours,
        profit: b.profit,
      })
    }
    return out
  }, [byDay, locale])

  const last30 = useMemo(() => {
    const first = days[0]?.day ?? ''
    return total(hunts.filter((h) => h.day >= first))
  }, [hunts, days])

  // Current month and current year, plus the year's twelve monthly bars.
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const yearPrefix = String(now.getFullYear())

  const month = useMemo(() => total(hunts.filter((h) => h.day.startsWith(monthPrefix))), [hunts, monthPrefix])
  const year = useMemo(() => total(hunts.filter((h) => h.day.startsWith(yearPrefix))), [hunts, yearPrefix])

  // Best day of the month — the one worth bragging about.
  const bestDay = useMemo(() => {
    let best: { day: string; profit: number } | null = null
    for (const [day, list] of byDay) {
      if (!day.startsWith(monthPrefix)) continue
      const p = total(list).profit
      if (!best || p > best.profit) best = { day, profit: p }
    }
    return best
  }, [byDay, monthPrefix])

  const months = useMemo(() => {
    const out: { key: string; short: string; hunts: number; hours: number; profit: number }[] = []
    for (let m = 0; m < 12; m++) {
      const key = `${yearPrefix}-${String(m + 1).padStart(2, '0')}`
      const b = total(hunts.filter((h) => h.day.startsWith(key)))
      out.push({
        key,
        short: new Date(Number(yearPrefix), m, 1).toLocaleDateString(locale, { month: 'short' }),
        hunts: b.hunts,
        hours: b.hours,
        profit: b.profit,
      })
    }
    return out
  }, [hunts, yearPrefix, locale])

  // Only days that actually hold sessions make the list — an empty row is noise
  // once the chart above already shows the gap.
  const dayRows = useMemo(() => days.filter((d) => d.hunts > 0).reverse(), [days])

  const perHour = (b: Bucket) => (b.hours > 0 ? b.profit / b.hours : null)

  if (hunts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-bg-2 px-4 py-8 text-center">
        <p className="text-sm text-fg-dim">{t('map.hlEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* --- last 30 days ---------------------------------------------------- */}
      <div className="rounded-xl border border-line bg-bg-2 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hl30d')}</span>
          <button
            onClick={() => {
              if (window.confirm(t('map.hlClearConfirm'))) onClear()
            }}
            className="text-[10px] font-bold uppercase tracking-wide text-fg-mute transition hover:text-accent"
          >
            {t('map.hlClear')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Stat label={t('map.hlHunts')} value={String(last30.hunts)} />
          <Stat label={t('map.hlHours')} value={`${last30.hours.toFixed(1)}h`} />
          <Stat
            label={t('map.hlProfit')}
            value={signed(last30.profit)}
            tone={last30.profit >= 0 ? 'good' : 'bad'}
          />
          <Stat
            label={t('map.hlPerHour')}
            value={perHour(last30) != null ? signed(perHour(last30)!) : '—'}
            tone={(perHour(last30) ?? 0) >= 0 ? 'good' : 'bad'}
          />
        </div>

        {/* One bar per day: gilt when the day earned, red when it burned gold. */}
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
              <XAxis
                dataKey="short"
                interval={4}
                tick={{ fill: chart.tick, fontSize: 10 }}
                stroke={chart.axis}
              />
              <YAxis
                tickFormatter={(v) => compact(Number(v))}
                tick={{ fill: chart.tick, fontSize: 10 }}
                stroke={chart.axis}
                width={44}
              />
              <Tooltip
                cursor={{ fill: chart.grid, fillOpacity: 0.25 }}
                contentStyle={chartTooltipStyle(chart)}
                formatter={(v, _n, p) => [
                  `${gp(Number(v))} gp · ${t('map.hlHuntsN', { count: p.payload.hunts })} · ${Number(p.payload.hours).toFixed(1)}h`,
                  t('map.hlProfit'),
                ]}
              />
              <Bar dataKey="profit" radius={[3, 3, 0, 0]}>
                {days.map((d) => (
                  <Cell key={d.day} fill={d.profit >= 0 ? chart.gold : chart.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Day list — click a day to see (and delete) the sessions inside it. */}
        <div className="scroll-atlas mt-1 flex max-h-[13rem] flex-col gap-0.5 overflow-y-auto pr-1">
          {dayRows.map((d) => {
            const open = openDay === d.day
            return (
              <div key={d.day}>
                <button
                  onClick={() => setOpenDay(open ? null : d.day)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-surface-2/60"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 shrink-0 text-fg-mute transition-transform ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="w-24 shrink-0 truncate text-xs font-semibold capitalize text-fg">{d.short}</span>
                  <span className="w-20 shrink-0 text-[11px] text-fg-mute">
                    {t('map.hlHuntsN', { count: d.hunts })}
                  </span>
                  <span className="w-14 shrink-0 text-[11px] text-fg-mute">{d.hours.toFixed(1)}h</span>
                  <span
                    className={`ml-auto shrink-0 text-right text-xs font-bold tabular-nums ${d.profit >= 0 ? 'text-canon' : 'text-accent'}`}
                  >
                    {signed(d.profit)}
                  </span>
                </button>

                {open && (
                  <div className="mb-1 ml-5 flex flex-col gap-0.5 border-l border-line pl-2">
                    {(byDay.get(d.day) ?? []).map((h) => (
                      <div key={h.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                        <span className="w-10 shrink-0 tabular-nums text-fg-mute">
                          {new Date(h.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="min-w-0 flex-1 truncate capitalize text-fg-dim">
                          {h.label || t('map.hlSession')}
                          {h.kills > 0 && <span className="text-fg-mute"> · {h.kills.toLocaleString()} kills</span>}
                        </span>
                        <span className="w-12 shrink-0 text-right tabular-nums text-fg-mute">
                          {h.hours.toFixed(1)}h
                        </span>
                        <span
                          className={`w-16 shrink-0 text-right font-bold tabular-nums ${h.profit >= 0 ? 'text-canon' : 'text-accent'}`}
                        >
                          {signed(h.profit)}
                        </span>
                        <button
                          onClick={() => onRemove(h.id)}
                          title={t('map.hlDelete')}
                          aria-label={t('map.hlDelete')}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg-mute transition hover:text-accent"
                        >
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* --- month + year rollups -------------------------------------------- */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg-2 p-2.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">
            {t('map.hlMonth')}{' '}
            <span className="capitalize text-fg-mute">
              {now.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('map.hlHunts')} value={String(month.hunts)} />
            <Stat label={t('map.hlHours')} value={`${month.hours.toFixed(1)}h`} />
            <Stat label={t('map.hlProfit')} value={signed(month.profit)} tone={month.profit >= 0 ? 'good' : 'bad'} />
            <Stat
              label={t('map.hlPerHour')}
              value={perHour(month) != null ? signed(perHour(month)!) : '—'}
              tone={(perHour(month) ?? 0) >= 0 ? 'good' : 'bad'}
            />
          </div>
          <p className="mt-1.5 truncate text-[11px] text-fg-mute">
            {bestDay
              ? t('map.hlBestDay', {
                  day: new Date(`${bestDay.day}T12:00:00`).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'long',
                  }),
                  gp: signed(bestDay.profit),
                })
              : t('map.hlNoMonth')}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-bg-2 p-2.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">
            {t('map.hlYear')} <span className="text-fg-mute">{yearPrefix}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label={t('map.hlHunts')} value={String(year.hunts)} />
            <Stat label={t('map.hlHours')} value={`${year.hours.toFixed(1)}h`} />
            <Stat label={t('map.hlProfit')} value={signed(year.profit)} tone={year.profit >= 0 ? 'good' : 'bad'} />
            <Stat
              label={t('map.hlPerHour')}
              value={perHour(year) != null ? signed(perHour(year)!) : '—'}
              tone={(perHour(year) ?? 0) >= 0 ? 'good' : 'bad'}
            />
          </div>
          {/* Twelve bars: the year's shape at a glance. */}
          <div className="mt-1.5">
            <ResponsiveContainer width="100%" height={92}>
              <BarChart data={months} margin={{ top: 2, right: 4, bottom: 0, left: -14 }}>
                <XAxis dataKey="short" tick={{ fill: chart.tick, fontSize: 9 }} stroke={chart.axis} interval={0} />
                <YAxis
                  tickFormatter={(v) => compact(Number(v))}
                  tick={{ fill: chart.tick, fontSize: 9 }}
                  stroke={chart.axis}
                  width={42}
                />
                <Tooltip
                  cursor={{ fill: chart.grid, fillOpacity: 0.25 }}
                  contentStyle={chartTooltipStyle(chart)}
                  formatter={(v, _n, p) => [
                    `${gp(Number(v))} gp · ${t('map.hlHuntsN', { count: p.payload.hunts })}`,
                    t('map.hlProfit'),
                  ]}
                />
                <Bar dataKey="profit" radius={[2, 2, 0, 0]}>
                  {months.map((m) => (
                    <Cell key={m.key} fill={m.profit >= 0 ? chart.gold : chart.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
