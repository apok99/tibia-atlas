import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { chartTooltipStyle, useChartTheme, type ChartTheme } from '../hooks/useChartTheme'
import { dayKey, waste, type SavedHunt } from '../hooks/useHuntLog'
import { shareUrl, shiftDay, type Roll, type Summary } from '../lib/huntShare'
import { compact } from '../lib/format'

const gp = (n: number) => Math.round(n).toLocaleString()
const signed = (n: number) => (n >= 0 ? '+' : '−') + compact(Math.abs(n))

/** Bucket of sessions — one calendar day, one month, or a whole period. */
type Bucket = Roll & { xp: number }

const EMPTY: Bucket = { hunts: 0, hours: 0, profit: 0, waste: 0, xp: 0 }

function add(b: Bucket, h: SavedHunt): Bucket {
  return {
    hunts: b.hunts + 1,
    hours: b.hours + h.hours,
    profit: b.profit + h.profit,
    waste: b.waste + waste(h),
    xp: b.xp + (h.xp ?? 0),
  }
}

/** Roll a list of sessions into a single total. */
function total(list: SavedHunt[]): Bucket {
  return list.reduce(add, EMPTY)
}

/** YYYY-MM-DD → a Date safe to format (midday dodges any DST edge). */
const dayDate = (day: string) => new Date(`${day}T12:00:00`)

/**
 * One saved session: when, what, and what it left you with — plus the × that
 * deletes it. Shared by the per-day drill-down and the full list, which is why
 * the date column is optional (inside a day it would repeat).
 */
