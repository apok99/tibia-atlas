import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SearchResult } from '../types'
import { compact } from '../lib/format'
import { loadCharProfile } from '../lib/charProfile'
import { dayKey, useHuntLog } from '../hooks/useHuntLog'
import { clearSharedSummary, readSharedSummary, type Summary } from '../lib/huntShare'
import { parseAnalyzer } from '../lib/huntAnalyzer'
import HuntLog from './HuntLog'
import PartySplitTool from './PartySplitTool'

// Items Cledwyn (Feyrist) recharges for silver tokens: tokens per recharge and
// how long one recharge lasts while worn. Grouped cheap-first so the list reads
// sane.
//
// The first twelve come straight from the OT server data (npc/cledwyn.lua +
// items.xml). The flamingo/swan amulets are NOT in that dump — it predates
// them — so their 5 tokens / 3h come from TibiaWiki, which states it for
// Valor, Destruction and Nature; Precision and the swan match their family.
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
  { id: 'flamingo-valor', name: 'Flamingo amulet of valor', tokens: 5, hours: 3 },
  { id: 'flamingo-precision', name: 'Flamingo amulet of precision', tokens: 5, hours: 3 },
  { id: 'flamingo-destruction', name: 'Flamingo amulet of destruction', tokens: 5, hours: 3 },
  { id: 'flamingo-nature', name: 'Flamingo amulet of nature', tokens: 5, hours: 3 },
  { id: 'swan-balance', name: 'Swan amulet of balance', tokens: 5, hours: 3 },
] as const

// Every tier 3 ("Powerful") imbuement, straight from the OT server data
// (data/XML/imbuements.xml): the 24 types and what each one actually does at
// that tier. Ordered damage → leech → crit → protections → skills → utility,
// which is the order the in-game shrine lists them.
//
// The gold each one costs is NOT in that file and cannot be: it is materials
// bought on the player market, so it moves by server and by week. Every type
// therefore starts at IMBUE_DEFAULT_COST and is edited (and remembered) per
// type — which is the point of listing them separately.
const IMBUEMENTS = [
  { id: 'scorch', name: 'Scorch', effect: '50% fire' },
  { id: 'venom', name: 'Venom', effect: '50% earth' },
  { id: 'frost', name: 'Frost', effect: '50% ice' },
  { id: 'electrify', name: 'Electrify', effect: '50% energy' },
  { id: 'reap', name: 'Reap', effect: '50% death' },
  { id: 'vampirism', name: 'Vampirism', effect: '25% life leech' },
  { id: 'void', name: 'Void', effect: '8% mana leech' },
  { id: 'strike', name: 'Strike', effect: '+50% crit · +10% chance' },
  { id: 'lich-shroud', name: 'Lich Shroud', effect: '−10% death' },
  { id: 'snake-skin', name: 'Snake Skin', effect: '−15% earth' },
  { id: 'dragon-hide', name: 'Dragon Hide', effect: '−15% fire' },
  { id: 'quara-scale', name: 'Quara Scale', effect: '−15% ice' },
  { id: 'cloud-fabric', name: 'Cloud Fabric', effect: '−15% energy' },
  { id: 'demon-presence', name: 'Demon Presence', effect: '−15% holy' },
  { id: 'chop', name: 'Chop', effect: '+4 axe' },
  { id: 'slash', name: 'Slash', effect: '+4 sword' },
  { id: 'bash', name: 'Bash', effect: '+4 club' },
  { id: 'punch', name: 'Punch', effect: '+4 fist' },
  { id: 'precision', name: 'Precision', effect: '+4 distance' },
  { id: 'blockade', name: 'Blockade', effect: '+4 shielding' },
  { id: 'epiphany', name: 'Epiphany', effect: '+4 magic level' },
  { id: 'swiftness', name: 'Swiftness', effect: '+30 speed' },
  { id: 'featherweight', name: 'Featherweight', effect: '+15 cap' },
  { id: 'vibrancy', name: 'Vibrancy', effect: '50% anti-paralyse' },
] as const

// Tier 3 defaults: ~500k of materials + fee, 20h of hunting per application.
const IMBUE_DEFAULT_COST = 500_000
const IMBUE_DURATION_H = 20
const SILVER_TOKEN_DEFAULT = 50_000

