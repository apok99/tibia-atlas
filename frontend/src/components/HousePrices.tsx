import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { compact } from '../lib/format'
import { chartTooltipStyle, useChartTheme } from '../hooks/useChartTheme'

/**
 * House auction prices over time.
 *
 * TibiaData only ever exposes the CURRENT bid, and clears it the moment a house
 * changes hands — so what a house sold for is not something you can look up
 * anywhere. tibia:etl-houses now appends every bid change and records the last
 * bid before a house flips to `rented`, which is the price actually paid. These
 * two charts are that history:
 *
 *  - the market index: median price paid per day, filterable by town;
 *  - one house's own bid trail while its auction runs.
 *
 * Both start empty on a fresh install — the series can only grow forward from the
 * first ETL run, there is nothing to back-fill from.
 */

type PricePoint = { day: string; sales: number; median: number; low: number; high: number }
type BidPoint = { bid: number; time_left: string | null; at: string }
type SalePoint = { price: number; at: string }

const dayLabel = (d: string) => d.slice(5, 10)

/** The market index: what houses actually sold for, by day. */
export function HousePriceIndex({ world }: { world?: string }) {
  const { t } = useTranslation()
  const chart = useChartTheme()
  const [town, setTown] = useState('')

  const { data: towns } = useQuery({
    queryKey: ['house-price-towns'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await api.get<{ data: string[] }>('/houses/prices/towns')).data.data,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['house-prices', world ?? '', town],
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      (
        await api.get<{ points: PricePoint[] }>('/houses/prices', {
          params: { days: 90, ...(world ? { world } : {}), ...(town ? { town } : {}) },
        })
      ).data.points,
  })

  const points = useMemo(() => data ?? [], [data])
  const totalSales = useMemo(() => points.reduce((n, p) => n + p.sales, 0), [points])

  return (
    <div className="mt-3 rounded-lg border border-line bg-bg p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-fg-mute">
          {t('map.priceIndexTitle')}
        </span>
        <select
          value={town}
          onChange={(e) => setTown(e.target.value)}
          aria-label={t('map.priceIndexTown')}
          className="ml-auto rounded-md border border-line-2 bg-bg-2 px-1.5 py-1 text-[11px] font-semibold text-fg"
        >
          <option value="">{t('map.priceIndexAllTowns')}</option>
          {(towns ?? []).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="py-3 text-center text-xs text-fg-dim">{t('common.loading')}</p>
      ) : points.length === 0 ? (
        // Not an error: the history simply has not accumulated yet.
        <p className="py-3 text-center text-xs leading-relaxed text-fg-mute">
          {t('map.priceIndexEmpty')}
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
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
                contentStyle={chartTooltipStyle(chart)}
                labelFormatter={(d) => String(d).slice(0, 10)}
                formatter={(v, n) => [`${Number(v).toLocaleString()} gp`, n === 'median' ? t('map.priceMedian') : String(n)]}
              />
              <Area
                type="monotone"
                dataKey="median"
                stroke={chart.accent}
                fill={chart.accent}
                fillOpacity={0.18}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="mt-1 text-center text-[10px] text-fg-mute">
            {t('map.priceIndexFoot', { count: totalSales })}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * One house's own price history: the live bid trail while an auction runs, plus
 * every past auction it closed at. A rented house has no bids to draw, but it
 * still has the sales behind it — which is the number people actually want.
 */
export function HouseBidChart({ world, houseId }: { world: string; houseId: number }) {
  const { t } = useTranslation()
  const chart = useChartTheme()

  const { data, isLoading } = useQuery({
    queryKey: ['house-bids', world, houseId],
    staleTime: 60 * 1000,
    queryFn: async () =>
      (
        await api.get<{ bids: BidPoint[]; sales: SalePoint[] }>(
          `/houses/${encodeURIComponent(world)}/${houseId}/bids`,
        )
      ).data,
  })

  const points = (data?.bids ?? []).map((b) => ({ ...b, at: b.at.slice(5, 16).replace('T', ' ') }))
  const sales = data?.sales ?? []

  if (isLoading) return <p className="py-2 text-center text-[11px] text-fg-dim">{t('common.loading')}</p>
  if (!points.length && !sales.length)
    return <p className="py-2 text-center text-[11px] text-fg-mute">{t('map.bidChartEmpty')}</p>

  return (
    <>
      {points.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="at" tick={{ fill: chart.tick, fontSize: 9 }} stroke={chart.axis} />
              <YAxis
                tickFormatter={(v) => compact(Number(v))}
                tick={{ fill: chart.tick, fontSize: 9 }}
                stroke={chart.axis}
                width={44}
              />
              <Tooltip
                contentStyle={chartTooltipStyle(chart)}
                formatter={(v) => [`${Number(v).toLocaleString()} gp`, t('map.priceBid')]}
              />
              {/* A step line: a bid holds its value until someone outbids it. */}
              <Line type="stepAfter" dataKey="bid" stroke={chart.gold} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-0.5 text-center text-[10px] text-fg-mute">
            {t('map.bidChartFoot', { count: points.length })}
          </p>
        </>
      )}

      {sales.length > 0 && (
        <div className={points.length > 0 ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">
            {t('map.saleHistoryTitle')}
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {[...sales].reverse().map((s, i) => (
              <li key={`${s.at}-${i}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-fg-dim">{s.at ? s.at.slice(0, 10) : '—'}</span>
                <span className="font-semibold text-fg">{s.price.toLocaleString()} gp</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
