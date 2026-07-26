import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SearchResult } from '../types'
import { compact } from '../lib/format'

// Items Cledwyn (Feyrist) recharges for silver tokens — straight from the OT
// server data (npc/cledwyn.lua + items.xml): tokens per recharge and how long
// one recharge lasts while worn. Grouped cheap-first so the list reads sane.
const RECHARGEABLES = [
  { id: 'sleep-shawl', name: 'Sleep shawl', tokens: 2, hours: 1 },
  { id: 'blister-ring', name: 'Blister ring', tokens: 2, hours: 1 },
  { id: 'pendulet', name: 'Pendulet', tokens: 2, hours: 2 },
  { id: 'theurgic-amulet', name: 'Theurgic amulet', tokens: 2, hours: 2 },
  { id: 'ring-of-souls', name: 'Ring of souls', tokens: 2, hours: 2 },
  { id: 'turtle-amulet', name: 'Turtle amulet', tokens: 2, hours: 2 },
  { id: 'merudri-brooch', name: 'Merudri brooch', tokens: 2, hours: 2 },
  { id: 'spiritthorn-ring', name: 'Spiritthorn ring', tokens: 5, hours: 3 },
  { id: 'alicorn-ring', name: 'Alicorn ring', tokens: 5, hours: 3 },
  { id: 'arcanomancer-sigil', name: 'Arcanomancer sigil', tokens: 5, hours: 3 },
  { id: 'arboreal-ring', name: 'Arboreal ring', tokens: 5, hours: 3 },
  { id: 'ethereal-ring', name: 'Ethereal ring', tokens: 5, hours: 3 },
] as const

// Tier 3 ("Powerful") imbuement defaults: ~500k of materials + fees, 20h of
// hunting per application. Both are editable in the panel.
const IMBUE_DEFAULT_COST = 500_000
const IMBUE_DURATION_H = 20
const SILVER_TOKEN_DEFAULT = 50_000

// Per-session extras the analyzer never sees: gold spent removing charms to swap
// hunts, and paying to reroll prey. Each is a unit price × how many you did.
const CHARM_REMOVAL_DEFAULT = 35_000
const PREY_REROLL_DEFAULT = 75_000

const STORE_KEY = 'atlas:map:huntProfit'

type Tally = { name: string; count: number }

type Parsed = {
  hours: number | null
  loot: number | null
  supplies: number | null
  balance: number | null
  xpGain: number | null
  xpPerHour: number | null
  damage: number | null
  damagePerHour: number | null
  healing: number | null
  healingPerHour: number | null
  kills: Tally[]
  items: Tally[]
}

// "667x candy horror 72x honey elemental …" → tallies. Works for one-per-line
// pastes too (whitespace is normalised first). Names never start with a digit,
// so the next "NNNx " marks the end of the previous name.
function parseTallies(section: string): Tally[] {
  const out: Tally[] = []
  const flat = section.replace(/\s+/g, ' ').trim()
  const re = /(\d+)x\s+(.+?)(?=\s+\d+x\s|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(flat))) {
    const count = parseInt(m[1], 10)
    const name = m[2].replace(/^(?:a|an)\s+/i, '').trim()
    if (name && Number.isFinite(count)) out.push({ name, count })
  }
  return out
}