// Per-session extras the analyzer never sees: gold spent removing charms to swap
// hunts, and paying to reroll prey. Each is a unit price × how many you did.
const CHARM_REMOVAL_DEFAULT = 35_000
const PREY_REROLL_DEFAULT = 75_000

const STORE_KEY = 'atlas:map:huntProfit'

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

/**
 * An active imbuement: how many of it you are wearing and what one 20h
 * application costs. The count matters because the same imbuement can sit on
 * two different pieces at once — two Vampirisms wear twice as fast in gold.
 */
type ImbueSlot = { n: number; price: number }

type Config = {
  /** Imbuement id → count + unit price, for the ones you actually ran. */
  imbues: Record<string, ImbueSlot>
  silverPrice: number
  charmCount: number
  charmCost: number
  preyCount: number
  preyCost: number
  items: string[]
  /** Party size the analyzer's balance is split between (1 = solo). */
  players: number
}

const DEFAULTS: Config = {
  imbues: {},
  silverPrice: SILVER_TOKEN_DEFAULT,
  charmCount: 1,
  charmCost: CHARM_REMOVAL_DEFAULT,
  preyCount: 1,
  preyCost: PREY_REROLL_DEFAULT,
  items: [],
  players: 1,
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      // Only ids we still know about, priced with a finite number. A bare
      // number is the earlier one-per-type format — read it as a single unit.
      const imbues: Record<string, ImbueSlot> = {}
      if (c.imbues && typeof c.imbues === 'object') {
        for (const im of IMBUEMENTS) {
          const raw = c.imbues[im.id]
          if (raw == null) continue
          const price = Number(typeof raw === 'object' ? raw.price : raw)
          const n = typeof raw === 'object' ? Math.round(Number(raw.n)) : 1
          if (Number.isFinite(price) && price >= 0) {
            imbues[im.id] = { n: Number.isFinite(n) && n >= 1 ? n : 1, price }
          }
        }
      }
      return {
        // The old config held a bare slot count + one shared price; there is no
        // way to guess WHICH imbuements those were, so the picker starts empty.
        imbues,
        silverPrice: Number.isFinite(c.silverPrice) ? c.silverPrice : SILVER_TOKEN_DEFAULT,
        charmCount: Number.isFinite(c.charmCount) ? c.charmCount : 1,
        charmCost: Number.isFinite(c.charmCost) ? c.charmCost : CHARM_REMOVAL_DEFAULT,
        preyCount: Number.isFinite(c.preyCount) ? c.preyCount : 1,
        preyCost: Number.isFinite(c.preyCost) ? c.preyCost : PREY_REROLL_DEFAULT,
        items: Array.isArray(c.items) ? c.items.filter((i: unknown) => typeof i === 'string') : [],
        players: Number.isFinite(c.players) && c.players >= 1 ? Math.round(c.players) : 1,
      }
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return DEFAULTS
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
  barValue,
  valueText,
  note,
}: {
  name: string
  count: number
  max: number
  total: number
  color: string
  entry?: SearchResult | null
  /** Magnitude the bar length maps to (defaults to `count`). */
  barValue?: number
  /** Right-hand figure (defaults to the count). */
  valueText?: string
  /** Small muted qualifier after the figure (defaults to the share of total). */
  note?: string
}) {
  const share = total > 0 ? Math.round((count / total) * 100) : null
  const mag = barValue ?? count
  const main = valueText ?? count.toLocaleString()
  const sub = note ?? (share != null ? ` · ${share}%` : '')
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
          style={{ width: `${Math.max(2, (mag / max) * 100)}%`, background: color }}
        />
      </span>
      <span className="w-24 shrink-0 text-right text-xs font-semibold text-fg">
        {main}
        {sub && <span className="font-normal text-fg-mute">{sub}</span>}
      </span>
    </>
  )
  const tip = `${main}${sub}`
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

