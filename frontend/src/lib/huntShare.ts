/**
 * Shareable hunt summaries — the whole payload travels inside the link.
 *
 * The hunt log lives in localStorage and there is no account system, so a
 * "share" link cannot point at a record on a server: there is no record. The
 * summary itself is therefore packed into the URL (base64url JSON) and unpacked
 * by whoever opens it. Small enough to paste anywhere, and nothing is uploaded.
 *
 * Only the rollups travel — totals, the best day and the 30-day series. Never
 * the individual sessions.
 */

/** One rolled-up period: sessions, hours, profit and waste. */
export type Roll = { hunts: number; hours: number; profit: number; waste: number }

/** One calendar day of the 30-day window. */
export type DayPoint = { day: string; hunts: number; hours: number; profit: number; waste: number }

export type Summary = {
  /** Local YYYY-MM-DD the link was generated on — the 30-day window's anchor. */
  gen: string
  d30: Roll
  month: Roll
  /** YYYY-MM, formatted into a month name by the reader's own locale. */
  monthKey: string
  year: Roll
  yearKey: string
  best: { day: string; profit: number } | null
  /** Only days that hold sessions; the empty ones are implied by the window. */
  days: DayPoint[]
  /** Months of `yearKey` that hold sessions, for the year's twelve bars. */
  months: MonthPoint[]
}

/** One month of the year chart. */
export type MonthPoint = { key: string; hunts: number; hours: number; profit: number; waste: number }

/** Query parameter carrying the payload. */
export const SHARE_PARAM = 'hunt'

const round2 = (n: number) => Math.round(n * 100) / 100
const int = (n: number) => Math.round(n)

const packRoll = (r: Roll) => [r.hunts, round2(r.hours), int(r.profit), int(r.waste)]
const unpackRoll = (a: unknown): Roll => {
  const v = Array.isArray(a) ? a : []
  return { hunts: +v[0] || 0, hours: +v[1] || 0, profit: +v[2] || 0, waste: +v[3] || 0 }
}

/** YYYY-MM-DD → local Date at midday (midday dodges any DST edge). */
function fromDayKey(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], 12)
}

const toDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Whole days between two day keys (a - b), or null if either is malformed. */
function dayDiff(a: string, b: string): number | null {
  const da = fromDayKey(a)
  const db = fromDayKey(b)
  if (!da || !db) return null
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** Shift a day key by n days back. */
export function shiftDay(day: string, back: number): string {
  const d = fromDayKey(day)
  if (!d) return day
  d.setDate(d.getDate() - back)
  return toDayKey(d)
}

// base64url over UTF-8, so the payload survives being pasted into any chat app.
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Pack a summary into the opaque string that rides in the URL. */
export function encodeSummary(s: Summary): string {
  const payload = {
    v: 1,
    g: s.gen,
    a: packRoll(s.d30),
    m: packRoll(s.month),
    mk: s.monthKey,
    y: packRoll(s.year),
    yk: s.yearKey,
    b: s.best ? [dayDiff(s.gen, s.best.day) ?? 0, int(s.best.profit)] : null,
    // Days as an offset from `gen` rather than full dates — same information,
    // a third of the characters.
    d: s.days.map((p) => [dayDiff(s.gen, p.day) ?? 0, p.hunts, round2(p.hours), int(p.profit), int(p.waste)]),
    // Months as 1-12 within `yk`, again only the ones that hold sessions.
    ms: s.months.map((p) => [Number(p.key.slice(5, 7)), p.hunts, round2(p.hours), int(p.profit), int(p.waste)]),
  }
  return b64urlEncode(JSON.stringify(payload))
}

/** Unpack a payload. Returns null for anything that is not a valid v1 summary. */
export function decodeSummary(raw: string): Summary | null {
  try {
    const p = JSON.parse(b64urlDecode(raw))
    if (!p || p.v !== 1 || typeof p.g !== 'string' || !fromDayKey(p.g)) return null
    const days: DayPoint[] = Array.isArray(p.d)
      ? p.d
          .filter((e: unknown) => Array.isArray(e))
          .map((e: number[]) => ({
            day: shiftDay(p.g, -(+e[0] || 0)),
            hunts: +e[1] || 0,
            hours: +e[2] || 0,
            profit: +e[3] || 0,
            waste: +e[4] || 0,
          }))
      : []
    const yearKey = typeof p.yk === 'string' ? p.yk : p.g.slice(0, 4)
    const months: MonthPoint[] = Array.isArray(p.ms)
      ? p.ms
          .filter((e: unknown) => Array.isArray(e))
          .map((e: number[]) => ({
            key: `${yearKey}-${String(+e[0] || 1).padStart(2, '0')}`,
            hunts: +e[1] || 0,
            hours: +e[2] || 0,
            profit: +e[3] || 0,
            waste: +e[4] || 0,
          }))
      : []
    return {
      gen: p.g,
      d30: unpackRoll(p.a),
      month: unpackRoll(p.m),
      monthKey: typeof p.mk === 'string' ? p.mk : p.g.slice(0, 7),
      year: unpackRoll(p.y),
      yearKey,
      best: Array.isArray(p.b) ? { day: shiftDay(p.g, -(+p.b[0] || 0)), profit: +p.b[1] || 0 } : null,
      days,
      months,
    }
  } catch {
    /* truncated, hand-edited or from a future version — treat as no summary */
    return null
  }
}

/** The full link to hand out. */
export function shareUrl(s: Summary): string {
  return `${window.location.origin}/map?${SHARE_PARAM}=${encodeSummary(s)}`
}

/** Is the current URL carrying a shared summary? Cheap enough to call anywhere. */
export function hasSharedSummary(): boolean {
  return new URLSearchParams(window.location.search).has(SHARE_PARAM)
}

/** The shared summary in the current URL, if any. */
export function readSharedSummary(): Summary | null {
  const raw = new URLSearchParams(window.location.search).get(SHARE_PARAM)
  return raw ? decodeSummary(raw) : null
}

/** Drop the payload from the address bar without reloading or adding history. */
export function clearSharedSummary(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(SHARE_PARAM)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}