function HuntRow({
  hunt,
  locale,
  showDate,
  onRemove,
}: {
  hunt: SavedHunt
  locale: string
  showDate?: boolean
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const at = new Date(hunt.at)
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]">
      <span className={`shrink-0 tabular-nums text-fg-mute ${showDate ? 'w-24' : 'w-10'}`}>
        {showDate && (
          <span className="mr-1 font-semibold capitalize text-fg-dim">
            {at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
          </span>
        )}
        {at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="min-w-0 flex-1 truncate capitalize text-fg-dim">
        {hunt.label || t('map.hlSession')}
        {hunt.kills > 0 && <span className="text-fg-mute"> · {hunt.kills.toLocaleString()} kills</span>}
      </span>
      <span className="w-12 shrink-0 text-right tabular-nums text-fg-mute">{hunt.hours.toFixed(1)}h</span>
      <span className="w-14 shrink-0 text-right tabular-nums text-fg-mute" title={t('map.hlWaste')}>
        −{compact(waste(hunt))}
      </span>
      <span
        className={`w-16 shrink-0 text-right font-bold tabular-nums ${hunt.profit >= 0 ? 'text-canon' : 'text-accent'}`}
      >
        {signed(hunt.profit)}
      </span>
      <button
        onClick={() => onRemove(hunt.id)}
        title={t('map.hlDelete')}
        aria-label={t('map.hlDelete')}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg-mute transition hover:bg-accent/10 hover:text-accent"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/**
 * One figure of a rollup card. `sub` carries the per-hour rate *inside* the
 * total's own tile: as six equal siblings, "+1.88M Profit" and "+687.6K
 * Profit/h" read as two competing headlines and people take the wrong one for
 * the profit. Nested, the total is unmistakably the number and the rate is
 * plainly its derivative.
 */
function Stat({
  label,
  value,
  sub,
  tone,
  hero,
  title,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad'
  hero?: boolean
  title?: string
}) {
  const color = tone === 'good' ? 'text-canon' : tone === 'bad' ? 'text-accent' : 'text-fg'
  return (
    <div
      title={title}
      className={`min-w-0 rounded-lg border px-2 py-1.5 text-center ${hero ? 'border-line-2 bg-surface-2/40' : 'border-line bg-bg-2'}`}
    >
      <div className={`truncate font-bold leading-tight tabular-nums ${hero ? 'text-xl' : 'text-base'} ${color}`}>
        {value}
      </div>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-fg-mute">{label}</div>
      {sub && <div className="truncate text-[11px] font-semibold tabular-nums text-fg-dim">{sub}</div>}
    </div>
  )
}

const perHour = (b: Roll) => (b.hours > 0 ? b.profit / b.hours : null)

/**
 * Every rollup, in two rows: how many sessions and how long on top, then the
 * money as the equation people actually reason with —
 *
 *     total (everything looted) − waste (everything it cost) = profit
 *
 * The operators live in the labels so the three tiles read left to right as one
 * sentence. Total is never stored: profit + waste *is* the gross loot, because
 * profit = balance − extras and waste = supplies + extras.
 */
function RollStats({ roll }: { roll: Roll }) {
  const { t } = useTranslation()
  const ph = perHour(roll)
  const gross = roll.profit + roll.waste
  /** Wrap an already-formatted figure as this rollup's per-hour sub-line. */
  const rate = (gp: string) => (roll.hours > 0 ? t('map.hlPerHourSub', { gp }) : undefined)
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label={t('map.hlHunts')} value={String(roll.hunts)} />
        <Stat label={t('map.hlHours')} value={`${roll.hours.toFixed(1)}h`} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <Stat
          label={t('map.hlTotal')}
          title={t('map.hlTotalHint')}
          value={compact(gross)}
          sub={roll.hours > 0 ? rate(compact(gross / roll.hours)) : undefined}
        />
        <Stat
          label={`− ${t('map.hlWaste')}`}
          value={`−${compact(roll.waste)}`}
          sub={roll.hours > 0 ? rate(`−${compact(roll.waste / roll.hours)}`) : undefined}
          tone="bad"
        />
        <Stat
          hero
          label={`= ${t('map.hlProfit')}`}
          value={signed(roll.profit)}
          sub={ph != null ? rate(signed(ph)) : undefined}
          tone={roll.profit >= 0 ? 'good' : 'bad'}
        />
      </div>
    </>
  )
}

/**
 * The three rollups — 30 days (with its daily bars), the month and the year
 * (with its twelve). Rendered identically whether the numbers come from the
 * local log or from a shared link, which is the whole point of routing both
 * through one `Summary`.
 */
function Rollups({
  summary,
  locale,
  chart,
  children,
}: {
  summary: Summary
  locale: string
  chart: ChartTheme
  /** Slotted under the daily chart — the local tab puts its day list here. */
  children?: React.ReactNode
}) {
  const { t } = useTranslation()

  // Zero-fill the 30-day window: an empty day is information too, and gaps
  // would make the chart lie about the cadence.
  const days = useMemo(() => {
    const found = new Map(summary.days.map((d) => [d.day, d]))
    const out: { day: string; short: string; hunts: number; hours: number; profit: number; waste: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const key = shiftDay(summary.gen, i)
      const d = found.get(key)
      out.push({
        day: key,
        short: dayDate(key).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
        hunts: d?.hunts ?? 0,
        hours: d?.hours ?? 0,
        profit: d?.profit ?? 0,
        waste: d?.waste ?? 0,
      })
    }
    return out
  }, [summary, locale])

  const months = useMemo(() => {
    const found = new Map(summary.months.map((m) => [m.key, m]))
    const out: { key: string; short: string; hunts: number; profit: number }[] = []
    for (let m = 0; m < 12; m++) {
      const key = `${summary.yearKey}-${String(m + 1).padStart(2, '0')}`
      const hit = found.get(key)
      out.push({
        key,
        short: new Date(Number(summary.yearKey), m, 1).toLocaleDateString(locale, { month: 'short' }),
        hunts: hit?.hunts ?? 0,
        profit: hit?.profit ?? 0,
      })
    }
    return out
  }, [summary, locale])

  return (
    <>
      <RollStats roll={summary.d30} />

      {/* One bar per day: gilt when the day earned, red when it burned gold. */}
      <div className="mt-2">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <XAxis dataKey="short" interval={4} tick={{ fill: chart.tick, fontSize: 10 }} stroke={chart.axis} />
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

      {children}

      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg-2 p-2.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">
            {t('map.hlMonth')}{' '}
            <span className="capitalize text-fg-mute">
              {dayDate(`${summary.monthKey}-01`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
          </div>
          <RollStats roll={summary.month} />
          <p className="mt-1.5 truncate text-[11px] text-fg-mute">
            {summary.best
              ? t('map.hlBestDay', {
                  day: dayDate(summary.best.day).toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
                  gp: signed(summary.best.profit),
                })
              : t('map.hlNoMonth')}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-bg-2 p-2.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">
            {t('map.hlYear')} <span className="text-fg-mute">{summary.yearKey}</span>
          </div>
          <RollStats roll={summary.year} />
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
    </>
  )
}

/**
 * The saved-hunt history: what the player actually earned, day by day.
 *
 * Two modes. Normally it renders the local log — the 30-day chart, an
 * expandable day list, the month and year rollups, and every saved hunt. When
 * `shared` is set the card instead shows someone else's rollups, decoded
 * straight out of the link that opened the page.
 */
export default function HuntLog({
  hunts,
  onRemove,
  onClear,
  shared,
  onExitShared,
}: {
  hunts: SavedHunt[]
  onRemove: (id: string) => void
  onClear: () => void
  /** Rollups decoded from a share link, shown instead of the local log. */
  shared?: Summary | null
  onExitShared?: () => void
}) {
  const { t, i18n } = useTranslation()
  const chart = useChartTheme()
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  // Everything the local tab shows, in the same shape a share link carries.
  const mine = useMemo((): Summary => {
    const now = new Date()
    const gen = dayKey(now)
    const first = shiftDay(gen, 29)
    const monthKey = gen.slice(0, 7)
    const yearKey = gen.slice(0, 4)

    const days = [...byDay.entries()]
      .filter(([day]) => day >= first && day <= gen)
      .map(([day, list]) => {
        const b = total(list)
        return { day, hunts: b.hunts, hours: b.hours, profit: b.profit, waste: b.waste }
      })

    const months = [...byDay.entries()]
      .filter(([day]) => day.startsWith(yearKey))
      .reduce((acc, [day, list]) => {
        const key = day.slice(0, 7)
        const b = total(list)
        const hit = acc.find((m) => m.key === key)
        if (hit) {
          hit.hunts += b.hunts
          hit.hours += b.hours
          hit.profit += b.profit
          hit.waste += b.waste
        } else {
          acc.push({ key, hunts: b.hunts, hours: b.hours, profit: b.profit, waste: b.waste })
        }
        return acc
      }, [] as Summary['months'])

    const roll = (list: SavedHunt[]): Roll => {
      const b = total(list)
      return { hunts: b.hunts, hours: b.hours, profit: b.profit, waste: b.waste }
    }

    // Best day of the month — the one worth bragging about.
    let best: Summary['best'] = null
    for (const [day, list] of byDay) {
      if (!day.startsWith(monthKey)) continue
      const p = total(list).profit
      if (!best || p > best.profit) best = { day, profit: p }
    }

    return {
      gen,
      d30: roll(hunts.filter((h) => h.day >= first && h.day <= gen)),
      month: roll(hunts.filter((h) => h.day.startsWith(monthKey))),
      monthKey,
      year: roll(hunts.filter((h) => h.day.startsWith(yearKey))),
      yearKey,
      best,
      days,
      months,
    }
  }, [hunts, byDay])

  // Only days that actually hold sessions make the list — an empty row is noise
  // once the chart above already shows the gap.
  const dayRows = useMemo(
    () =>
      [...mine.days]
        .sort((a, b) => b.day.localeCompare(a.day))
        .map((d) => ({ ...d, short: dayDate(d.day).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })),
    [mine.days, locale],
  )

  /**
   * Share = a link that carries the rollups inside it. There is no account and
   * no server to store them on, so the summary itself is packed into the URL
   * and unpacked by whoever opens it.
   */
  const onShare = async () => {
    const url = shareUrl(mine)
    const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    try {
      if (mobile && navigator.share) {
        await navigator.share({ title: t('map.hlShareTitle'), url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* denied clipboard / dismissed share sheet — nothing to recover from */
    }
  }

  // --- someone else's summary, straight from the link ------------------------
  if (shared) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 rounded-xl border-2 border-accent bg-accent/10 px-2.5 py-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-accent">{t('map.hlSharedTitle')}</div>
            <div className="truncate text-[11px] text-fg-mute">
              {t('map.hlSharedOn', {
                day: dayDate(shared.gen).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
              })}
            </div>
          </div>
          {onExitShared && (
            <button
              onClick={onExitShared}
              className="shrink-0 rounded-md border border-accent px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent transition hover:bg-accent hover:text-bg-2"
            >
              {t('map.hlSharedExit')}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-line bg-bg-2 p-2.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hl30d')}</div>
          <Rollups summary={shared} locale={locale} chart={chart} />
        </div>
      </div>
    )
  }

  if (hunts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-bg-2 px-4 py-8 text-center">
        <p className="text-sm text-fg-dim">{t('map.hlEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* --- last 30 days + month/year rollups -------------------------------- */}
      <div className="rounded-xl border border-line bg-bg-2 p-2.5">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hl30d')}</span>
          {/* A link that carries the rollups inside it — no backend involved. */}
          <button
            onClick={onShare}
            title={t('map.hlShareHint')}
            className={`ml-auto flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${
              copied ? 'border-canon text-canon' : 'border-line-2 text-fg-mute hover:border-accent hover:text-accent'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {copied ? (
                <path d="M20 6 9 17l-5-5" />
              ) : (
                <>
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
                </>
              )}
            </svg>
            {copied ? t('map.hlCopied') : t('map.hlShare')}
          </button>
          <button
            onClick={() => {
              if (window.confirm(t('map.hlClearConfirm'))) onClear()
            }}
            className="text-[10px] font-bold uppercase tracking-wide text-fg-mute transition hover:text-accent"
          >
            {t('map.hlClear')}
          </button>
        </div>

        <Rollups summary={mine} locale={locale} chart={chart}>
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
                    <span className="ml-auto shrink-0 text-right text-[11px] tabular-nums text-fg-mute" title={t('map.hlWaste')}>
                      −{compact(d.waste)}
                    </span>
                    <span
                      className={`w-20 shrink-0 text-right text-xs font-bold tabular-nums ${d.profit >= 0 ? 'text-canon' : 'text-accent'}`}
                    >
                      {signed(d.profit)}
                    </span>
                  </button>

                  {open && (
                    <div className="mb-1 ml-5 flex flex-col gap-0.5 border-l border-line pl-2">
                      {(byDay.get(d.day) ?? []).map((h) => (
                        <HuntRow key={h.id} hunt={h} locale={locale} onRemove={onRemove} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Rollups>
      </div>

      {/* --- every saved hunt ------------------------------------------------ */}
      {/* The day list above only reaches 30 days back and hides sessions behind
          a drill-down. This is the flat, complete register: every hunt ever
          saved, newest first, each with its own × — no hunting for the day. */}
      <div className="rounded-xl border border-line bg-bg-2 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hlAll')}</span>
          <span className="text-[11px] font-semibold text-fg-mute">{t('map.hlHuntsN', { count: hunts.length })}</span>
        </div>
        <div className="scroll-atlas flex max-h-[16rem] flex-col gap-0.5 overflow-y-auto pr-1">
          {hunts.map((h) => (
            <HuntRow key={h.id} hunt={h} locale={locale} showDate onRemove={onRemove} />
          ))}
        </div>
      </div>
    </div>
  )
}