export default function HuntProfitTool({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()

  const [text, setText] = useState('')
  const [hoursDraft, setHoursDraft] = useState('') // manual override of the session length
  const [cfg, setCfg] = useState<Config>(loadConfig)
  const [collapsed, setCollapsed] = useState(false) // hide the inputs, keep the verdict + charts
  const [calculated, setCalculated] = useState(false) // gate: no report until "Calcular" is hit
  const [lootSort, setLootSort] = useState<'total' | 'unit' | 'count'>('total') // loot list ordering
  // A share link lands here: the summary rides in the URL, so it is read once
  // on mount and the card opens straight onto it.
  const [sharedSummary, setSharedSummary] = useState<Summary | null>(readSharedSummary)
  const [tab, setTab] = useState<'calc' | 'log'>(sharedSummary ? 'log' : 'calc')
  // The party settle-up panel, opened from the icon beside the paste box.
  const [splitOpen, setSplitOpen] = useState(false)
  const { hunts, save, remove, clear } = useHuntLog()
  // The last save, tagged with the numbers it captured: editing hours or any
  // cost after saving changes the result, so the button must offer to save the
  // new figure instead of claiming the old one is still on file.
  const [saved, setSaved] = useState<{ id: string; sig: string } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
    } catch {
      /* storage full/blocked — the tool still works, it just forgets */
    }
  }, [cfg])

  // Esc closes the card — a second way out that never depends on where the
  // header ended up after a drag. While the split panel is up, Esc is its to
  // handle: closing both at once would throw away the paste behind it.
  useEffect(() => {
    if (!open || splitOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, splitOpen])

  // Draggable card: null = docked (centered above the hotbar); a point once the
  // user grabs the header. Pointer capture keeps the drag alive when the cursor
  // outruns the handle; position clamps to the viewport.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  // "Añadir otra" bumps this; the effect then puts the caret back in the paste
  // box. It has to be an effect, not a rAF in the click handler — React commits
  // the un-collapse after the frame callback, and the commit steals focus back.
  const [focusPaste, setFocusPaste] = useState(0)
  useEffect(() => {
    if (focusPaste > 0) textRef.current?.focus()
  }, [focusPaste])
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

  // The paste knows how many of you there were — one player section per member.
  // Auto-fill it, but leave it editable: a solo paste from a party hunt, or a
  // member who left early, is the player's call to correct.
  useEffect(() => {
    setCfg((c) => (c.players === parsed.players ? c : { ...c, players: parsed.players }))
  }, [parsed.players])

  // Which member of a party paste is you. Pre-picked from the saved character
  // when the names match, since that is nearly always the answer.
  const [meName, setMeName] = useState<string | null>(null)
  useEffect(() => {
    if (parsed.members.length === 0) {
      setMeName(null)
      return
    }
    const saved = loadCharProfile()?.name?.trim().toLowerCase()
    const hit = saved ? parsed.members.find((p) => p.name.toLowerCase() === saved) : undefined
    setMeName(hit?.name ?? null)
  }, [parsed.members])

  const me = parsed.members.find((p) => p.name === meName) ?? null

  const hours = (() => {
    const h = parseFloat(hoursDraft.replace(',', '.'))
    return Number.isFinite(h) && h > 0 ? h : null
  })()

  // A party analyzer reports the WHOLE party's loot/supplies/balance, so what
  // you actually took home is that balance over the number of players. Your own
  // imbuements, recharges, charms and rerolls are never split — you paid those
  // alone — so the division happens here and nowhere else.
  const players = Math.max(1, Math.round(Number(cfg.players) || 1))
  const rawBalance = parsed.balance ?? (parsed.loot != null && parsed.supplies != null ? parsed.loot - parsed.supplies : null)
  const balance = rawBalance != null ? rawBalance / players : null

  const activeImbues = IMBUEMENTS.filter((im) => im.id in cfg.imbues)
  // Total gold per 20h application across everything worn — a type counts as
  // many times as you carry it.
  const imbueSum = activeImbues.reduce((s, im) => {
    const slot = cfg.imbues[im.id]
    return s + Math.max(1, Math.round(slot.n) || 1) * Math.max(0, Number(slot.price) || 0)
  }, 0)
  const imbueCount = activeImbues.reduce((n, im) => n + Math.max(1, Math.round(cfg.imbues[im.id].n) || 1), 0)
  const silverPrice = Math.max(0, Number(cfg.silverPrice) || 0)
  const charmCount = Math.max(0, Math.round(Number(cfg.charmCount) || 0))
  const charmCost = Math.max(0, Number(cfg.charmCost) || 0)
  const preyCount = Math.max(0, Math.round(Number(cfg.preyCount) || 0))
  const preyCost = Math.max(0, Number(cfg.preyCost) || 0)

  // Each active imbuement wears at its own price / 20h.
  const imbueTotal = hours != null ? (imbueSum / IMBUE_DURATION_H) * hours : 0
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

  // Waste: every gp the session actually burned. The analyzer's own Supplies
  // (runes, potions, ammo) plus the costs it never sees — imbuement wear, token
  // recharges, charms and prey. This is the number that answers "how much did
  // this hunt cost me", where Supplies alone always answers it too low.
  //
  // Supplies is split by the same party size as the balance: a party settles up
  // so everyone ends level, so your share of the consumables is the party's
  // over N. Splitting one and not the other would leave profit + waste bigger
  // than your actual share of the loot, and the history's Total tile is exactly
  // that sum. When the paste names you, your OWN supplies line is used instead
  // of the average — it is the gold that actually left your pocket, and the
  // sum still lands on your share of the loot once the party transfer settles.
  const mySupplies = me ? me.supplies : (parsed.supplies ?? 0) / players
  const wasteTotal = mySupplies + imbueTotal + tokenTotal + extraTotal

  // Party settle-up: everyone ends on the same net, so what you owe (or are
  // owed) is the gap between what you personally banked and that fair share.
  const transfer = me && balance != null ? balance - me.balance : null
  const wastePerHour = hours != null && wasteTotal > 0 ? wasteTotal / hours : null

  // Fingerprint of the current result. It matching the last save — and that
  // entry still being in the log — is what makes the button read "Guardada".
  const sig = ready ? `${hours}|${balance}|${Math.round(realProfit!)}` : ''
  const isSaved = !!saved && saved.sig === sig && sig !== '' && hunts.some((h) => h.id === saved.id)

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
  // A party analyzer has no session-wide Damage/Healing — only per-player ones,
  // so the generic parse would report whoever happens to come first. Use your
  // own block when the paste names you.
  const myDamage = me ? me.damage : parsed.damage
  const myHealing = me ? me.healing : parsed.healing
  const dmgH =
    me != null
      ? myDamage != null && hours != null
        ? myDamage / hours
        : null
      : parsed.damagePerHour ?? (parsed.damage != null && hours != null ? parsed.damage / hours : null)
  const healH =
    me != null
      ? myHealing != null && hours != null
        ? myHealing / hours
        : null
      : parsed.healingPerHour ?? (parsed.healing != null && hours != null ? parsed.healing / hours : null)
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
  // Each looted line enriched with its unit gold value and session total worth,
  // then ordered by the chosen metric (total worth / unit price / quantity).
  // Count breaks ties. Re-sorts live as the value lookups resolve.
  const lootRows = useMemo(() => {
    const rows = lootBase.map((i) => {
      const unit = itemLinks[i.name.toLowerCase()]?.value ?? 0
      return { ...i, unit, worth: unit * i.count }
    })
    const key = lootSort === 'unit' ? 'unit' : lootSort === 'count' ? 'count' : 'worth'
    return rows.sort((a, b) => b[key] - a[key] || b.count - a.count)
  }, [lootBase, itemLinks, lootSort])
  // Bar magnitude scale for the active metric (never 0, so a bar always shows).
  const maxLoot = Math.max(
    1,
    ...lootRows.map((i) => (lootSort === 'unit' ? i.unit : lootSort === 'count' ? i.count : i.worth)),
  )

  const toggleItem = (id: string) =>
    setCfg((c) => ({
      ...c,
      items: c.items.includes(id) ? c.items.filter((i) => i !== id) : [...c.items, id],
    }))

  // Ticking an imbuement gives it one unit at the default price; unticking
  // forgets it entirely, price and count.
  const toggleImbue = (id: string) =>
    setCfg((c) => {
      const next = { ...c.imbues }
      if (id in next) delete next[id]
      else next[id] = { n: 1, price: IMBUE_DEFAULT_COST }
      return { ...c, imbues: next }
    })

  const setImbue = (id: string, patch: Partial<ImbueSlot>) =>
    setCfg((c) => (c.imbues[id] ? { ...c, imbues: { ...c.imbues, [id]: { ...c.imbues[id], ...patch } } } : c))

  if (!open) return null

  // Portal to <body>: MapPage's root is a `z-20` stacking context, so a z-index
  // set in here can never climb above the `z-30` header — dragged up, the card
  // (and its close button) ends up buried under the navbar. Outside that root
  // the z-[1002] finally means what it says.
  return createPortal(
    <div
      className={
        pos
          ? 'pointer-events-none fixed inset-0 z-[1002]'
          : 'pointer-events-none fixed inset-0 z-[1002] flex items-center justify-center px-3 py-4'
      }
    >
      <div
        ref={cardRef}
        style={
          pos
            ? // Dragged: the card can't run past the bottom edge either, or its
              // lower half (and the scroller inside it) would be unreachable.
              { position: 'absolute', left: pos.x, top: pos.y, maxHeight: `calc(100vh - ${pos.y}px - 0.75rem)` }
            : undefined
        }
        className="pointer-events-auto flex max-h-[92vh] w-[64rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border-2 border-line bg-bg-2/95 p-3.5 shadow-2xl backdrop-blur-md"
      >
        {/* Header doubles as the drag handle — grab it to move the card. It sits
            outside the scroller so the close button never scrolls out of reach. */}
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="mb-2 flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 text-accent active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
            <path d="M7 6h1v4" />
            <path d="m16.71 13.88.7.71-2.82 2.82" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest">{t('map.hpTitle')}</span>
          {hasReport && tab === 'calc' && (
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
            className={`${hasReport && tab === 'calc' ? '' : 'ml-auto'} grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Calculator ↔ saved-hunt history. Sits outside the scroller so the
            switch is always reachable, like the close button. */}
        <div className="mb-2 flex shrink-0 gap-1 rounded-lg border border-line p-0.5">
          {([
            ['calc', t('map.hpTabCalc'), null],
            ['log', t('map.hpTabLog'), hunts.length],
          ] as const).map(([id, label, badge]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-bold uppercase tracking-widest transition ${
                tab === id ? 'bg-accent text-bg-2' : 'text-fg-mute hover:text-fg'
              }`}
            >
              {label}
              {badge != null && badge > 0 && (
                <span
                  className={`rounded px-1 text-[10px] tabular-nums ${tab === id ? 'bg-bg-2/25' : 'bg-line/60 text-fg-dim'}`}
                >
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Everything below the header scrolls; the card itself never grows past
            92vh, so the header (and its close button) always stays on screen. */}
        <div className="scroll-atlas min-h-0 flex-1 overflow-y-auto">

        {tab === 'log' ? (
          <HuntLog
            hunts={hunts}
            onRemove={remove}
            onClear={clear}
            shared={sharedSummary}
            onExitShared={() => {
              setSharedSummary(null)
              clearSharedSummary()
            }}
          />
        ) : (
        <>

        {/* Inputs — collapse into the results with a smooth grid-rows animation
            when you hit "Calcular", so the breakdown and charts take the card. */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out ${collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}
        >
          <div className="min-h-0 overflow-hidden">
        <p className="mb-2 text-sm text-fg-dim">{t('map.hpHint')}</p>

        {/* Analyzer paste box, with the party settle-up panel one click to its
            right — same paste, different question ("what do I owe the others"). */}
        <div className="flex items-stretch gap-2">
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('map.hpPaste')}
            spellCheck={false}
            rows={hasReport ? 3 : 4}
            className="min-w-0 flex-1 resize-y rounded-lg border border-line bg-bg-2 px-2.5 py-2 font-mono text-xs leading-relaxed outline-none transition placeholder:font-sans placeholder:text-sm placeholder:text-fg-mute focus:border-accent"
          />
          <button
            onClick={() => setSplitOpen(true)}
            title={t('map.psOpenHint')}
            aria-label={t('map.psTitle')}
            className={`flex w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-1 py-2 transition ${
              parsed.members.length > 1
                ? 'border-accent bg-accent/10 text-accent hover:bg-accent hover:text-bg-2'
                : 'border-line-2 text-fg-mute hover:border-accent hover:text-accent'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
            </svg>
            <span className="text-center text-[9px] font-bold uppercase leading-tight tracking-wide">{t('map.psOpen')}</span>
          </button>
        </div>

        {/* Party paste: say who you are. Your own supplies and damage are then
            read off your block instead of averaged across the party. */}
        {parsed.members.length > 1 && (
          <div className="mt-2 rounded-xl border border-accent/40 bg-accent/5 p-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-accent">
              {t('map.hpPartyDetected', { n: parsed.members.length })}
            </div>
            <div className="flex flex-wrap gap-1">
              {parsed.members.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setMeName(meName === p.name ? null : p.name)}
                  aria-pressed={meName === p.name}
                  title={`${t('map.hpBalance')} ${gp(p.balance)}`}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    meName === p.name
                      ? 'border-accent bg-accent text-bg-2'
                      : 'border-line-2 text-fg-dim hover:border-accent hover:text-accent'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-fg-mute">
              {me ? t('map.hpPartyYouAre', { name: me.name, gp: gp(me.supplies) }) : t('map.hpPartyPick')}
            </p>
          </div>
        )}

        {/* What we read from the paste + the editable session length */}
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
          <NumField big w="w-24" label={t('map.hpHours')} value={hoursDraft} onChange={setHoursDraft} suffix="h" min={0} step={0.25} />
          {/* Party split — a shared analyzer's balance is the whole party's. */}
          <NumField
            big
            w="w-20"
            label={t('map.hpPlayers')}
            value={String(cfg.players)}
            onChange={(v) => setCfg((c) => ({ ...c, players: Math.max(1, parseInt(v, 10) || 1) }))}
            min={1}
          />
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
                {players > 1 && rawBalance != null && (
                  <span className="ml-1 text-xs text-fg-mute">{t('map.hpSplitOf', { n: gp(rawBalance), p: players })}</span>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* Imbuements — tick the ones you ran and price each one. They are
              not interchangeable: a Vampirism costs several times a Chop, and
              a single averaged price was quietly wrong for everyone. */}
          <div className="rounded-xl border border-line bg-bg-2 p-2.5 sm:col-span-2">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-fg-dim">
                {t('map.hpImbues')}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-fg-mute">
                  {t('map.hpImbueActive', { n: imbueCount })}
                </span>
              </div>
              <div className="text-right text-sm font-bold text-accent">
                {hours != null && imbueTotal > 0 ? '-' + gp(imbueTotal) : '—'}
              </div>
            </div>
            <div className="scroll-atlas grid max-h-[13rem] grid-cols-1 gap-x-3 gap-y-0.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {IMBUEMENTS.map((im) => {
                const slot = cfg.imbues[im.id]
                const on = !!slot
                const price = slot?.price ?? IMBUE_DEFAULT_COST
                const n = Math.max(1, Math.round(slot?.n ?? 1) || 1)
                // What this type alone costs the session: unit price × how many
                // of it you wear, worn down over the 20h application.
                const cost = hours != null && on ? ((n * price) / IMBUE_DURATION_H) * hours : null
                return (
                  <div
                    key={im.id}
                    className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition ${on ? 'bg-accent/10 text-fg' : 'text-fg-dim hover:bg-surface-2/60'}`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5" title={im.effect}>
                      <input type="checkbox" checked={on} onChange={() => toggleImbue(im.id)} className="h-3.5 w-3.5 shrink-0 accent-accent" />
                      <span className="min-w-0 truncate">{im.name}</span>
                      <span className="shrink-0 text-[10px] text-fg-mute">{im.effect}</span>
                    </label>
                    {on ? (
                      <>
                        {/* How many pieces carry this same imbuement. */}
                        <span className="flex shrink-0 items-center text-[11px] text-fg-mute">
                          ×
                          <input
                            type="number"
                            value={String(n)}
                            min={1}
                            step={1}
                            aria-label={`${im.name} — ${t('map.hpImbueQty')}`}
                            title={t('map.hpImbueQty')}
                            onChange={(e) => setImbue(im.id, { n: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                            className="h-6 w-10 rounded-md border border-line bg-bg-2 px-1 text-center text-xs font-semibold tabular-nums outline-none transition focus:border-accent"
                          />
                        </span>
                        <input
                          type="number"
                          value={String(price)}
                          min={0}
                          step={1000}
                          aria-label={`${im.name} — ${t('map.hpImbueCost')}`}
                          title={t('map.hpImbueCost')}
                          onChange={(e) => setImbue(im.id, { price: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                          className="h-6 w-20 shrink-0 rounded-md border border-line bg-bg-2 px-1 text-right text-xs font-semibold tabular-nums outline-none transition focus:border-accent"
                        />
                        <span className="w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums text-accent">
                          {cost != null ? '-' + compact(cost) : ''}
                        </span>
                      </>
                    ) : (
                      <span className="w-[10.5rem] shrink-0 text-right text-[11px] text-fg-mute">
                        {compact(IMBUE_DEFAULT_COST)}/20h
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-fg-mute">{t('map.hpImbueNote')}</p>
          </div>

          {/* Silver-token rechargeables — tick what you wore for the session */}
          <div className="rounded-xl border border-line bg-bg-2 p-2.5 sm:col-span-2">
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpTokens')}</div>
              <NumField w="w-32" label={t('map.hpTokenPrice')} value={String(cfg.silverPrice)} onChange={(v) => setCfg((c) => ({ ...c, silverPrice: Math.max(0, parseInt(v, 10) || 0) }))} suffix="gp" min={0} step={1000} />
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 sm:grid-cols-3">
              {RECHARGEABLES.map((r) => {
                const on = cfg.items.includes(r.id)
                const cost = hours != null ? (hours / r.hours) * r.tokens * silverPrice : null
                return (
                  <label
                    key={r.id}
                    title={r.name}
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
              <dt className="text-fg-dim">
                {t('map.hpBalanceRow')}
                {players > 1 && <span className="text-fg-mute"> ÷{players}</span>}
              </dt>
              <dd className="text-right font-semibold text-fg">{gp(balance!)}</dd>
              <dt className="text-fg-dim">
                {t('map.hpCostImbues')} <span className="text-fg-mute">×{imbueCount}</span>
              </dt>
              <dd className="text-right font-semibold text-fg">{imbueTotal > 0 ? '-' + gp(imbueTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostTokens')}</dt>
              <dd className="text-right font-semibold text-fg">{tokenTotal > 0 ? '-' + gp(tokenTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostCharms')} <span className="text-fg-mute">×{charmCount}</span></dt>
              <dd className="text-right font-semibold text-fg">{charmTotal > 0 ? '-' + gp(charmTotal) : '0'}</dd>
              <dt className="text-fg-dim">{t('map.hpCostPrey')} <span className="text-fg-mute">×{preyCount}</span></dt>
              <dd className="text-right font-semibold text-fg">{preyTotal > 0 ? '-' + gp(preyTotal) : '0'}</dd>
            </dl>

            {/* Who owes whom, so the party actually ends level. */}
            {transfer != null && Math.round(transfer) !== 0 && (
              <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-fg-dim">
                {transfer > 0 ? (
                  <>
                    {t('map.hpPartyReceive')} <b className="text-canon">{gp(transfer)} gp</b>
                  </>
                ) : (
                  <>
                    {t('map.hpPartyOwe')} <b className="text-accent">{gp(-transfer)} gp</b>
                  </>
                )}
                <span className="ml-1 text-fg-mute">{t('map.hpPartyTransferNote', { gp: gp(me!.balance) })}</span>
              </p>
            )}
            {/* Waste: supplies + every real cost above, i.e. the whole spend. */}
            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
              <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">
                {t('map.hpWaste')}
                {parsed.supplies != null && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-fg-mute">
                    {t('map.hpWasteNote', { n: gp(mySupplies) })}
                  </span>
                )}
              </span>
              <span className="text-right">
                <b className="text-accent">{gp(wasteTotal)} gp</b>
                {wastePerHour != null && <span className="ml-2 text-sm text-fg-dim">{gp(wastePerHour)}/h</span>}
              </span>
            </div>

            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
              <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpReal')}</span>
              <span className="text-right">
                <b className={`text-lg ${realProfit! >= 0 ? 'text-canon' : 'text-accent'}`}>{gp(realProfit!)} gp</b>
                <span className="ml-2 text-sm text-fg-dim">{gp(perHour!)}/h</span>
              </span>
            </div>

            {/* Save the session into the local hunt log (the "Historial" tab).
                Turns into a confirmation once these exact numbers are on file. */}
            <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                if (isSaved) return
                const id = save({
                  hours: hours!,
                  balance: balance!,
                  imbues: imbueTotal,
                  tokens: tokenTotal,
                  charms: charmTotal,
                  prey: preyTotal,
                  profit: realProfit!,
                  xp: parsed.xpGain,
                  supplies: mySupplies,
                  players,
                  kills: totalKills,
                  label: kills[0]?.name ?? '',
                }, parsed.startedAt)
                setSaved({ id, sig })
              }}
              disabled={isSaved}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2 text-sm font-bold uppercase tracking-widest transition active:scale-[0.99] ${
                isSaved
                  ? 'cursor-default border-canon bg-canon/10 text-canon'
                  : 'border-line-2 text-fg-dim hover:border-accent hover:text-accent'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isSaved ? (
                  <path d="M20 6 9 17l-5-5" />
                ) : (
                  <>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                    <path d="M17 21v-8H7v8M7 3v5h8" />
                  </>
                )}
              </svg>
              {isSaved ? t('map.hpSaved') : t('map.hpSave')}
            </button>

            {/* Straight into the next session: wipes the paste and the report
                but keeps your cost setup, which is the same hunt after hunt. */}
            {isSaved && (
              <button
                onClick={() => {
                  setText('')
                  setHoursDraft('')
                  setCalculated(false)
                  setCollapsed(false)
                  setSaved(null)
                  setFocusPaste((n) => n + 1)
                }}
                className="flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-accent bg-accent/10 px-4 py-2 text-sm font-bold uppercase tracking-widest text-accent transition hover:bg-accent hover:text-bg-2 active:scale-[0.99]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('map.hpAddAnother')}
              </button>
            )}
            </div>
            {/* Say out loud which day the entry lands on when the paste is not
                from today — otherwise a back-dated session looks misfiled. */}
            {parsed.startedAt && dayKey(parsed.startedAt) !== dayKey(new Date()) && (
              <p className="mt-1 text-center text-[11px] text-fg-mute">
                {t('map.hpSaveDay', {
                  day: parsed.startedAt.toLocaleDateString(i18n.language?.startsWith('en') ? 'en-GB' : 'es-ES', {
                    day: 'numeric',
                    month: 'long',
                  }),
                })}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-mute">{t('map.hpNoData')}</p>
        ))}

        {/* --- session report: the "video wall" ------------------------------- */}
        {calculated && hasReport && (
          <div className="mt-3 border-t-2 border-line pt-2.5">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent">{t('map.hpReport')}</div>

            {/* Headline tiles */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {xpH != null && <Tile label={t('map.hpXpH')} value={compact(xpH)} />}
              {perHour != null && <Tile label={t('map.hpProfitH')} value={compact(perHour)} tone={perHour >= 0 ? 'good' : 'bad'} />}
              {wastePerHour != null && <Tile label={t('map.hpWasteH')} value={compact(wastePerHour)} tone="bad" />}
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
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.hpLootTop')}</span>
                    {/* Sort toggle: total worth / unit price / quantity */}
                    <div className="flex shrink-0 gap-0.5 rounded-lg border border-line p-0.5">
                      {(['total', 'unit', 'count'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setLootSort(mode)}
                          aria-pressed={lootSort === mode}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${lootSort === mode ? 'bg-accent text-bg-2' : 'text-fg-mute hover:text-fg'}`}
                        >
                          {t(`map.hpSort_${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mb-1 truncate text-[11px] font-semibold text-fg-mute">
                    {t('map.hpLootItems', { n: lootRows.length })}
                    {coinGold > 0 && ` · ${t('map.hpCoins', { n: gp(coinGold) })}`}
                  </div>
                  <div className="scroll-atlas flex max-h-[15rem] flex-col gap-1 overflow-y-auto pr-1">
                    {lootRows.map((i) => {
                      const barValue = lootSort === 'unit' ? i.unit : lootSort === 'count' ? i.count : i.worth
                      const valueText =
                        lootSort === 'count' ? i.count.toLocaleString() : barValue > 0 ? compact(barValue) : '—'
                      const note = lootSort === 'count' ? '' : ` · ×${i.count.toLocaleString()}`
                      return (
                        <BarRow
                          key={i.name}
                          name={i.name}
                          count={i.count}
                          barValue={barValue}
                          valueText={valueText}
                          note={note}
                          max={maxLoot}
                          total={0}
                          color="var(--color-gold)"
                          entry={itemLinks[i.name.toLowerCase()]}
                        />
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </>
        )}
        </div>
      </div>

      {/* Party settle-up — its own small modal on top of the card. */}
      <PartySplitTool open={splitOpen} onClose={() => setSplitOpen(false)} initialText={text} meName={meName} />
    </div>,
    document.body,
  )
}