// Pull the numbers out of a pasted (party) hunt analyzer. Per-player sections
// repeat "Loot:/Supplies:/Balance:" below the totals, so the FIRST match of
// each label is always the session total. Numbers keep their thousand
// separators ("1,234,567") and Balance may be negative. The paste often
// arrives as ONE long line (the client strips newlines), so labels are matched
// anywhere in the text — each number simply ends at the next space or word.
// Word boundaries keep "Looted Items:" / "Loot Type:" from matching "Loot:",
// and the lookbehinds keep "Raw XP Gain"/"Raw XP/h" from stealing the boosted
// "XP Gain"/"XP/h" values.
function parseAnalyzer(text: string): Parsed {
  const num = (re: RegExp): number | null => {
    const m = re.exec(text)
    if (!m) return null
    const neg = m[1].trim().startsWith('-')
    const v = parseInt(m[1].replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(v)) return null
    return neg ? -v : v
  }
  let hours: number | null = null
  const s = /\bSession:\s*(\d+):(\d{2})\s*h/i.exec(text)
  if (s) {
    const h = parseInt(s[1], 10) + parseInt(s[2], 10) / 60
    if (h > 0) hours = h
  }

  // List sections: "Killed Monsters: …" runs until "Looted Items: …".
  const km = /Killed Monsters:/i.exec(text)
  const li = /Looted Items:/i.exec(text)
  const kills = km ? parseTallies(text.slice(km.index + km[0].length, li ? li.index : undefined)) : []
  const items = li ? parseTallies(text.slice(li.index + li[0].length)) : []

  return {
    hours,
    loot: num(/\bLoot:\s*(-?[\d.,]+)/i),
    supplies: num(/\bSupplies:\s*(-?[\d.,]+)/i),
    balance: num(/\bBalance:\s*(-?[\d.,]+)/i),
    xpGain: num(/(?<!Raw )\bXP Gain:\s*(-?[\d.,]+)/i),
    xpPerHour: num(/(?<!Raw )\bXP\/h:\s*(-?[\d.,]+)/i),
    damage: num(/\bDamage:\s*(-?[\d.,]+)/i),
    damagePerHour: num(/\bDamage\/h:\s*(-?[\d.,]+)/i),
    healing: num(/\bHealing:\s*(-?[\d.,]+)/i),
    healingPerHour: num(/\bHealing\/h:\s*(-?[\d.,]+)/i),
    kills,
    items,
  }
}

// Loose coins in the loot list, folded to raw gold.
const COIN_VALUE: Record<string, number> = { 'gold coin': 1, 'platinum coin': 100, 'crystal coin': 10_000 }

// Resolve analyzer names (creatures or items) against the site's own /search,
// so each report row gets its sprite and a link to its page. One tiny cached
// request per unique name; only an exact name match of the right type counts —
// a wrong link is worse than no link.
function useResolvedRows(names: string[], type: 'creature' | 'item') {
  const results = useQueries({
    queries: names.map((n) => ({
      queryKey: ['hp-resolve', type, n.toLowerCase()],
      staleTime: 24 * 60 * 60 * 1000,
      enabled: n.trim().length >= 2,
      queryFn: async (): Promise<SearchResult | null> => {
        const { data } = await api.get<{ data: SearchResult[] }>('/search', { params: { q: n } })
        const lower = n.trim().toLowerCase()
        return data.data.find((r) => r.type === type && (r.name ?? '').toLowerCase() === lower) ?? null
      },
    })),
  })
  const map: Record<string, SearchResult | null> = {}
  names.forEach((n, i) => {
    map[n.toLowerCase()] = results[i]?.data ?? null
  })
  return map
}

type Config = {
  imbueCount: number
  imbueCost: number
  silverPrice: number
  charmCount: number
  charmCost: number
  preyCount: number
  preyCost: number
  items: string[]
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      return {
        imbueCount: Number.isFinite(c.imbueCount) ? c.imbueCount : 3,
        imbueCost: Number.isFinite(c.imbueCost) ? c.imbueCost : IMBUE_DEFAULT_COST,
        silverPrice: Number.isFinite(c.silverPrice) ? c.silverPrice : SILVER_TOKEN_DEFAULT,
        charmCount: Number.isFinite(c.charmCount) ? c.charmCount : 1,
        charmCost: Number.isFinite(c.charmCost) ? c.charmCost : CHARM_REMOVAL_DEFAULT,
        preyCount: Number.isFinite(c.preyCount) ? c.preyCount : 1,
        preyCost: Number.isFinite(c.preyCost) ? c.preyCost : PREY_REROLL_DEFAULT,
        items: Array.isArray(c.items) ? c.items.filter((i: unknown) => typeof i === 'string') : [],
      }
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return {
    imbueCount: 3,
    imbueCost: IMBUE_DEFAULT_COST,
    silverPrice: SILVER_TOKEN_DEFAULT,
    charmCount: 1,
    charmCost: CHARM_REMOVAL_DEFAULT,
    preyCount: 1,
    preyCost: PREY_REROLL_DEFAULT,
    items: [],
  }
}

const gp = (n: number) => Math.round(n).toLocaleString()

// Small labelled number input used across the panel.
function NumField({
  label,
  value,
  onChange,
  suffix,
  min,
  step,
  wide,
  w,
  big,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
  min?: number
  step?: number
  wide?: boolean
  w?: string
  big?: boolean
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'flex-1' : w ?? 'w-14'}`}>
      <span className="truncate text-[10px] font-bold uppercase tracking-wide text-fg-dim">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min ?? 0}
          step={step ?? 1}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full min-w-0 rounded-lg border border-line bg-bg-2 px-2 font-semibold outline-none transition focus:border-accent ${big ? 'h-10 text-lg tabular-nums' : 'h-8 text-sm'}`}
        />
        {suffix && <span className="shrink-0 text-[11px] font-semibold text-fg-mute">{suffix}</span>}
      </span>
    </label>
  )
}

// Hero-number tile for the report's headline stats.
function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-canon' : tone === 'bad' ? 'text-accent' : 'text-fg'
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-2 py-1.5 text-center">
      <div className={`text-base font-bold leading-tight ${color}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-fg-mute">{label}</div>
    </div>
  )
}

// One horizontal bar of a single-hue magnitude chart: sprite, label, thin
// track, count (+ share when a total is given) directly labelled — identity
// lives in the row text, never in the color. With a resolved entry the whole
// row links to the creature/item page.
function BarRow({
  name,
  count,
  max,
  total,
  color,
  entry,
}: {
  name: string
  count: number
  max: number
  total: number
  color: string
  entry?: SearchResult | null
}) {
  const share = total > 0 ? Math.round((count / total) * 100) : null
  const body = (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center">
        {entry?.image ? (
          <img src={entry.image} alt="" loading="lazy" className="max-h-7 max-w-7 object-contain" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
        )}
      </span>
      <span className={`w-32 shrink-0 truncate text-xs capitalize ${entry ? 'text-fg underline decoration-line-2 underline-offset-2' : 'text-fg-dim'}`}>
        {name}
      </span>
      <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-line/40">
        <span
          className="absolute inset-y-0 left-0 rounded-r-[4px]"
          style={{ width: `${Math.max(2, (count / max) * 100)}%`, background: color }}
        />
      </span>
      <span className="w-24 shrink-0 text-right text-xs font-semibold text-fg">
        {count.toLocaleString()}
        {share != null && <span className="font-normal text-fg-mute"> · {share}%</span>}
      </span>
    </>
  )
  const tip = share != null ? `${count.toLocaleString()} · ${share}%` : count.toLocaleString()
  return entry ? (
    <Link
      to={entry.type === 'item' ? `/items/${entry.slug}` : `/entry/${entry.slug}`}
      title={tip}
      className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 transition hover:bg-surface-2/60"
    >
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-2 px-0 py-0.5" title={tip}>
      {body}
    </div>
  )
}

// Waterfall from the analyzer's loot down to the real profit. Floating bars on
// a shared scale; sign is triple-coded (position, +/− label, green/red).
function Waterfall({ steps, realLabel }: { steps: { label: string; value: number }[]; realLabel: string }) {
  const total = steps.reduce((s, x) => s + x.value, 0)
  const cums: { label: string; from: number; to: number; value: number; final: boolean }[] = []
  let run = 0
  for (const s of steps) {
    cums.push({ label: s.label, from: run, to: run + s.value, value: s.value, final: false })
    run += s.value
  }
  cums.push({ label: realLabel, from: 0, to: total, value: total, final: true })
  const top = Math.max(...cums.map((c) => Math.max(c.from, c.to, 0)))
  const bottom = Math.min(...cums.map((c) => Math.min(c.from, c.to, 0)))
  const span = Math.max(1, top - bottom)
  // Bars top out at 85% so the value labels above them stay inside the chart.
  const pct = (v: number) => ((v - bottom) / span) * 85
  return (
    <div className="flex items-stretch gap-1.5">
      {cums.map((c) => {
        const hi = Math.max(c.from, c.to)
        const lo = Math.min(c.from, c.to)
        const good = c.value >= 0
        return (
          <div key={c.label} className="flex min-w-0 flex-1 flex-col" title={`${c.label}: ${gp(c.value)}`}>
            <div className="relative h-24">
              <span
                className="absolute inset-x-0 rounded-[4px]"
                style={{
                  bottom: `${pct(lo)}%`,
                  height: `${Math.max(2, pct(hi) - pct(lo))}%`,
                  background: good ? 'var(--color-canon)' : 'var(--color-accent)',
                  opacity: c.final ? 1 : 0.85,
                }}
              />
              <span
                className="absolute inset-x-0 text-center text-[10px] font-bold text-fg"
                style={{ bottom: `calc(${pct(hi)}% + 2px)` }}
              >
                {(good ? '+' : '−') + compact(Math.abs(c.value))}
              </span>
            </div>
            <div className="mt-1 truncate text-center text-[10px] font-bold uppercase tracking-wide text-fg-mute">
              {c.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function HuntProfitTool({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()

  const [text, setText] = useState('')
  const [hoursDraft, setHoursDraft] = useState('') // manual override of the session length
  const [cfg, setCfg] = useState<Config>(loadConfig)
  const [collapsed, setCollapsed] = useState(false) // hide the inputs, keep the verdict + charts
  const [calculated, setCalculated] = useState(false) // gate: no report until "Calcular" is hit

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
    } catch {
      /* storage full/blocked — the tool still works, it just forgets */
    }
  }, [cfg])

  // Draggable card: null = docked (centered above the hotbar); a point once the
  // user grabs the header. Pointer capture keeps the drag alive when the cursor
  // outruns the handle; position clamps to the viewport.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragOff = useRef<{ dx: number; dy: number } | null>(null)
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    dragOff.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const off = dragOff.current
    const card = cardRef.current
    if (!off || !card) return
    const x = Math.min(Math.max(8, e.clientX - off.dx), window.innerWidth - card.offsetWidth - 8)
    const y = Math.min(Math.max(8, e.clientY - off.dy), window.innerHeight - 56)
    setPos({ x, y })
  }
  const endDrag = () => {
    dragOff.current = null
  }

  const parsed = useMemo(() => parseAnalyzer(text), [text])

  // A fresh paste invalidates the previous result: hide the report (and reopen
  // the inputs) until the user hits "Calcular" again.
  useEffect(() => {
    setCalculated(false)
    setCollapsed(false)
  }, [text])

  // The analyzer's session length auto-fills the hours field but stays editable
  // (a fixed 20:00h party session, someone hunting less than a full recharge…).
  useEffect(() => {
    if (parsed.hours != null) setHoursDraft((parsed.hours * 60) % 60 === 0 ? String(parsed.hours) : parsed.hours.toFixed(2))
  }, [parsed.hours])

  const hours = (() => {
    const h = parseFloat(hoursDraft.replace(',', '.'))
    return Number.isFinite(h) && h > 0 ? h : null
  })()

  const balance = parsed.balance ?? (parsed.loot != null && parsed.supplies != null ? parsed.loot - parsed.supplies : null)

  const imbueCount = Math.max(0, Math.round(Number(cfg.imbueCount) || 0))
  const imbueCost = Math.max(0, Number(cfg.imbueCost) || 0)
  const silverPrice = Math.max(0, Number(cfg.silverPrice) || 0)
  const charmCount = Math.max(0, Math.round(Number(cfg.charmCount) || 0))
  const charmCost = Math.max(0, Number(cfg.charmCost) || 0)
  const preyCount = Math.max(0, Math.round(Number(cfg.preyCount) || 0))
  const preyCost = Math.max(0, Number(cfg.preyCost) || 0)

  const imbueTotal = hours != null ? imbueCount * (imbueCost / IMBUE_DURATION_H) * hours : 0
  const wornItems = RECHARGEABLES.filter((r) => cfg.items.includes(r.id))
  const tokenTotal =
    hours != null ? wornItems.reduce((sum, r) => sum + (hours / r.hours) * r.tokens * silverPrice, 0) : 0
  // Per-session counts × unit price — independent of hours, unlike imbues/tokens.
  const charmTotal = charmCount * charmCost
  const preyTotal = preyCount * preyCost
  const extraTotal = charmTotal + preyTotal

  const ready = hours != null && balance != null
  const realProfit = ready ? balance! - imbueTotal - tokenTotal - extraTotal : null
  const perHour = realProfit != null && hours != null ? realProfit / hours : null

  // --- report data -----------------------------------------------------------
  const kills = useMemo(() => [...parsed.kills].sort((a, b) => b.count - a.count), [parsed.kills])
  const totalKills = kills.reduce((s, k) => s + k.count, 0)
  const killRows = useMemo(() => {
    const top = kills.slice(0, 8)
    const rest = kills.slice(8).reduce((s, k) => s + k.count, 0)
    return rest > 0 ? [...top, { name: t('map.hpOther'), count: rest }] : top
  }, [kills, t])

  const coinGold = parsed.items.reduce((s, i) => s + (COIN_VALUE[i.name.toLowerCase()] ?? 0) * i.count, 0)
  // Every looted item (coins folded into the raw-gold line), most-dropped first.
  // No cap: the valuable rares usually drop in low quantity, so slicing to a
  // "top 8 by count" hid exactly the loot worth seeing. The list scrolls.
  // Looted items minus coins (folded into the raw-gold line). Kept unsorted here
  // so the value lookups below can resolve, then re-sorted by worth.
  const lootBase = useMemo(
    () => parsed.items.filter((i) => !(i.name.toLowerCase() in COIN_VALUE)),
    [parsed.items],
  )

  const xpH = parsed.xpPerHour ?? (parsed.xpGain != null && hours != null ? parsed.xpGain / hours : null)
  const dmgH = parsed.damagePerHour ?? (parsed.damage != null && hours != null ? parsed.damage / hours : null)
  const healH = parsed.healingPerHour ?? (parsed.healing != null && hours != null ? parsed.healing / hours : null)
  const hasReport = kills.length > 0 || lootBase.length > 0 || xpH != null || dmgH != null

  // Sprite + page link for each visible row ("Others" is a label, not a name).
  const creatureLinks = useResolvedRows(
    kills.slice(0, 8).map((k) => k.name),
    'creature',
  )
  // Sprites/links + gold value for the loot list — cap the lookups so a huge
  // paste doesn't fire 40+ /search calls; rows past the cap still list, just
  // without a sprite (and worth 0, so they sink to the bottom).
  const itemLinks = useResolvedRows(
    lootBase.slice(0, 30).map((i) => i.name),
    'item',
  )
  // Loot ordered by total worth (unit NPC value × quantity), most valuable
  // first; count breaks ties. Re-sorts as the value lookups resolve.
  const lootRows = useMemo(() => {
    const worth = (i: { name: string; count: number }) =>
      (itemLinks[i.name.toLowerCase()]?.value ?? 0) * i.count
    return [...lootBase].sort((a, b) => worth(b) - worth(a) || b.count - a.count)
  }, [lootBase, itemLinks])
  const maxLootCount = Math.max(1, ...lootBase.map((i) => i.count))

  const toggleItem = (id: string) =>
    setCfg((c) => ({
      ...c,
      items: c.items.includes(id) ? c.items.filter((i) => i !== id) : [...c.items, id],
    }))

  if (!open) return null

  return (
    <div
      className={
        pos
          ? 'pointer-events-none fixed inset-0 z-[1002]'
          : 'pointer-events-none fixed inset-0 z-[1002] flex items-center justify-center px-3 py-4'
      }
    >
      <div
        ref={cardRef}
        style={pos ? { position: 'absolute', left: pos.x, top: pos.y } : undefined}
        className="scroll-atlas pointer-events-auto max-h-[92vh] w-[64rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-3.5 shadow-2xl backdrop-blur-md"
      >
        {/* Header doubles as the drag handle — grab it to move the card. */}
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="mb-2 flex cursor-grab touch-none select-none items-center gap-1.5 text-accent active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
            <path d="M7 6h1v4" />
            <path d="m16.71 13.88.7.71-2.82 2.82" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest">{t('map.hpTitle')}</span>
          {hasReport && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-pressed={collapsed}
              title={collapsed ? t('map.hpExpand') : t('map.hpCollapse')}
              aria-label={collapsed ? t('map.hpExpand') : t('map.hpCollapse')}
              className={`ml-auto flex h-6 items-center gap-1 rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent ${collapsed ? 'px-1.5' : 'w-6 justify-center'}`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {collapsed ? <path d="m7 14 5 5 5-5M7 10l5-5 5 5" /> : <path d="M5 12h14" />}
              </svg>
              {collapsed && <span className="text-[10px] font-bold uppercase tracking-wide">{t('map.hpExpand')}</span>}
            </button>
          )}
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t('map.hpTitle')}
            className={`${hasReport ? '' : 'ml-auto'} grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Inputs — collapse into the results with a smooth grid-rows animation
            when you hit "Calcular", so the breakdown and charts take the card. */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out ${collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}
        >
          <div className="min-h-0 overflow-hidden">
        <p className="mb-2 text-sm text-fg-dim">{t('map.hpHint')}</p>

        {/* Analyzer paste box */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('map.hpPaste')}
          spellCheck={false}
          rows={hasReport ? 3 : 4}
          className="w-full resize-y rounded-lg border border-line bg-bg-2 px-2.5 py-2 font-mono text-xs leading-relaxed outline-none transition placeholder:font-sans placeholder:text-sm placeholder:text-fg-mute focus:border-accent"
        />

        {/* What we read from the paste + the editable session length */}
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
          <NumField big w="w-24" label={t('map.hpHours')} value={hoursDraft} onChange={setHoursDraft} suffix="h" min={0} step={0.25} />
          <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {parsed.loot != null && (
              <span className="text-fg-dim">
                {t('map.hpLoot')} <b className="text-fg">{gp(parsed.loot)}</b>
              </span>
            )}
            {parsed.supplies != null && (
              <span className="text-fg-dim">
                {t('map.hpSupplies')} <b className="text-fg">{gp(parsed.supplies)}</b>
              </span>
            )}
            {balance != null && (
              <span className="text-fg-dim">
                {t('map.hpBalance')}{' '}
                <b className={balance >= 0 ? 'text-canon' : 'text-accent'}>{gp(balance)}</b>
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* Imbuements — slots x (cost / 20h) x session hours */}
          <div className="rounded-xl border border-line bg-bg-2 p-2.5">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpImbues')}</div>
            <div className="flex items-end gap-2">
              <NumField label={t('map.hpImbueCount')} value={String(cfg.imbueCount)} onChange={(v) => setCfg((c) => ({ ...c, imbueCount: Math.max(0, parseInt(v, 10) || 0) }))} min={0} />
              <NumField wide label={t('map.hpImbueCost')} value={String(cfg.imbueCost)} onChange={(v) => setCfg((c) => ({ ...c, imbueCost: Math.max(0, parseInt(v, 10) || 0) }))} suffix="gp" min={0} step={1000} />
              <div className="pb-1 text-right text-sm font-bold text-fg">
                {hours != null && imbueTotal > 0 ? '-' + gp(imbueTotal) : '—'}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-fg-mute">{t('map.hpImbueNote')}</p>
          </div>

          {/* Silver-token rechargeables — tick what you wore for the session */}
          <div className="rounded-xl border border-line bg-bg-2 p-2.5">
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpTokens')}</div>
              <NumField w="w-32" label={t('map.hpTokenPrice')} value={String(cfg.silverPrice)} onChange={(v) => setCfg((c) => ({ ...c, silverPrice: Math.max(0, parseInt(v, 10) || 0) }))} suffix="gp" min={0} step={1000} />
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {RECHARGEABLES.map((r) => {
                const on = cfg.items.includes(r.id)
                const cost = hours != null ? (hours / r.hours) * r.tokens * silverPrice : null
                return (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition ${on ? 'bg-accent/10 text-fg' : 'text-fg-dim hover:bg-surface-2/60'}`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleItem(r.id)} className="h-3.5 w-3.5 accent-accent" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-[11px] text-fg-mute">
                      {on && cost != null ? '-' + gp(cost) : `${r.tokens}tk/${r.hours}h`}
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-fg-mute">{t('map.hpTokenNote')}</p>
          </div>

          {/* Otros gastos por sesión — nº de charms/rerolls × coste unitario.
              Grid de columnas fijas: la cantidad no crece, el coste ocupa el
              hueco flexible y el total tiene su propio ancho, así nunca se sale. */}
          <div className="rounded-xl border border-line bg-bg-2 p-2.5 sm:col-span-2">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpExtras')}</div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {/* Quitar charms: nº × coste por charm */}
              <div className="flex items-end gap-2">
                <NumField label={t('map.hpCharmCount')} value={String(cfg.charmCount)} onChange={(v) => setCfg((c) => ({ ...c, charmCount: Math.max(0, parseInt(v, 10) || 0) }))} min={0} />
                <NumField wide label={t('map.hpCharmCost')} value={String(cfg.charmCost)} onChange={(v) => setCfg((c) => ({ ...c, charmCost: Math.max(0, parseInt(v, 10) || 0) }))} suffix="gp" min={0} step={1000} />
                <div className="shrink-0 whitespace-nowrap pb-2 text-right text-sm font-bold tabular-nums text-accent">{charmTotal > 0 ? '-' + gp(charmTotal) : '—'}</div>
              </div>
              {/* Prey rerolls: nº × coste por reroll */}
              <div className="flex items-end gap-2">
                <NumField label={t('map.hpPreyCount')} value={String(cfg.preyCount)} onChange={(v) => setCfg((c) => ({ ...c, preyCount: Math.max(0, parseInt(v, 10) || 0) }))} min={0} />
                <NumField wide label={t('map.hpPreyCost')} value={String(cfg.preyCost)} onChange={(v) => setCfg((c) => ({ ...c, preyCost: Math.max(0, parseInt(v, 10) || 0) }))} suffix="gp" min={0} step={1000} />
                <div className="shrink-0 whitespace-nowrap pb-2 text-right text-sm font-bold tabular-nums text-accent">{preyTotal > 0 ? '-' + gp(preyTotal) : '—'}</div>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-fg-mute">{t('map.hpExtraNote')}</p>
          </div>
        </div>

        {/* Calcular — folds the inputs away so the verdict + charts fill the card */}
        {ready && (
          <button
            onClick={() => {
              setCalculated(true)
              setCollapsed(true)
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-accent bg-accent/10 py-2.5 text-sm font-bold uppercase tracking-widest text-accent transition hover:bg-accent hover:text-bg-2 active:scale-[0.99]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M8 6h8M8 10h8M8 14h3M14 14h.01M8 18h3M14 18h.01" />
            </svg>
            {t('map.hpCalc')}
          </button>
        )}
          </div>
        </div>

        {/* The verdict — only after "Calcular" */}
        {calculated && (ready ? (
          <div className="mt-2 rounded-xl border border-line bg-bg-2 p-2.5">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-fg-dim">{t('map.hpBalanceRow')}</dt>
              <dd className="text-right font-semibold text-fg">{gp(balance!)}</dd>
              <dt className="text-fg-dim">{t('map.hpCostImbues')}</dt>
              <dd className="text-right font-semibold text-fg">{imbueTotal > 0 ? '-' + gp(imbueTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostTokens')}</dt>
              <dd className="text-right font-semibold text-fg">{tokenTotal > 0 ? '-' + gp(tokenTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostCharms')} <span className="text-fg-mute">×{charmCount}</span></dt>
              <dd className="text-right font-semibold text-fg">{charmTotal > 0 ? '-' + gp(charmTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostPrey')} <span className="text-fg-mute">×{preyCount}</span></dt>
              <dd className="text-right font-semibold text-fg">{preyTotal > 0 ? '-' + gp(preyTotal) : '0'}</dd>
            </dl>
            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
              <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpReal')}</span>
              <span className="text-right">
                <b className={`text-lg ${realProfit! >= 0 ? 'text-canon' : 'text-accent'}`}>{gp(realProfit!)} gp</b>
                <span className="ml-2 text-sm text-fg-dim">{gp(perHour!)}/h</span>
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-mute">{t('map.hpNoData')}</p>
        ))}

        {/* --- session report: the "video wall" ------------------------------- */}
        {calculated && hasReport && (
          <div className="mt-3 border-t-2 border-line pt-2.5">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent">{t('map.hpReport')}</div>

            {/* Headline tiles */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {xpH != null && <Tile label={t('map.hpXpH')} value={compact(xpH)} />}
              {perHour != null && <Tile label={t('map.hpProfitH')} value={compact(perHour)} tone={perHour >= 0 ? 'good' : 'bad'} />}
              {dmgH != null && <Tile label={t('map.hpDmgH')} value={compact(dmgH)} />}
              {healH != null && <Tile label={t('map.hpHealH')} value={compact(healH)} />}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* Kills per creature — single-hue magnitude bars */}
              {killRows.length > 0 && (
                <div className="rounded-xl border border-line bg-bg-2 p-2.5">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpKills')}</span>
                    <span className="text-xs font-semibold text-fg-mute">{t('map.hpKillsTotal', { n: totalKills.toLocaleString() })}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {killRows.map((k) => (
                      <BarRow
                        key={k.name}
                        name={k.name}
                        count={k.count}
                        max={Math.max(...killRows.map((r) => r.count))}
                        total={totalKills}
                        color="var(--color-accent)"
                        entry={creatureLinks[k.name.toLowerCase()]}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Every looted item (coins folded into one raw-gold line) */}
              {(lootRows.length > 0 || coinGold > 0) && (
                <div className="flex min-h-0 flex-col rounded-xl border border-line bg-bg-2 p-2.5">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpLootTop')}</span>
                    <span className="truncate text-xs font-semibold text-fg-mute">
                      {t('map.hpLootItems', { n: lootRows.length })}
                      {coinGold > 0 && ` · ${t('map.hpCoins', { n: gp(coinGold) })}`}
                    </span>
                  </div>
                  <div className="scroll-atlas flex max-h-[15rem] flex-col gap-1 overflow-y-auto pr-1">
                    {lootRows.map((i) => (
                      <BarRow
                        key={i.name}
                        name={i.name}
                        count={i.count}
                        max={maxLootCount}
                        total={0}
                        color="var(--color-gold)"
                        entry={itemLinks[i.name.toLowerCase()]}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Loot → real profit waterfall */}
            {ready && parsed.loot != null && parsed.supplies != null && (
              <div className="mt-2 rounded-xl border border-line bg-bg-2 p-2.5">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpWaterfall')}</div>
                <Waterfall
                  steps={[
                    { label: t('map.hpLoot'), value: parsed.loot },
                    { label: t('map.hpSupplies'), value: -parsed.supplies },
                    { label: t('map.hpImbues'), value: -imbueTotal },
                    { label: t('map.hpCostTokensShort'), value: -tokenTotal },
                    { label: t('map.hpCostExtraShort'), value: -extraTotal },
                  ]}
                  realLabel={t('map.hpReal')}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
