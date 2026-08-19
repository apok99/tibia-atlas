import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import { compact } from '../lib/format'
import { planRoute, type RoutePlan, type RouteLeg } from '../lib/routing'
import { Seo } from '../lib/seo'
import { Icon, iconMarkup } from '../lib/icons'
import {
  type Watch,
  isAvailable,
  isHouseWatched,
  isTownWatched,
  isWorldWatched,
  houseCovered,
  loadWatches,
  saveWatches,
  toggleHouseWatch,
  toggleTownWatch,
  toggleWorldWatch,
  loadSeen,
  saveSeen,
  toStatusMap,
  diffFreed,
  notifyPermission,
  requestNotifyPermission,
  osNotify,
  type LocalBidEvent,
  type BidSeen,
  loadBidSeen,
  saveBidSeen,
  loadBidEvents,
  saveBidEvents,
} from '../lib/houseWatch'
import {
  type CharProfile,
  type Character,
  type GearPiece,
  type GearSlot,
  GEAR_SLOTS,
  fetchCharacter,
  gearIds,
  loadCharProfile,
  saveCharProfile,
} from '../lib/charProfile'
import { useItems, useSetStats, useEntry, logSearchClick, logNpcSearchClick } from '../hooks/useEntries'
import { LoreText } from '../components/LoreText'
import { LORE_POIS, type LorePoi } from '../lib/lorePois'
import {
  dropLabel,
  raidDelay,
  raidInterval,
  raidRegion,
  raidRoster,
  raidTimeline,
  useRaids,
  type Raid,
} from '../lib/raids'
import {
  useWorldChanges,
  wcCadenceKey,
  wcFloors,
  type WcSpot,
  type WorldChange,
} from '../lib/worldChanges'
import { RASHID_ROTATION, rashidEffectiveDay, useRashidClock, type RashidStop } from '../lib/rashid'
import { YASIR_DOCKS, type YasirDock } from '../lib/yasir'
import { SKILL_LABELS, signed } from '../components/items/itemStats'
import { useGlossary } from '../hooks/useGlossary'
import { useBosses, useKillWorlds, type BossRow } from '../hooks/useKillStats'
import { useHunts, type HuntZone } from '../hooks/useHunts'
import { useZoneProtection, useZoneSummary, type ZoneBox, type ZoneSummary } from '../hooks/useZoneSummary'
import { TypeIcon } from '../components/TypeIcon'
import { Skeleton } from '../components/Skeleton'
import { SiteGuide, guideSeen } from '../components/SiteGuide'
import HuntProfitTool from '../components/HuntProfitTool'
import { hasSharedSummary } from '../lib/huntShare'
import { MapKillPulse } from '../components/MapKillPulse'
import { HouseBidChart, HousePriceIndex } from '../components/HousePrices'
import {
  SHRINE_ACCESS,
  nearestTour,
  planPilgrimage,
  useBlessings,
  type PilgrimStop,
} from '../lib/blessings'
import type { Dropper, Entry, EntryListItem, ItemDetail, ItemTrade, MapNpc, Paginated, SearchResult, Spawn } from '../types'
import {
  TILE,
  X_MIN,
  X_MAX,
  Y_MIN,
  Y_MAX,
  SURFACE,
  toLatLng,
  LANDMARKS,
  MAP_LABELS,
  type Landmark,
} from '../lib/zones'

// Floor 7 is the surface/ground level in Tibia; lower numbers are higher up.
const FLOORS = Array.from({ length: 16 }, (_, i) => i) // 0..15

// Distinct ring colours for each creature overlay.
const PALETTE = ['#d23d2f', '#3fa7d6', '#6cc551', '#e0a531', '#9b5de5', '#f15bb5', '#ff8c42', '#4ecdc4']

// Boss "spawn heat" (0-100) → a qualitative bucket for the Boss Watch strip.
// High heat = no recent kills across worlds, so the boss is likely up; low heat
// = freshly killed (still on cooldown).
function heatBucket(heat: number): 'hot' | 'warm' | 'cold' {
  if (heat >= 66) return 'hot'
  if (heat >= 33) return 'warm'
  return 'cold'
}
const HEAT_STYLE = {
  hot: { cls: 'text-accent', glyph: '🔥', label: 'map.bossHot' },
  warm: { cls: 'text-gold', glyph: '🌡', label: 'map.bossWarm' },
  cold: { cls: 'text-interp', glyph: '❄', label: 'map.bossCold' },
} as const

// Boss Watch category tabs, keyed by TibiaWiki spawntype. 'all' keeps the classic
// hottest-first mixed roster; the rest slice the roster to one spawntype so a
// player can browse e.g. every raid boss or every lever ("Triggered") boss. Order
// = how a hunter thinks about them (raids first, curiosities last).
type BossType = 'all' | 'Raid' | 'Unique' | 'Triggered' | 'Regular' | 'Event' | 'Unblockable'
const BOSS_TYPES: BossType[] = ['all', 'Raid', 'Unique', 'Triggered', 'Regular', 'Event', 'Unblockable']

type Marker = { id: string; x: number; y: number; floor: number; label: string }
type Cluster = { x: number; y: number; z: number; count: number; score: number }
type ActiveCreature = {
  slug: string
  name: string
  image: string | null
  color: string
  spawns: Spawn[]
  clusters: Cluster[]
  jumpIdx: number
}

// "All creatures" overlay payload from GET /api/spawns?z=
type AllSpawns = {
  creatures: {
    slug: string
    name: string
    image: string | null
    classification: string | null
    difficulty: string | null
    boss: boolean
    experience: number
    loot_value: number
  }[]
  points: [number, number, number][]
}

// A point-of-interest from the imported client minimap markers
// (public/map-markers.json, generated by tools/gen-map-markers.mjs).
type Poi = { x: number; y: number; z: number; desc: string; color: string; icon: string }

// A rentable house/guildhall. Coords + meta are baked from the world files
// (world-agnostic); `live` (rent status on a chosen world) is layered on top by
// the TibiaData ETL, joined by `id` (the real Tibia house id).
type House = {
  id: number
  name: string
  x: number
  y: number
  z: number
  town: string | null
  rent: number
  size: number
  beds: number
  guild: number
  live?: {
    status: 'rented' | 'auctioned' | 'free'
    owner?: string | null
    bid?: number
    // Current-bidder name; undefined = not looked up yet, null = no bids.
    bidder?: string | null
  } | null
}

// A live "what's happening on your world" event from GET /api/events. Two
// producers feed it: the house-status ETL diff (house_* transitions) and the
// daily kill-stats digest (digest_* — most-hunted creature, top bosses, total
// kills "yesterday"). Generic shape so more producers can be added later.
type WorldEvent = {
  id: number
  type: string
  ref_id: number | null
  title: string | null
  town: string | null
  meta: {
    from?: string
    to?: string
    bid?: number
    bidder?: string | null // house_bid / house_outbid: who holds the top bid
    count?: number // digest_*: how many were killed
    slug?: string // digest creature/boss: lore slug, for click-to-plot
    image?: string | null // digest creature/boss: sprite
  } | null
  occurred_at: string
}

// Line-icon (name in ICON_INNER) + accent colour per event type, so the ticker
// reads at a glance and stays on the atlas theme (no emoji).
const EVENT_STYLE: Record<string, { icon: string; color: string }> = {
  // Houses: red = taken (new tenant), green = freed up, gold = auction.
  house_rented: { icon: 'home', color: 'var(--color-accent)' },
  house_freed: { icon: 'key', color: '#2f9e5a' },
  house_auctioned: { icon: 'gavel', color: '#e0a531' },
  // Local (client-generated) entries for belled auctions: gold = someone bid,
  // red = they bid over YOUR configured character.
  house_bid: { icon: 'gavel', color: '#e0a531' },
  house_outbid: { icon: 'gavel', color: '#c94f4f' },
  // Daily digest: sword = total slain, paw = most-hunted creature, skull = boss.
  digest_total: { icon: 'sword', color: 'var(--color-accent-2)' },
  digest_top_creature: { icon: 'paw', color: '#6cc551' },
  digest_boss: { icon: 'skull', color: 'var(--color-accent)' },
}

// Whether an event is a daily-digest headline (vs a real-time house change).
const isDigest = (type: string) => type.startsWith('digest_')

// "hace 3 h" / "3h ago" — coarse relative time; events land ~twice a day so
// minute precision would be noise.
function eventAgo(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return t('map.evtAgoMin', { n: Math.max(1, Math.round(s / 60)) })
  if (s < 86400) return t('map.evtAgoHour', { n: Math.round(s / 3600) })
  return t('map.evtAgoDay', { n: Math.round(s / 86400) })
}

// Short label for an event, by type.
function eventLabel(ev: WorldEvent, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (ev.type) {
    case 'house_freed':
      return t('map.evtFreed')
    case 'house_auctioned':
      return t('map.evtAuction')
    // Local bid alerts carry the amount right in the label so the rail answers
    // "how much?" without a click; the bidder shows in the house popup.
    case 'house_bid':
      return `${t('map.evtNewBid')}${ev.meta?.bid ? ` · ${fmtGold(ev.meta.bid)}` : ''}`
    case 'house_outbid':
      return `${t('map.evtOutbid')}${ev.meta?.bid ? ` · ${fmtGold(ev.meta.bid)}` : ''}`
    case 'digest_total':
      return t('map.evtTotalKills')
    case 'digest_top_creature':
      return t('map.evtTopCreature')
    case 'digest_boss':
      return t('map.evtBoss')
    default:
      return t('map.evtNewOwner')
  }
}

// Live "world news" rail docked to the RIGHT edge. Collapsed by default to a
// small 📰 button (with an unread-style count badge) so it never covers the map;
// clicking slides it open (same maxWidth animation as the Boss Watch rail) into a
// scrollable vertical list. It's an absolute overlay, so opening it doesn't shift
// any other control. Each row: sprite/icon + label + title + kills/relative-time;
// clicking plots the creature (digest) or flies to the house (house event).
function NewsRail({
  events,
  open,
  alert,
  onToggle,
  t,
  onPick,
}: {
  events: WorldEvent[]
  open: boolean
  // Unseen PERSONAL news (outbid on your auction, a belled house released):
  // the collapsed badge swaps its count for a pulsing red "!" until opened.
  alert: boolean
  onToggle: () => void
  t: (k: string, o?: Record<string, unknown>) => string
  onPick: (ev: WorldEvent) => void
}) {
  if (!events.length) return null
  return (
    <aside
      className="scroll-atlas pointer-events-auto flex max-h-[calc(50vh-6rem)] flex-col gap-0.5 overflow-y-auto overflow-x-hidden rounded-2xl border-2 border-line bg-bg-2/95 p-2 shadow-lg backdrop-blur-md transition-[max-width] duration-300 ease-in-out"
      style={{ maxWidth: open ? 'min(21rem, calc(100vw - 1rem))' : '2.9rem' }}
    >
      <div className={`flex items-center gap-1.5 ${open ? 'px-0.5 pb-1' : 'justify-center'}`}>
        {open && (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-accent">
            <Icon name="newspaper" size={14} className="shrink-0" />
            <span className="truncate text-[10px] font-bold uppercase tracking-widest">{t('map.newsTitle')}</span>
            <span className="ks-ticker-tag shrink-0" style={{ padding: '2px 6px', fontSize: 9, borderRadius: 9999 }}>
              {t('map.eventsLive')}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={open ? t('map.modeHide') : t('map.newsTitle')}
          aria-label={open ? t('map.modeHide') : t('map.newsTitle')}
          aria-expanded={open}
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded text-fg-mute transition hover:bg-line/40 hover:text-fg"
        >
          {open ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          ) : (
            <>
              <Icon name="newspaper" size={17} className="text-accent" />
              <span
                className={`absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white ${
                  alert ? 'animate-pulse bg-[#c94f4f]' : 'bg-accent'
                }`}
              >
                {alert ? '!' : events.length}
              </span>
            </>
          )}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-0.5">
          {events.map((ev) => {
            const st = EVENT_STYLE[ev.type] ?? EVENT_STYLE.house_rented
            const digest = isDigest(ev.type)
            const can = digest ? !!ev.meta?.slug : !!ev.ref_id
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onPick(ev)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-line/40"
                style={{ cursor: can ? 'pointer' : 'default' }}
                title={ev.title ?? ''}
              >
                {digest && ev.meta?.image ? (
                  <img src={ev.meta.image} alt="" loading="lazy" className="h-6 w-6 shrink-0 object-contain [image-rendering:pixelated]" />
                ) : (
                  <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: st.color }}>
                    <Icon name={st.icon} size={17} />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.color }}>
                    {eventLabel(ev, t)}
                  </span>
                  {ev.title && (
                    <span className="truncate text-xs font-semibold text-fg-dim">
                      {ev.title}
                      {ev.town ? ` · ${ev.town}` : ''}
                    </span>
                  )}
                </span>
                <span
                  className="shrink-0 text-[11px] font-bold tabular-nums"
                  style={{ color: digest ? 'var(--color-accent-2)' : 'var(--color-fg-mute)' }}
                >
                  {digest
                    ? typeof ev.meta?.count === 'number'
                      ? compact(ev.meta.count)
                      : ''
                    : eventAgo(ev.occurred_at, t)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}

// The travelling merchants' own walking sprites (self-hosted, like the rest of
// the game art), used both as map markers and as rail buttons — no pin or card
// chrome around them. Rashid reads gold, Yasir teal, so the two never blur.
const RASHID_SPRITE = '/sprites/rashid.webp'
const YASIR_SPRITE = '/sprites/yasir.webp'
const RASHID_GOLD = 'var(--color-rashid)'
const YASIR_TEAL = '#5fb8a6'

/** Short city tag: initials for multi-word names ("Port Hope" → PH), first
 *  three letters otherwise ("Carlin" → CAR) — the full name is in the tooltip. */
function cityTag(city: string): string {
  const words = city.split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.map((w) => w[0]).join('').toUpperCase()
  return city.slice(0, 3).toUpperCase()
}

function rashidCountdown(totalSeconds: number): string {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// A travelling merchant docked to the right edge, right under the news rail:
// just his sprite with the city tag under it (no card), because the map is the
// content. One tap opens his panel — for Rashid that also traces the route.
function TravellerRail({
  sprite,
  tag,
  color,
  title,
  label,
  active,
  onPick,
}: {
  sprite: string
  tag: string
  color: string
  title: string
  label: string
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={title}
      aria-label={label}
      className={`pointer-events-auto flex flex-col items-center transition hover:scale-110 ${
        active ? 'scale-110' : ''
      }`}
    >
      <img
        src={sprite}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 [image-rendering:pixelated]"
        style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.85))' }}
      />
      <span
        className="-mt-1 rounded px-1 text-[10px] font-black leading-tight tracking-wider"
        style={{
          color: active ? '#fff' : color,
          textShadow: '0 1px 2px rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.9)',
        }}
      >
        {tag}
      </span>
    </button>
  )
}

// Rashid's rail button: sprite + today's city tag, ticking its own countdown.
function RashidRail({
  stop,
  active,
  onPick,
  t,
}: {
  stop: RashidStop
  active: boolean
  onPick: () => void
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  // The 1 s tick lives here (and in the panel) so it never re-renders the map.
  const { secondsToSave } = useRashidClock()
  return (
    <TravellerRail
      sprite={RASHID_SPRITE}
      tag={cityTag(stop.city)}
      color={RASHID_GOLD}
      title={`${t('map.rashidTitle')} — ${stop.city} · ${t('map.rashidChangesIn')} ${rashidCountdown(secondsToSave)}`}
      label={`${t('map.rashidTitle')} — ${stop.city}. ${t('map.rashidHint')}`}
      active={active}
      onPick={onPick}
    />
  )
}

// In-map reader for Rashid: today's exact spot, the countdown to the 10:00
// Berlin server save that moves him, and a re-trace button for the route.
function RashidPanel({
  stop,
  lang,
  onRoute,
  onClose,
}: {
  stop: RashidStop
  lang: 'es' | 'en'
  onRoute: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { secondsToSave } = useRashidClock()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="pointer-events-auto w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5 text-rashid">
          <img src={RASHID_SPRITE} alt="" className="h-6 w-6 shrink-0 [image-rendering:pixelated]" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.rashidTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-rashid hover:text-rashid"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="font-serif text-lg font-bold leading-tight text-fg">{stop.city}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-dim">
          <span className="font-semibold text-fg-mute">{t('map.rashidWhere')}: </span>
          {stop.spot[lang]}
        </p>
        <p className="mt-2 text-xs text-fg-mute">
          <span className="font-mono tabular-nums text-fg-dim">
            {stop.x}, {stop.y}, {stop.z}
          </span>
          {' · '}
          {t('map.rashidChangesIn')}{' '}
          <span className="font-mono font-semibold tabular-nums text-fg-dim">
            {rashidCountdown(secondsToSave)}
          </span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRoute}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rashid/50 bg-rashid/10 px-3 py-1.5 text-sm font-semibold text-rashid transition hover:bg-rashid/20"
          >
            <Icon name="compass" size={15} />
            {t('map.rashidRoute')}
          </button>
          <Link
            to="/rashid"
            className="text-sm font-semibold text-fg-mute underline decoration-dotted underline-offset-4 transition hover:text-fg"
          >
            {t('map.rashidFull')}
          </Link>
        </div>
      </div>
    </div>
  )
}

// In-map reader for Yasir. He keeps no schedule — his ship docks at one of
// three ports and which one is anybody's guess — so the panel lists all three
// candidates honestly, each with its own "route me there" button.
function YasirPanel({
  docks,
  lang,
  onRoute,
  onClose,
}: {
  docks: YasirDock[]
  lang: 'es' | 'en'
  onRoute: (dock: YasirDock) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="pointer-events-auto w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5" style={{ color: YASIR_TEAL }}>
          <img src={YASIR_SPRITE} alt="" className="h-6 w-6 shrink-0 [image-rendering:pixelated]" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.yasirTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm leading-relaxed text-fg-dim">{t('map.yasirNote')}</p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {docks.map((d) => (
            <li key={d.city} className="flex items-center gap-2 rounded-lg border border-line-2 p-2">
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-sm font-bold text-fg">{d.city}</span>
                <span className="truncate text-xs text-fg-mute">{d.spot[lang]}</span>
              </span>
              <button
                type="button"
                onClick={() => onRoute(d)}
                title={t('map.rashidRoute')}
                aria-label={`${t('map.routeToSpawn')} — ${d.city}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition"
                style={{ borderColor: `${YASIR_TEAL}80`, color: YASIR_TEAL, background: `${YASIR_TEAL}1a` }}
              >
                <Icon name="compass" size={14} />
                {t('map.routeToSpawn')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// A published community route from GET /api/routes (ranked by likes, then loads).
type CommunityRoute = {
  id: number
  name: string
  description: string | null
  waypoints: [number, number, number][]
  connect: 'auto' | 'straight'
  author: string | null
  views: number
  likes: number
  created_at: string
}

// Lucide-style line-icon paths (24x24), matching the rest of the UI — a real
// icon set reads far clearer than glyphs.
const POI_ICONS = {
  // skull — spawns & bosses
  boss: 'M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20',
  // up/down arrows — travel between floors (teleports, stairs, holes, levitate)
  travel: 'M3 16l4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16',
  // shopping bag — services (depot, bank, store, trainer)
  service:
    'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  // scroll — quest mechanics (levers, chests, missions)
  quest:
    'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3M19 17V5a2 2 0 0 0-2-2H4',
  // map pin — everything else
  poi: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
} as const

// Colour + icon for a marker, inferred from its description so the overlay reads
// at a glance: red = spawns/bosses, blue = travel/access, green = services,
// gold = quest mechanics, violet = everything else.
function poiStyle(desc: string): { color: string; icon: string } {
  const d = desc.toLowerCase()
  if (/spawn|boss|raid|\blair\b/.test(d)) return { color: '#d23d2f', icon: POI_ICONS.boss }
  if (/teleport|exit|entrance|portal|stair|ladder|\bhole\b|way to|shortcut|levitate|rope spot|passage|tunnel|harbour|harbor|boat|ship/.test(d))
    return { color: '#3fa7d6', icon: POI_ICONS.travel }
  if (/depot|\bbank\b|store|shop|market|trainer|training|offline|magic store|post/.test(d))
    return { color: '#6cc551', icon: POI_ICONS.service }
  if (/quest|lever|switch|chest|mission|reward|book|\bkey\b|door|sign|note|mechanism|button|pull|painting|pick hole|dig/.test(d))
    return { color: '#e0a531', icon: POI_ICONS.quest }
  return { color: '#9b8cff', icon: POI_ICONS.poi }
}

// Core element accent colours (mirrors CreatureCombat's palette) for the Hunt
// Finder's "hit with" / "resists" chips, so the two panels read as one system.
const HUNT_ELEMENT_COLOR: Record<string, string> = {
  physical: '#8a8578', fire: '#c0592f', energy: '#7d5aa8', ice: '#4f8fb0',
  earth: '#5f8a3e', holy: '#c69a3a', death: '#6d5a86',
}

// Normalise a TibiaData vocation label ("Elite Knight", "Royal Paladin") to a
// base vocation slug the Hunt Finder API expects, or '' if unrecognised.
function baseVocation(v: string): string {
  const s = v.toLowerCase()
  return (['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const).find((b) => s.includes(b)) ?? ''
}

// Compact one-line stat hint for a gear-picker row: the numbers that tell two
// candidates apart at a glance (armor / attack / defense, then resists).
function gearHint(it: EntryListItem): string {
  const s = it.item
  if (!s) return ''
  const parts: string[] = []
  if (s.armor) parts.push(`Arm ${s.armor}`)
  const atk = (s.attack ?? 0) + (s.element_attack ?? 0)
  if (atk) parts.push(`Atk ${atk}${s.element_attack_type ? ` ${s.element_attack_type}` : ''}`)
  if (s.defense) parts.push(`Def ${s.defense}`)
  const res = Object.entries(s.resists ?? {}).filter(([, p]) => p !== 0)
  if (res.length) parts.push(res.map(([el, p]) => `${el} ${p > 0 ? '+' : ''}${p}%`).join(' '))
  return parts.slice(0, 3).join(' · ')
}

// One labelled horizontal bar of the set-stats readout (resists, skills).
// `pct` is the fill 0-100 (pre-scaled by the caller); a minimum sliver keeps
// tiny values visible. Negative stats arrive with a red `color`.
function StatBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs font-semibold text-fg-dim">{label}</span>
      <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/50">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.min(100, Math.max(5, pct))}%`, background: color }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

// A zone/creature danger number (fraction of your effective HP a big hit takes)
// bucketed into a safe/risky/deadly label + colour for the panel.
function dangerBand(d: number): { key: 'huntDangerLow' | 'huntDangerMed' | 'huntDangerHigh'; color: string } {
  if (d < 0.35) return { key: 'huntDangerLow', color: '#2f9e5a' }
  if (d < 0.7) return { key: 'huntDangerMed', color: '#d08a1e' }
  return { key: 'huntDangerHigh', color: '#c0392b' }
}

// Safety ceiling on how many creature sprites to draw at once (the screen-grid
// de-duplication normally keeps it far below this).
const SPRITE_CAP = 1200

// Max rows rendered in the houses panel list (the "rented" / "all" filters can
// match ~1000 houses; cap keeps the DOM light, with a "+N more" note).
const HOUSE_LIST_CAP = 150

const inTileBounds = (x: number, y: number) =>
  x >= X_MIN && x < X_MAX && y >= Y_MIN && y < Y_MAX

// Group nearby spawns (same floor, within `threshold` tiles) into clusters so
// "next spawn" jumps to a different hunting area, not the adjacent tile.
// Clusters are scored for task/bounty hunting: many creatures packed into a
// small area rank highest (kill the quota fast, walk little), so clusters[0]
// is the recommended "best spawn".
function clusterSpawns(spawns: Spawn[], threshold = 40): Cluster[] {
  const acc: {
    sx: number
    sy: number
    x: number
    y: number
    z: number
    count: number
    minx: number
    maxx: number
    miny: number
    maxy: number
  }[] = []
  for (const s of spawns) {
    let hit = null
    for (const c of acc) {
      if (c.z === s.z && Math.abs(c.x - s.x) <= threshold && Math.abs(c.y - s.y) <= threshold) {
        hit = c
        break
      }
    }
    if (hit) {
      hit.sx += s.x
      hit.sy += s.y
      hit.count++
      hit.x = Math.round(hit.sx / hit.count)
      hit.y = Math.round(hit.sy / hit.count)
      if (s.x < hit.minx) hit.minx = s.x
      if (s.x > hit.maxx) hit.maxx = s.x
      if (s.y < hit.miny) hit.miny = s.y
      if (s.y > hit.maxy) hit.maxy = s.y
    } else {
      acc.push({ sx: s.x, sy: s.y, x: s.x, y: s.y, z: s.z, count: 1, minx: s.x, maxx: s.x, miny: s.y, maxy: s.y })
    }
  }
  return acc
    .map((c) => {
      // spread = longest side of the cluster's bounding box (tiles). A tight,
      // dense cluster beats a loose one of similar size: a spread equal to the
      // clustering threshold halves the score.
      const spread = Math.max(c.maxx - c.minx, c.maxy - c.miny)
      return { x: c.x, y: c.y, z: c.z, count: c.count, score: c.count / (1 + spread / threshold) }
    })
    .sort((a, b) => b.score - a.score)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

// Leaflet popup HTML for a house marker: name, type + town, size/beds, rent,
// (when the ETL has run for the chosen world) its live rent status, and a bell
// button to add/remove it from the client-side alert list. `watched` colours the
// bell; the button carries data-house-watch so renderHouses can wire the click.
function housePopup(h: House, t: (k: string) => string, watched: boolean): string {
  const kind = h.guild ? t('map.houseGuildhall') : t('map.houseHouse')
  const where = h.town ? `${kind} · ${escapeHtml(h.town)}` : kind
  const meta = [
    `${h.size} ${t('map.houseSqm')}`,
    h.beds ? `${h.beds} ${t('map.houseBeds')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  let live = ''
  if (h.live) {
    const label =
      h.live.status === 'free'
        ? t('map.houseFree')
        : h.live.status === 'auctioned'
          ? `${t('map.houseAuctioned')}${h.live.bid ? ` · ${fmtGold(h.live.bid)}` : ''}${h.live.bidder ? ` · ${escapeHtml(h.live.bidder)}` : ''}`
          : `${t('map.houseRented')}${h.live.owner ? ` · ${escapeHtml(h.live.owner)}` : ''}`
    const col = h.live.status === 'free' ? '#2f9e5a' : h.live.status === 'auctioned' ? '#d08a1e' : '#a13d3d'
    // data-house-live lets buildHousePopupEl patch the owner in once its
    // on-demand lookup answers (the bulk status feed carries no owner names).
    live = `<div data-house-live style="margin-top:3px;font-size:11px;font-weight:600;color:${col}">${label}</div>`
  }
  const bellLabel = watched ? t('map.houseUnwatch') : t('map.houseWatch')
  const bellCol = watched ? '#b3873f' : 'currentColor'
  const bell =
    `<button type="button" data-house-watch="${h.id}" ` +
    `style="margin-top:6px;display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;` +
    `border:1px solid ${watched ? '#b3873f' : 'rgba(140,140,140,.55)'};background:${watched ? 'rgba(179,135,63,.14)' : 'transparent'};` +
    `color:${bellCol};font-size:11px;font-weight:600;cursor:pointer;line-height:1.2">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>` +
    `<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span data-bell-label>${escapeHtml(bellLabel)}</span></button>`
  return (
    `<div style="min-width:150px"><div style="font-weight:700">${escapeHtml(h.name)}</div>` +
    `<div style="opacity:.6;font-size:11px;margin-top:1px">${where}</div>` +
    `<div style="opacity:.6;font-size:11px">${meta}</div>` +
    `<div style="font-size:11px;margin-top:2px">${t('map.houseRent')}: ${fmtGold(h.rent)} ${t('map.houseGoldMonth')}</div>` +
    live +
    `<div style="opacity:.45;font-size:10px;margin-top:2px">${h.x}, ${h.y}, z${h.z}</div>` +
    bell +
    `</div>`
  )
}

// Draw a route's legs onto a layer group for the floor in view: walk polylines
// (ink on parchment), boat hops (dashed) and stair/rope/shovel/levitate
// floor-change badges. Shared by the "how to get there" directions and the
// manual route builder so both render identically. `floorWord` is the localized
// "Floor" label; `onFloorJump` switches the map to a leg's destination floor.
function drawRouteLegs(
  grp: L.LayerGroup,
  legs: RouteLeg[],
  floor: number,
  floorWord: string,
  floorLabel: (f: number) => string,
  onFloorJump: (f: number) => void,
) {
  for (const leg of legs) {
    if (leg.kind === 'walk') {
      if (leg.floor !== floor || leg.path.length < 2) continue
      const latlngs = leg.path.map((p) => toLatLng(p.x, p.y))
      grp.addLayer(
        L.polyline(latlngs, { color: '#f4e7c6', weight: 7, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }),
      )
      grp.addLayer(
        L.polyline(latlngs, { color: '#3b2313', weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }),
      )
    } else if (leg.kind === 'boat') {
      if (floor !== leg.fromFloor && floor !== leg.toFloor) continue
      const seg = [toLatLng(leg.from.x, leg.from.y), toLatLng(leg.to.x, leg.to.y)]
      grp.addLayer(
        L.polyline(seg, { color: '#3b2313', weight: 5, opacity: 0.55, dashArray: '2 9', lineCap: 'round' }),
      )
      grp.addLayer(
        L.polyline(seg, { color: '#f4e7c6', weight: 2.5, opacity: 0.95, dashArray: '2 9', lineCap: 'round' }),
      )
      grp.addLayer(
        L.marker(toLatLng((leg.from.x + leg.to.x) / 2, (leg.from.y + leg.to.y) / 2), {
          icon: L.divIcon({
            className: '',
            html: `<div class="tm-route-boat">${iconMarkup(leg.icon)} ${escapeHtml(leg.toName)}</div>`,
            iconSize: [0, 0],
          }),
          interactive: false,
        }),
      )
    } else if (leg.kind === 'stairs') {
      if (leg.floor !== floor) continue
      const glyph =
        leg.tool === 'rope' ? iconMarkup('rope') : leg.tool === 'shovel' ? iconMarkup('pickaxe') : leg.tool === 'levitate' ? iconMarkup('sparkles') : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'
      const cls = leg.dir === 'down' ? 'is-down' : leg.dir === 'up' ? 'is-up' : 'is-tp'
      grp.addLayer(
        L.marker(toLatLng(leg.from.x, leg.from.y), {
          icon: L.divIcon({
            className: '',
            html: `<div class="tm-route-stair ${cls}">${glyph} ${escapeHtml(floorWord)} ${floorLabel(leg.toFloor)}</div>`,
            iconSize: [0, 0],
          }),
        }).on('click', () => onFloorJump(leg.toFloor)),
      )
    }
  }
}

// --- profit-heat ramp ---------------------------------------------------------
// The "all creatures" dots are tinted by a per-spawn profit score (a creature's
// loot gold, averaged per spot with a light spawn-density nudge). The ramp follows
// Tibia's coin value: the warm half (red → orange → gold) is the poor-to-mediocre
// range, the cool half (teal → blue) the genuinely rich spots. Five stops, so a
// bad earner (a dragon) reads as clearly warm, not lumped in with the mid greens.
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [200, 52, 44]], // red — poorest
  [0.22, [226, 110, 42]], // orange — bad
  [0.45, [222, 170, 55]], // gold/amber — mediocre
  [0.72, [63, 183, 167]], // teal — good
  [1.0, [70, 120, 214]], // blue — richest (crystal)
]
const HEAT_STEPS = 16
// Profit colour is a creature's RANK among all the regular creatures we have, not
// a log of its raw gold — a log squashes a 188-gp dragon and a 1,131-gp medusa
// almost together, so everything decent looked mid-green. These are the gold-per-
// kill values (loot items + coins, drop-weighted; see tibia:etl-loot-stats) at
// each 5th percentile of our 648 regular creatures, so the scale is derived from
// the real population. A creature richer than the top regular (or a boss) clamps
// to 1. Update if the loot dataset shifts a lot.
const PROFIT_PCTS = [
  1, 6, 15, 28, 42, 65, 116, 165, 211, 317, 419, 599, 750, 967, 1225, 1514, 1856,
  2534, 3945, 5914, 54332,
] // index i ⇒ the i·5th percentile gold-per-kill
// Fraction (0..1) of regular creatures a given gold-per-kill outranks, by linear
// interpolation between the baked percentile breakpoints.
function profitPercentile(gpk: number): number {
  const bp = PROFIT_PCTS
  const last = bp.length - 1
  if (gpk <= bp[0]) return 0
  if (gpk >= bp[last]) return 1
  for (let i = 0; i < last; i++) {
    if (gpk < bp[i + 1]) {
      const frac = (gpk - bp[i]) / (bp[i + 1] - bp[i] || 1)
      return (i + frac) / last
    }
  }
  return 1
}
// The colour score: percentile rank, then a smoothstep so the warm half stays
// warm (poor earners → red/orange) but everything past mid-table climbs quickly
// into teal/blue — decent hunts should read as decent, not lukewarm.
function profitScore(gpk: number): number {
  const p = profitPercentile(Math.max(0, gpk))
  return p * p * (3 - 2 * p)
}
function heatRgb(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (c <= HEAT_STOPS[i][0]) {
      const [t0, a] = HEAT_STOPS[i - 1]
      const [t1, b] = HEAT_STOPS[i]
      const k = (c - t0) / (t1 - t0 || 1)
      return [
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
      ]
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1]
}
// Quantised palette (fill + radius per step) so the canvas paints each colour
// bucket in a single pass; hotter spots also draw a touch larger to stand out.
const HEAT_PALETTE = Array.from({ length: HEAT_STEPS }, (_, i) => {
  const t = i / (HEAT_STEPS - 1)
  const [r, g, b] = heatRgb(t)
  return { fill: `rgb(${r},${g},${b})`, radius: 5.5 + 3.5 * t }
})
function heatCss(t: number): string {
  const [r, g, b] = heatRgb(t)
  return `rgb(${r},${g},${b})`
}
// The same ramp as a CSS gradient, for the on-map profit legend.
const HEAT_GRADIENT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(
  ([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`,
).join(', ')})`
// Compact gp label for the spawn money badges: 950, 12k, 1.4M.
function fmtGold(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'k'
  return String(Math.round(n))
}

// World-tile neighbourhood that a dot's colour is averaged over.
const DENSITY_CELL = 32
// Colour each spawn by how rich its spot is: the average loot score (an absolute
// rank, see profitScore) of the spawns sharing its ~32-tile cell. Scores already
// mean the same thing on every floor, so there's no per-floor renormalisation —
// a poor corner stays warm and a rich one is blue wherever it is. Bosses average
// in like anything else and, being top-rank, pull their own cell to blue.
// Returns per-point palette indices aligned to `points`, or null when there's no
// loot signal at all.
function computeHeat(
  points: [number, number, number][],
  scores: number[],
): Uint8Array | null {
  if (!points.length || !scores.length) return null
  if (!scores.some((s) => s > 0)) return null
  const cellSum = new Map<string, number>()
  const cellCount = new Map<string, number>()
  const keys: string[] = new Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const k = Math.floor(p[0] / DENSITY_CELL) + '_' + Math.floor(p[1] / DENSITY_CELL)
    keys[i] = k
    cellSum.set(k, (cellSum.get(k) ?? 0) + (scores[p[2]] ?? 0))
    cellCount.set(k, (cellCount.get(k) ?? 0) + 1)
  }
  const out = new Uint8Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const k = keys[i]
    const t = Math.min(1, (cellSum.get(k) ?? 0) / (cellCount.get(k) ?? 1))
    out[i] = Math.round(t * (HEAT_STEPS - 1))
  }
  return out
}

// --- overlay performance helpers ----------------------------------------------

// The "all creatures" dots painted onto one canvas in a single pass. As
// individual L.circleMarkers a floor carries ~10k layer objects that must be
// rebuilt on every floor/filter change and repainted one by one — a single
// canvas draws the same picture in a couple of milliseconds. `heat` (aligned to
// `pts`) carries each dot's profit-palette index; when omitted the dots fall
// back to the classic uniform orange.
type DotsLayer = L.Layer & {
  setData(pts: [number, number, number][], heat?: Uint8Array): void
}
const DotCanvas = L.Layer.extend({
  setData(pts: [number, number, number][], heat?: Uint8Array) {
    ;(this as { _pts?: unknown })._pts = pts
    ;(this as { _heat?: unknown })._heat = heat
    if ((this as { _map?: L.Map })._map) (this as { _redraw(): void })._redraw()
  },
  onAdd(map: L.Map) {
    // `leaflet-layer` gives the canvas `position:absolute; left:0; top:0`.
    // `leaflet-zoom-hide` makes Leaflet hide the canvas for the duration of the
    // zoom animation (visibility:hidden while the map pane carries
    // `leaflet-zoom-anim`) — exactly what it does to the DOM marker panes that
    // hold the creature sprites and POIs. So the dots and their sprites hide
    // together mid-zoom and are redrawn together on zoomend/moveend, staying
    // locked to each other. (Keeping the canvas visible and transforming it
    // per-frame instead left the dots drifting out of their orange circle while
    // the map scaled, since the sprites they sit under are hidden meanwhile.)
    const canvas = L.DomUtil.create('canvas', 'leaflet-layer leaflet-zoom-hide')
    canvas.style.pointerEvents = 'none'
    ;(this as { _canvas?: HTMLCanvasElement })._canvas = canvas
    map.getPanes().overlayPane.appendChild(canvas)
    map.on('moveend resize zoomend', (this as { _reset(): void })._reset, this)
    ;(this as { _reset(): void })._reset()
    return this
  },
  onRemove(map: L.Map) {
    map.off('moveend resize zoomend', (this as { _reset(): void })._reset, this)
    ;(this as { _canvas: HTMLCanvasElement })._canvas.remove()
    return this
  },
  _reset() {
    const map = (this as { _map: L.Map })._map
    L.DomUtil.setPosition(
      (this as { _canvas: HTMLCanvasElement })._canvas,
      map.containerPointToLayerPoint([0, 0]),
    )
    ;(this as { _redraw(): void })._redraw()
  },
  _redraw() {
    const map = (this as { _map: L.Map })._map
    const canvas = (this as { _canvas: HTMLCanvasElement })._canvas
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    const pts = ((this as { _pts?: [number, number, number][] })._pts ?? [])
    if (!pts.length) return
    const heat = (this as { _heat?: Uint8Array })._heat
    const RMAX = 9
    ctx.lineWidth = 1
    ctx.strokeStyle = '#2a0d00'
    if (!heat) {
      // No profit signal: fall back to the classic uniform orange dot.
      const R = 7
      ctx.beginPath()
      for (const p of pts) {
        const pt = map.latLngToContainerPoint([-p[1], p[0]])
        if (pt.x < -R || pt.y < -R || pt.x > size.x + R || pt.y > size.y + R) continue
        ctx.moveTo(pt.x + R, pt.y)
        ctx.arc(pt.x, pt.y, R, 0, Math.PI * 2)
      }
      ctx.globalAlpha = 0.9
      ctx.fillStyle = '#ff7a33'
      ctx.fill()
      ctx.globalAlpha = 0.6
      ctx.stroke()
      ctx.globalAlpha = 1
      return
    }
    // Bucket the visible dots by their heat step, so each colour paints in a
    // single fill pass (project every point once, not once per palette step).
    const byStep: number[][] = Array.from({ length: HEAT_STEPS }, () => [])
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const pt = map.latLngToContainerPoint([-p[1], p[0]])
      if (pt.x < -RMAX || pt.y < -RMAX || pt.x > size.x + RMAX || pt.y > size.y + RMAX) continue
      const step = heat[i] ?? 0
      const arr = byStep[step] ?? byStep[0]
      arr.push(pt.x, pt.y)
    }
    // Coolest → hottest, so richer spots paint on top of the cold background.
    for (let s = 0; s < HEAT_STEPS; s++) {
      const arr = byStep[s]
      if (!arr.length) continue
      const { fill, radius } = HEAT_PALETTE[s]
      ctx.beginPath()
      for (let j = 0; j < arr.length; j += 2) {
        ctx.moveTo(arr[j] + radius, arr[j + 1])
        ctx.arc(arr[j], arr[j + 1], radius, 0, Math.PI * 2)
      }
      ctx.globalAlpha = 0.9
      ctx.fillStyle = fill
      ctx.fill()
      ctx.globalAlpha = 0.45
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  },
})

// Incrementally sync a layer group with the wanted marker set: keys that
// survive keep their existing marker (no DOM churn while panning), the rest
// are added/removed. `epoch` names the inputs the cache was built from — when
// it changes (zoom, floor, filter set…) the whole group is rebuilt.
type MarkerCache = { epoch: string; markers: Map<string, L.Marker> }
function syncMarkers(
  grp: L.LayerGroup,
  cache: MarkerCache,
  epoch: string,
  wanted: Map<string, () => L.Marker>,
) {
  if (cache.epoch !== epoch) {
    grp.clearLayers()
    cache.markers.clear()
    cache.epoch = epoch
  }
  for (const [key, mk] of cache.markers) {
    if (wanted.has(key)) continue
    if (mk.isPopupOpen()) continue // keep an open popup anchored while panning
    grp.removeLayer(mk)
    cache.markers.delete(key)
  }
  for (const [key, make] of wanted) {
    if (!cache.markers.has(key)) {
      const mk = make()
      mk.addTo(grp)
      cache.markers.set(key, mk)
    }
  }
}

// --- URL hash <-> map state ---------------------------------------------------
// Format: #f=<floor>&z=<zoom>&x=<cx>&y=<cy>&m=<x,y,f,label>;<...>&c=<slug>,<slug>
//         &r=<sx,sy,sf,slabel>;<ex,ey,ef,elabel>   (route: start ; end)
function encodeMarkers(markers: Marker[]): string {
  return markers
    .map((m) => [Math.round(m.x), Math.round(m.y), m.floor, encodeURIComponent(m.label)].join(','))
    .join(';')
}

// A route endpoint as stored in the URL hash. Structurally matches the
// component's RoutePoint so restored values drop straight into state.
type HashRoutePoint = { x: number; y: number; floor: number; label?: string }

function encodeRoutePoint(p: HashRoutePoint | null): string {
  return p ? [Math.round(p.x), Math.round(p.y), p.floor, encodeURIComponent(p.label ?? '')].join(',') : ''
}

function decodeRoutePoint(chunk: string): HashRoutePoint | null {
  if (!chunk) return null
  const [rx, ry, rf, ...rest] = chunk.split(',')
  if (!rx || !ry || !rf) return null
  const label = decodeURIComponent(rest.join(',') || '')
  return { x: Number(rx), y: Number(ry), floor: Number(rf), label: label || undefined }
}

// A manually built route restored from the hash: ordered waypoints, how they
// connect, and an optional name.
type HashBuild = {
  points: { x: number; y: number; floor: number }[]
  connect: 'auto' | 'straight'
  name: string
}

function parseHash(): {
  x?: number
  y?: number
  z?: number
  floor?: number
  markers: Marker[]
  creatures: string[]
  routeStart: HashRoutePoint | null
  routeEnd: HashRoutePoint | null
  build: HashBuild | null
} {
  const h = window.location.hash.replace(/^#/, '')
  const parts: Record<string, string> = {}
  for (const kv of h.split('&')) {
    if (!kv) continue
    const i = kv.indexOf('=')
    if (i === -1) continue
    parts[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const num = (k: string) => (parts[k] != null && parts[k] !== '' ? Number(parts[k]) : undefined)
  const markers: Marker[] = []
  if (parts.m) {
    for (const chunk of parts.m.split(';')) {
      if (!chunk) continue
      const [mx, my, mf, ...rest] = chunk.split(',')
      if (mx && my && mf) {
        markers.push({
          id: crypto.randomUUID(),
          x: Number(mx),
          y: Number(my),
          floor: Number(mf),
          label: decodeURIComponent(rest.join(',') || ''),
        })
      }
    }
  }
  const creatures = parts.c ? parts.c.split(',').filter(Boolean) : []
  let routeStart: HashRoutePoint | null = null
  let routeEnd: HashRoutePoint | null = null
  if (parts.r) {
    const [s, e] = parts.r.split(';')
    routeStart = decodeRoutePoint(s ?? '')
    routeEnd = decodeRoutePoint(e ?? '')
  }
  // Built route: bp = points (x,y,f ; …), bc = connect mode, bn = name.
  let build: HashBuild | null = null
  if (parts.bp) {
    const points: { x: number; y: number; floor: number }[] = []
    for (const chunk of parts.bp.split(';')) {
      if (!chunk) continue
      const [px, py, pf] = chunk.split(',')
      if (px && py && pf) points.push({ x: Number(px), y: Number(py), floor: Number(pf) })
    }
    if (points.length)
      build = {
        points,
        connect: parts.bc === 'auto' ? 'auto' : 'straight',
        name: decodeURIComponent(parts.bn ?? ''),
      }
  }
  return { x: num('x'), y: num('y'), z: num('z'), floor: num('f'), markers, creatures, routeStart, routeEnd, build }
}

// --- item trade pins -----------------------------------------------------------
// A merchant on the trade layer, with both sides of the deal merged: buyPrice =
// what YOU pay to buy from the NPC, sellPrice = what the NPC pays you.
type TradePin = {
  npc: string
  city: string | null
  currency: string | null
  buyPrice: number | null
  sellPrice: number | null
  coords: [number, number, number][]
}

// Marker budget (markers, not merchants) — a mass-market item like mana potion
// has 31 sellers; both API lists arrive best-price-first so the cut keeps winners.
const TRADE_PIN_CAP = 60

function mergeTradePins(trade: ItemTrade): TradePin[] {
  const byNpc = new Map<string, TradePin>()
  const add = (offers: ItemTrade['buy'], side: 'buy' | 'sell') => {
    for (const o of offers) {
      if (!o.coords || o.coords.length === 0) continue
      let pin = byNpc.get(o.npc)
      if (!pin) {
        pin = {
          npc: o.npc,
          city: o.city,
          currency: o.currency,
          buyPrice: null,
          sellPrice: null,
          coords: o.coords,
        }
        byNpc.set(o.npc, pin)
      }
      if (side === 'buy') pin.buyPrice = o.price
      else pin.sellPrice = o.price
    }
  }
  add(trade.buy, 'buy')
  add(trade.sell, 'sell')

  const pins: TradePin[] = []
  let markers = 0
  for (const pin of byNpc.values()) {
    markers += pin.coords.length
    if (markers > TRADE_PIN_CAP) break
    pins.push(pin)
  }
  return pins
}

// lucide "shopping bag", inlined like the other divIcon glyphs.
const TRADE_PIN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'

// --- immersive map "hotbar" styling -------------------------------------------
// A compact row of square icon slots: the search field stays the hero, and every
// secondary action collapses into a tooltip-labelled icon. PILL is the slotted
// bar that groups them; SLOT/SLOT_ON/SLOT_OFF style each slot.
const PILL =
  'pointer-events-auto inline-flex flex-wrap items-center gap-1 rounded-2xl border border-line-2 bg-surface/95 p-1.5 shadow-lg backdrop-blur-md [&_svg]:[stroke-width:2.25]'
const SLOT = 'grid h-11 w-11 place-items-center rounded-lg border transition'
const SLOT_OFF =
  'border-line-2 bg-bg-2 text-fg hover:border-accent hover:bg-surface hover:text-accent'
const SLOT_ON = 'border-accent bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'

// A collapsible cluster of hotbar slots that belong to the same family (routes,
// markers…). It mirrors the Houses layer's "sprout up" pattern: a single primary
// slot in the bar; when opened, its sibling actions grow straight UP from it,
// joined by a little trunk, so they read clearly as "these belong together". The
// primary slot lights up (and shows a count badge) whenever any child is engaged,
// so nothing is hidden — you can always tell a group is active at a glance.
// Self-contained open state; clicking outside closes it.
function HotbarGroup({
  icon,
  label,
  accent = 'var(--color-accent)',
  active = false,
  badge,
  children,
}: {
  icon: ReactNode
  label: string
  // Trunk colour + primary tint when engaged (defaults to the accent).
  accent?: string
  // Whether any child action is currently on (lights the primary slot).
  active?: boolean
  badge?: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative flex items-center">
      {open && (
        <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5">
          {/* trunk connecting the branch down to the primary slot */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1 -bottom-2.5 -z-10 w-0.5 -translate-x-1/2 rounded"
            style={{ background: accent, opacity: 0.45 }}
          />
          {children}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className={`relative ${SLOT} ${active || open ? SLOT_ON : SLOT_OFF}`}
      >
        {icon}
        {badge != null && badge > 0 && (
          <span
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ background: accent }}
          >
            {badge}
          </span>
        )}
      </button>
    </div>
  )
}

// Blessings live in ONE hotbar slot: a shrine icon that, when clicked, asks
// which pilgrimage you mean — the five cheap blessings or the full seven. The
// question unfolds sideways from the slot itself (the column above it is taken
// by the other tools), and picking one folds it back. Kept inside the group's
// children so collapsing the group forgets the question.
function BlessPicker({
  label,
  fiveLabel,
  sevenLabel,
  value,
  onPick,
}: {
  label: string
  fiveLabel: string
  sevenLabel: string
  // Which pilgrimage is currently plotted, if any.
  value: 'five' | 'seven' | null
  onPick: (set: 'five' | 'seven') => void
}) {
  const [asking, setAsking] = useState(false)
  const shrine = (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M7 8h10" />
      <path d="M12 21c-3 0-5-1.5-5-3h10c0 1.5-2 3-5 3z" />
    </svg>
  )
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setAsking((v) => !v)}
        title={label}
        aria-label={label}
        aria-expanded={asking}
        className={`${SLOT} ${asking || value ? SLOT_ON : SLOT_OFF}`}
      >
        {shrine}
      </button>
      {asking &&
        ([
          { set: 'five' as const, n: '5', title: fiveLabel },
          { set: 'seven' as const, n: '7', title: sevenLabel },
        ]).map((o) => (
          <button
            key={o.set}
            type="button"
            onClick={() => {
              onPick(o.set)
              setAsking(false)
            }}
            title={o.title}
            aria-label={o.title}
            aria-pressed={value === o.set}
            className={`${SLOT} ${value === o.set ? SLOT_ON : SLOT_OFF}`}
          >
            <span className="text-base font-black">{o.n}</span>
          </button>
        ))}
    </div>
  )
}

// Quick-launch "mini windows" floated on the map: shortcuts to the site's games
// and stats. Titles/taglines reuse the existing nav + section-kicker i18n keys.
const QUICK_LINKS: { to: string; title: string; kicker: string; icon: string }[] = [
  // wordle grid
  { to: '/wordle', title: 'nav.wordle', kicker: 'wordle.kicker', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' },
  // sparkles (daily silhouette game)
  {
    to: '/altar',
    title: 'nav.altar',
    kicker: 'altar.kicker',
    icon: 'M12 3l-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z',
  },
  // compass (daily zone game)
  {
    to: '/geo',
    title: 'nav.geo',
    kicker: 'geo.kicker',
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
  },
  // bar chart
  { to: '/killstats', title: 'nav.killstats', kicker: 'ks.kicker', icon: 'M3 3v18h18M8 17V9M13 17v-5M18 17V6' },
]

// Route origin/destination picker. Replaces the native <select> so the popup
// carries the atlas styling (framed paper, themed scrollbar) instead of the
// OS's un-themable listbox. Behaves like a select: a coloured status dot, a
// button showing the current label, and a scrollable menu of the cities.
function RouteCityPicker({
  placeholder,
  valueLabel,
  pointLabel,
  dotClass,
  onSelect,
  onClear,
}: {
  placeholder: string
  // The selected landmark's name, or null when unset / a raw map point.
  valueLabel: string | null
  // A non-landmark endpoint's display label (clicked point / plotted spawn).
  pointLabel: string | null
  dotClass: string
  onSelect: (name: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const isEmpty = !valueLabel && !pointLabel
  const display = valueLabel ?? pointLabel ?? placeholder
  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass} ring-2 ring-white/80`} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 min-w-[8.5rem] max-w-[12rem] items-center gap-1.5 rounded-lg border border-line bg-bg-2 pl-2.5 pr-2 text-sm font-semibold outline-none transition hover:border-line-2 focus:border-accent"
      >
        <span className={`min-w-0 flex-1 truncate text-left ${isEmpty ? 'text-fg-mute' : 'text-fg'}`}>
          {display}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-fg-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="scroll-atlas absolute left-0 top-full z-[1100] mt-1 max-h-72 w-56 overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl"
        >
          <li>
            <button
              type="button"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              className="flex w-full items-center px-4 py-2 text-left text-sm font-medium text-fg-mute transition hover:bg-surface-2"
            >
              {placeholder}
            </button>
          </li>
          {LANDMARKS.map((l) => {
            const active = l.name === valueLabel
            return (
              <li key={l.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(l.name)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center px-4 py-2 text-left text-sm transition hover:bg-surface-2 ${
                    active ? 'font-bold text-accent' : 'font-medium text-fg'
                  }`}
                >
                  {l.name}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Global world switcher, rendered as a chip below the quick-links stack in the
// bottom-right. Shows the active world by name (it drives both the Boss Watch's
// per-world heat and the houses layer's live rent status) and pops a themed menu
// upward — the whole stack is pinned to the bottom of the screen.
function WorldPicker({
  worlds,
  value,
  label,
  onSelect,
}: {
  worlds: string[]
  value: string
  label: string
  onSelect: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}: ${value}`}
        aria-label={`${label}: ${value}`}
        className="group flex items-center gap-2 rounded-lg border border-line-2 bg-bg-2/90 px-2.5 py-1.5 shadow-lg backdrop-blur-md transition hover:-translate-x-0.5 hover:border-accent"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent transition group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
        </svg>
        <span className="text-[10px] font-bold uppercase leading-none tracking-widest text-fg-mute">{label}</span>
        <span className="text-xs font-bold leading-none text-fg">{value}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="scroll-atlas absolute bottom-full right-0 z-[1100] mb-2 max-h-72 w-44 overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl"
        >
          {worlds.map((w) => {
            const active = w === value
            return (
              <li key={w}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(w)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-surface-2 ${
                    active ? 'font-bold text-accent' : 'font-medium text-fg'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                  </svg>
                  {w}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Floor stepper — a compact "current floor + up/down arrows" control pinned to
// the right edge. The arrows step one floor at a time (up = toward the sky, i.e.
// a higher altitude / lower internal index); tapping the current-floor number
// opens a scrollable list of every floor to jump directly. Replaces the tall
// 16-button pad that crowded the right edge and overlapped the other controls.
function FloorStepper({
  floor,
  surface,
  floors,
  floorWord,
  onSelect,
}: {
  floor: number
  surface: number
  floors: number[]
  floorWord: string
  onSelect: (f: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  // Centre the current floor in the list each time it opens.
  useEffect(() => {
    if (!open) return
    const active = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ block: 'center' })
  }, [open])
  const relLabel = (f: number) => {
    const rel = surface - f // +N above surface, -N below
    return rel === 0 ? '0' : rel > 0 ? `+${rel}` : `${rel}`
  }
  const canUp = floor > 0 // a higher floor (toward +N)
  const canDown = floor < floors.length - 1
  return (
    <div
      ref={ref}
      className="pointer-events-auto relative flex flex-col items-center gap-1 rounded-xl border border-line bg-bg/90 p-1.5 shadow-lg backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => onSelect(Math.max(0, floor - 1))}
        disabled={!canUp}
        title={`${floorWord} +`}
        aria-label={`${floorWord} +`}
        className="grid h-7 w-9 place-items-center rounded-lg text-fg-mute transition hover:bg-line/40 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={floorWord}
        className={`grid h-9 w-9 place-items-center rounded-lg text-[13px] font-bold tabular-nums transition ${
          open ? 'bg-accent text-white' : 'bg-line/40 text-fg hover:bg-line'
        }`}
      >
        {relLabel(floor)}
      </button>
      <button
        type="button"
        onClick={() => onSelect(Math.min(floors.length - 1, floor + 1))}
        disabled={!canDown}
        title={`${floorWord} -`}
        aria-label={`${floorWord} -`}
        className="grid h-7 w-9 place-items-center rounded-lg text-fg-mute transition hover:bg-line/40 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Full floor list — opens to the LEFT of the stepper (it's pinned to the
          right edge) so it never spills off-screen; scrolls if the floors
          outgrow the viewport. */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="scroll-atlas absolute right-full top-1/2 z-[1100] mr-2 max-h-[85vh] -translate-y-1/2 space-y-0.5 overflow-y-auto rounded-xl border-2 border-line bg-bg-2 p-1.5 shadow-2xl"
        >
          {floors.map((f) => {
            const active = f === floor
            return (
              <li key={f}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onClick={() => {
                    onSelect(f)
                    setOpen(false)
                  }}
                  className={`flex w-12 items-center justify-center rounded px-2 py-1.5 text-sm font-bold tabular-nums transition ${
                    active
                      ? 'bg-accent text-white'
                      : f === surface
                        ? 'bg-line/40 text-fg hover:bg-line'
                        : 'text-fg-mute hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {relLabel(f)}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// The in-map lore reader: fetches a published entry and renders its story
// (overview → canon → interpretations) with the same auto-linking as the full
// article page, plus a link out to that page. Floats bottom-centre like the
// hunt/house panels so it never covers the map controls.
// The "Analyze zone" verdict: what lives inside the drag-selected rectangle and
// how it fights. Aggregate first — what the combined damage arrives as, which
// elements to attack with / avoid, how many species shoot from range — then the
// residents, deadliest (biggest real per-turn burst) first. Floats bottom-centre
// like the lore/raid/hunt panels.
function ZonePanel({
  data,
  loading,
  floor,
  onClose,
}: {
  data: ZoneSummary | undefined
  loading: boolean
  floor: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  // Clicked incoming-damage element → "how do I protect myself" advice.
  const [protEl, setProtEl] = useState<string | null>(null)
  const protection = useZoneProtection(protEl)
  const elName = (el: string) => t(`elements.${el}`, { defaultValue: el.replace(/_/g, ' ') })
  const elColor = (el: string) => HUNT_ELEMENT_COLOR[el] ?? '#8a8578'
  // The element palette is tuned for accents; darkened it holds AA contrast as
  // TEXT on the panel's light parchment background.
  const elDark = (el: string) => {
    const hex = elColor(el)
    return '#' + (hex.slice(1).match(/../g) ?? []).map((h) => Math.round(parseInt(h, 16) * 0.62).toString(16).padStart(2, '0')).join('')
  }
  const chip = (el: string, text: string, key?: string) => (
    <span
      key={key ?? el}
      className="rounded-full px-2.5 py-0.5 text-[13px] font-bold"
      style={{ background: `${elColor(el)}26`, color: elDark(el) }}
    >
      {text}
    </span>
  )

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="scroll-atlas pointer-events-auto max-h-[70vh] w-[32rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5 text-[#3fa7d6]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
          <span className="text-[11px] font-bold uppercase tracking-widest">{t('map.zoneTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#3fa7d6] hover:text-[#3fa7d6]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && <Skeleton className="h-24 w-full" />}

        {!loading && data && data.species === 0 && (
          <p className="text-[15px] text-fg-dim">{t('map.zoneEmpty')}</p>
        )}

        {!loading && data && data.species > 0 && (
          <>
            <h3 className="font-serif text-xl font-bold leading-tight text-fg">
              {data.name ?? t('map.zoneTitle')}
            </h3>
            <span className="text-[12px] font-semibold uppercase tracking-wide text-fg-dim">
              {t('map.zoneMeta', { species: data.species, points: data.spawn_points, z: floor })}
            </span>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* What you'll take: element share of the count-weighted burst. */}
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-dim">
                  {t('map.zoneIncoming')}
                </div>
                <div className="flex flex-col gap-1.5">
                  {data.incoming.slice(0, 5).map((i) => (
                    <button
                      key={i.element}
                      onClick={() => setProtEl((cur) => (cur === i.element ? null : i.element))}
                      title={t('map.zoneProtectHint')}
                      className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-surface ${protEl === i.element ? 'bg-surface ring-1 ring-[#3fa7d6]' : ''}`}
                    >
                      <span className="w-20 shrink-0 truncate text-[13px] font-semibold text-fg">{elName(i.element)}</span>
                      <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-line/50">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(5, i.pct))}%`, background: elColor(i.element) }}
                        />
                      </span>
                      <span className="w-11 shrink-0 text-right text-[13px] font-bold" style={{ color: elDark(i.element) }}>
                        {i.pct}%
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-fg-mute">{t('map.zoneProtectHint')}</p>
              </div>
              {/* What works, what doesn't, who shoots. */}
              <div className="flex flex-col gap-2">
                {data.attack_with.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-fg-dim">
                      {t('map.zoneAttackWith')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {data.attack_with.map((a) =>
                        chip(
                          a.element,
                          `${elName(a.element)}${a.avg_pct > 100 ? ` +${a.avg_pct - 100}%` : a.avg_pct < 100 ? ` −${100 - a.avg_pct}%` : ''}`,
                        ),
                      )}
                    </div>
                  </div>
                )}
                {data.avoid.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-fg-dim">
                      {t('map.zoneAvoid')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {data.avoid.map((a) =>
                        chip(
                          a.element,
                          a.immune_species > 0
                            ? `${elName(a.element)} · ${t('map.zoneImmune', { count: a.immune_species })}`
                            : `${elName(a.element)} −${100 - a.avg_pct}%`,
                        ),
                      )}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#3fa7d6]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                  {t('map.zoneRangedLine', { ranged: data.ranged_species, total: data.species })}
                </div>
                {/* Always shown — "nothing here flees" is real information too. */}
                <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  {/* footsteps running off — "these bolt when wounded" */}
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#d08a1e]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 4h6M11 12h6M9 20h6" />
                    <path d="M19 4l2 0M17 12l2 0M15 20l2 0" strokeDasharray="1 3" />
                  </svg>
                  {t('map.zoneFleesLine', { fleeing: data.fleeing_species, total: data.species })}
                </div>
              </div>
            </div>

            {/* "How do I protect myself from <clicked element>": the best
                obtainable resist gear (two per slot, best slots first) plus
                the element's protection imbuement. */}
            {protEl && (
              <div className="mt-3 rounded-xl border border-[#3fa7d6]/40 bg-surface/60 p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: elDark(protEl) }}>
                    {t('map.zoneProtectTitle', { el: elName(protEl) })}
                  </span>
                  <button
                    onClick={() => setProtEl(null)}
                    aria-label={t('common.close')}
                    className="ml-auto grid h-5 w-5 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#3fa7d6] hover:text-[#3fa7d6]"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {protection.isPending && <Skeleton className="mt-2 h-16 w-full" />}
                {protection.data && (
                  <>
                    {protection.data.imbue ? (
                      <p className="mt-1.5 text-[13px] font-semibold text-fg">
                        {t('map.zoneProtectImbue', { name: protection.data.imbue })}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[13px] text-fg-dim">{t('map.zoneProtectNoImbue')}</p>
                    )}
                    {protection.data.slots.length === 0 && (
                      <p className="mt-1.5 text-[13px] text-fg-dim">{t('map.zoneProtectEmpty')}</p>
                    )}
                    <div className="mt-1.5 flex flex-col">
                      {protection.data.slots.slice(0, 5).map((pieces) => (
                        <div key={pieces[0].slot} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
                          <span className="w-16 shrink-0 text-[11px] font-bold uppercase tracking-wide text-fg-mute">
                            {t(`slots.${pieces[0].slot}`, { defaultValue: pieces[0].slot })}
                          </span>
                          {pieces.map((p) => (
                            <Link
                              key={p.slug}
                              to={`/entry/${p.slug}`}
                              className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 transition hover:border-[#3fa7d6]"
                            >
                              {p.image && (
                                <img src={p.image} alt="" className="h-6 w-6 object-contain" style={{ imageRendering: 'pixelated' }} />
                              )}
                              <span className="text-[13px] font-semibold text-fg">{p.name}</span>
                              <span className="text-[13px] font-bold" style={{ color: '#1f7a44' }}>+{p.pct}%</span>
                              {p.level > 0 && <span className="text-[11px] text-fg-mute">lvl {p.level}</span>}
                            </Link>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Residents, deadliest first. */}
            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-fg-dim">
                {t('map.zoneCreatures')}
              </div>
              <div className="flex flex-col">
                {data.creatures.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/entry/${c.slug}`}
                    className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-surface"
                  >
                    {c.image ? (
                      <img src={c.image} alt="" className="h-10 w-10 shrink-0 object-contain" style={{ imageRendering: 'pixelated' }} />
                    ) : (
                      <span className="h-10 w-10 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-[15px] font-bold text-fg">{c.name}</span>
                        <span className="shrink-0 text-[13px] font-bold text-fg-dim">×{c.count}</span>
                        {c.boss && (
                          <span className="shrink-0 rounded-full bg-[#d23d2f] px-2 text-[11px] font-bold uppercase text-white">
                            Boss
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-fg">
                        {c.burst > 0 && (
                          <span className="font-semibold" title={t('map.zoneBurstHint')}>
                            ⚔ {compact(c.burst)}
                          </span>
                        )}
                        <span className="text-fg-dim">{compact(c.hp)} hp</span>
                        {c.damage_elements[0] && chip(c.damage_elements[0].element, elName(c.damage_elements[0].element), `dmg-${c.slug}`)}
                        {c.weak_to[0] && (
                          <span className="font-bold" style={{ color: '#1f7a44' }}>
                            {t('map.zoneWeakTo')} {elName(c.weak_to[0].element)} +{c.weak_to[0].pct - 100}%
                          </span>
                        )}
                        {c.run_health > 0 && (
                          <span className="font-bold" style={{ color: '#b06a10' }} title={t('map.zoneFleesHint')}>
                            {t('map.zoneFlees', { hp: c.run_health })}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[12px] font-bold uppercase tracking-wide ${c.ranged ? 'text-[#22759e]' : 'text-fg-dim'}`}>
                      {c.ranged ? t('map.zoneRanged') : t('map.zoneMelee')}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LorePanel({ poi, onClose }: { poi: LorePoi; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: entry, isLoading, isError } = useEntry(poi.slug)
  // Lead paragraph = overview, falling back to canon (mirrors EntryPage). When
  // the overview supplies the lead, canon becomes the body so it isn't repeated.
  const lead = entry?.content.overview || entry?.content.canon || null
  const canonBody = entry?.content.overview ? entry.content.canon : null
  // Entry-less mystery spot: show its factual caption instead of fetched lore.
  const blurbOnly = !poi.slug

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="scroll-atlas pointer-events-auto max-h-[70vh] w-[30rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5 text-[#c79a3f]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.loreTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#c79a3f] hover:text-[#c79a3f]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {blurbOnly && (
          <>
            <h3 className="font-serif text-lg font-bold leading-tight text-fg">{poi.title}</h3>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
              {t('map.loreMystery')}
            </span>
            <p className="prose-atlas mt-3 text-sm leading-relaxed text-fg-dim">{poi.blurb}</p>
          </>
        )}

        {!blurbOnly && isLoading && <Skeleton className="h-24 w-full" />}
        {!blurbOnly && isError && <p className="text-sm text-fg-mute">{t('common.error')}</p>}

        {!blurbOnly && entry && (
          <>
            <div className="flex items-start gap-3">
              {entry.primary_image && (
                <img
                  src={entry.primary_image}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg border border-line-2 object-contain p-1"
                />
              )}
              <div className="min-w-0">
                <h3 className="font-serif text-lg font-bold leading-tight text-fg">
                  {entry.name ?? poi.title}
                </h3>
                {entry.type_label && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
                    {entry.type_label}
                  </span>
                )}
              </div>
            </div>

            <div className="prose-atlas mt-3 text-sm leading-relaxed text-fg-dim">
              {lead && (
                <p>
                  <LoreText text={lead} currentSlug={entry.slug} />
                </p>
              )}
              {canonBody && (
                <p className="mt-2">
                  <LoreText text={canonBody} currentSlug={entry.slug} />
                </p>
              )}
              {entry.content.interpretations && (
                <p className="mt-2">
                  <LoreText text={entry.content.interpretations} currentSlug={entry.slug} />
                </p>
              )}
              {!lead && !canonBody && !entry.content.interpretations && (
                <p className="text-fg-mute">{t('map.loreEmpty')}</p>
              )}
            </div>

            <Link
              to={`/entry/${entry.slug}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#c79a3f]/50 bg-[#c79a3f]/10 px-3 py-1.5 text-sm font-semibold text-[#c79a3f] transition hover:bg-[#c79a3f]/20"
            >
              {t('map.loreReadFull')}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

// The raid dossier: what an invasion actually does. The announcements are the
// literal broadcasts the world reads out, kept in English on purpose — that is
// the text players see in-game, translating it would make it unrecognisable.
// Floats bottom-centre like the lore/hunt/house panels.
function RaidPanel({
  raid,
  onClose,
  onPlot,
}: {
  raid: Raid
  onClose: () => void
  onPlot: (name: string) => void
}) {
  const { t, i18n } = useTranslation()
  const roster = raidRoster(raid)
  const timeline = raidTimeline(raid)
  const every = raidInterval(raid.interval, i18n.language)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="scroll-atlas pointer-events-auto max-h-[70vh] w-[32rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5 text-[#d4483b]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C8.9 8.6 9.6 9.4 10 10c0-2.6 1-6 2-8z" />
            <path d="M12 22a7 7 0 0 0 7-7" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.raidTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#d4483b] hover:text-[#d4483b]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="font-serif text-lg font-bold leading-tight text-fg">{raid.name}</h3>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
          {raidRegion(raid, i18n.language)}
        </p>

        {/* Scale, cadence and where it lands. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim">
            {t('map.raidCreatures', { count: raid.creatures })}
          </span>
          <span className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim">
            {t('map.raidFloors', { floors: raid.floors.join(', ') })}
          </span>
          {every ? (
            <span className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim">
              {t('map.raidEvery', { every })}
            </span>
          ) : (
            <span
              className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-mute"
              title={t('map.raidUnscheduledHint')}
            >
              {t('map.raidUnscheduled')}
            </span>
          )}
        </div>

        {/* Roster — click any creature to plot its normal spawns on the map. */}
        <h4 className="mt-4 text-[11px] font-bold uppercase tracking-widest text-fg-mute">
          {t('map.raidRoster')}
        </h4>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {roster.map((c, i) => {
            const boss = raid.bosses.includes(c.name)
            return (
              <button
                key={`${c.name}-${i}`}
                onClick={() => onPlot(c.name)}
                title={t('map.raidPlotHint', { name: c.name })}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                  c.drops
                    ? 'border-[#c79a3f]/70 bg-[#c79a3f]/15 text-[#e2b06f] hover:bg-[#c79a3f]/25'
                    : boss
                      ? 'border-[#d4483b]/60 bg-[#d4483b]/15 text-[#e2705f] hover:bg-[#d4483b]/25'
                      : 'border-line-2 bg-bg-3/60 text-fg-dim hover:border-[#d4483b]/50 hover:text-fg'
                }`}
              >
                {c.amount > 1 && <span className="text-fg-mute">{c.amount}× </span>}
                {c.name}
                {/* The reason to run the raid: what this variant carries and its
                    ordinary twin does not. */}
                {c.drops && <span className="ml-1 font-normal">· {dropLabel(c.drops)}</span>}
              </button>
            )
          })}
        </div>

        {/* How it unfolds: broadcasts and spawn waves on one clock. */}
        <h4 className="mt-4 text-[11px] font-bold uppercase tracking-widest text-fg-mute">
          {t('map.raidTimeline')}
        </h4>
        <ol className="mt-1.5 space-y-1.5 border-l border-line-2 pl-3">
          {timeline.map((s, i) => (
            <li key={i} className="relative text-sm leading-snug">
              <span className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-[#d4483b]" />
              <span className="mr-2 text-[11px] font-bold tabular-nums text-fg-mute">
                {raidDelay(s.at)}
              </span>
              {s.kind === 'announce' ? (
                <span className="italic text-broadcast">“{s.message}”</span>
              ) : (
                <span className="text-fg-dim">{s.label}</span>
              )}
            </li>
          ))}
        </ol>

        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">{t('map.raidSource')}</p>
      </div>
    </div>
  )
}

// The mini-world-change dossier. A change is a dice roll the server makes at
// start-up, so the panel never claims one is live — it lists every place it can
// land and quotes what the world says when it does. Those quotes stay in English
// like the raid broadcasts: that is the text players hear in-game.
function WorldChangePanel({
  change,
  spot,
  onClose,
  onSpot,
  onRoute,
  onInside,
  onPlot,
}: {
  change: WorldChange
  spot: string | null
  onClose: () => void
  onSpot: (s: WcSpot) => void
  onRoute: (s: WcSpot) => void
  onInside: () => void
  onPlot: (name: string) => void
}) {
  const { t } = useTranslation()
  const inside = change.inside
  // The spot being read right now — the one a "how to get there" walks to. A
  // change with a single candidate needs no picking, so it is that one.
  const active = change.spots.find((s) => s.key === spot) ?? (change.spots.length === 1 ? change.spots[0] : null)
  // Which spot each announcement belongs to, so a rhyme that names a coast is
  // shown next to that coast instead of floating loose.
  const spotLabel = (key: string | null) =>
    key ? (change.spots.find((s) => s.key === key)?.label ?? null) : null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
      <div className="scroll-atlas pointer-events-auto max-h-[70vh] w-[32rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-1.5 text-[#8b6fd4]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.wcTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#8b6fd4] hover:text-[#8b6fd4]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="font-serif text-lg font-bold leading-tight text-fg">
          {t(`map.wcName.${change.id}`)}
        </h3>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim">
            {t(wcCadenceKey(change), { spots: change.spots.length, chance: change.chance, day: change.day })}
          </span>
          <span className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim">
            {t('map.raidFloors', { floors: wcFloors(change).join(', ') })}
          </span>
          {change.requirement && (
            <span className="rounded-md border border-[#c79a3f]/60 bg-[#c79a3f]/10 px-2 py-1 text-[11px] font-semibold text-[#e2b06f]">
              {t('map.wcRequirement', { level: change.requirement.level })}
            </span>
          )}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-fg-dim">{t(`map.wcDesc.${change.id}`)}</p>

        {/* What the world says. The whole point of the layer: you learn a change
            fired by hearing it, so these are the lines to listen for. */}
        {change.phrases.length > 0 && (
          <>
            <h4 className="mt-4 text-[11px] font-bold uppercase tracking-widest text-fg-mute">
              {t('map.wcPhrases')}
            </h4>
            <ul className="mt-1.5 space-y-2 border-l border-line-2 pl-3">
              {change.phrases.map((p, i) => (
                <li key={i} className="text-sm leading-snug">
                  <span className="mr-2 text-[10px] font-bold uppercase tracking-wide text-fg-mute">
                    {t(`map.wcFrom.${p.from}`)}
                    {spotLabel(p.spot) ? ` · ${spotLabel(p.spot)}` : ''}
                  </span>
                  <span className="italic text-broadcast">“{p.text}”</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Every candidate place. One of them happens per roll — never all. */}
        <h4 className="mt-4 text-[11px] font-bold uppercase tracking-widest text-fg-mute">
          {t('map.wcSpots', { count: change.spots.length })}
        </h4>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {change.spots.map((s) => (
            <button
              key={s.key}
              onClick={() => onSpot(s)}
              title={t('map.wcSpotHint')}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                spot === s.key
                  ? 'border-[#8b6fd4] bg-[#8b6fd4]/20 text-[#b79df0]'
                  : 'border-line-2 bg-bg-3/60 text-fg-dim hover:border-[#8b6fd4]/50 hover:text-fg'
              }`}
            >
              {s.label}
              {s.when && (
                <span className="ml-1 font-normal text-fg-mute">
                  · {t(s.when === 'night' ? 'map.wcAtNight' : 'map.wcByDay')}
                </span>
              )}
              <span className="ml-1 font-normal tabular-nums text-fg-mute">
                {s.x}, {s.y}, {s.z}
              </span>
            </button>
          ))}
        </div>

        {/* Walk there. The route starts from the city nearest the chosen spot,
            which for the fury gates is the invaded city itself. */}
        {active && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRoute(active)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#8b6fd4]/70 bg-[#8b6fd4]/15 px-2.5 py-1.5 text-xs font-semibold text-[#b79df0] transition hover:bg-[#8b6fd4]/25"
            >
              <Icon name="compass" size={14} />
              {t('map.wcRouteTo', { spot: active.label })}
            </button>
            {change.spots.length > 1 && (
              <span className="text-[11px] text-fg-mute">{t('map.wcRouteNote')}</span>
            )}
          </div>
        )}

        {/* The full moon swaps the wildlife in the vale rather than opening a
            portal, so its spot carries a before/after instead of a roster. */}
        {change.spots.map((s) =>
          s.creatures?.length ? (
            <p key={`${s.key}-swap`} className="mt-2 text-[11px] leading-relaxed text-fg-mute">
              {t('map.wcInstead', {
                creatures: s.creatures.join(', '),
                instead: (s.instead ?? []).join(', '),
              })}
            </p>
          ) : null
        )}

        {/* Where it leads. Click a creature to plot its ordinary spawns. */}
        {inside && (
          <>
            <h4 className="mt-4 text-[11px] font-bold uppercase tracking-widest text-fg-mute">
              {t('map.wcInside')}
            </h4>
            <button
              onClick={onInside}
              title={t('map.wcSpotHint')}
              className="mt-1.5 rounded-md border border-[#8b6fd4]/60 bg-[#8b6fd4]/10 px-2 py-1 text-[11px] font-semibold text-[#b79df0] transition hover:bg-[#8b6fd4]/20"
            >
              {/* Proper nouns (Fury Hell, the Nightmare Isles) read the same in
                  both languages and stay as the OT names them; the odd
                  descriptive one gets a translation. */}
              {t(`map.wcInsideName.${change.id}`, { defaultValue: inside.label })}
              <span className="ml-1 font-normal text-fg-mute">
                {t('map.raidFloors', { floors: inside.floors.join(', ') })}
              </span>
            </button>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {inside.creatures.map((c) => (
                <button
                  key={c.name}
                  onClick={() => onPlot(c.name)}
                  title={t('map.raidPlotHint', { name: c.name })}
                  className="rounded-md border border-line-2 bg-bg-3/60 px-2 py-1 text-[11px] font-semibold text-fg-dim transition hover:border-[#8b6fd4]/50 hover:text-fg"
                >
                  {c.name}
                  <span className="ml-1 font-normal text-fg-mute">×{c.spawns}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">{t('map.wcSource')}</p>
      </div>
    </div>
  )
}

// Breakpoint feed for the creature-bar page size (3 cards wide, 1 on phones).
// useSyncExternalStore re-reads the snapshot on every render, so a missed
// media-query event can never leave a stale page size behind.
const WIDE_MQ = '(min-width: 640px)'
function subscribeWideMq(cb: () => void) {
  const mq = window.matchMedia(WIDE_MQ)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function isWideMq() {
  return window.matchMedia(WIDE_MQ).matches
}

export function MapPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  // The immersive canvas root + the top-left control column, so the boss-watch
  // sidebar can start right below the column (avoids overlapping the search /
  // route / creature panels when they grow).
  const rootRef = useRef<HTMLDivElement>(null)
  const topColRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GridLayer | null>(null)
  const markersGroupRef = useRef<L.LayerGroup | null>(null)
  const cityGroupRef = useRef<L.LayerGroup | null>(null)
  const spawnGroupRef = useRef<L.LayerGroup | null>(null)
  const dotsLayerRef = useRef<DotsLayer | null>(null)
  const allSpriteGroupRef = useRef<L.LayerGroup | null>(null)
  const poiGroupRef = useRef<L.LayerGroup | null>(null)
  const houseGroupRef = useRef<L.LayerGroup | null>(null)
  const loreGroupRef = useRef<L.LayerGroup | null>(null)
  const raidGroupRef = useRef<L.LayerGroup | null>(null)
  const wcGroupRef = useRef<L.LayerGroup | null>(null)
  const tradeGroupRef = useRef<L.LayerGroup | null>(null)
  const rashidGroupRef = useRef<L.LayerGroup | null>(null)
  // Highlight ring drawn over the hunting zone the user picked in the Hunt Finder.
  const huntHiRef = useRef<L.LayerGroup | null>(null)
  // A dedicated SVG renderer for that ring, so it draws crisply above the canvas
  // spawn-dot layer (the map's default renderer is canvas).
  const huntSvgRef = useRef<L.SVG | null>(null)
  // "Analyze zone" selection rectangle + its corner handles.
  const analyzeGroupRef = useRef<L.LayerGroup | null>(null)
  // Mirrored so the once-bound map click handler can tell the mode is on.
  const analyzeModeRef = useRef(false)
  // Current-floor "all creatures" data kept for click-to-identify and the
  // viewport sprite renderer.
  const allPointsRef = useRef<{
    points: [number, number, number][]
    names: string[]
    images: (string | null)[]
    slugs: string[]
    bosses: boolean[]
    // Per-creature profit score (0..1): loot gold, log-normalised across the
    // floor's creatures. Empty when no loot data is present.
    scores: number[]
    // Per-creature raw loot worth (gp), summed per spawn for the money badge.
    lootValues: number[]
  }>({ points: [], names: [], images: [], slugs: [], bosses: [], scores: [], lootValues: [] })
  // Points after the bosses-only narrowing — what actually gets drawn.
  const filteredRef = useRef<[number, number, number][]>([])
  // Per-filtered-point heat-palette index (aligned to filteredRef), or null when
  // there's no profit signal (dots then paint the classic uniform orange).
  const filteredHeatRef = useRef<Uint8Array | null>(null)
  // Diff caches for the marker layers (see syncMarkers) so pans/zooms reuse
  // existing DOM markers instead of rebuilding every one.
  const spriteCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  const poiCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  const houseCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  const creatureCacheRef = useRef<MarkerCache>({ epoch: '', markers: new Map() })
  // Bumped whenever the filtered point set changes, invalidating sprite reps.
  const overlayGenRef = useRef(0)

  // Initial state restored from the shared link (if any).
  const initial = useRef(parseHash()).current
  const [floor, setFloor] = useState(initial.floor ?? SURFACE)
  const [markers, setMarkers] = useState<Marker[]>(initial.markers)
  const [placing, setPlacing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [center, setCenter] = useState({ x: 0, y: 0 })

  // Creature spawn overlay.
  const [creatures, setCreatures] = useState<ActiveCreature[]>([])
  // The active-creature bar pages 3 cards at a time (1 on small screens) so an
  // item batch ("Lo dejan caer N criaturas") never buries the map in cards.
  const [creaturePage, setCreaturePage] = useState(0)
  const creaturePageSize = useSyncExternalStore(subscribeWideMq, isWideMq) ? 3 : 1
  const creaturePageCount = Math.max(1, Math.ceil(creatures.length / creaturePageSize))
  const creaturePageSafe = Math.min(creaturePage, creaturePageCount - 1)
  useEffect(() => {
    setCreaturePage((p) => Math.min(p, creaturePageCount - 1))
  }, [creaturePageCount])
  // Which plotted creature has its kill pulse open (yesterday / last 30 days on
  // the selected world). One at a time, docked under the creature bar; it hangs
  // off a chip rather than the bottom-centre panel stack, so it lives outside
  // openPanel's mutually-exclusive family.
  const [killsSlug, setKillsSlug] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  // What the search box looks up: a creature (plot its spawns), an item (plot
  // every creature that drops it) or a merchant NPC (route straight to the
  // shop). "Dónde farmeo este objeto" / "llévame con este NPC".
  const [searchKind, setSearchKind] = useState<'creature' | 'item' | 'npc'>('creature')
  // The item whose droppers are currently plotted, for the context banner.
  const [activeItem, setActiveItem] = useState<{
    slug: string
    name: string
    image: string | null
    plotted: string[] // dropper slugs plotted as creatures
    total: number // droppers with a slug (may exceed plotted if capped)
    trade: ItemTrade | null // merchants that buy/sell it (trade pins layer)
  } | null>(null)
  // Which merchant of the trade board is currently routed to, so the banner can
  // page through the rest (◀ 2/31 ▶) instead of only ever reaching the best one.
  const [tradeNav, setTradeNav] = useState<{ side: 'buy' | 'sell'; i: number } | null>(null)
  // Mirrored in a ref so two fast clicks on ▶ advance two merchants instead of
  // both reading the same pre-render state.
  const tradeNavRef = useRef<{ side: 'buy' | 'sell'; i: number } | null>(null)
  const [itemBusy, setItemBusy] = useState(false)
  const [showAll, setShowAll] = useState(true)
  const [bossOnly, setBossOnly] = useState(false) // show only bosses
  const [showPoi, setShowPoi] = useState(false) // imported minimap markers layer
  const [showLore, setShowLore] = useState(false) // curated lore / mystery POIs layer
  const [lorePoi, setLorePoi] = useState<LorePoi | null>(null) // open lore reader
  const [showRaids, setShowRaids] = useState(false) // invasions / raids layer
  const [raid, setRaid] = useState<Raid | null>(null) // open raid dossier
  const [showWc, setShowWc] = useState(false) // mini world changes layer
  const [wc, setWc] = useState<WorldChange | null>(null) // open world-change dossier
  // The spot inside that change the user is looking at, so the pin they clicked
  // (and only that one) is highlighted while the rest stay candidates.
  const [wcSpot, setWcSpot] = useState<string | null>(null)
  // "Analyze zone": drag-select a rectangle and get a combat summary of what
  // spawns inside it. The box has no floor — the floor control picks the level.
  const [analyzeMode, setAnalyzeMode] = useState(false)
  const [analyzeBox, setAnalyzeBox] = useState<ZoneBox | null>(null)
  const [rashidOpen, setRashidOpen] = useState(false) // Rashid reader panel
  const [yasirOpen, setYasirOpen] = useState(false) // Yasir reader panel
  // Rashid moves city at the 10:00 Europe/Berlin server save. The second-level
  // countdown ticks inside the rail/panel only — this page-level state polls
  // coarsely (30 s) so the pin flips over on its own without re-rendering the
  // whole map every second.
  const [rashidDay, setRashidDay] = useState(rashidEffectiveDay)
  const rashidStop = RASHID_ROTATION[rashidDay]
  const [showHouses, setShowHouses] = useState(false) // rentable houses layer
  const [houseStatusFilter, setHouseStatusFilter] = useState<'all' | 'available' | 'rented'>('all') // rent-status filter
  const [houseKind, setHouseKind] = useState<'all' | 'house' | 'guild'>('all') // house vs guildhall filter
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null) // draggable window position
  const [houseSearch, setHouseSearch] = useState('') // house-list name filter
  const [houseTownFilter, setHouseTownFilter] = useState('') // house-list city filter
  const [alertsOpen, setAlertsOpen] = useState(false) // "my alerts" watchlist — collapsed submenu by default
  const [housePanelOpen, setHousePanelOpen] = useState(false) // "available houses" + alerts panel
  const [bidChartFor, setBidChartFor] = useState<number | null>(null) // house whose bid trail is open
  const [watches, setWatches] = useState<Watch[]>(() => loadWatches()) // client-side alert list
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() => notifyPermission())
  const [freedToast, setFreedToast] = useState<string | null>(null) // "a house opened up" banner
  // "You've been outbid" — a MODAL, not a corner toast: it's the one alert the
  // user must not miss, so it opens by itself the moment the check finds it.
  const [outbidToast, setOutbidToast] = useState<{
    id: number
    name: string
    bid: number
    bidder: string | null
  } | null>(null)
  const [newsOpen, setNewsOpen] = useState(false) // right-edge world-news rail (collapsed by default)
  const [freedIds, setFreedIds] = useState<Set<number>>(() => new Set()) // ids just freed this session
  const [townSel, setTownSel] = useState('') // town picked in the "watch a whole town" control
  // The selected Tibia world — a GLOBAL map concern: it drives the Boss Watch's
  // per-world heat AND the houses layer's live rent status. Persisted so the user
  // doesn't re-pick their world every visit; defaults to Antica (a classic world
  // that has a house-rent snapshot).
  const [world, setWorld] = useState(() => {
    try {
      return localStorage.getItem('tibiaAtlas.mapWorld') || 'Antica'
    } catch {
      return 'Antica'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('tibiaAtlas.mapWorld', world)
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
  }, [world])
  // Local bid alerts (new bid / outbid on a belled auction) for the news rail.
  // Per-world in localStorage; swapped wholesale when the world changes.
  const [bidEvents, setBidEvents] = useState<LocalBidEvent[]>(() => loadBidEvents(world))
  useEffect(() => {
    setBidEvents(loadBidEvents(world))
  }, [world])
  // When the news rail was last OPENED on this world — personal news newer than
  // this makes the collapsed button flash a red "!" instead of the count.
  const newsSeenKey = 'tibia:news-seen:' + world
  const [newsSeenAt, setNewsSeenAt] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(newsSeenKey)) || 0
    } catch {
      return 0
    }
  })
  useEffect(() => {
    try {
      setNewsSeenAt(Number(localStorage.getItem('tibia:news-seen:' + world)) || 0)
    } catch {
      setNewsSeenAt(0)
    }
  }, [world])
  // "Your character" overlay: the saved profile (localStorage), the settings
  // panel open state, and the name being typed. The live character data is
  // fetched by react-query below, keyed on the saved name.
  const [charProfile, setCharProfile] = useState<CharProfile | null>(() => loadCharProfile())
  const [charOpen, setCharOpen] = useState(false)
  const [charDraft, setCharDraft] = useState(() => loadCharProfile()?.name ?? '')
  const charQuery = useQuery({
    queryKey: ['character', charProfile?.name ?? ''],
    queryFn: () => fetchCharacter(charProfile!.name),
    enabled: !!charProfile?.name,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const character: Character | null = charQuery.data ?? null
  const saveChar = () => {
    const name = charDraft.trim()
    if (!name) return
    const p = { name }
    saveCharProfile(p)
    setCharProfile(p)
  }
  const clearChar = () => {
    saveCharProfile(null)
    setCharProfile(null)
    setCharDraft('')
    setGearSlot(null)
    setGearQuery('')
  }

  // "Your equipment": the gear editor's open slot picker + its search text.
  // The picked set itself lives on the profile (localStorage) so it survives
  // reloads and feeds both the stats readout and the Hunt Finder.
  const [gearSlot, setGearSlot] = useState<GearSlot | null>(null)
  const [gearQuery, setGearQuery] = useState('')
  const setGearPiece = (slot: GearSlot, piece: GearPiece | null) => {
    setCharProfile((prev) => {
      if (!prev) return prev
      const gear = { ...(prev.gear ?? {}) }
      if (piece) gear[slot] = piece
      else delete gear[slot]
      const next: CharProfile = Object.keys(gear).length ? { name: prev.name, gear } : { name: prev.name }
      saveCharProfile(next)
      return next
    })
    setGearSlot(null)
    setGearQuery('')
  }
  const clearGear = () => {
    setCharProfile((prev) => {
      if (!prev) return prev
      const next: CharProfile = { name: prev.name }
      saveCharProfile(next)
      return next
    })
    setGearSlot(null)
    setGearQuery('')
  }
  // Sorted ids of the worn pieces — the `gear` the hunts + set-stats APIs take.
  const gearIdList = useMemo(() => gearIds(charProfile), [charProfile])

  // Draggable char card: null = docked (centered above the hotbar); a point
  // once the user grabs the header. Pointer capture keeps the drag alive when
  // the cursor outruns the handle; position clamps to the viewport.
  const [charPos, setCharPos] = useState<{ x: number; y: number } | null>(null)
  const charCardRef = useRef<HTMLDivElement | null>(null)
  const charDragOff = useRef<{ dx: number; dy: number } | null>(null)
  const startCharDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = charCardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    charDragOff.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveCharDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const off = charDragOff.current
    const card = charCardRef.current
    if (!off || !card) return
    const x = Math.min(Math.max(8, e.clientX - off.dx), window.innerWidth - card.offsetWidth - 8)
    const y = Math.min(Math.max(8, e.clientY - off.dy), window.innerHeight - 56)
    setCharPos({ x, y })
  }
  const endCharDrag = () => {
    charDragOff.current = null
  }

  // --- Hunt Finder -----------------------------------------------------------
  // Panel ranking the best hunting zones for a level + vocation (solo hunts).
  // Level/vocation auto-fill from the saved character (below) but stay editable.
  const [huntOpen, setHuntOpen] = useState(false)
  // Hunt profit calculator — the draggable "real profit" card (analyzer paste).
  // A shared-summary link (?hunt=…) opens it on arrival: the payload rides in
  // the URL, so there is nothing to fetch before showing it.
  const [profitOpen, setProfitOpen] = useState(hasSharedSummary)
  const [huntLevel, setHuntLevel] = useState('')
  const [huntVoc, setHuntVoc] = useState('')
  const [huntZoneId, setHuntZoneId] = useState<number | null>(null)
  const [huntAuto, setHuntAuto] = useState(false)
  // Seed level + vocation from the looked-up character the first time it lands,
  // without clobbering anything the user has typed themselves.
  useEffect(() => {
    if (!character) return
    const base = character.vocation ? baseVocation(character.vocation) : ''
    setHuntLevel((prev) => (prev === '' && character.level != null ? String(character.level) : prev))
    setHuntVoc((prev) => (prev === '' && base ? base : prev))
    if (base && character.level != null) setHuntAuto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.name, character?.level, character?.vocation])

  // Effective inputs: what you typed overrides, otherwise fall back to your saved
  // character — so with a character set the planner just works without re-asking
  // for level/vocation (you already told us who you are via the character gear).
  const charVoc = character?.vocation ? baseVocation(character.vocation) : ''
  // Gear picker: catalogue items for the open slot (vocation-filtered when the
  // character's vocation is known — items usable by all always pass).
  // Debounced like the map's own search: one request per pause, not per
  // keystroke (typing "Souls" used to queue five 120-item round trips).
  const gearSearch = useDebouncedValue(gearQuery.trim(), 250)
  // Below 2 chars a search is all noise (every "s" item), so browse instead.
  const gearTerm = gearSearch.length >= 2 ? gearSearch : ''
  const gearItemsQuery = useItems(
    {
      slot: gearSlot ?? undefined,
      equippable: '1',
      q: gearTerm || undefined,
      // Strongest first, SERVER-side: sorting client-side over an id-paged
      // window silently hid every modern high-id piece (the Soulshredder bug).
      sort: 'power',
      per_page: 120,
      // The picker only needs name/image/stats — skip the listing payload the
      // album needs (overview, view counts, quest facets): ~half the bytes.
      light: '1',
      // Vocation narrows the BROWSE list only. A typed search drops it: if you
      // name the item, it's yours — a wrong/failed vocation lookup must never
      // turn a real weapon into "no results".
      ...(charVoc && !gearTerm ? { vocation: charVoc } : {}),
    },
    // Wait for the character lookup to settle: firing while it loads asks
    // twice (once vocation-less, once with it) for the same browse list.
    charOpen && gearSlot !== null && !charQuery.isLoading,
  )
  const gearChoices = gearItemsQuery.data?.data ?? []
  // The list lags the input by the debounce; say so instead of showing the
  // previous term's hits as if they were results for what you just typed.
  const gearSearching = gearItemsQuery.isFetching || gearSearch !== gearQuery.trim()
  // Derived stats of the worn set — same math the Hunt Finder scores with.
  const setStatsQuery = useSetStats(gearIdList, charVoc)
  const setStats = setStatsQuery.data ?? null
  // Scale for the skill-bonus bars: relative to the biggest bonus worn, with a
  // floor of 8 so a lone +2 doesn't paint a full bar.
  const skillMax = setStats
    ? Math.max(8, ...Object.values(setStats.bonuses).map((v) => Math.abs(v)))
    : 8
  const huntLevelNum =
    huntLevel.trim() !== '' ? Math.max(1, parseInt(huntLevel, 10) || 0) : (character?.level ?? null)
  const effVoc = huntVoc.trim() !== '' ? huntVoc : charVoc
  const huntQuery = useHunts(huntLevelNum, effVoc, 'solo', huntOpen, gearIdList)
  const hunt = huntQuery.data ?? null
  // Localised element label, falling back to the prettified key (drown, life drain).
  const elLabel = (el: string) => t(`elements.${el}`, { defaultValue: el.replace(/_/g, ' ') })
  // Picking a different vocation/level/mode invalidates the selected zone.
  const resetHuntSel = () => setHuntZoneId(null)

  // "Analyze zone" summary for the fixed selection on the current floor —
  // flipping floors with the box kept re-analyzes the same rectangle there.
  const zoneQuery = useZoneSummary(analyzeMode ? analyzeBox : null, floor)

  const [showTour, setShowTour] = useState(false) // guided how-to overlay
  const [bossRailOpen, setBossRailOpen] = useState(false) // world-boss watch sidebar (starts minimized so it doesn't cover the map)
  const [bossQuery, setBossQuery] = useState('') // free-text filter for the boss watch rail
  const [bossType, setBossType] = useState<BossType>('all') // spawntype tab (Raid/Unique/…)
  // Bosses the player has pinned to "follow" — kept at the top of the rail and
  // never dropped by the hottest-16 cut. Persisted so a watch survives reloads.
  const [pinnedBosses, setPinnedBosses] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('tibiaAtlas.pinnedBosses')
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('tibiaAtlas.pinnedBosses', JSON.stringify([...pinnedBosses]))
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
  }, [pinnedBosses])
  const togglePin = (slug: string) =>
    setPinnedBosses((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  const [bossTop, setBossTop] = useState(112) // sidebar top = bottom of the control column
  const [markerDraft, setMarkerDraft] = useState<{ x: number; y: number; floor: number } | null>(null)
  const [draftLabel, setDraftLabel] = useState('')

  // "How to get there" routing (A* over minimap walkability). An endpoint can be
  // set by clicking the map (no label) or by picking a city (label = its name).
  type RoutePoint = { x: number; y: number; floor: number; label?: string }
  // A shared link may carry a route — open the directions panel and restore its
  // endpoints so the plan can be recomputed (see the restore effect below).
  const [routeMode, setRouteMode] = useState(!!(initial.routeStart || initial.routeEnd))
  const [routeStart, setRouteStart] = useState<RoutePoint | null>(initial.routeStart)
  const [routeEnd, setRouteEnd] = useState<RoutePoint | null>(initial.routeEnd)
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeMsg, setRouteMsg] = useState<string | null>(null)
  const [blessSet, setBlessSet] = useState<null | 'five' | 'seven'>(null) // pilgrimage in progress
  const [blessStops, setBlessStops] = useState<PilgrimStop[] | null>(null) // its stop list
  // Collapsed card: the stop list folds away to a single bar so you can read the
  // map under it. Closing throws the pilgrimage away, minimising never does.
  const [blessMin, setBlessMin] = useState(false)
  // "Reportar" flow for a wrong route: idle → editing (note box open) → sending →
  // done/error. The submitted report (endpoints + itinerary + note) lands in the
  // DB for a later routing fix pass (read via `php artisan tibia:route-reports`).
  const [reportState, setReportState] = useState<'idle' | 'editing' | 'sending' | 'done' | 'error'>('idle')
  const [reportNote, setReportNote] = useState('')
  const routeGroupRef = useRef<L.LayerGroup | null>(null)
  const routeModeRef = useRef(routeMode)
  const routeStartRef = useRef(routeStart)
  const routeEndRef = useRef(routeEnd)
  const computeRouteRef = useRef<(s: RoutePoint, e: RoutePoint) => void>(() => {})
  routeModeRef.current = routeMode
  routeStartRef.current = routeStart
  routeEndRef.current = routeEnd

  // Manual route builder ("crear ruta"): place ordered waypoints by clicking,
  // connected either by the A* auto-router (planRoute between consecutive points)
  // or by straight lines. The result is named and shareable via the URL, exactly
  // like the directions plan.
  const [buildMode, setBuildMode] = useState(!!initial.build)
  const [buildPoints, setBuildPoints] = useState<RoutePoint[]>(initial.build?.points ?? [])
  const [buildConnect, setBuildConnect] = useState<'auto' | 'straight'>(initial.build?.connect ?? 'straight')
  const [buildName, setBuildName] = useState(initial.build?.name ?? '')
  const [buildPlan, setBuildPlan] = useState<RoutePlan | null>(null)
  const [buildBusy, setBuildBusy] = useState(false)
  const [publishState, setPublishState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  // Community route gallery: published routes others submitted, ranked by likes.
  // The list is paginated (server-side, most popular first); this holds the page.
  const [routesOpen, setRoutesOpen] = useState(false)
  const [routesPage, setRoutesPage] = useState(1)
  const [routesQuery, setRoutesQuery] = useState('')

  // The map's floating cards are mutually exclusive: they all dock bottom-centre,
  // so opening one closes the rest instead of stacking them on the same spot.
  // Every entry point goes through openPanel/togglePanel instead of its own
  // setter — a hotbar slot, a pin click and a rail button all land here.
  type MapPanel =
    | 'char' | 'hunt' | 'profit' | 'houses' | 'routes' | 'rashid' | 'yasir'
    | 'lore' | 'raid' | 'worldchange' | 'bless' | 'zone'
  function openPanel(panel: MapPanel | null) {
    setCharOpen(panel === 'char')
    setHuntOpen(panel === 'hunt')
    setProfitOpen(panel === 'profit')
    setHousePanelOpen(panel === 'houses')
    setRoutesOpen(panel === 'routes')
    setRashidOpen(panel === 'rashid')
    setYasirOpen(panel === 'yasir')
    setAnalyzeMode(panel === 'zone')
    // Cards that carry a payload the caller sets straight after this call, so
    // here we only clear the ones being left behind.
    if (panel !== 'zone') setAnalyzeBox(null)
    if (panel !== 'lore') setLorePoi(null)
    if (panel !== 'raid') setRaid(null)
    if (panel !== 'worldchange') {
      setWc(null)
      setWcSpot(null)
    }
    if (panel !== 'bless') {
      setBlessSet(null)
      setBlessStops(null)
      setBlessMin(false)
    }
    // Zone analysis reads map drags, so it joins the interaction modes too.
    if (panel === 'zone') setMapMode('zone')
  }
  function togglePanel(panel: MapPanel, isOpen: boolean) {
    openPanel(isOpen ? null : panel)
  }

  // The modes that hijack map clicks and drags are exclusive for a different
  // reason: two of them live at once would fight over the same gesture. `zone`
  // belongs to both groups, so it is set by openPanel above, not here.
  function setMapMode(mode: 'route' | 'build' | 'place' | 'zone' | null) {
    setRouteMode(mode === 'route')
    setBuildMode(mode === 'build')
    setPlacing(mode === 'place')
    if (mode !== 'zone') {
      setAnalyzeMode(false)
      setAnalyzeBox(null)
    }
  }

  const routesQueryDebounced = useDebouncedValue(routesQuery.trim(), 300)
  // Routes this visitor has "liked". No accounts, so a like is client-side: we
  // remember the ids here (persisted) to show the heart filled and to avoid
  // double-counting; the server just holds the aggregate counter.
  const [likedRoutes, setLikedRoutes] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('tibiaAtlas.likedRoutes')
      return new Set(raw ? (JSON.parse(raw) as number[]) : [])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('tibiaAtlas.likedRoutes', JSON.stringify([...likedRoutes]))
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
  }, [likedRoutes])
  const buildGroupRef = useRef<L.LayerGroup | null>(null)
  const buildModeRef = useRef(buildMode)
  const buildPointsRef = useRef(buildPoints)
  const buildConnectRef = useRef(buildConnect)
  const buildNameRef = useRef(buildName)
  const appendBuildPointRef = useRef<(p: RoutePoint) => void>(() => {})
  buildModeRef.current = buildMode
  buildPointsRef.current = buildPoints
  buildConnectRef.current = buildConnect
  buildNameRef.current = buildName
  appendBuildPointRef.current = (p) => setBuildPoints((prev) => [...prev, p])

  // Bumped each time the Leaflet map is (re)created so the overlay-drawing
  // effects re-run against the fresh layer groups — crucial under React
  // StrictMode's mount→cleanup→mount cycle in dev, where data-only deps may not
  // change between the two mounts and would otherwise leave overlays empty.
  const [mapReady, setMapReady] = useState(0)
  const colorIdx = useRef(0)
  // Slugs added or currently being fetched — guards against double-adds
  // (incl. React StrictMode's double effect invocation in dev).
  const pendingRef = useRef<Set<string>>(new Set())
  const restoredRef = useRef(false)

  // First-time visitors get the how-to tour once, unless they arrived via a
  // shared link (a preset floor/marker/route means they know what they want).
  useEffect(() => {
    const fromLink = !!(
      initial.floor != null ||
      initial.markers.length ||
      initial.creatures.length ||
      initial.routeStart ||
      initial.routeEnd ||
      initial.build
    )
    if (!fromLink && !guideSeen()) setShowTour(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refs to give once-bound Leaflet handlers access to the latest values.
  const floorRef = useRef(floor)
  const markersRef = useRef(markers)
  const placingRef = useRef(placing)
  const creaturesRef = useRef(creatures)
  const showAllRef = useRef(showAll)
  const bossOnlyRef = useRef(bossOnly)
  const showPoiRef = useRef(showPoi)
  const poiRef = useRef<Poi[]>([])
  const showHousesRef = useRef(showHouses)
  const housesRef = useRef<House[]>([])
  // House lookup by real Tibia id, so the news ticker can fly to an event's house.
  const houseByIdRef = useRef<Map<number, House>>(new Map())
  const houseLiveRef = useRef<Record<
    number,
    { status: 'rented' | 'auctioned' | 'free'; owner?: string | null; bid?: number; bidder?: string | null }
  > | null>(null)
  // Bumped when live status is merged, so the marker diff's epoch changes and the
  // (otherwise key-cached) pins get rebuilt with their new rent-status colour.
  const houseLiveVerRef = useRef(0)
  const houseStatusFilterRef = useRef(houseStatusFilter)
  const houseKindRef = useRef(houseKind)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const watchesRef = useRef(watches)
  // Bumped on every watch toggle so open/cached house pins rebuild and reflect
  // the new bell state (the marker diff caches by key+epoch).
  const houseWatchVerRef = useRef(0)
  const worldRef = useRef(world)
  // Toggle a single house on the alert list; updates the ref synchronously so a
  // popup click handler can re-read the fresh state immediately after.
  const toggleHouseWatchRef = useRef<(id: number, name: string, town: string | null) => void>(
    () => {},
  )
  const addMarkerRef = useRef<(m: Marker) => void>(() => {})
  const removeMarkerRef = useRef<(id: string) => void>(() => {})
  const openMarkerModalRef = useRef<(d: { x: number; y: number; floor: number }) => void>(() => {})
  const renderSpritesRef = useRef<() => void>(() => {})
  const renderPoiRef = useRef<() => void>(() => {})
  const renderHousesRef = useRef<() => void>(() => {})
  const renderCreaturesRef = useRef<() => void>(() => {})
  const rebuildOverlayRef = useRef<() => void>(() => {})
  worldRef.current = world
  // Commit a new watch list: sync the ref, persist, bump the pin-rebuild version,
  // and update state — all callers go through here so nothing drifts.
  const applyWatches = (next: Watch[]) => {
    watchesRef.current = next
    saveWatches(next)
    houseWatchVerRef.current++
    setWatches(next)
  }
  toggleHouseWatchRef.current = (id, name, town) =>
    applyWatches(toggleHouseWatch(watchesRef.current, world, id, name, town))

  // Build a house popup as a DOM element with a live-wired bell button. Shared by
  // the map pins and the "fly to" action from the panel so both behave the same.
  function buildHousePopupEl(hl: House): HTMLElement {
    const watched = isHouseWatched(watchesRef.current, world, hl.id)
    const el = document.createElement('div')
    el.innerHTML = housePopup(hl, t, watched)
    const btn = el.querySelector<HTMLButtonElement>('[data-house-watch]')
    if (btn) {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        toggleHouseWatchRef.current(hl.id, hl.name, hl.town)
        const on = isHouseWatched(watchesRef.current, world, hl.id)
        const lbl = btn.querySelector('[data-bell-label]')
        if (lbl) lbl.textContent = on ? t('map.houseUnwatch') : t('map.houseWatch')
        btn.style.borderColor = on ? '#b3873f' : 'rgba(140,140,140,.55)'
        btn.style.background = on ? 'rgba(179,135,63,.14)' : 'transparent'
        btn.style.color = on ? '#b3873f' : 'currentColor'
      })
    }
    // Owner/bidder lookup on demand: the bulk /api/houses feed carries neither
    // (TibiaData's town lists omit them), so the first time a rented or
    // auctioned house's popup opens we ask the per-house proxy, patch the
    // status line in place, and cache the answer on houseLiveRef so re-opens
    // show it instantly. `bidder === undefined` = never looked up; null after
    // a lookup marks a bidless auction so we don't refetch on every open.
    const lv = hl.live
    if (lv && ((lv.status === 'rented' && !lv.owner) || (lv.status === 'auctioned' && lv.bidder === undefined))) {
      const w = worldRef.current
      const line = el.querySelector('[data-house-live]')
      const plainLabel = line?.textContent ?? ''
      // Show the lookup is in flight; replaced by the name (or restored to the
      // plain label if the proxy fails / has nothing) so it never dangles.
      if (line) line.textContent = `${plainLabel} · …`
      const restore = () => {
        if (line) line.textContent = plainLabel
      }
      fetch(`/api/houses/${encodeURIComponent(w)}/${hl.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const det = d?.house
          if (!det || worldRef.current !== w) return restore()
          const live = houseLiveRef.current?.[hl.id]
          if (live) {
            if (det.owner) live.owner = det.owner
            if (det.auctioned) {
              // Fresher than the periodic ETL snapshot.
              if (det.bid) live.bid = det.bid
              live.bidder = det.bidder ?? null
            }
          }
          if (!line) return
          if (det.rented && det.owner) {
            line.textContent = `${t('map.houseRented')} · ${det.owner}`
          } else if (det.auctioned && (det.bid || det.bidder)) {
            line.textContent =
              `${t('map.houseAuctioned')}${det.bid ? ` · ${fmtGold(det.bid)}` : ''}` +
              `${det.bidder ? ` · ${det.bidder}` : ''}`
          } else {
            restore()
          }
        })
        .catch(restore)
    }
    return el
  }

  // Centre the map on a house (switching floor if needed) and pop its details.
  function flyToHouse(h: House) {
    const map = mapRef.current
    if (!map) return
    if (h.z !== floorRef.current) setFloor(h.z)
    const ll = toLatLng(h.x, h.y)
    map.flyTo(ll, Math.max(map.getZoom(), 5), { duration: 0.6 })
    const live = houseLiveRef.current?.[h.id] ?? null
    const hl: House = live ? { ...h, live } : h
    L.popup({ offset: [0, -8] }).setLatLng(ll).setContent(buildHousePopupEl(hl)).openOn(map)
  }

  // Centre the map on a hunting zone (switching floor if needed) and mark it as
  // the selected zone, so the highlight ring effect draws over it.
  function flyToZone(zone: HuntZone) {
    // Select first so the card expands + the highlight arms even if the map
    // isn't ready yet; then fly to it when the map is available.
    setHuntZoneId(zone.id)
    const map = mapRef.current
    if (!map) return
    if (zone.z !== floorRef.current) setFloor(zone.z)
    map.flyTo(toLatLng(zone.x, zone.y), Math.max(map.getZoom(), 4), { duration: 0.6 })
  }

  // Clicking a news-ticker item: a daily-digest creature/boss plots its spawns
  // (reusing the creature search machinery); a house event flies to that house
  // (turning the layer on so its pin shows). Both are no-ops when unresolvable.
  function onPickEvent(ev: WorldEvent) {
    if (ev.type.startsWith('digest_')) {
      if (ev.meta?.slug) void addCreature(ev.meta.slug)
      return
    }
    if (!ev.ref_id) return
    const h = houseByIdRef.current.get(ev.ref_id)
    if (!h) return
    if (!showHouses) setShowHouses(true)
    flyToHouse(h)
  }

  // Drag the houses window by its header. Grabs the pointer offset once, then
  // tracks moves on window (self-removing listeners), clamped to the viewport so
  // it can't be lost behind the nav/hotbar. Ignores drags starting on a button.
  function startPanelDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const move = (ev: PointerEvent) => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, ev.clientX - dx))
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, ev.clientY - dy))
      setPanelPos({ x, y })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  addMarkerRef.current = (m) => setMarkers((prev) => [...prev, m])
  removeMarkerRef.current = (id) => setMarkers((prev) => prev.filter((m) => m.id !== id))
  openMarkerModalRef.current = (d) => {
    setDraftLabel('')
    setMarkerDraft(d)
  }

  // Compute a multi-modal route (walk + boat) between two points and store the
  // plan; a draw effect renders its legs on the map.
  computeRouteRef.current = async (s, e) => {
    setRouteMsg(null)
    setRoutePlan(null)
    setRouteBusy(true)
    try {
      const plan = await planRoute(
        { x: s.x, y: s.y, floor: s.floor },
        { x: e.x, y: e.y, floor: e.floor },
      )
      if (!plan) {
        setRouteMsg(t('map.routeNone'))
        return
      }
      setRoutePlan(plan)
      // Best-effort route: warn that the trail goes cold before the target and
      // say where/how far, instead of a bare "no route".
      if (plan.partial)
        setRouteMsg(
          t('map.routePartial', {
            tiles: plan.partial.remaining,
            floor: plan.partial.floor === SURFACE ? '0' : plan.partial.floor < SURFACE ? `+${SURFACE - plan.partial.floor}` : `${SURFACE - plan.partial.floor}`,
          }),
        )
      // Jump to the start floor so the beginning of the route is visible.
      setFloor(s.floor)
    } catch {
      setRouteMsg(t('map.routeError'))
    } finally {
      setRouteBusy(false)
    }
  }

  // Set a route endpoint from a city dropdown; auto-route once both ends exist.
  function pickCityEndpoint(which: 'start' | 'end', name: string) {
    const l = LANDMARKS.find((x) => x.name === name)
    if (!l) return
    const pt: RoutePoint = { x: l.x, y: l.y, floor: l.floor, label: l.name }
    if (which === 'start') {
      setRouteStart(pt)
      const e = routeEndRef.current
      if (e) computeRouteRef.current(pt, e)
    } else {
      setRouteEnd(pt)
      const s = routeStartRef.current
      if (s) computeRouteRef.current(s, pt)
    }
  }

  function clearRouteEndpoint(which: 'start' | 'end') {
    if (which === 'start') setRouteStart(null)
    else setRouteEnd(null)
    setRoutePlan(null)
    setRouteMsg(null)
  }

  function resetRoute() {
    setRouteStart(null)
    setRouteEnd(null)
    setRoutePlan(null)
    setRouteMsg(null)
    setReportState('idle')
    setReportNote('')
  }

  // Close the directions bar entirely: wipe the route and leave route mode.
  function closeRoute() {
    resetRoute()
    setRouteMode(false)
  }

  // Report the current route as wrong. Sends the two endpoints, an optional note
  // ("what looks off"), a trimmed snapshot of the computed itinerary and the map
  // URL hash (so the exact route replays) to the DB for a later routing fix.
  async function submitRouteReport() {
    const s = routeStartRef.current
    const e = routeEndRef.current
    if (!s || !e || reportState === 'sending') return
    setReportState('sending')
    try {
      // Trim walk legs to their endpoints so the payload stays small; boat/stairs
      // legs are already compact. Keeps the itinerary shape for triage.
      const plan = routePlan
        ? {
            totalTiles: routePlan.totalTiles,
            partial: routePlan.partial,
            legs: routePlan.legs.map((leg) =>
              leg.kind === 'walk'
                ? {
                    kind: 'walk',
                    floor: leg.floor,
                    tiles: leg.tiles,
                    path: leg.path.length > 2 ? [leg.path[0], leg.path[leg.path.length - 1]] : leg.path,
                  }
                : leg,
            ),
          }
        : null
      await api.post('/route-reports', {
        from: [Math.round(s.x), Math.round(s.y), s.floor],
        to: [Math.round(e.x), Math.round(e.y), e.floor],
        from_label: s.label ?? null,
        to_label: e.label ?? null,
        note: reportNote.trim() || null,
        plan,
        total_tiles: routePlan?.totalTiles ?? null,
        partial: !!routePlan?.partial,
        hash: window.location.hash.replace(/^#/, '') || null,
        view_floor: floorRef.current,
        lang: i18n.language?.slice(0, 2) ?? null,
      })
      setReportState('done')
      setReportNote('')
    } catch {
      setReportState('error')
    }
  }

  // --- manual route builder actions ---
  function toggleBuildMode() {
    setMapMode(buildMode ? null : 'build')
  }

  function undoBuildPoint() {
    setBuildPoints((prev) => prev.slice(0, -1))
  }

  function clearBuild() {
    setBuildPoints([])
    setBuildName('')
    setBuildPlan(null)
    setPublishState('idle')
  }

  // Submit the built route for review. No accounts: it's stored anonymously
  // (optional name + the server-recorded IP) as `pending` until a reviewer
  // publishes it.
  async function publishRoute() {
    if (buildPoints.length < 2 || !buildName.trim() || publishState === 'sending') return
    setPublishState('sending')
    try {
      await api.post('/routes', {
        name: buildName.trim(),
        connect: buildConnect,
        waypoints: buildPoints.map((p) => [Math.round(p.x), Math.round(p.y), p.floor]),
      })
      setPublishState('done')
    } catch {
      setPublishState('error')
    }
  }

  // Whether a route endpoint is one of the named cities (so the picker shows its
  // name) versus a raw map click / plotted spawn (shown as a generic "point").
  const isLandmark = (p: RoutePoint | null) => !!p?.label && LANDMARKS.some((l) => l.name === p.label)

  // Floor label matching the selector (0 = surface, +N above, -N below).
  const floorLabel = (f: number) =>
    f === SURFACE ? '0' : f < SURFACE ? `+${SURFACE - f}` : `${SURFACE - f}`

  // Recompute the visible point set (bosses-only is the sole narrowing left; the
  // refine panel's category/zone/level filters are gone — the search field and
  // the hunt finder cover that ground) and redraw the overlay.
  rebuildOverlayRef.current = () => {
    const { points, bosses } = allPointsRef.current
    const f = bossOnlyRef.current ? points.filter((p) => bosses[p[2]]) : points
    filteredRef.current = f
    filteredHeatRef.current = computeHeat(f, allPointsRef.current.scores)
    overlayGenRef.current++ // sprite representatives may change wholesale
    renderSpritesRef.current() // paints both the ×N sprites and the (gated) dots
  }

  // Render the "all creatures" overlay as ONE grouped marker per spawn: nearby
  // spawns collapse into a single zoom-aware grid cell showing the dominant
  // creature's sprite, an ×N of how many creatures the spawn holds, and a coin
  // badge with the spawn's TOTAL loot gold (Σ each creature's loot worth). The
  // marker's ring is tinted by the spawn's average profit score. The grid is
  // anchored in projected (world-pixel) space so a cell's representative stays
  // put while panning and the syncMarkers diff reuses the existing DOM nodes.
  renderSpritesRef.current = () => {
    const grp = allSpriteGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    const points = filteredRef.current
    const { names, images, slugs, scores, lootValues } = allPointsRef.current

    if (!showAllRef.current || !points.length) {
      syncMarkers(grp, spriteCacheRef.current, 'off', new Map())
      dotsLayerRef.current?.setData([])
      return
    }

    const zoom = map.getZoom()
    // The grouped money markers replace the raw per-spawn dots entirely, so keep
    // the dot canvas empty (its heat colour now lives on each marker's ring).
    dotsLayerRef.current?.setData([])
    // Scale the sprite badge with zoom so it doesn't look tiny when zoomed in,
    // and keep the de-dup grid a bit larger than the badge to avoid overlap.
    const size = Math.max(28, Math.min(64, Math.round(22 + zoom * 9)))
    const imgPx = Math.round(size * 0.85)
    // Grouping grid: a multiple of the badge footprint that grows as you zoom
    // out (where the badge itself is clamped small but each screen cell covers
    // far more world). Kept modest so an overview stays readable without
    // collapsing everything into a handful of ×N markers — `5 - zoom`, clamped,
    // sweeps the factor from ~4 when zoomed out to ~1.4 zoomed in.
    const groupFactor = Math.max(1.4, Math.min(4, 5 - zoom))
    const cell = Math.round((size + 6) * groupFactor)
    const view = map.getPixelBounds()
    const minX = view.min!.x - cell
    const maxX = view.max!.x + cell
    const minY = view.min!.y - cell
    const maxY = view.max!.y + cell
    // Aggregate every spawn in a cell into one spawn group: per-species counts
    // (to pick the dominant sprite + break it down in the popup), the total
    // creature count, the total loot gold, and a score sum for the ring tint.
    type SpawnAgg = {
      bySpecies: Map<number, { p: [number, number, number]; n: number }>
      total: number
      gold: number
      scoreSum: number
      rep: [number, number, number]
    }
    const cells = new Map<string, SpawnAgg>()
    for (const p of points) {
      const pt = map.project(toLatLng(p[0], p[1]), zoom)
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
      const ck = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      let agg = cells.get(ck)
      if (!agg) cells.set(ck, (agg = { bySpecies: new Map(), total: 0, gold: 0, scoreSum: 0, rep: p }))
      const hit = agg.bySpecies.get(p[2])
      if (hit) hit.n++
      else agg.bySpecies.set(p[2], { p, n: 1 })
      agg.total++
      agg.gold += lootValues[p[2]] ?? 0
      agg.scoreSum += scores[p[2]] ?? 0
    }
    const wanted = new Map<string, () => L.Marker>()
    for (const [ck, agg] of cells) {
      if (wanted.size >= SPRITE_CAP) break
      // Dominant species (most spawns) supplies the sprite and marker position.
      const species = [...agg.bySpecies.values()].sort((a, b) => b.n - a.n)
      const dom = species[0]
      const ci = dom.p[2]
      const total = agg.total
      const gold = agg.gold
      const ringT = agg.scoreSum / Math.max(1, total) // avg profit → ring colour
      const ring = heatCss(ringT)
      // Rebuild the marker when its cell, dominant creature, count or gold change.
      wanted.set(`${ck}|${ci}|${total}|${Math.round(gold)}`, () => {
        const img = images[ci]
          ? `<img src="${escapeHtml(images[ci]!)}" alt="" loading="lazy" style="width:${imgPx}px;height:${imgPx}px" />`
          : ''
        const countBadge =
          total > 1
            ? `<span class="tm-spawn-count" style="left:${Math.round(size * 0.34)}px;top:-${Math.round(size * 0.4)}px">&times;${total}</span>`
            : ''
        const goldBadge =
          gold > 0
            ? `<span class="tm-spawn-gold" style="left:0;top:${Math.round(size * 0.5)}px">` +
              `<img src="/sprites/crystal-coin.webp" alt="" />${fmtGold(gold)}</span>`
            : ''
        const icon = L.divIcon({
          className: '',
          html:
            `<div class="tm-spawn-marker"><div class="tm-spawn tm-spawn-all" style="--ring:${ring};width:${size}px;height:${size}px">${img}</div>${countBadge}${goldBadge}</div>`,
          iconSize: [0, 0],
        })
        // Popup: total gold + the species breakdown (top 6), each linking out.
        const rows = species
          .slice(0, 6)
          .map(
            (s) =>
              `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">` +
              (images[s.p[2]]
                ? `<img src="${escapeHtml(images[s.p[2]]!)}" alt="" style="width:18px;height:18px;image-rendering:pixelated;object-fit:contain" />`
                : '') +
              `<a href="/entry/${escapeHtml(slugs[s.p[2]] ?? '')}" style="color:var(--color-accent);font-weight:700;font-size:12px">${escapeHtml(names[s.p[2]])}</a>` +
              `<span style="opacity:.6;font-size:11px">&times;${s.n}</span></div>`,
          )
          .join('')
        const more = species.length > 6 ? `<div style="opacity:.55;font-size:11px;margin-top:3px">+${species.length - 6}…</div>` : ''
        return L.marker(toLatLng(dom.p[0], dom.p[1]), { icon }).bindPopup(
          `<div style="min-width:150px"><div style="font-weight:800;display:flex;align-items:center;gap:5px">` +
            `<img src="/sprites/crystal-coin.webp" alt="" style="width:15px;height:15px;image-rendering:pixelated" /> ${fmtGold(gold)} gp` +
            `<span style="opacity:.55;font-weight:600;font-size:11px">· ${total} ${escapeHtml(t('map.spawnsShown'))}</span></div>` +
            `<div style="opacity:.55;font-size:11px;margin:2px 0">${dom.p[0]}, ${dom.p[1]}, z${floorRef.current}</div>` +
            rows +
            more +
            `</div>`,
        )
      })
    }
    syncMarkers(grp, spriteCacheRef.current, `${zoom}|${overlayGenRef.current}`, wanted)
  }

  // Draw the imported minimap POI markers for the current floor. De-duplicated
  // by a screen-pixel grid (like the creature sprites) so dense clusters thin
  // out instead of piling up; each shows its label on hover and coords on click.
  renderPoiRef.current = () => {
    const grp = poiGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    if (!showPoiRef.current) {
      syncMarkers(grp, poiCacheRef.current, 'off', new Map())
      return
    }
    const f = floorRef.current
    const zoom = map.getZoom()
    const cell = 34
    const view = map.getPixelBounds()
    const minX = view.min!.x - cell
    const maxX = view.max!.x + cell
    const minY = view.min!.y - cell
    const maxY = view.max!.y + cell
    const wanted = new Map<string, () => L.Marker>()
    for (const m of poiRef.current) {
      if (m.z !== f) continue
      const pt = map.project(toLatLng(m.x, m.y), zoom)
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
      const key = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      if (wanted.has(key)) continue
      wanted.set(key, () => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-poi" style="--poi:${m.color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg></div>`,
          iconSize: [0, 0],
        })
        return L.marker(toLatLng(m.x, m.y), { icon })
          .bindTooltip(escapeHtml(m.desc), { direction: 'top', offset: [0, -9] })
          .bindPopup(
            `<div><div style="font-weight:700">${escapeHtml(m.desc)}</div>` +
              `<div style="opacity:.55;font-size:11px;margin-top:2px">${m.x}, ${m.y}, z${m.z}</div></div>`,
          )
      })
    }
    syncMarkers(grp, poiCacheRef.current, `${f}|${zoom}`, wanted)
  }

  // Draw the rentable houses on the current floor. Same viewport-culled,
  // pixel-grid-deduped diff as the POI layer so dense town blocks stay legible.
  // A guildhall is tinted indigo, a normal house gold; once the live ETL is
  // layered in, the ring recolours by rent status (rented / auctioned / free).
  renderHousesRef.current = () => {
    const grp = houseGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    if (!showHousesRef.current) {
      syncMarkers(grp, houseCacheRef.current, 'off', new Map())
      return
    }
    const f = floorRef.current
    const zoom = map.getZoom()
    const cell = 26
    const view = map.getPixelBounds()
    const minX = view.min!.x - cell
    const maxX = view.max!.x + cell
    const minY = view.min!.y - cell
    const maxY = view.max!.y + cell
    const sf = houseStatusFilterRef.current
    const kind = houseKindRef.current
    const wanted = new Map<string, () => L.Marker>()
    for (const h of housesRef.current) {
      if (h.z !== f) continue
      // Guildhall filter: guild > 0 marks a guildhall.
      if (kind === 'guild' && !h.guild) continue
      if (kind === 'house' && h.guild) continue
      const live = houseLiveRef.current?.[h.id] ?? null
      // Rent-status filter, applied BEFORE the per-cell dedupe so a matching house
      // isn't hidden behind a non-matching neighbour sharing its screen cell.
      if (sf === 'available' && !(live && isAvailable(live.status))) continue
      if (sf === 'rented' && live?.status !== 'rented') continue
      const pt = map.project(toLatLng(h.x, h.y), zoom)
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
      const key = Math.floor(pt.x / cell) + '_' + Math.floor(pt.y / cell)
      if (wanted.has(key)) continue
      const hl: House = live ? { ...h, live } : h
      const watched = isHouseWatched(watchesRef.current, worldRef.current, hl.id)
      wanted.set(key, () => {
        const fill = hl.live
          ? hl.live.status === 'free'
            ? '#2f9e5a'
            : hl.live.status === 'auctioned'
              ? '#d08a1e'
              : '#a13d3d'
          : hl.guild
            ? '#7c6cf0'
            : '#b3873f'
        // A gold ring flags houses on the alert list at a glance.
        const ring = watched ? ';outline:2px solid #f0c674;outline-offset:1px' : ''
        const icon = L.divIcon({
          className: '',
          html:
            `<div style="display:grid;place-items:center;width:22px;height:22px;margin:-11px 0 0 -11px;` +
            `border-radius:6px;background:${fill};box-shadow:0 1px 3px rgba(0,0,0,.55);border:1.5px solid rgba(255,255,255,.85)${ring}">` +
            `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" ` +
            `stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7M5 9v11h14V9"/></svg></div>`,
          iconSize: [0, 0],
        })
        // Popup as a DOM node so the bell button gets a live click handler.
        // Bound LAZILY (Leaflet accepts a content factory) so the on-demand
        // owner lookup inside buildHousePopupEl only fires when a popup is
        // actually opened — not once per visible pin on every repaint.
        return L.marker(toLatLng(hl.x, hl.y), { icon })
          .bindTooltip(escapeHtml(hl.name), { direction: 'top', offset: [0, -12] })
          .bindPopup(() => buildHousePopupEl(hl))
      })
    }
    syncMarkers(
      grp,
      houseCacheRef.current,
      `${f}|${zoom}|${houseLiveVerRef.current}|${sf}|${kind}|${houseWatchVerRef.current}`,
      wanted,
    )
  }

  function writeHash() {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    let hash = `f=${floorRef.current}&z=${map.getZoom()}&x=${Math.round(c.lng)}&y=${Math.round(-c.lat)}`
    if (markersRef.current.length) hash += `&m=${encodeMarkers(markersRef.current)}`
    if (creaturesRef.current.length) hash += `&c=${creaturesRef.current.map((c) => c.slug).join(',')}`
    if (routeStartRef.current || routeEndRef.current)
      hash += `&r=${encodeRoutePoint(routeStartRef.current)};${encodeRoutePoint(routeEndRef.current)}`
    if (buildPointsRef.current.length) {
      hash += `&bp=${buildPointsRef.current.map((p) => [Math.round(p.x), Math.round(p.y), p.floor].join(',')).join(';')}`
      hash += `&bc=${buildConnectRef.current}`
      if (buildNameRef.current.trim()) hash += `&bn=${encodeURIComponent(buildNameRef.current.trim())}`
    }
    window.history.replaceState(null, '', '#' + hash)
  }

  // Keep the boss-watch sidebar pinned just below the top-left control column, so
  // it never overlaps the search / route / creature panels as they grow or shrink.
  useEffect(() => {
    const col = topColRef.current
    const root = rootRef.current
    if (!col || !root) return
    const measure = () => {
      const top = col.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 8
      setBossTop(Math.max(64, Math.round(top)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(col)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // --- map init (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      preferCanvas: true, // vector layers (route polylines) render to canvas
      minZoom: 1, // hard floor: never zoom out past z=1 (see resize clamp)
      maxZoom: 5,
      zoomControl: false, // +/- buttons removed — they collided with the floor
      // selector in the top-right corner; scroll/pinch still zooms.
      attributionControl: false,
      maxBounds: [
        [-Y_MAX - TILE, X_MIN - TILE],
        [-Y_MIN + TILE, X_MAX + TILE],
      ],
      maxBoundsViscosity: 1.0,
    })

    const worldBounds = L.latLngBounds([-Y_MAX, X_MIN], [-Y_MIN, X_MAX])

    // Custom grid layer: map tile indices back to world-coordinate file names.
    const TibiaTiles = L.GridLayer.extend({
      createTile(coords: { x: number; y: number }) {
        const img = document.createElement('img')
        const gx = coords.x * TILE
        const gy = coords.y * TILE
        img.alt = ''
        img.style.imageRendering = 'pixelated'
        // leaflet.css sets mix-blend-mode:plus-lighter on tiles (Chromium
        // hairline workaround). Combined with our 1px tile overlap (see
        // _initTile) the overlapping strip ADDS both tiles' colours — a
        // bright white/cyan grid. Our tiles are opaque; blend normally.
        img.style.mixBlendMode = 'normal'
        const f = (this as L.GridLayer).options as { floor: number }
        img.onerror = () => {
          img.style.visibility = 'hidden'
        }
        img.src = `/minimap/Minimap_Color_${gx}_${gy}_${f.floor}.png`
        return img
      },
      // Kill the tile-seam grid: the tile pane sits at a sub-pixel offset, so
      // with image-rendering:pixelated a 1px gap opens at every tile boundary
      // and the #336699 container background shows through as a blue grid.
      // Drawing each tile 1px larger makes neighbours overlap instead of
      // leaving a gap. Must live in _initTile — Leaflet overrides any size set
      // in createTile.
      _initTile(tile: HTMLElement) {
        ;(L.GridLayer.prototype as unknown as { _initTile(t: HTMLElement): void })._initTile.call(this, tile)
        const size = (this as L.GridLayer).getTileSize()
        tile.style.width = `${size.x + 1}px`
        tile.style.height = `${size.y + 1}px`
      },
    })

    const layer = new (TibiaTiles as unknown as new (
      o: L.GridLayerOptions & { floor: number },
    ) => L.GridLayer)({
      tileSize: TILE,
      // Always fetch the single native resolution (zoom 0) and let Leaflet
      // scale it; minZoom/maxZoom must span the map's range or the layer stops
      // drawing (GridLayer defaults to minZoom 0 → black when zoomed out).
      minNativeZoom: 0,
      maxNativeZoom: 0,
      minZoom: -5,
      maxZoom: 6,
      noWrap: true,
      bounds: worldBounds,
      floor: floorRef.current,
    })
    layer.addTo(map)

    // The "all creatures" dots (potentially ~10k) paint onto a single canvas
    // overlay in one pass — one layer object instead of one per dot.
    const dots = new (DotCanvas as unknown as new () => DotsLayer)()
    dots.addTo(map)
    const allSpriteGroup = L.layerGroup().addTo(map)
    const poiGroup = L.layerGroup().addTo(map)
    const houseGroup = L.layerGroup().addTo(map)
    const spawnGroup = L.layerGroup().addTo(map)
    const cityGroup = L.layerGroup().addTo(map)
    const loreGroup = L.layerGroup().addTo(map)
    const raidGroup = L.layerGroup().addTo(map)
    const wcGroup = L.layerGroup().addTo(map)
    const tradeGroup = L.layerGroup().addTo(map)
    const rashidGroup = L.layerGroup().addTo(map)
    const markersGroup = L.layerGroup().addTo(map)
    const routeGroup = L.layerGroup().addTo(map)
    const buildGroup = L.layerGroup().addTo(map)

    // Restore the shared view, or default to Thais.
    if (initial.x != null && initial.y != null && initial.z != null) {
      map.setView(toLatLng(initial.x, initial.y), initial.z)
    } else {
      map.setView([-32198, 32368], 1)
    }

    mapRef.current = map
    layerRef.current = layer
    markersGroupRef.current = markersGroup
    cityGroupRef.current = cityGroup
    spawnGroupRef.current = spawnGroup
    dotsLayerRef.current = dots
    allSpriteGroupRef.current = allSpriteGroup
    poiGroupRef.current = poiGroup
    houseGroupRef.current = houseGroup
    loreGroupRef.current = loreGroup
    raidGroupRef.current = raidGroup
    wcGroupRef.current = wcGroup
    tradeGroupRef.current = tradeGroup
    rashidGroupRef.current = rashidGroup
    routeGroupRef.current = routeGroup
    buildGroupRef.current = buildGroup
    // Fresh map: the analyze-selection group belongs to the previous map.
    analyzeGroupRef.current = null
    // Fresh map, fresh layer groups: the diff caches hold markers bound to the
    // previous map (StrictMode remount), so they must start empty.
    spriteCacheRef.current = { epoch: '', markers: new Map() }
    poiCacheRef.current = { epoch: '', markers: new Map() }
    houseCacheRef.current = { epoch: '', markers: new Map() }
    creatureCacheRef.current = { epoch: '', markers: new Map() }
    setMapReady((v) => v + 1)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const x = Math.round(e.latlng.lng)
      const y = Math.round(-e.latlng.lat)

      // "Analyze zone" mode owns the mouse: selection happens on drag
      // (mousedown/up), so a plain click must not fire popups or markers.
      if (analyzeModeRef.current) return

      // "Crear ruta" builder mode: each click appends an ordered waypoint on the
      // current floor.
      if (buildModeRef.current) {
        appendBuildPointRef.current({ x, y, floor: floorRef.current })
        return
      }

      // "Directions" mode: first click sets the start, second the destination
      // (and kicks off the route computation).
      if (routeModeRef.current) {
        const pt = { x, y, floor: floorRef.current }
        // Fill whichever endpoint is still empty (start first); once both are
        // set, a further click replaces the destination.
        if (!routeStartRef.current) {
          setRouteStart(pt)
          const e = routeEndRef.current
          if (e) computeRouteRef.current(pt, e)
        } else {
          setRouteEnd(pt)
          computeRouteRef.current(routeStartRef.current, pt)
        }
        return
      }

      // "Add marker" mode: open the naming modal for a new user marker.
      if (placingRef.current) {
        setPlacing(false)
        openMarkerModalRef.current({ x, y, floor: floorRef.current })
        return
      }

      // Otherwise, if the "all creatures" layer is on, identify the nearest
      // (filtered) spawn within a small pixel tolerance and show what's there.
      const points = filteredRef.current
      const { names } = allPointsRef.current
      if (!points.length) return
      const tol = 8 / Math.pow(2, map.getZoom()) // ~8px tolerance in game units
      let bestD = Infinity
      let bestI = -1
      for (let i = 0; i < points.length; i++) {
        const dx = points[i][0] - x
        const dy = points[i][1] - y
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          bestI = i
        }
      }
      if (bestI >= 0 && bestD <= tol * tol) {
        const p = points[bestI]
        L.popup()
          .setLatLng(toLatLng(p[0], p[1]))
          .setContent(
            `<div><div style="font-weight:700">${escapeHtml(names[p[2]])}</div>` +
              `<div style="opacity:.55;font-size:11px">${p[0]}, ${p[1]}, z${floorRef.current}</div></div>`,
          )
          .openOn(map)
      }
    })

    // Wire the "delete" link inside marker popups.
    map.on('popupopen', (e: L.PopupEvent) => {
      const el = e.popup.getElement()
      const del = el?.querySelector('.tm-del') as HTMLElement | null
      if (del) {
        del.onclick = () => {
          const id = del.getAttribute('data-id')
          map.closePopup()
          if (id) removeMarkerRef.current(id)
        }
      }
    })

    const syncCenter = () => {
      const c = map.getCenter()
      setCenter({ x: Math.round(c.lng), y: Math.round(-c.lat) })
    }
    map.on('moveend zoomend', () => {
      syncCenter()
      writeHash()
      renderSpritesRef.current()
      renderPoiRef.current()
      renderHousesRef.current()
      renderCreaturesRef.current()
    })
    syncCenter()

    // The container may have zero size at mount (e.g. inside transitions);
    // recompute once layout settles and whenever it resizes. The immersive map
    // fills the viewport, so the whole world would fit at a very low zoom — but
    // zooming out that far reads as a tiny map floating in black. Keep z=1 as the
    // hard floor; only tighten it further if a small container needs a higher
    // zoom just to fit the bounds.
    const resize = () => {
      map.invalidateSize()
      const fitZoom = map.getBoundsZoom(worldBounds, false)
      const minZ = Math.max(1, Number.isFinite(fitZoom) ? fitZoom : 1)
      map.setMinZoom(minZ)
      if (map.getZoom() < minZ) map.setZoom(minZ)
    }
    resize()
    const raf = requestAnimationFrame(resize)
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      markersGroupRef.current = null
      cityGroupRef.current = null
      spawnGroupRef.current = null
      dotsLayerRef.current = null
      allSpriteGroupRef.current = null
      poiGroupRef.current = null
      houseGroupRef.current = null
      loreGroupRef.current = null
      raidGroupRef.current = null
      wcGroupRef.current = null
      tradeGroupRef.current = null
      rashidGroupRef.current = null
      routeGroupRef.current = null
      buildGroupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render tiles when the floor changes.
  useEffect(() => {
    floorRef.current = floor
    const layer = layerRef.current
    if (layer) {
      ;(layer.options as L.GridLayerOptions & { floor: number }).floor = floor
      layer.redraw()
    }
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor])

  // Re-draw user markers whenever the set or the floor changes (markers are
  // floor-specific: only those on the current floor are shown).
  useEffect(() => {
    markersRef.current = markers
    const grp = markersGroupRef.current
    if (grp) {
      grp.clearLayers()
      for (const mk of markers) {
        if (mk.floor !== floor) continue
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-marker"><div class="tm-pin"></div><div class="tm-label">${escapeHtml(mk.label || '?')}</div></div>`,
          iconSize: [0, 0],
        })
        const lm = L.marker(toLatLng(mk.x, mk.y), { icon }).addTo(grp)
        lm.bindPopup(
          `<div><div style="font-weight:700">${escapeHtml(mk.label || t('map.markerDefault'))}</div>` +
            `<div style="opacity:.55;font-size:11px;margin-top:2px">${mk.x}, ${mk.y}, z${mk.floor}</div>` +
            `<div class="tm-del" data-id="${mk.id}">${escapeHtml(t('map.delete'))}</div></div>`,
        )
      }
    }
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, floor, mapReady])

  // Draw the city/zone name labels. Each landmark belongs to one floor (all the
  // surface ones live on floor 7), so a label only shows on its own floor.
  // Clicking a label flies to that city.
  useEffect(() => {
    const grp = cityGroupRef.current
    if (!grp) return
    grp.clearLayers()
    for (const lm of MAP_LABELS) {
      if (lm.floor !== floor) continue
      const cls = lm.kind === 'city' ? 'tm-city' : 'tm-city tm-region'
      const icon = L.divIcon({
        className: '',
        html: `<div class="${cls}">${escapeHtml(lm.name)}</div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(lm.x, lm.y), { icon, interactive: true, keyboard: false })
        .addTo(grp)
        .on('click', () => goTo(lm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady])

  // Draw the curated lore / mystery POIs when the layer is on. Each pin sits on
  // its own floor (all surface today) and, when clicked, flies the map there and
  // opens the in-map reader panel for its lore entry. The open pin is highlighted.
  useEffect(() => {
    const grp = loreGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (!showLore) return
    for (const poi of LORE_POIS) {
      if (poi.floor !== floor) continue
      const active = poi === lorePoi
      const icon = L.divIcon({
        className: '',
        html:
          `<div class="tm-lore${active ? ' is-active' : ''}">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
          `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>` +
          `</div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(poi.x, poi.y), { icon, interactive: true, keyboard: false, zIndexOffset: 500 })
        .addTo(grp)
        .bindTooltip(escapeHtml(poi.title), { direction: 'top', offset: [0, -12] })
        .on('click', () => {
          openPanel('lore')
          setLorePoi(poi)
          const map = mapRef.current
          if (map) map.flyTo(toLatLng(poi.x, poi.y), Math.max(map.getZoom(), 3), { duration: 0.5 })
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady, showLore, lorePoi])

  // Roll Rashid's city over on its own when the 10:00 Berlin server save passes
  // while the map is open (a 30 s poll is plenty for a once-a-day change).
  useEffect(() => {
    const id = window.setInterval(() => setRashidDay(rashidEffectiveDay()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // The travelling merchants' pins, always drawn (dimmed when they stand on a
  // floor other than the one being viewed) so "where are they?" is answerable
  // at a glance: Rashid at today's city, Yasir at each of his three candidate
  // docks. Clicking a pin does what its rail button does — panel + route.
  useEffect(() => {
    const grp = rashidGroupRef.current
    if (!grp) return
    grp.clearLayers()
    const pin = (sprite: string, x: number, y: number, z: number, tip: string, onClick: () => void) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="tm-rashid${z !== floor ? ' is-off' : ''}"><img src="${sprite}" alt=""></div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(x, y), { icon, interactive: true, keyboard: false, zIndexOffset: 700 })
        .addTo(grp)
        .bindTooltip(tip, { direction: 'top', offset: [0, -14] })
        .on('click', onClick)
    }
    pin(
      RASHID_SPRITE,
      rashidStop.x,
      rashidStop.y,
      rashidStop.z,
      `<b>Rashid</b> · ${escapeHtml(rashidStop.city)}`,
      () => goToRashid(),
    )
    for (const d of YASIR_DOCKS) {
      pin(
        YASIR_SPRITE,
        d.x,
        d.y,
        d.z,
        `<b>Yasir</b> · ${escapeHtml(d.city)}<br>${escapeHtml(t('map.yasirMaybe'))}`,
        () => goToYasirDock(d),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady, rashidStop])

  // Trade pins for the searched item: one pin per merchant spawn — gold when
  // the NPC sells it, green when it pays you for it, split when both. Pins on
  // other floors render dimmed; clicking one flies there (switching floor) and
  // presets the "Cómo llegar" destination on that merchant.
  useEffect(() => {
    const grp = tradeGroupRef.current
    if (!grp) return
    grp.clearLayers()
    const trade = activeItem?.trade
    if (!trade) return
    for (const p of mergeTradePins(trade)) {
      const kind =
        p.buyPrice != null && p.sellPrice != null ? 'is-both' : p.buyPrice != null ? 'is-buy' : 'is-sell'
      const gp = (n: number) => `${n.toLocaleString()} ${escapeHtml(p.currency ?? 'gp')}`
      const lines = [`<b>${escapeHtml(p.npc)}</b>${p.city ? ` · ${escapeHtml(p.city)}` : ''}`]
      if (p.buyPrice != null) lines.push(`${t('map.tradeSellsFor')} ${gp(p.buyPrice)}`)
      if (p.sellPrice != null) lines.push(`${t('map.tradePaysYou')} ${gp(p.sellPrice)}`)
      const tip = lines.join('<br>')
      for (const c of p.coords) {
        const off = c[2] !== floor
        const icon = L.divIcon({
          className: '',
          html: `<div class="tm-trade ${kind}${off ? ' is-off' : ''}">${TRADE_PIN_SVG}</div>`,
          iconSize: [0, 0],
        })
        L.marker(toLatLng(c[0], c[1]), { icon, interactive: true, keyboard: false, zIndexOffset: 600 })
          .addTo(grp)
          .bindTooltip(tip, { direction: 'top', offset: [0, -12] })
          .on('click', () => routeToTradeNpc(p.npc, c))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, floor, mapReady])

  // Draw the selected creatures' spawn icons. Seven creatures can carry ~700
  // spawn points and Leaflet repositions every DOM marker on each zoom, so only
  // spawns in (or near) the viewport get a DOM node; keys are world coordinates
  // and pans/zooms reuse the existing markers (syncMarkers), adding/removing
  // just the ones that cross the padded view edge.
  renderCreaturesRef.current = () => {
    const grp = spawnGroupRef.current
    const map = mapRef.current
    if (!grp || !map) return
    const f = floorRef.current
    const zoom = map.getZoom()
    const pad = 160 // px beyond the view so edge markers don't pop in late
    const view = map.getPixelBounds()
    const minX = view.min!.x - pad
    const maxX = view.max!.x + pad
    const minY = view.min!.y - pad
    const maxY = view.max!.y + pad
    const wanted = new Map<string, () => L.Marker>()
    for (const cr of creaturesRef.current) {
      // Eager (not lazy): a tracked creature has few markers and lazy-loading
      // inside a Leaflet div-icon often never fires — you fly to a lone boss
      // spawn and the sprite stays blank until you pan.
      const img = cr.image
        ? `<img src="${escapeHtml(cr.image)}" alt="" />`
        : ''
      for (const sp of cr.spawns) {
        if (sp.z !== f) continue
        const pt = map.project(toLatLng(sp.x, sp.y), zoom)
        if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue
        wanted.set(`${cr.slug}_${sp.x}_${sp.y}`, () => {
          const icon = L.divIcon({
            className: '',
            html: `<div class="tm-spawn" style="--ring:${cr.color}">${img}</div>`,
            iconSize: [0, 0],
          })
          return L.marker(toLatLng(sp.x, sp.y), { icon }).bindPopup(
            `<div><div style="font-weight:700">${escapeHtml(cr.name)}</div>` +
              `<div style="opacity:.55;font-size:11px;margin:2px 0">${sp.x}, ${sp.y}, z${sp.z}</div>` +
              `<a href="/entry/${escapeHtml(cr.slug)}" style="color:var(--color-accent);font-size:11px;font-weight:700">${escapeHtml(t('map.viewEntry'))}</a></div>`,
          )
        })
      }
    }
    syncMarkers(
      grp,
      creatureCacheRef.current,
      `${f}|${creaturesRef.current.map((c) => c.slug + c.color).join(',')}`,
      wanted,
    )
  }

  // Re-draw creature spawn icons on creature/floor change.
  useEffect(() => {
    creaturesRef.current = creatures
    renderCreaturesRef.current()
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatures, floor, mapReady])

  // Highlight ring over the hunting zone picked in the Hunt Finder — shown only
  // while its floor is selected (the ring is lazily created on first use).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let grp = huntHiRef.current
    if (!grp) {
      grp = L.layerGroup().addTo(map)
      huntHiRef.current = grp
    }
    grp.clearLayers()
    const zone = hunt?.zones.find((z) => z.id === huntZoneId)
    if (zone && zone.z === floor) {
      if (!huntSvgRef.current) huntSvgRef.current = L.svg().addTo(map)
      grp.addLayer(
        L.circleMarker(toLatLng(zone.x, zone.y), {
          radius: 28,
          color: '#f4e7c6',
          weight: 3,
          opacity: 0.95,
          fillColor: '#d23d2f',
          fillOpacity: 0.14,
          renderer: huntSvgRef.current,
        }),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huntZoneId, hunt, floor, mapReady])

  // "Analyze zone" drawing mode: TWO CLICKS, not a drag — first click plants a
  // corner, the dashed preview follows the cursor, second click closes the box
  // (which opens the summary panel). Chosen over drag-to-draw precisely so the
  // map keeps panning normally with the tool active (Leaflet suppresses 'click'
  // after a pan, so dragging around between the two clicks is free). Armed only
  // while there is NO box yet; once fixed, the box is adjusted via its corner
  // handles and closing the panel (or re-toggling the tool) re-arms the draw.
  useEffect(() => {
    analyzeModeRef.current = analyzeMode
    const map = mapRef.current
    if (!map || !mapReady || !analyzeMode || analyzeBox !== null) return
    const container = map.getContainer()
    const prevCursor = container.style.cursor
    container.style.cursor = 'crosshair'
    // Two quick corner clicks must not zoom the map.
    map.doubleClickZoom.disable()

    let first: { x: number; y: number } | null = null
    let rubber: L.Rectangle | null = null
    const toXY = (e: L.LeafletMouseEvent) => ({ x: Math.round(e.latlng.lng), y: Math.round(-e.latlng.lat) })
    const click = (e: L.LeafletMouseEvent) => {
      // A click on the fixed box's corner handles is not a corner plant.
      if ((e.originalEvent.target as HTMLElement | null)?.closest?.('.leaflet-marker-icon')) return
      const p = toXY(e)
      if (!first) {
        first = p
        return
      }
      const box = {
        x1: Math.min(first.x, p.x), y1: Math.min(first.y, p.y),
        x2: Math.max(first.x, p.x), y2: Math.max(first.y, p.y),
      }
      // Same-spot second click (accidental double click): keep waiting.
      if (box.x2 - box.x1 < 4 || box.y2 - box.y1 < 4) return
      first = null
      rubber?.remove()
      rubber = null
      setAnalyzeBox(box)
    }
    const move = (e: L.LeafletMouseEvent) => {
      if (!first) return
      const cur = toXY(e)
      const b = L.latLngBounds(toLatLng(first.x, first.y), toLatLng(cur.x, cur.y))
      if (!rubber) {
        rubber = L.rectangle(b, {
          color: '#3fa7d6', weight: 2, dashArray: '6 4', fillColor: '#3fa7d6', fillOpacity: 0.08, interactive: false,
        }).addTo(map)
      } else {
        rubber.setBounds(b)
      }
    }
    map.on('click', click)
    map.on('mousemove', move)
    return () => {
      map.off('click', click)
      map.off('mousemove', move)
      rubber?.remove()
      container.style.cursor = prevCursor
      map.doubleClickZoom.enable()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeMode, analyzeBox, mapReady])

  // The fixed selection: the rectangle plus four draggable corner handles to
  // fine-tune it after release (each nudge re-queries). Drawn on every floor on
  // purpose — the box is a place; the floor control picks which level of it the
  // summary describes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let grp = analyzeGroupRef.current
    if (!grp) {
      grp = L.layerGroup().addTo(map)
      analyzeGroupRef.current = grp
    }
    grp.clearLayers()
    if (!analyzeBox || !analyzeMode) return
    const b = analyzeBox
    const rect = L.rectangle(
      L.latLngBounds(toLatLng(b.x1, b.y1), toLatLng(b.x2 + 1, b.y2 + 1)),
      { color: '#3fa7d6', weight: 2, fillColor: '#3fa7d6', fillOpacity: 0.07, interactive: false },
    )
    grp.addLayer(rect)
    const handleIcon = L.divIcon({
      className: '',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      html: '<div style="width:12px;height:12px;border-radius:3px;background:#3fa7d6;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:nwse-resize"></div>',
    })
    for (const [cx, cy] of [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]] as const) {
      const ox = cx === b.x1 ? b.x2 : b.x1
      const oy = cy === b.y1 ? b.y2 : b.y1
      const m = L.marker(toLatLng(cx, cy), { icon: handleIcon, draggable: true, keyboard: false, zIndexOffset: 800 })
      // Live feedback while dragging; the box (and the query) commit on release.
      m.on('drag', () => {
        const ll = m.getLatLng()
        const nx = Math.round(ll.lng)
        const ny = Math.round(-ll.lat)
        rect.setBounds(L.latLngBounds(toLatLng(Math.min(nx, ox), Math.min(ny, oy)), toLatLng(Math.max(nx, ox) + 1, Math.max(ny, oy) + 1)))
      })
      m.on('dragend', () => {
        const ll = m.getLatLng()
        const nx = Math.round(ll.lng)
        const ny = Math.round(-ll.lat)
        setAnalyzeBox({ x1: Math.min(nx, ox), y1: Math.min(ny, oy), x2: Math.max(nx, ox), y2: Math.max(ny, oy) })
      })
      grp.addLayer(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeBox, analyzeMode, mapReady])

  // Draw the computed route + start/destination pins. The route belongs to the
  // start point's floor, so it only shows while that floor is selected.
  useEffect(() => {
    const grp = routeGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (routePlan) {
      // Legs live on specific floors; only draw those on the floor in view.
      drawRouteLegs(grp, routePlan.legs, floor, t('map.floor'), floorLabel, setFloor)
      // Partial route: mark where the trail goes cold on its own floor.
      if (routePlan.partial && routePlan.partial.floor === floor) {
        grp.addLayer(
          L.marker(toLatLng(routePlan.partial.x, routePlan.partial.y), {
            icon: L.divIcon({
              className: '',
              html: `<div class="tm-route-stair is-lost">✕ ${escapeHtml(t('map.routeLostHere'))}</div>`,
              iconSize: [0, 0],
            }),
            interactive: false,
          }),
        )
      }
    }
    const pin = (p: RoutePoint, label: string, color: string) =>
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({
          className: '',
          html: `<div class="tm-route-pin" style="--rp:${color}">${label}</div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
      })
    if (routeStart && routeStart.floor === floor)
      grp.addLayer(pin(routeStart, t('map.routeStartLabel'), '#4f7a3a'))
    if (routeEnd && routeEnd.floor === floor)
      grp.addLayer(pin(routeEnd, t('map.routeEndLabel'), '#9c3b2e'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStart, routeEnd, routePlan, floor, mapReady])

  // Compute the built route's connecting legs whenever its points or connection
  // mode change. 'straight' synthesizes simple walk/floor-change legs instantly;
  // 'auto' routes each consecutive pair with the A* planner (falling back to a
  // straight hop for any pair the router can't connect).
  useEffect(() => {
    const pts = buildPoints
    if (pts.length < 2) {
      setBuildPlan(null)
      setBuildBusy(false)
      return
    }
    const straightHop = (a: RoutePoint, b: RoutePoint): Extract<RouteLeg, { kind: 'walk' }> => ({
      kind: 'walk',
      floor: a.floor,
      path: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
      tiles: Math.round(Math.hypot(b.x - a.x, b.y - a.y)),
    })
    if (buildConnect === 'straight') {
      const legs: RouteLeg[] = []
      let total = 0
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        if (a.floor === b.floor) {
          const leg = straightHop(a, b)
          legs.push(leg)
          total += leg.tiles
        } else {
          // A floor change between two waypoints: a badge on the origin floor.
          legs.push({ kind: 'stairs', from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, floor: a.floor, toFloor: b.floor, dir: b.floor < a.floor ? 'up' : 'down' })
        }
      }
      setBuildPlan({ legs, totalTiles: total })
      setBuildBusy(false)
      return
    }
    let cancelled = false
    setBuildBusy(true)
    ;(async () => {
      const legs: RouteLeg[] = []
      let total = 0
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        try {
          const plan = await planRoute({ x: a.x, y: a.y, floor: a.floor }, { x: b.x, y: b.y, floor: b.floor })
          if (plan) {
            legs.push(...plan.legs)
            total += plan.totalTiles
          } else {
            legs.push(straightHop(a, b))
          }
        } catch {
          legs.push(straightHop(a, b))
        }
      }
      if (!cancelled) {
        setBuildPlan({ legs, totalTiles: total })
        setBuildBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [buildPoints, buildConnect])

  // Draw the built route: its legs (shared renderer) plus numbered waypoint pins
  // on the floor in view.
  useEffect(() => {
    const grp = buildGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (buildPlan) drawRouteLegs(grp, buildPlan.legs, floor, t('map.floor'), floorLabel, setFloor)
    buildPoints.forEach((p, i) => {
      if (p.floor !== floor) return
      grp.addLayer(
        L.marker(toLatLng(p.x, p.y), {
          icon: L.divIcon({
            className: '',
            html: `<div class="tm-route-pin" style="--rp:#8a5a2b">${i + 1}</div>`,
            iconSize: [0, 0],
          }),
          interactive: false,
        }),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPoints, buildPlan, floor, mapReady])

  // Keep the shared link in sync with the built route.
  useEffect(() => {
    writeHash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPoints, buildConnect, buildName])

  // Keep the placing cursor + ref in sync (route + builder modes also use it).
  useEffect(() => {
    placingRef.current = placing
    const c = mapRef.current?.getContainer()
    if (c) c.classList.toggle('tm-placing', placing || routeMode || buildMode)
  }, [placing, routeMode, buildMode])

  // --- "all creatures" overlay: every spawn on the current floor ---
  const { data: allSpawns } = useQuery<AllSpawns>({
    queryKey: ['map-all-spawns', floor],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<AllSpawns>('/spawns', { params: { z: floor } })
      return data
    },
  })

  // Imported client minimap markers (points of interest) — a static asset,
  // fetched once and kept for the whole session.
  const { data: poiData } = useQuery<[number, number, number, number, string][]>({
    queryKey: ['map-poi'],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch('/map-markers.json')
      if (!res.ok) throw new Error('poi fetch failed')
      return res.json()
    },
  })

  // Pre-process the raw markers into styled POIs, then (re)draw when the layer
  // is toggled, the floor changes, or the map remounts.
  useEffect(() => {
    showPoiRef.current = showPoi
    if (poiData && poiRef.current.length === 0) {
      poiRef.current = poiData.map(([x, y, z, , desc]) => ({ x, y, z, desc, ...poiStyle(desc) }))
    }
    renderPoiRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPoi, poiData, floor, mapReady])

  // Invasions / raids — every raid the server can fire, baked from the OT's own
  // raid XMLs (see tools/gen-raids.mjs). Static, so it loads once per session.
  const { data: raidsFile } = useRaids()
  const raids = raidsFile?.raids

  // Draw the raid layer for the floor in view. Each raid contributes the exact
  // rectangles it floods plus a pin per named creature — an invasion is ground,
  // not a point, so the shape is the whole story. The open raid is highlighted
  // and its geometry drawn on top.
  useEffect(() => {
    const grp = raidGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (!showRaids || !raids) return

    for (const r of raids) {
      if (!r.floors.includes(floor)) continue
      const active = raid?.id === r.id
      const colour = active ? '#ffcf6b' : '#d4483b'

      for (const a of r.areas) {
        if (a.z !== floor) continue
        // +1 so the rectangle covers the far tiles instead of stopping at their
        // top-left corner.
        L.rectangle(L.latLngBounds(toLatLng(a.x1, a.y1), toLatLng(a.x2 + 1, a.y2 + 1)), {
          color: colour,
          weight: active ? 2 : 1.5,
          opacity: active ? 0.95 : 0.7,
          fillColor: colour,
          fillOpacity: active ? 0.22 : 0.12,
          interactive: true,
        })
          .addTo(grp)
          .on('click', () => openRaid(r))
      }

      // One pin per named creature on this floor; a swarm-only raid gets a single
      // pin at the centre of the invaded ground so it stays clickable.
      const pins = r.spawns
        .filter((s) => s.z === floor)
        // A special-drop variant says so on the pin: the three Amazon-set Orc
        // Warlords in Thais stand on different tiles and are otherwise identical.
        .map((s) => ({
          x: s.x,
          y: s.y,
          label: s.drops ? `${s.name} · ${dropLabel(s.drops)}` : s.name,
          carrier: Boolean(s.drops),
        }))
      if (!pins.length) {
        const a = r.areas.find((ar) => ar.z === floor)
        if (a) {
          // A swarm can carry too — Venore's orc raid hides a guaranteed backpack.
          const carried = a.monsters.filter((m) => m.drops)
          pins.push({
            x: Math.round((a.x1 + a.x2) / 2),
            y: Math.round((a.y1 + a.y2) / 2),
            label: carried.length
              ? `${r.name} · ${carried.map((m) => dropLabel(m.drops!)).join(', ')}`
              : r.name,
            carrier: carried.length > 0,
          })
        }
      }

      for (const p of pins) {
        const icon = L.divIcon({
          className: '',
          html:
            `<div class="tm-raid${active ? ' is-active' : ''}${p.carrier ? ' is-carrier' : ''}">` +
            // flame — an invasion under way
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C8.9 8.6 9.6 9.4 10 10c0-2.6 1-6 2-8z"/>` +
            `<path d="M12 22a7 7 0 0 0 7-7"/></svg>` +
            `</div>`,
          iconSize: [0, 0],
        })
        L.marker(toLatLng(p.x, p.y), { icon, interactive: true, keyboard: false, zIndexOffset: 520 })
          .addTo(grp)
          .bindTooltip(escapeHtml(`${r.name} — ${p.label}`), { direction: 'top', offset: [0, -12] })
          .on('click', () => openRaid(r))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady, showRaids, raids, raid])

  // Mini world changes — the server's daily dice rolls, baked from the OT's own
  // scripts and map patches (see tools/gen-world-changes.mjs). Static like the
  // raids, so it loads once per session.
  const { data: wcFile } = useWorldChanges()
  const worldChanges = wcFile?.changes

  // Draw the world-change layer for the floor in view: every place a change CAN
  // land, never a claim that one is live today. Each candidate spot gets a pin
  // plus the footprint of the ground the change swaps in, which is what makes a
  // fury gate read as a piece of a city instead of a dot. The destination behind
  // the change (Fury Hell, the isle) is only drawn for the open dossier —
  // otherwise its pins would sit on floors nothing else explains.
  useEffect(() => {
    const grp = wcGroupRef.current
    if (!grp) return
    grp.clearLayers()
    if (!showWc || !worldChanges) return

    const pin = (x: number, y: number, cls: string, label: string, onClick: () => void) => {
      const icon = L.divIcon({
        className: '',
        // waning moon — a change the world rolls overnight
        html: `<div class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></div>`,
        iconSize: [0, 0],
      })
      L.marker(toLatLng(x, y), { icon, interactive: true, keyboard: false, zIndexOffset: 530 })
        .addTo(grp)
        .bindTooltip(escapeHtml(label), { direction: 'top', offset: [0, -12] })
        .on('click', onClick)
    }

    for (const c of worldChanges) {
      const open = wc?.id === c.id
      const name = t(`map.wcName.${c.id}`)

      for (const s of c.spots) {
        const active = open && wcSpot === s.key
        const colour = active ? '#c7b0ff' : '#8b6fd4'

        if (s.bounds?.floors.includes(floor)) {
          // +1 so the rectangle covers the far tiles instead of stopping at
          // their top-left corner (same convention as the raid areas).
          L.rectangle(
            L.latLngBounds(toLatLng(s.bounds.x1, s.bounds.y1), toLatLng(s.bounds.x2 + 1, s.bounds.y2 + 1)),
            {
              color: colour,
              weight: active ? 2 : 1.5,
              opacity: open ? 0.95 : 0.6,
              fillColor: colour,
              fillOpacity: active ? 0.22 : 0.1,
              interactive: true,
            }
          )
            .addTo(grp)
            .on('click', () => openWorldChange(c, s))
        }

        if (s.z === floor) {
          pin(
            s.x,
            s.y,
            `tm-wc${open ? ' is-open' : ''}${active ? ' is-active' : ''}`,
            `${name} — ${s.label}`,
            () => openWorldChange(c, s)
          )
        }
      }

      if (open && c.inside) {
        if (c.inside.floors.includes(floor)) {
          L.rectangle(
            L.latLngBounds(
              toLatLng(c.inside.bounds.x1, c.inside.bounds.y1),
              toLatLng(c.inside.bounds.x2 + 1, c.inside.bounds.y2 + 1)
            ),
            { color: '#8b6fd4', weight: 1.5, opacity: 0.8, fillColor: '#8b6fd4', fillOpacity: 0.1, dashArray: '5 4' }
          ).addTo(grp)
        }
        if (c.inside.z === floor) {
          pin(c.inside.x, c.inside.y, 'tm-wc is-open is-inside', `${name} — ${c.inside.label}`, () =>
            openWorldChange(c, null)
          )
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, mapReady, showWc, worldChanges, wc, wcSpot, i18n.language])

  // Open a world change's dossier and fly to the spot that was clicked — or, when
  // opened from the panel with no spot, to its first candidate. Changing floors
  // is often the point: Fury Hell sits eight floors under the gate.
  function openWorldChange(c: WorldChange, s: WcSpot | null) {
    openPanel('worldchange')
    setWc(c)
    setWcSpot(s?.key ?? null)
    const target = s ?? (c.inside && !s ? null : c.spots[0])
    const dest = target ? { x: target.x, y: target.y, z: target.z } : c.inside!
    if (dest.z !== floorRef.current) {
      floorRef.current = dest.z
      setFloor(dest.z)
    }
    const map = mapRef.current
    if (map) map.flyTo(toLatLng(dest.x, dest.y), Math.max(map.getZoom(), 3), { duration: 0.5 })
  }

  // The blessing pilgrimage. The visiting ORDER is precomputed — an exact tour
  // over real travel distances (tools/gen-blessings.mjs) — because solving it in
  // the browser would mean thousands of searches over the walkability bake. Here
  // we take the tour whose starting city is nearest to where you are looking and
  // walk it for real, leg by leg, so it draws like any other route.
  const { data: blessings } = useBlessings(blessSet !== null)

  async function runPilgrimage(set: 'five' | 'seven') {
    openPanel('bless')
    setBlessSet(set)
    setBlessStops(null)
    setBlessMin(false)
    setRouteMsg(null)
    setRoutePlan(null)
    setRouteBusy(true)
    try {
      // The hook only starts fetching once blessSet flips, so the very first
      // click has to fetch the file itself rather than wait a render.
      const data = blessings ?? (await (await fetch('/blessings.json')).json())
      const map = mapRef.current
      const c = map?.getCenter()
      const here = { x: Math.round(c ? c.lng : 32365), y: Math.round(c ? -c.lat : 32224) }
      const tour = nearestTour(data, set, here)
      if (!tour) {
        setRouteMsg(t('map.routeNone'))
        return
      }
      const { plan, stops } = await planPilgrimage(data, tour, {
        x: tour.start.x,
        y: tour.start.y,
        floor: tour.start.z,
      })
      setRoutePlan(plan)
      setBlessStops(stops)
      floorRef.current = tour.start.z
      setFloor(tour.start.z)
      if (map) map.flyTo(toLatLng(tour.start.x, tour.start.y), Math.max(map.getZoom(), 2), { duration: 0.5 })
    } catch {
      setRouteMsg(t('map.routeError'))
    } finally {
      setRouteBusy(false)
    }
  }

  // Open a raid's dossier and fly to it, switching floor when it happens
  // somewhere else (Ferumbras and friends are all underground).
  function openRaid(r: Raid) {
    openPanel('raid')
    setRaid(r)
    if (!r.floors.includes(floorRef.current)) {
      floorRef.current = r.z
      setFloor(r.z)
    }
    const map = mapRef.current
    if (map) map.flyTo(toLatLng(r.x, r.y), Math.max(map.getZoom(), 3), { duration: 0.5 })
  }

  // Rentable houses — a static asset baked from the world files (id, name,
  // coords, rent, size, beds, town), fetched once for the session.
  const { data: housesData } = useQuery<{ houses: House[] }>({
    queryKey: ['map-houses'],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch('/houses.json')
      if (!res.ok) throw new Error('houses fetch failed')
      return res.json()
    },
  })

  // Index houses by id once loaded, for the news ticker's fly-to.
  useEffect(() => {
    const m = new Map<number, House>()
    for (const h of housesData?.houses ?? []) m.set(h.id, h)
    houseByIdRef.current = m
  }, [housesData])

  // Live world-events feed (house status changes on the selected world) that
  // powers the top news ticker. Short staleTime + a 5-min poll + refetch-on-focus
  // so an open tab picks up the ETL's twice-daily refresh without a reload.
  const { data: worldEventsData } = useQuery<{ world: string; events: WorldEvent[] }>({
    queryKey: ['world-events', world],
    queryFn: async () => {
      const { data } = await api.get<{ world: string; events: WorldEvent[] }>('/events', {
        params: { world },
      })
      return data
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  })
  const worldEvents = worldEventsData?.events ?? []
  // The news rail shows the server's world events PLUS the local bid alerts on
  // belled auctions, newest first (LocalBidEvent mirrors the WorldEvent shape).
  const newsEvents = useMemo<WorldEvent[]>(() => {
    if (!bidEvents.length) return worldEvents
    return [...(bidEvents as WorldEvent[]), ...worldEvents].sort(
      (a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldEventsData, bidEvents])

  // Unseen PERSONAL news since the rail was last opened: any local bid alert
  // (new bid / outbid), or a server house event saying a house covered by one
  // of the user's watches was released (freed or thrown on auction by its
  // owner). Drives the red "!" on the collapsed news button.
  const hasNewsAlert = useMemo(() => {
    const isNew = (iso: string) => new Date(iso).getTime() > newsSeenAt
    if (bidEvents.some((e) => isNew(e.occurred_at))) return true
    return worldEvents.some(
      (e) =>
        (e.type === 'house_freed' || e.type === 'house_auctioned') &&
        e.ref_id != null &&
        isNew(e.occurred_at) &&
        houseCovered(watches, world, e.ref_id, e.town),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidEvents, worldEventsData, watches, world, newsSeenAt])

  // Load the houses into the ref and (re)draw when toggled, floor changes, or the
  // map remounts.
  useEffect(() => {
    showHousesRef.current = showHouses
    if (housesData?.houses && housesRef.current.length === 0) {
      housesRef.current = housesData.houses
    }
    renderHousesRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHouses, housesData, floor, mapReady])

  // Full world roster for the global world picker (most-populated first).
  const { data: killWorlds } = useKillWorlds()
  const worldNames = useMemo(() => {
    const names = (killWorlds ?? []).map((w) => w.name)
    // Keep the current selection selectable even before the roster loads.
    const all = names.includes(world) ? names : [world, ...names]
    // Alphabetical so a world is easy to find in the list.
    return all.sort((a, b) => a.localeCompare(b))
  }, [killWorlds, world])

  // Live rent status for the chosen world. Fetched while the layer is on OR the
  // user has any alerts (so re-opening the site catches what freed up while
  // away). Refetches on focus + every 10 min so an open tab picks up the ETL's
  // twice-daily refresh.
  const { data: houseStatus } = useQuery<{
    world: string
    synced_at: string | null
    houses: Record<number, { status: 'rented' | 'auctioned' | 'free'; bid?: number }>
  }>({
    queryKey: ['house-status', world],
    staleTime: 300_000,
    enabled: (showHouses || watches.length > 0) && !!world,
    refetchOnWindowFocus: true,
    refetchInterval: 600_000,
    queryFn: async () => {
      const res = await fetch(`/api/houses?world=${encodeURIComponent(world)}`)
      if (!res.ok) throw new Error('house status fetch failed')
      return res.json()
    },
  })

  // Merge the live status onto the pins (by id) and repaint. Bump the version so
  // the marker diff rebuilds the pins with their new status colour.
  useEffect(() => {
    houseLiveRef.current = houseStatus?.houses ?? null
    houseLiveVerRef.current++
    renderHousesRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseStatus])

  // Keep the availability- and guildhall-filter refs in sync and repaint.
  useEffect(() => {
    houseStatusFilterRef.current = houseStatusFilter
    houseKindRef.current = houseKind
    renderHousesRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseStatusFilter, houseKind])

  // Keep the watches ref in sync and repaint so pin rings reflect the alert list.
  useEffect(() => {
    watchesRef.current = watches
    renderHousesRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watches])

  // "Just freed" detection — the only notification path, fully client-side. On
  // each status snapshot, diff against the last one stored for this world; any
  // watched house that went rented → available raises an in-app toast and (if the
  // user granted permission) a browser notification. First snapshot per world is
  // silent (no prior baseline to diff).
  useEffect(() => {
    if (!houseStatus?.houses) return
    const curr = toStatusMap(houseStatus.houses)
    const prev = loadSeen(world)
    const townOf = (id: number) => housesRef.current.find((h) => h.id === id)?.town ?? null
    const freed = diffFreed(prev, curr, watchesRef.current, world, townOf)
    saveSeen(world, curr)
    if (!freed.length) return
    setFreedIds((s) => new Set([...s, ...freed]))
    const firstName = housesRef.current.find((h) => h.id === freed[0])?.name ?? ''
    const msg =
      freed.length === 1
        ? t('map.houseFreedOne', { name: firstName, world })
        : t('map.houseFreedMany', { n: freed.length, world })
    setFreedToast(msg)
    osNotify(t('map.houseFreedTitle'), msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseStatus, world])

  // Auction outbid watch — fully client-side, and deliberately NOT gated on the
  // bulk /api/houses snapshot: the belled houses come from localStorage, so the
  // check can run the INSTANT the page opens instead of a round-trip later
  // (being outbid is the alert users want immediately). `bidSeenRef` holds the
  // baseline in memory so the on-load run and the periodic one can never
  // clobber each other's writes to localStorage.
  const bidSeenRef = useRef<{ world: string; map: BidSeen } | null>(null)
  function bidSeenFor(w: string): BidSeen {
    if (!bidSeenRef.current || bidSeenRef.current.world !== w) {
      bidSeenRef.current = { world: w, map: loadBidSeen(w) }
    }
    return bidSeenRef.current.map
  }
  // Last probe per `world:id`. The on-load run and the snapshot run fire within
  // milliseconds of each other on every page load (and React's dev double-mount
  // doubles that again), so without this one house costs 3-4 upstream calls per
  // visit. Far below the 10-min refresh interval, so it never blocks a real one.
  const bidProbeRef = useRef<Map<string, number>>(new Map())
  const PROBE_TTL = 15_000

  // Ask the per-house proxy who holds the top bid on each belled house (the
  // bulk feed has no bidder names; a handful of watches keeps this cheap). A
  // raised bid becomes a local news entry; when the PREVIOUS top bidder was the
  // user's configured character it upgrades to an "outbid" alert — red toast +
  // OS notification. A first sighting is stored silently (no phantom alerts on
  // a cold baseline), same rule as the freed diff above.
  async function checkOutbids(belled: Extract<Watch, { kind: 'house' }>[]): Promise<void> {
    const w = world
    const now = Date.now()
    const due = belled.filter((bw) => {
      const key = `${w}:${bw.id}`
      if (now - (bidProbeRef.current.get(key) ?? 0) < PROBE_TTL) return false
      bidProbeRef.current.set(key, now)
      return true
    })
    if (!due.length) return
    const seen = bidSeenFor(w)
    const my = charProfile?.name.trim().toLowerCase() ?? ''
    const rows = await Promise.all(
      due.map(async (bw) => {
        try {
          const res = await fetch(`/api/houses/${encodeURIComponent(w)}/${bw.id}`)
          if (!res.ok) return null
          const d = await res.json()
          if (!d?.house?.auctioned) {
            // Auction over — its baseline can't be compared against any more.
            delete seen[bw.id]
            return null
          }
          return {
            watch: bw,
            bid: Number(d.house.bid) || 0,
            bidder: (d.house.bidder as string | null) ?? null,
          }
        } catch {
          return null
        }
      }),
    )
    // The user switched worlds mid-flight — these answers are for the old one.
    if (worldRef.current !== w) return

    const fresh: LocalBidEvent[] = []
    let beaten: { id: number; name: string; bid: number; bidder: string | null } | null = null
    const stamp = new Date().toISOString()
    for (const row of rows) {
      if (!row) continue
      const { watch: bw, bid, bidder } = row
      const prev = seen[bw.id]
      seen[bw.id] = { bid, bidder }
      // Cold start or nothing moved → just (re)store the baseline.
      if (!prev || (prev.bid === bid && prev.bidder === bidder)) continue
      const bidderLc = bidder?.toLowerCase() ?? ''
      // The user's own (re)bid — nothing worth announcing to themselves.
      if (my && bidderLc === my) continue
      const outbid = my !== '' && prev.bidder?.toLowerCase() === my && bidderLc !== my
      fresh.push({
        // Negative + house-id salt: unique locally, never collides with the
        // server feed's positive ids in the rail's key prop.
        id: -(Date.now() + bw.id),
        type: outbid ? 'house_outbid' : 'house_bid',
        ref_id: bw.id,
        title: bw.name,
        town: bw.town,
        meta: { bid: bid || undefined, bidder },
        occurred_at: stamp,
      })
      // Only the newest one gets the toast; the rest are in the news rail.
      if (outbid) beaten = { id: bw.id, name: bw.name, bid, bidder }
    }
    saveBidSeen(w, seen)
    if (fresh.length) {
      setBidEvents((cur) => {
        const next = [...fresh, ...cur].slice(0, 20)
        saveBidEvents(w, next)
        return next
      })
    }
    if (beaten) {
      setOutbidToast(beaten)
      osNotify(
        t('map.houseOutbidTitle'),
        t('map.houseOutbidBody', {
          name: beaten.name,
          bid: fmtGold(beaten.bid),
          bidder: beaten.bidder ?? '?',
        }),
      )
    }
  }

  // ON LOAD (and on world / character change): probe every belled house that
  // already has a stored baseline — those are exactly the ones where movement
  // is meaningful, and they're known from localStorage without any prior fetch,
  // so an outbid that happened while away shows within one request of opening
  // the page.
  useEffect(() => {
    const seen = bidSeenFor(world)
    void checkOutbids(
      watchesRef.current.filter(
        (w): w is Extract<Watch, { kind: 'house' }> =>
          w.kind === 'house' && w.world === world && seen[w.id] !== undefined,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, charProfile?.name])

  // Ongoing: every status snapshot (10-min interval / tab focus) re-checks the
  // belled houses the bulk feed says are on auction. This is also what SEEDS a
  // baseline for an auction we've never probed, which is what lets the on-load
  // run above catch it next time.
  useEffect(() => {
    if (!houseStatus?.houses) return
    void checkOutbids(
      watchesRef.current.filter(
        (w): w is Extract<Watch, { kind: 'house' }> =>
          w.kind === 'house' && w.world === world && houseStatus.houses[w.id]?.status === 'auctioned',
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseStatus, world, charProfile?.name])

  // Houses for the panel list — respecting BOTH the guildhall (kind) and
  // rent-status filters — sorted by town then rent. Empty until the static pins
  // and the live status have loaded.
  const panelHouses = useMemo(() => {
    const live = houseStatus?.houses
    const all = housesData?.houses
    type Row = { h: House; status: 'auctioned' | 'free' | 'rented'; bid?: number }
    if (!live || !all) return [] as Row[]
    const q = houseSearch.trim().toLowerCase()
    const out: Row[] = []
    for (const h of all) {
      if (houseKind === 'guild' && !h.guild) continue
      if (houseKind === 'house' && h.guild) continue
      const s = live[h.id]?.status
      if (!s) continue
      if (houseStatusFilter === 'available' && !(s === 'free' || s === 'auctioned')) continue
      if (houseStatusFilter === 'rented' && s !== 'rented') continue
      if (houseTownFilter && (h.town ?? '') !== houseTownFilter) continue
      if (q && !h.name.toLowerCase().includes(q) && !(h.town ?? '').toLowerCase().includes(q)) continue
      out.push({ h, status: s, bid: live[h.id]?.bid })
    }
    out.sort((a, b) => (a.h.town ?? '').localeCompare(b.h.town ?? '') || a.h.rent - b.h.rent)
    return out
  }, [houseStatus, housesData, houseKind, houseStatusFilter, houseSearch, houseTownFilter])

  // Count of currently-available houses (kind-filtered) — drives the green badge
  // on the panel toggle, independent of the status filter.
  const availableCount = useMemo(() => {
    const live = houseStatus?.houses
    const all = housesData?.houses
    if (!live || !all) return 0
    let n = 0
    for (const h of all) {
      if (houseKind === 'guild' && !h.guild) continue
      if (houseKind === 'house' && h.guild) continue
      const s = live[h.id]?.status
      if (s === 'free' || s === 'auctioned') n++
    }
    return n
  }, [houseStatus, housesData, houseKind])

  // Per-status counts (kind-filtered) for the status-filter segmented control —
  // lets each button show how many houses it would surface at a glance.
  const statusCounts = useMemo(() => {
    const live = houseStatus?.houses
    const all = housesData?.houses
    if (!live || !all) return { all: 0, available: 0, rented: 0 }
    let total = 0
    let available = 0
    let rented = 0
    for (const h of all) {
      if (houseKind === 'guild' && !h.guild) continue
      if (houseKind === 'house' && h.guild) continue
      const s = live[h.id]?.status
      if (!s) continue
      total++
      if (s === 'free' || s === 'auctioned') available++
      else if (s === 'rented') rented++
    }
    return { all: total, available, rented }
  }, [houseStatus, housesData, houseKind])

  // Per-kind counts (status-filtered) for the house-vs-guildhall segmented
  // control — mirrors statusCounts so each button shows its live tally.
  const kindCounts = useMemo(() => {
    const live = houseStatus?.houses
    const all = housesData?.houses
    if (!all) return { all: 0, house: 0, guild: 0 }
    let total = 0
    let house = 0
    let guild = 0
    for (const h of all) {
      const s = live?.[h.id]?.status
      if (houseStatusFilter === 'available' && !(s === 'free' || s === 'auctioned')) continue
      if (houseStatusFilter === 'rented' && s !== 'rented') continue
      total++
      if (h.guild) guild++
      else house++
    }
    return { all: total, house, guild }
  }, [houseStatus, housesData, houseStatusFilter])

  // Total monthly rent (gold) paid across every currently-rented house on this
  // world — the "how much gold does this server pay for housing" figure. Only
  // rented houses count (free/auctioned pay nothing); respects the kind filter.
  const worldRentTotal = useMemo(() => {
    const live = houseStatus?.houses
    const all = housesData?.houses
    if (!live || !all) return { gold: 0, count: 0 }
    let gold = 0
    let count = 0
    for (const h of all) {
      if (houseKind === 'guild' && !h.guild) continue
      if (houseKind === 'house' && h.guild) continue
      if (live[h.id]?.status === 'rented') {
        gold += h.rent
        count++
      }
    }
    return { gold, count }
  }, [houseStatus, housesData, houseKind])

  // Distinct towns that have houses, for the "watch a whole town" picker.
  const houseTowns = useMemo(() => {
    const s = new Set<string>()
    for (const h of housesData?.houses ?? []) if (h.town) s.add(h.town)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [housesData])

  // The chosen world's watched-specific houses, for the "my alerts" list.
  const watchedHouses = useMemo(
    () =>
      watches.filter(
        (w): w is Extract<Watch, { kind: 'house' }> => w.kind === 'house' && w.world === world,
      ),
    [watches, world],
  )
  // Active alerts for this world (watched houses + whole-town/world watches) —
  // shown as a badge on the collapsed "my alerts" submenu.
  const watchCount =
    watchedHouses.length +
    watches.filter((w) => (w.kind === 'town' || w.kind === 'world') && w.world === world).length

  // Auto-dismiss the "a house opened up" toast after a while.
  useEffect(() => {
    if (!freedToast) return
    const id = setTimeout(() => setFreedToast(null), 14_000)
    return () => clearTimeout(id)
  }, [freedToast])

  useEffect(() => {
    showAllRef.current = showAll
    if (!showAll || !allSpawns) {
      allPointsRef.current = {
        points: [],
        names: [],
        images: [],
        slugs: [],
        bosses: [],
        scores: [],
        lootValues: [],
      }
    } else {
      // Only keep spawns within the available tile region; the rest (other
      // continents) would just litter the empty background.
      const pts = allSpawns.points.filter(([x, y]) => inTileBounds(x, y))
      // Score each creature by its loot gold — the wealth a hunt actually yields
      // (loot items + coins per kill; experience is deliberately left out). The
      // score is an absolute rank against every regular creature we have (see
      // profitScore), so a dragon reads the same poor colour on every floor and a
      // boss's million-gp table can't distort the scale — it just clamps to blue.
      const cs = allSpawns.creatures
      const scores = cs.map((c) => profitScore(c.loot_value ?? 0))
      allPointsRef.current = {
        points: pts,
        names: cs.map((c) => c.name),
        images: cs.map((c) => c.image),
        slugs: cs.map((c) => c.slug),
        bosses: cs.map((c) => c.boss),
        scores,
        lootValues: cs.map((c) => c.loot_value ?? 0),
      }
    }
    rebuildOverlayRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSpawns, showAll, floor, mapReady])

  // Re-apply the bosses-only narrowing and fit the map to the matches so the
  // results are actually in view (they're often far from where the user is
  // currently looking).
  useEffect(() => {
    bossOnlyRef.current = bossOnly
    rebuildOverlayRef.current()

    const map = mapRef.current
    const f = filteredRef.current
    if (map && bossOnly && f.length) {
      let minLat = Infinity
      let maxLat = -Infinity
      let minLng = Infinity
      let maxLng = -Infinity
      for (const p of f) {
        const lat = -p[1]
        const lng = p[0]
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
      }
      map.fitBounds(
        L.latLngBounds([minLat, minLng], [maxLat, maxLng]),
        { padding: [40, 40], maxZoom: 4, animate: false },
      )
    }
  }, [bossOnly])

  // --- creature search (by name, via the published-names glossary) ---
  const debouncedQuery = useDebouncedValue(query, 250)
  const { data: glossary } = useGlossary()
  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (q.length < 2 || !glossary) return []
    return glossary
      .filter((g) => g.type === 'creature' && g.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (n: string) => (n.toLowerCase().startsWith(q) ? 0 : 1)
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
      })
      .slice(0, 8)
  }, [debouncedQuery, glossary])

  // --- item search (via the catalogue; items include drafts, so it hits the API
  // rather than the published-only glossary) ---
  const { data: itemResults } = useQuery({
    queryKey: ['map-item-search', debouncedQuery.trim().toLowerCase()],
    enabled: searchKind === 'item' && debouncedQuery.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: EntryListItem[] }>('/items', {
        params: { q: debouncedQuery.trim(), per_page: 8 },
      })
      return data.data
    },
  })

  // --- merchant NPC search (server-side, over the trade directory) ---
  const { data: npcResults } = useQuery({
    queryKey: ['map-npc-search', debouncedQuery.trim().toLowerCase()],
    enabled: searchKind === 'npc' && debouncedQuery.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: MapNpc[] }>('/npcs', {
        params: { q: debouncedQuery.trim() },
      })
      return data.data
    },
  })

  /**
   * A result picked from the map's search box. The map is the most-used search
   * on the site, so it feeds the same "most searched" log as the header box
   * (killstats). Logged HERE and not inside addCreature/addItem/goToNpc: those
   * also run for shared links, raid rosters, item droppers and house events —
   * none of which are searches. A merchant NPC with no lore page has no slug,
   * so it logs by name instead (the server resolves it against the directory).
   */
  function pickFromSearch(slug: string | null, plot: () => void, npc?: string) {
    if (slug) logSearchClick(slug)
    else if (npc) logNpcSearchClick(npc)
    plot()
  }

  // Restore creatures + a shared route from the link (once, StrictMode-safe).
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    initial.creatures.forEach((slug, i) => void addCreature(slug, i === 0))
    // Recompute the plan for a shared route once both endpoints are present.
    if (initial.routeStart && initial.routeEnd)
      computeRouteRef.current(initial.routeStart, initial.routeEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addCreature(slug: string, jump = true) {
    if (pendingRef.current.has(slug) || creaturesRef.current.some((c) => c.slug === slug)) {
      setQuery('')
      setSearchOpen(false)
      return
    }
    pendingRef.current.add(slug)
    try {
      const { data } = await api.get<{ data: Entry }>(`/entries/${slug}`)
      const e = data.data
      const color = PALETTE[colorIdx.current++ % PALETTE.length]
      const spawns = e.spawns ?? []
      // Cluster the in-bounds spawns (fall back to all) into hunting areas,
      // sorted by density — clusters[0] is the densest spot.
      const onMap = spawns.filter((s) => inTileBounds(s.x, s.y))
      const clusters = clusterSpawns(onMap.length ? onMap : spawns)
      const cr: ActiveCreature = {
        slug: e.slug,
        name: e.name ?? slug,
        image: e.primary_image,
        color,
        spawns,
        clusters,
        jumpIdx: 0,
      }
      setCreatures((prev) => [...prev, cr])
      setQuery('')
      setSearchOpen(false)

      // Jump to the densest cluster (within the available tile region).
      if (jump && clusters.length) {
        const c = clusters[0]
        floorRef.current = c.z
        setFloor(c.z)
        const map = mapRef.current
        if (map) map.setView(toLatLng(c.x, c.y), Math.max(map.getZoom(), 2))
      }
    } catch {
      // allow a retry if the fetch failed
      pendingRef.current.delete(slug)
    }
  }

  // Raid rosters carry creature NAMES (the OT never stores our slugs), so a click
  // on one resolves it through the normal search and plots it like any other
  // creature — giving the raid roster the full toolkit (best spawn, route to it).
  // An exact name match wins; otherwise the top creature hit is close enough.
  async function plotCreatureByName(name: string) {
    try {
      const { data } = await api.get<{ data: SearchResult[] }>('/search', { params: { q: name } })
      const hits = data.data.filter((r) => r.type === 'creature')
      const hit = hits.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? hits[0]
      if (hit) await addCreature(hit.slug)
    } catch {
      // A missing creature is not worth interrupting the map for.
    }
  }

  function removeCreature(slug: string) {
    pendingRef.current.delete(slug)
    setCreatures((prev) => prev.filter((c) => c.slug !== slug))
    setKillsSlug((s) => (s === slug ? null : s))
  }

  // "¿Dónde farmeo este objeto?" — plot every creature that drops the item.
  // Its droppers come pre-resolved to slug/name/image; each is plotted through
  // addCreature so it gets the full toolkit (best-spawn jump, respawn switcher,
  // "how to get there"). Capped at PALETTE.length so the map doesn't flood.
  async function addItem(slug: string) {
    setQuery('')
    setSearchOpen(false)
    setItemBusy(true)
    try {
      // Trade offers ride along with the detail: the same search also answers
      // "¿dónde lo compro/vendo?" with merchant pins. Non-fatal if it fails.
      const [{ data }, tradeRes] = await Promise.all([
        api.get<{ data: ItemDetail }>(`/items/${slug}`),
        api.get<{ data: ItemTrade }>(`/items/${slug}/trade`).catch(() => null),
      ])
      const it = data.data
      const droppers = it.dropped_by.filter((d): d is Dropper & { slug: string } => !!d.slug)
      const plotted = droppers.slice(0, PALETTE.length)
      tradeNavRef.current = null
      setTradeNav(null)
      setActiveItem({
        slug: it.slug,
        name: it.name ?? slug,
        image: it.image,
        plotted: plotted.map((d) => d.slug),
        total: droppers.length,
        trade: tradeRes?.data.data ?? null,
      })
      // Jump to the first dropper's densest spawn, then plot the rest quietly.
      if (plotted.length) {
        await addCreature(plotted[0].slug, true)
        await Promise.all(plotted.slice(1).map((d) => addCreature(d.slug, false)))
      }
    } catch {
      // leave the map as-is on failure
    } finally {
      setItemBusy(false)
    }
  }

  // Drop the item context and remove the creatures it plotted.
  function clearItem() {
    if (activeItem) for (const s of activeItem.plotted) removeCreature(s)
    setActiveItem(null)
    tradeNavRef.current = null
    setTradeNav(null)
  }

  // Fly to the next/previous spawn cluster of a creature, switching floor.
  function cycleSpawn(slug: string, dir: 1 | -1) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    if (!cr || cr.clusters.length === 0) return
    const next = (cr.jumpIdx + dir + cr.clusters.length) % cr.clusters.length
    setCreatures((prev) => prev.map((c) => (c.slug === slug ? { ...c, jumpIdx: next } : c)))
    const cl = cr.clusters[next]
    floorRef.current = cl.z
    setFloor(cl.z)
    const map = mapRef.current
    if (map) map.setView(toLatLng(cl.x, cl.y), Math.max(map.getZoom(), 3))
  }

  // Fly straight to the recommended best spawn for a task/bounty: the densest,
  // most compact cluster (clusters[0], since they are sorted by score).
  function jumpToBest(slug: string) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    if (!cr || cr.clusters.length === 0) return
    setCreatures((prev) => prev.map((c) => (c.slug === slug ? { ...c, jumpIdx: 0 } : c)))
    const cl = cr.clusters[0]
    floorRef.current = cl.z
    setFloor(cl.z)
    const map = mapRef.current
    if (map) map.setView(toLatLng(cl.x, cl.y), Math.max(map.getZoom(), 3))
  }

  // A plotted creature's active spawn cluster as a route endpoint (its current
  // respawn if cycled, else the recommended best one).
  function routeEndForCreature(cr: ActiveCreature): RoutePoint | null {
    if (cr.clusters.length === 0) return null
    const cl = cr.clusters[cr.jumpIdx] ?? cr.clusters[0]
    return { x: cl.x, y: cl.y, floor: cl.z, label: cr.name }
  }

  // Set the route destination, compute the route if an origin is already
  // picked, and fly the map to it.
  function applyRouteEnd(pt: RoutePoint) {
    setRouteEnd(pt)
    setRoutePlan(null)
    setRouteMsg(null)
    const s = routeStartRef.current
    if (s) computeRouteRef.current(s, pt)
    floorRef.current = pt.floor
    setFloor(pt.floor)
    const map = mapRef.current
    if (map) map.setView(toLatLng(pt.x, pt.y), Math.max(map.getZoom(), 3))
  }

  // Default the route origin to the nearest city when none is picked yet, so
  // the route computes immediately instead of waiting for the player to choose
  // a starting city. Nearest is by horizontal distance — cities are surface
  // entry points, so floor is irrelevant for the pick.
  function ensureRouteStartNear(pt: RoutePoint) {
    if (routeStartRef.current) return
    const near = LANDMARKS.reduce<Landmark | null>((best, l) => {
      const d = (l.x - pt.x) ** 2 + (l.y - pt.y) ** 2
      return !best || d < (best.x - pt.x) ** 2 + (best.y - pt.y) ** 2 ? l : best
    }, null)
    if (near) {
      const start: RoutePoint = { x: near.x, y: near.y, floor: near.floor, label: near.name }
      routeStartRef.current = start
      setRouteStart(start)
    }
  }

  // "Cómo llegar" from a plotted creature's active spawn cluster.
  function routeToSpawn(slug: string) {
    const cr = creaturesRef.current.find((c) => c.slug === slug)
    const pt = cr && routeEndForCreature(cr)
    if (!pt) return
    setMapMode('route')
    ensureRouteStartNear(pt)
    applyRouteEnd(pt)
  }

  // NPC picked in the search box: fly to the merchant and trace the walking
  // route straight to them (origin defaults to the nearest city).
  function goToNpc(n: MapNpc) {
    setQuery('')
    setSearchOpen(false)
    const c = n.coords[0]
    if (!c) return
    routeToTradeNpc(n.city ? `${n.npc} · ${n.city}` : n.npc, c)
  }

  // "Cómo llegar" to a merchant pin from the item trade layer.
  function routeToTradeNpc(name: string, c: [number, number, number]) {
    const pt: RoutePoint = { x: c[0], y: c[1], floor: c[2], label: name }
    setMapMode('route')
    ensureRouteStartNear(pt)
    applyRouteEnd(pt)
  }

  // Rashid card / pin: open his panel, fly to today's spot and trace the walking
  // route to him from the nearest city (his own, in practice — he always stands
  // inside one). Re-picking forces a fresh origin so the route is always "from
  // the nearest city" even if an older route origin is still set.
  function goToRashid(refresh = false) {
    const pt: RoutePoint = {
      x: rashidStop.x,
      y: rashidStop.y,
      floor: rashidStop.z,
      label: `Rashid · ${rashidStop.city}`,
    }
    openPanel('rashid')
    setMapMode('route')
    if (refresh) {
      routeStartRef.current = null
      setRouteStart(null)
    }
    ensureRouteStartNear(pt)
    applyRouteEnd(pt)
  }

  // Yasir: no schedule to trust, so the rail button only opens the panel with
  // his three candidate docks; picking one (there or on the map) flies and
  // routes to it from the nearest city, like Rashid.
  function openYasir() {
    openPanel('yasir')
  }

  // "Cómo llegar" to one candidate spot of a mini world change. Origin is reset
  // first so it is always "from the nearest city" to THAT spot — the ten fury
  // gates sit in ten different cities, and an origin left over from the previous
  // one would trace a cross-continent walk. Only surface spots get this: what
  // lies behind the portal (Fury Hell, Feroxa's arena) has no walking route,
  // reaching it means stepping through the change itself.
  function routeToWorldChangeSpot(c: WorldChange, s: WcSpot) {
    const pt: RoutePoint = {
      x: s.x,
      y: s.y,
      floor: s.z,
      label: `${t(`map.wcName.${c.id}`)} · ${s.label}`,
    }
    setMapMode('route')
    routeStartRef.current = null
    setRouteStart(null)
    ensureRouteStartNear(pt)
    applyRouteEnd(pt)
  }

  function goToYasirDock(dock: YasirDock) {
    const pt: RoutePoint = { x: dock.x, y: dock.y, floor: dock.z, label: `Yasir · ${dock.city}` }
    openYasir()
    setMapMode('route')
    routeStartRef.current = null
    setRouteStart(null)
    ensureRouteStartNear(pt)
    applyRouteEnd(pt)
  }

  // The merchants of one side of the board we can actually walk to: the API
  // lists arrive best-price-first, and merchants without map coords (scripted
  // spawns outside the mapped region) can't be routed to, so they drop out.
  function routableOffers(side: 'buy' | 'sell'): ItemTrade['buy'] {
    const list = side === 'buy' ? activeItem?.trade?.buy : activeItem?.trade?.sell
    return (list ?? []).filter((o) => o.coords && o.coords.length > 0)
  }

  // Banner chips: fly-and-route to the n-th merchant of one side of the board,
  // best price first. Going shopping means the dropper overlays are noise now,
  // so they get cleared — the trade pins and the route are what's left on
  // screen. The banner then shows a pager to walk the rest of the list.
  function routeToOffer(side: 'buy' | 'sell', i: number) {
    const offers = routableOffers(side)
    if (offers.length === 0) return
    const idx = (i + offers.length) % offers.length
    const o = offers[idx]
    const item = activeItem
    if (item && item.plotted.length) {
      for (const s of item.plotted) removeCreature(s)
      setActiveItem({ ...item, plotted: [] })
    }
    tradeNavRef.current = { side, i: idx }
    setTradeNav({ side, i: idx })
    routeToTradeNpc(o.npc, o.coords![0])
  }

  // ◀ / ▶ on the merchant pager, wrapping around both ends.
  function cycleOffer(dir: 1 | -1) {
    const cur = tradeNavRef.current
    if (cur) routeToOffer(cur.side, cur.i + dir)
  }

  function goTo(l: Landmark) {
    floorRef.current = l.floor
    setFloor(l.floor)
    const map = mapRef.current
    if (map) map.setView(toLatLng(l.x, l.y), Math.max(map.getZoom(), 3))
  }

  async function share() {
    writeHash()
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt(t('map.copyManual'), window.location.href)
    }
  }

  const spawnsOnFloor = (cr: ActiveCreature) => cr.spawns.filter((s) => s.z === floor).length

  // The layer trees (markers, houses) sprout up out of the hotbar into the band
  // straight above it, and they're absolutely positioned — nothing in the bar's
  // flow knows they're there. The legend line rides above the bar, so it has to
  // leave that band clear itself or it lands on top of the trees and eats their
  // clicks. Height of the tallest open tree, in rem so it tracks the slots when
  // the root font-size scales: N slots (h-11) + the gaps between them (gap-1.5),
  // plus a little air. The tree's own stem (mb-2) is paid for by the bar's gap-2.
  const treeSlots = Math.max(
    showPoi ? 1 + (markers.length > 0 ? 1 : 0) : 0,
    showHouses ? 2 : 0,
  )
  const treeClearance = treeSlots
    ? `calc(${treeSlots} * 2.75rem + ${treeSlots - 1} * 0.375rem + 0.25rem)`
    : undefined

  const activeSlugs = useMemo(() => new Set(creatures.map((c) => c.slug)), [creatures])

  // "Boss Watch": the raid/world bosses ranked by spawn heat (likelihood of
  // being up right now / about to spawn). Powers both the ☠-mode strip and the
  // always-on right-edge boss rail, so it's fetched on every map view.
  // Plottable bosses (slug + sprite) sorted hottest first.
  // type='world' — the roster whose heat reading actually means something. NOT
  // 'raid': that bucket caps at 60 worlds, which excluded 228 of the 401 tracked
  // bosses (Midnight Panther, Gaz'haragoth…) and left them reading "sin datos de
  // spawn recientes" forever. NOT 'all' either: unfiltered, the rail fills with
  // lever and quest bosses that are permanently available on a per-PLAYER
  // cooldown, where "probablemente viva" is meaningless. See WorldBossRule.
  // Full roster, not a top-N cut — the rail still displays pins + hottest 16.
  const { data: bossWatch, isLoading: bossLoading } = useBosses('world', 600, true, world)
  const bosses = useMemo(
    () =>
      (bossWatch ?? [])
        // Skip bosses we've never recorded a kill for in the tracking window: with
        // no "last seen" anchor their heat is a fabricated 100% ("probably up"),
        // which is misleading — hide them until we actually have data.
        .filter(
          (b): b is BossRow & { slug: string; image: string } =>
            !!b.slug && !!b.image && b.week_killed > 0,
        )
        // heat null = world-scoped with no kill recorded there — sink those below
        // any real reading so the rail leads with bosses we can actually call.
        .sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1) || b.due - a.due),
    [bossWatch],
  )
  // Rail row shape — heat-tracked bosses carry a heat/worlds read; bosses pulled
  // from the glossary (rare ones with no kill-stats) carry heat = null. spawn_type
  // (from the glossary) drives the category tabs.
  // heatGlobal = the cross-world reading, used when the selected world has no
  // recorded kill to anchor a per-world estimate (Orshabaal & co. have never been
  // killed on Antica in our window). Shown as a cross-world read, not as if it
  // were a reading for this world. null only for glossary-only bosses.
  type RailBoss = { race: string; slug: string; image: string | null; heat: number | null; heatGlobal: number | null; worlds: string[]; spawn_type: string[] | null }
  // slug → spawntypes, so the heat-tracked list (which the kill-stats API doesn't
  // tag) can be classified for the tabs by borrowing the glossary's spawn_type.
  const spawnTypeBySlug = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const g of glossary ?? []) if (g.boss && g.spawn_type?.length) m.set(g.slug, g.spawn_type)
    return m
  }, [glossary])
  // The whole boss roster (heat-tracked + glossary-only), each tagged with its
  // spawntype. The rail derives both the tab counts and the shown list from it.
  const allRailBosses = useMemo<RailBoss[]>(() => {
    const heatList: RailBoss[] = bosses.map((b) => ({
      race: b.race,
      slug: b.slug,
      image: b.image,
      heat: b.heat,
      heatGlobal: b.heat_global ?? null,
      worlds: b.worlds,
      spawn_type: spawnTypeBySlug.get(b.slug) ?? null,
    }))
    const heatSlugs = new Set(heatList.map((b) => b.slug))
    // Published bosses the heat roster doesn't cover (floor-independent) — e.g.
    // Morgaroth, absent from the latest kill_daily snapshot. `world_boss`, not
    // `boss`: without it this bucket would re-admit every lever and quest boss
    // the heat roster deliberately drops, and they'd sit in the rail reading
    // "sin datos de spawn recientes" — the exact bug the roster cut just fixed.
    const glossaryBosses: RailBoss[] = (glossary ?? [])
      .filter((g) => g.world_boss && g.type === 'creature' && !heatSlugs.has(g.slug))
      .map((g) => ({ race: g.name, slug: g.slug, image: g.image, heat: null, heatGlobal: null, worlds: [], spawn_type: g.spawn_type ?? null }))
    return [...heatList, ...glossaryBosses]
  }, [bosses, glossary, spawnTypeBySlug])
  // Count per tab, for the little badges. A boss counts toward every spawntype it
  // carries; 'all' = the whole roster.
  const bossTypeCounts = useMemo(() => {
    const c: Record<BossType, number> = { all: allRailBosses.length, Raid: 0, Unique: 0, Triggered: 0, Regular: 0, Event: 0, Unblockable: 0 }
    for (const b of allRailBosses) for (const st of b.spawn_type ?? []) if (st in c) c[st as BossType]++
    return c
  }, [allRailBosses])
  // Free-text filter + spawntype tab for the rail. 'all' with no query keeps the
  // classic "hottest 16" cut (plus pins); a specific tab shows that spawntype's
  // whole roster (hottest first, then A–Z), and a query searches within the tab.
  // The heat-tracked API list AND every published boss from the glossary are both
  // in scope, so rare bosses missing from kill-stats (e.g. Gaz'haragoth) stay
  // findable and followable. Pinned ("followed") bosses always float to the top
  // and skip the cap, so a watch never scrolls out of view.
  const shownBosses = useMemo<RailBoss[]>(() => {
    const q = bossQuery.trim().toLowerCase()
    const byHeatThenName = (a: RailBoss, b: RailBoss) =>
      (b.heat ?? -1) - (a.heat ?? -1) || a.race.localeCompare(b.race)
    const inTab = (b: RailBoss) => bossType === 'all' || (b.spawn_type?.includes(bossType) ?? false)
    const pool = allRailBosses.filter(inTab)
    const resolve = (slug: string): RailBoss | undefined => allRailBosses.find((b) => b.slug === slug)

    if (q) {
      // Search the name plus the worlds the row actually SHOWS — under a world
      // filter a cross-world row displays none, so matching its borrowed world
      // names would surface it for a world the rail isn't even looking at.
      const match = (b: RailBoss) =>
        b.race.toLowerCase().includes(q) ||
        (world === 'all' || b.heat !== null) && b.worlds.some((w) => w.toLowerCase().includes(q))
      const matched = pool.filter(match).sort(byHeatThenName)
      const pinned = matched.filter((b) => pinnedBosses.has(b.slug))
      const rest = matched.filter((b) => !pinnedBosses.has(b.slug))
      return [...pinned, ...rest]
    }

    // No query, 'all' tab: pins first (resolved from either source so a followed
    // rare boss stays visible), then the hottest 16 heat-tracked bosses.
    if (bossType === 'all') {
      const pinnedList = [...pinnedBosses].map(resolve).filter((b): b is RailBoss => !!b)
      const pinnedSlugs = new Set(pinnedList.map((b) => b.slug))
      const rest = allRailBosses.filter((b) => !pinnedSlugs.has(b.slug)).slice(0, 16)
      return [...pinnedList, ...rest]
    }

    // A specific spawntype tab: the WHOLE category (hottest first, then A–Z), so
    // browsing the tab surfaces every boss in it — no cap, the rail scrolls. A cap
    // here would hide alphabetically-late rare spawns like Midnight Panther, which
    // carry no heat and sort below the heated bosses.
    const sorted = [...pool].sort(byHeatThenName)
    const pinned = sorted.filter((b) => pinnedBosses.has(b.slug))
    const rest = sorted.filter((b) => !pinnedBosses.has(b.slug))
    return [...pinned, ...rest]
  }, [allRailBosses, bossQuery, bossType, pinnedBosses, world])

  // Published community routes, most popular first, one page at a time. Only
  // fetched once the gallery is opened; keepPreviousData keeps the current page
  // on screen (no flash to empty) while the next page loads.
  const { data: routesData, isLoading: routesLoading } = useQuery({
    queryKey: ['community-routes', routesPage, routesQueryDebounced],
    enabled: routesOpen,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get<Paginated<CommunityRoute>>('/routes', {
        params: { page: routesPage, q: routesQueryDebounced || undefined },
      })
      return data
    },
  })
  const communityRoutes = routesData?.data

  // A new search term resets to the first page (the old page number rarely exists
  // in the filtered result set).
  useEffect(() => {
    setRoutesPage(1)
  }, [routesQueryDebounced])

  // Load a community route onto the map: drop it into the builder (so it renders
  // with pins + legs and can be tweaked/re-published), fly to its start, and bump
  // its load counter (the popularity signal).
  function loadCommunityRoute(r: CommunityRoute) {
    openPanel(null) // the gallery card closes; the route lands in the builder
    setMapMode('build')
    setBuildName(r.name)
    setBuildConnect(r.connect)
    setBuildPoints(r.waypoints.map(([x, y, floor]) => ({ x, y, floor })))
    setPublishState('idle')
    const first = r.waypoints[0]
    if (first) {
      floorRef.current = first[2]
      setFloor(first[2])
      const map = mapRef.current
      if (map) map.setView(toLatLng(first[0], first[1]), Math.max(map.getZoom(), 3))
    }
    api.post(`/routes/${r.id}/view`).catch(() => {})
  }

  // Toggle a "like" on a community route. Optimistic: flip the local liked set and
  // adjust the cached count immediately, then POST like/unlike. On failure, roll
  // both back so the UI never drifts from the server.
  function toggleLike(r: CommunityRoute) {
    const liked = likedRoutes.has(r.id)
    const delta = liked ? -1 : 1
    // Optimistically update the liked set…
    setLikedRoutes((prev) => {
      const next = new Set(prev)
      if (liked) next.delete(r.id)
      else next.add(r.id)
      return next
    })
    // …and the count in the query cache (the current page's slice).
    const bump = (d: number) =>
      queryClient.setQueryData<Paginated<CommunityRoute>>(['community-routes', routesPage, routesQueryDebounced], (old) =>
        old
          ? {
              ...old,
              data: old.data.map((x) =>
                x.id === r.id ? { ...x, likes: Math.max(0, x.likes + d) } : x,
              ),
            }
          : old,
      )
    bump(delta)
    api.post(`/routes/${r.id}/${liked ? 'unlike' : 'like'}`).catch(() => {
      // Roll back on error.
      setLikedRoutes((prev) => {
        const next = new Set(prev)
        if (liked) next.add(r.id)
        else next.delete(r.id)
        return next
      })
      bump(-delta)
    })
  }

  return (
    <div ref={rootRef} className="fixed inset-x-0 bottom-0 top-[var(--header-h,57px)] z-20 overflow-hidden bg-[#336699]">
      <Seo title={t('map.title')} description={t('map.intro')} path="/map" />
      <h1 className="sr-only">{t('map.title')}</h1>

      {/* The atlas fills the entire immersive canvas; every control floats over it. */}
      <div className="absolute inset-0 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" style={{ background: '#336699' }} />
      </div>

      {/* Coordinate readout — bottom-left corner. */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded border border-line bg-bg/85 px-2 py-1 font-mono text-[11px] tabular-nums text-fg-dim backdrop-blur-md">
        {center.x}, {center.y}, z{floor}
      </div>

      {/* Quick-launch mini windows — shortcuts to the games + stats, tucked into
          the bottom-right corner (above the attribution line). */}
      <div className="pointer-events-auto absolute bottom-9 right-2 z-[1000] flex flex-col items-end gap-1.5">
        {QUICK_LINKS.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            title={t(q.kicker)}
            className="group flex items-center gap-2 rounded-lg border border-line-2 bg-bg-2/90 px-2.5 py-1.5 shadow-lg backdrop-blur-md transition hover:-translate-x-0.5 hover:border-accent"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent transition group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={q.icon} />
            </svg>
            <span className="text-xs font-bold leading-none text-fg">{t(q.title)}</span>
          </Link>
        ))}
        {/* Hunt profit calculator — sits right below "Stats". Opens the
            draggable card: paste the analyzer, subtract imbuement wear +
            silver-token recharges from the balance. */}
        <button
          onClick={() => togglePanel('profit', profitOpen)}
          title={t('map.hpHint')}
          aria-pressed={profitOpen}
          className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 shadow-lg backdrop-blur-md transition hover:-translate-x-0.5 hover:border-accent ${profitOpen ? 'border-accent bg-accent/15' : 'border-line-2 bg-bg-2/90'}`}
        >
          {/* two coins — "count the money" */}
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent transition group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
            <path d="M7 6h1v4" />
            <path d="m16.71 13.88.7.71-2.82 2.82" />
          </svg>
          <span className="text-xs font-bold leading-none text-fg">{t('map.hpTitle')}</span>
        </button>
        {/* Active world — drives the Boss Watch heat and the houses layer's
            live rent status. */}
        <WorldPicker worlds={worldNames} value={world} label={t('map.world')} onSelect={setWorld} />
      </div>

      {/* Floor selector — a compact stepper pinned to the right edge and
          vertically centred: the current floor with up/down arrows, and a tap on
          the number opens the full floor list to jump directly. Tiny footprint,
          so it clears the search bar above and the quick-links below. */}
      <div className="absolute right-2 top-1/2 z-[1100] -translate-y-1/2">
        <FloorStepper
          floor={floor}
          surface={SURFACE}
          floors={FLOORS}
          floorWord={t('map.floor')}
          onSelect={setFloor}
        />
      </div>

      {/* World-boss watch — a vertical list down the left edge (the normal-mob
          rail is gone). Each boss shows its spawn "time"/status (heat bucket:
          likely up / maybe / just killed, plus %) and the worlds it applies to.
          Hottest first; always shown (skeletons while loading). Tapping plots the
          boss's location on the map. */}
      {(bossLoading || bosses.length > 0) && (
        <aside
          className="scroll-atlas absolute bottom-10 left-2 z-[1000] flex w-[calc(100vw-1rem)] flex-col gap-0.5 overflow-y-auto overflow-x-hidden rounded-2xl border-2 border-line bg-bg-2/95 p-2 shadow-lg backdrop-blur-md transition-[max-width] duration-300 ease-in-out sm:left-3 sm:w-[calc(100vw-1.5rem)]"
          style={{ top: bossTop, maxWidth: bossRailOpen ? '28rem' : '5rem' }}
          aria-busy={bossLoading}
        >
          <div className={`flex items-center gap-1.5 px-1 pb-1 text-theory ${bossRailOpen ? '' : 'justify-center'}`}>
            {bossRailOpen && (
              <span className="flex min-w-0 items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
                </svg>
                <span className="truncate text-[10px] font-bold uppercase tracking-widest">{t('map.bossWatch')}</span>
              </span>
            )}
            <button
              onClick={() => setBossRailOpen((v) => !v)}
              title={bossRailOpen ? t('map.modeHide') : t('map.bossWatch')}
              aria-label={bossRailOpen ? t('map.modeHide') : t('map.bossWatch')}
              aria-expanded={bossRailOpen}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded text-fg-mute transition hover:bg-line/40 hover:text-fg ${bossRailOpen ? 'ml-auto' : ''}`}
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 transition-transform duration-300 ${bossRailOpen ? '' : 'rotate-180'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          </div>
          {/* Spawntype tabs — split the roster into Raid / Unique / Triggered / …
              Empty categories (before the spawntype backfill lands) are hidden. */}
          {bossRailOpen && (
            <div
              className="scroll-atlas mb-1 flex shrink-0 gap-1 overflow-x-auto pb-1"
              role="tablist"
              aria-label={t('map.bossTypeFilter')}
            >
              {BOSS_TYPES.map((bt) => {
                const active = bossType === bt
                const count = bossTypeCounts[bt]
                if (bt !== 'all' && count === 0 && !active) return null
                return (
                  <button
                    key={bt}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBossType(bt)}
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition ${
                      active ? 'border-theory bg-theory text-white' : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
                    }`}
                  >
                    {t(`map.bossType.${bt.toLowerCase()}`)}
                    {count > 0 && <span className="ml-1 font-normal opacity-70">{count}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {/* Boss filter — only when the rail is expanded (collapsed it's a 5rem strip) */}
          {bossRailOpen && (
            <div className="mb-1 flex items-center gap-1.5 rounded-lg border border-line bg-bg/50 px-2 focus-within:border-accent">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search"
                value={bossQuery}
                onChange={(e) => setBossQuery(e.target.value)}
                placeholder={t('map.bossSearch')}
                aria-label={t('map.bossSearch')}
                className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-fg outline-none placeholder:text-fg-mute"
              />
            </div>
          )}
          {bosses.length > 0
            ? shownBosses.length > 0
              ? shownBosses.map((b) => {
                // Per-world read when this world has a kill to anchor it; else the
                // cross-world one, flagged so the row never claims to know THIS
                // world. Only glossary-only bosses (no kill-stats at all) end up
                // with neither and render as a plain "follow/plot" row.
                const shownHeat = b.heat ?? b.heatGlobal
                const crossWorld = b.heat === null && b.heatGlobal !== null
                const hs = shownHeat !== null ? HEAT_STYLE[heatBucket(shownHeat)] : null
                const on = activeSlugs.has(b.slug)
                const pinned = pinnedBosses.has(b.slug)
                // Under a world filter the rail must never name OTHER worlds. An
                // anchored row already carries just the selected world; a
                // cross-world fallback row is labelled "todos los mundos", and
                // listing the worlds it borrowed the reading from is exactly the
                // leak — drop the chip there and let the label speak.
                const worldList = world === 'all' ? b.worlds : crossWorld ? [] : b.worlds
                const worlds = worldList.slice(0, 3).join(', ')
                const moreWorlds = worldList.length > 3 ? ` +${worldList.length - 3}` : ''
                return (
                  <div
                    key={b.slug}
                    className={`group flex w-full items-center gap-1 rounded-lg border px-1.5 py-1 transition ${
                      on ? 'border-accent bg-accent/10' : pinned ? 'border-gold/40 bg-gold/5' : 'border-transparent hover:border-line-2 hover:bg-bg-2/60'
                    } ${bossRailOpen ? '' : 'justify-center'}`}
                  >
                    <button
                      onClick={() =>
                        on
                          ? removeCreature(b.slug)
                          : // Plotting a boss the user FILTERED for is a search too
                            // (the rail is the other search box on the map). With no
                            // query typed it's just browsing the roster — don't log it.
                            bossQuery.trim().length >= 2
                            ? pickFromSearch(b.slug, () => addCreature(b.slug))
                            : addCreature(b.slug)
                      }
                      title={
                        hs
                          ? `${b.race} · ${t(hs.label)}${crossWorld ? ` (${t('map.bossCrossWorld')})` : ''}${worldList.length ? ` · ${worldList.join(', ')}` : ''}`
                          : `${b.race} · ${t('map.bossNoHeat')}`
                      }
                      className={`flex min-w-0 flex-1 items-center gap-2 text-left ${bossRailOpen ? '' : 'justify-center'}`}
                    >
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded bg-line/15">
                        <img
                          src={b.image ?? ''}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden'
                          }}
                          className="sprite h-9 w-9 object-contain transition group-hover:scale-110"
                        />
                        <span
                          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${
                            shownHeat === null ? 'bg-line-2' : shownHeat >= 66 ? 'bg-accent' : shownHeat >= 33 ? 'bg-gold' : 'bg-interp'
                          }`}
                        />
                      </span>
                      {bossRailOpen && (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-fg">{b.race}</span>
                          {hs ? (
                            <span className={`flex items-center gap-1 text-[15px] font-bold ${hs.cls}`}>
                              <span aria-hidden>{hs.glyph}</span>
                              <span className="truncate">{t(hs.label)}</span>
                              {crossWorld && (
                                <span className="shrink-0 text-[10px] font-normal uppercase tracking-wide text-fg-mute">
                                  {t('map.bossCrossWorld')}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="block truncate text-xs italic text-fg-mute">{t('map.bossNoHeat')}</span>
                          )}
                          {worldList.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-fg-mute">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                              </svg>
                              <span className="truncate">
                                {worlds}
                                {moreWorlds}
                              </span>
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    {bossRailOpen && (
                      <button
                        onClick={() => togglePin(b.slug)}
                        title={pinned ? t('map.bossUnpin') : t('map.bossPin')}
                        aria-label={pinned ? t('map.bossUnpin') : t('map.bossPin')}
                        aria-pressed={pinned}
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded transition hover:bg-line/40 ${
                          pinned ? 'text-gold' : 'text-fg-mute hover:text-fg'
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill={pinned ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 17v5" />
                          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })
              : (
                <p className="px-2 py-4 text-center text-xs text-fg-mute">
                  {bossQuery.trim() ? t('map.bossSearchEmpty', { q: bossQuery.trim() }) : t('map.bossTypeEmpty')}
                </p>
              )
            : Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full shrink-0 rounded-lg" />
              ))}
        </aside>
      )}

      {/* Live world-news rail — "what's happening on your world" (houses changing
          hands + the daily kill-stats digest), docked to the RIGHT edge and
          collapsed to a 📰 button by default so it never shifts the layout.
          Clicking an item plots the creature / flies to the house. */}
      {/* Right-edge stack: the news rail, and directly under it the travelling
          merchants — one tap flies to them and routes there. */}
      <div className="pointer-events-none absolute right-2 top-3 z-[1101] flex flex-col items-end gap-2 sm:right-3">
        <NewsRail
          events={newsEvents}
          open={newsOpen}
          alert={hasNewsAlert}
          onToggle={() => {
            // Opening the rail marks everything as seen — the "!" stands down.
            if (!newsOpen) {
              const now = Date.now()
              setNewsSeenAt(now)
              try {
                localStorage.setItem(newsSeenKey, String(now))
              } catch {
                /* ignore */
              }
            }
            setNewsOpen((v) => !v)
          }}
          t={t}
          onPick={onPickEvent}
        />
        {/* Same panel shell as the news rail (rounded, blurred, bordered) but in
            gold — and the same 2.9rem width as the collapsed news button, with
            the merchants stacked one above the other, so the right edge stays a
            single narrow column instead of growing sideways. */}
        <div className="pointer-events-auto flex w-[2.9rem] flex-col items-center gap-1 rounded-2xl border-2 border-rashid/70 bg-bg-2/95 p-1.5 shadow-lg backdrop-blur-md">
          <RashidRail stop={rashidStop} active={rashidOpen} onPick={() => goToRashid()} t={t} />
          <TravellerRail
            sprite={YASIR_SPRITE}
            tag={`×${YASIR_DOCKS.length}`}
            color={YASIR_TEAL}
            title={`${t('map.yasirTitle')} — ${YASIR_DOCKS.map((d) => d.city).join(' / ')}`}
            label={`${t('map.yasirTitle')}. ${t('map.yasirHint')}`}
            active={yasirOpen}
            onPick={openYasir}
          />
        </div>
      </div>

      {/* Floating control layer — pinned to the top, translucent so the map reads
          through it. The outer wrapper ignores pointer events so the map stays
          draggable in the side gutters; the inner column re-enables them. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col p-2 pt-5 sm:p-3 sm:pt-7">
        <div ref={topColRef} className="pointer-events-none flex w-full max-w-lg flex-col gap-2">

      {/* Search — the hero, pinned top-left. The action/layer hotbar lives at the
          bottom of the screen (see below). */}
      <div className="pointer-events-none flex flex-col gap-2">
        {/* Search pill — creature/item mode toggle + the search field */}
        <div className="pointer-events-auto flex w-full items-center gap-2 rounded-2xl border-2 border-line bg-bg-2/95 p-1.5 shadow-lg backdrop-blur-md transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          {/* Mode: creature spawns, item droppers ("where does it drop?") or
              merchant NPCs (route straight to the shop) */}
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-bg/50 p-1.5">
            {(
              [
                { key: 'creature', icon: '/sprites/infernal-demon.webp', label: t('map.searchModeCreature') },
                { key: 'item', icon: '/sprites/magic-longsword.webp', label: t('map.searchModeItem') },
                { key: 'npc', icon: '/sprites/npc-frodo.png', label: t('map.searchModeNpc') },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setSearchKind(m.key)
                  setQuery('')
                  setSearchOpen(false)
                }}
                title={m.label}
                aria-label={m.label}
                aria-pressed={searchKind === m.key}
                className={`grid h-10 w-10 place-items-center rounded-lg transition ${
                  searchKind === m.key ? 'bg-accent shadow-sm' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={m.icon}
                  alt=""
                  className="h-8 w-8 object-contain [image-rendering:pixelated]"
                />
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-mute"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder={t(
                searchKind === 'item'
                  ? 'map.searchItem'
                  : searchKind === 'npc'
                    ? 'map.searchNpc'
                    : 'map.searchCreature',
              )}
              className="h-12 w-full rounded-xl bg-transparent pl-10 pr-3 text-lg font-semibold text-fg outline-none placeholder:font-medium placeholder:text-fg-mute"
            />
          </div>
          {searchOpen && debouncedQuery.trim().length >= 2 && searchKind === 'creature' && searchResults && searchResults.length > 0 && (
            <ul className="scroll-atlas absolute z-[1100] mt-2 max-h-80 w-full overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl">
              {searchResults.map((r) => (
                <li key={r.slug}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickFromSearch(r.slug, () => addCreature(r.slug))}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2"
                  >
                    {r.image ? (
                      <img
                        src={r.image}
                        alt=""
                        className="h-6 w-6 shrink-0 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <TypeIcon type={r.type} className="h-4 w-4 shrink-0 text-fg-mute" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                      {t(`types.${r.type}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchOpen && debouncedQuery.trim().length >= 2 && searchKind === 'item' && itemResults && itemResults.length > 0 && (
            <ul className="scroll-atlas absolute z-[1100] mt-2 max-h-80 w-full overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl">
              {itemResults.map((r) => (
                <li key={r.slug}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickFromSearch(r.slug, () => addItem(r.slug))}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2"
                  >
                    {r.primary_image ? (
                      <img
                        src={r.primary_image}
                        alt=""
                        className="h-6 w-6 shrink-0 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <TypeIcon type="item" className="h-4 w-4 shrink-0 text-fg-mute" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                      {t('map.searchModeItem')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchOpen && debouncedQuery.trim().length >= 2 && searchKind === 'npc' && npcResults && npcResults.length > 0 && (
            <ul className="scroll-atlas absolute z-[1100] mt-2 max-h-80 w-full overflow-auto rounded-xl border-2 border-line bg-bg-2 py-1.5 shadow-2xl">
              {npcResults.map((r, i) => {
                const routable = r.coords.length > 0
                return (
                  <li key={`${r.npc}-${i}`}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => routable && pickFromSearch(r.slug, () => goToNpc(r), r.npc)}
                      disabled={!routable}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                        routable ? 'hover:bg-surface-2' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      {r.image ? (
                        <img
                          src={r.image}
                          alt=""
                          className="h-6 w-6 shrink-0 object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <TypeIcon type="npc" className="h-4 w-4 shrink-0 text-fg-mute" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {r.npc}
                        {r.city && <span className="text-fg-mute"> · {r.city}</span>}
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-mute">
                        {routable ? t('map.searchNpcGo') : t('map.searchNpcNoSpot')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        </div>

        {/* Hotbar — grouped icon slots, pinned to the bottom-centre of the screen
            like a game action bar (fixed, so it escapes the top control column and
            anchors to the viewport). Tooltips name each action. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex flex-wrap items-end justify-center gap-2 p-2 sm:p-3">
          {/* Imported-marker category legend — a full-width line, so it always
              sits on its own row above the pills. It rides in the bar's flow
              rather than floating over it, and holds `treeClearance` of empty
              air below so the trees sprouting out of the pills stay clickable. */}
          {showPoi && (
            <div
              className="flex w-full justify-center"
              style={{ marginBottom: treeClearance }}
            >
              <div className="pointer-events-auto flex max-w-[94vw] flex-wrap items-center justify-center gap-x-4 gap-y-2 overflow-x-auto rounded-2xl border border-line-2 bg-surface/95 px-3 py-2 text-xs font-semibold text-fg-dim shadow-lg backdrop-blur-md">
                <span className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">
                  {t('map.markersLegend')}
                </span>
                {[
                  { c: '#d23d2f', i: POI_ICONS.boss, l: t('map.poiBoss') },
                  { c: '#3fa7d6', i: POI_ICONS.travel, l: t('map.poiTravel') },
                  { c: '#6cc551', i: POI_ICONS.service, l: t('map.poiService') },
                  { c: '#e0a531', i: POI_ICONS.quest, l: t('map.poiQuest') },
                  { c: '#9b8cff', i: POI_ICONS.poi, l: t('map.poiOther') },
                ].map((e) => (
                  <span key={e.l} className="flex items-center gap-1.5">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/90"
                      style={{ background: e.c }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d={e.i} />
                      </svg>
                    </span>
                    {e.l}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Go — everything about moving around the atlas. Jumping to a city is
              the search field's job, so this pill is route planning only. */}
          <div className={PILL}>
            {/* Routes — directions, community gallery and the route builder all
                sprout from one slot (same family as the Houses layer's tree). */}
            <HotbarGroup
              label={t('map.routesGroup')}
              active={routeMode || buildMode || routesOpen}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
              }
            >
              {/* Directions (nearest the primary — the most-used) */}
              <button
                onClick={() => {
                  const next = !routeMode
                  setMapMode(next ? 'route' : null)
                  resetRoute()
                  if (next) {
                    const cr = creaturesRef.current[0]
                    const pt = cr && routeEndForCreature(cr)
                    if (pt) applyRouteEnd(pt)
                  }
                }}
                title={routeMode ? t('map.routeActive') : t('map.route')}
                aria-label={t('map.route')}
                aria-pressed={routeMode}
                className={`${SLOT} ${routeMode ? SLOT_ON : SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
              </button>

              {/* Community routes gallery */}
              <button
                onClick={() => {
                  setRoutesPage(1)
                  setRoutesQuery('')
                  togglePanel('routes', routesOpen)
                }}
                title={t('map.routesGallery')}
                aria-label={t('map.routesGallery')}
                aria-pressed={routesOpen}
                className={`${SLOT} ${routesOpen ? SLOT_ON : SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>

              {/* Build a route */}
              <button
                onClick={toggleBuildMode}
                title={t('map.buildRoute')}
                aria-label={t('map.buildRoute')}
                aria-pressed={buildMode}
                className={`${SLOT} ${buildMode ? SLOT_ON : SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="19" r="2" />
                  <circle cx="18" cy="5" r="2" />
                  <path d="M8 17.5 16 6.5" strokeDasharray="2 3" />
                </svg>
              </button>
            </HotbarGroup>
          </div>

          {/* Layers — what's drawn on the atlas */}
          <div className={PILL}>
            {/* All creatures / hide */}
            <button
              onClick={() => {
                if (showAll && !bossOnly) setShowAll(false)
                else {
                  setShowAll(true)
                  setBossOnly(false)
                }
              }}
              title={t('map.modeAll')}
              aria-label={t('map.modeAll')}
              aria-pressed={showAll && !bossOnly}
              className={`${SLOT} ${showAll && !bossOnly ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            {/* Bosses only */}
            <button
              onClick={() => {
                if (showAll && bossOnly) setBossOnly(false)
                else {
                  setShowAll(true)
                  setBossOnly(true)
                }
              }}
              title={t('map.bosses')}
              aria-label={t('map.bosses')}
              aria-pressed={showAll && bossOnly}
              className={`${SLOT} ${showAll && bossOnly ? 'border-theory bg-theory text-white' : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
              </svg>
            </button>

            <span className="mx-0.5 h-6 w-px bg-line/50" />

            {/* Markers — everything about marks on the atlas hangs off one slot.
                The primary toggles the imported client markers (points of
                interest); while it's on, your own marker actions (add / clear)
                sprout UP from it like the Houses tree below. */}
            <div className="relative flex items-center">
              {showPoi && (
                <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5">
                  {/* trunk connecting the branch down to the markers icon */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1 -bottom-2.5 -z-10 w-0.5 -translate-x-1/2 rounded"
                    style={{ background: 'var(--color-interp)', opacity: 0.45 }}
                  />
                  <button
                    onClick={() => setMapMode(placing ? null : 'place')}
                    title={t('map.addMarker')}
                    aria-label={t('map.addMarker')}
                    aria-pressed={placing}
                    className={`${SLOT} ${placing ? SLOT_ON : SLOT_OFF}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                      <path d="M12 8v4M10 10h4" />
                    </svg>
                  </button>

                  {/* Clear your markers (only when there are any) */}
                  {markers.length > 0 && (
                    <button
                      onClick={() => setMarkers([])}
                      title={`${t('map.clear')} (${markers.length})`}
                      aria-label={`${t('map.clear')} (${markers.length})`}
                      className={`${SLOT} ${SLOT_OFF}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  const next = !showPoi
                  setShowPoi(next)
                  // Collapsing the branch would strand "placing" with no visible
                  // way out, so close it with the tree.
                  if (!next) setPlacing(false)
                }}
                title={t('map.markersLayer')}
                aria-label={t('map.markersLayer')}
                aria-pressed={showPoi}
                className={`relative ${SLOT} ${showPoi || placing ? 'border-interp bg-interp/15 text-interp' : SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <path d="M4 22v-7" />
                </svg>
                {markers.length > 0 && (
                  <span
                    className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
                    style={{ background: 'var(--color-interp)' }}
                  >
                    {markers.length}
                  </span>
                )}
              </button>
            </div>

            {/* Rentable houses — the layer toggle. When the layer is on, its
                sub-controls (available-only filter + availability/alerts panel)
                sprout straight UP from it like a little tree, connected by a
                trunk, so it reads clearly as "these belong to Houses". */}
            <div className="relative flex items-center">
              {showHouses && (
                <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5">
                  {/* trunk connecting the branch down to the house icon */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1 -bottom-2.5 -z-10 w-0.5 -translate-x-1/2 rounded bg-[#b3873f]/45"
                  />
                  <button
                    onClick={() =>
                      setHouseStatusFilter((v) => (v === 'available' ? 'all' : 'available'))
                    }
                    title={t('map.houseAvailOnly')}
                    aria-label={t('map.houseAvailOnly')}
                    aria-pressed={houseStatusFilter === 'available'}
                    className={`${SLOT} ${houseStatusFilter === 'available' ? 'border-[#2f9e5a] bg-[#2f9e5a]/15 text-[#2f9e5a]' : SLOT_OFF}`}
                  >
                    {/* filter funnel */}
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 4h18l-7 8v6l-4 2v-8z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => togglePanel('houses', housePanelOpen)}
                    title={t('map.houseAvailPanel')}
                    aria-label={t('map.houseAvailPanel')}
                    aria-pressed={housePanelOpen}
                    className={`relative ${SLOT} ${housePanelOpen ? SLOT_ON : SLOT_OFF}`}
                  >
                    {/* list */}
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                    {availableCount > 0 && (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#2f9e5a] px-1 text-[10px] font-bold text-white">
                        {availableCount}
                      </span>
                    )}
                  </button>
                </div>
              )}
              <button
                onClick={() => setShowHouses((v) => !v)}
                title={t('map.housesLayer')}
                aria-label={t('map.housesLayer')}
                aria-pressed={showHouses}
                className={`${SLOT} ${showHouses ? 'border-[#b3873f] bg-[#b3873f]/15 text-[#b3873f]' : SLOT_OFF}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10l9-7 9 7M5 9v11h14V9M9 21v-6h6v6" />
                </svg>
              </button>
            </div>

            {/* Lore / mysteries — curated story POIs. Toggling it off also closes
                any open reader panel so a stray pin's story can't linger. */}
            <div className="relative flex items-center">
              <button
                onClick={() => {
                  setShowLore((v) => {
                    if (v) setLorePoi(null)
                    return !v
                  })
                }}
                title={t('map.loreLayer')}
                aria-label={t('map.loreLayer')}
                aria-pressed={showLore}
                className={`relative ${SLOT} ${showLore ? 'border-[#c79a3f] bg-[#c79a3f]/15 text-[#c79a3f]' : SLOT_OFF}`}
              >
                {/* open book — "read the lore" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                {showLore && (
                  <span
                    className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#c79a3f] px-1 text-[10px] font-bold leading-none text-white"
                  >
                    {LORE_POIS.length}
                  </span>
                )}
              </button>
            </div>

            {/* Invasions / raids — where the world's scripted invasions land.
                Turning it off also closes any open dossier. */}
            <div className="relative flex items-center">
              <button
                onClick={() => {
                  setShowRaids((v) => {
                    if (v) setRaid(null)
                    return !v
                  })
                }}
                title={t('map.raidLayer')}
                aria-label={t('map.raidLayer')}
                aria-pressed={showRaids}
                className={`relative ${SLOT} ${showRaids ? 'border-[#d4483b] bg-[#d4483b]/15 text-[#d4483b]' : SLOT_OFF}`}
              >
                {/* flame — an invasion under way */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C8.9 8.6 9.6 9.4 10 10c0-2.6 1-6 2-8z" />
                  <path d="M12 22a7 7 0 0 0 7-7" />
                </svg>
                {showRaids && raids && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#d4483b] px-1 text-[10px] font-bold leading-none text-white">
                    {raids.length}
                  </span>
                )}
              </button>
            </div>

            {/* Mini world changes — the daily rolls (fury gates, nightmare isles,
                Yasir, the full moon). Turning it off closes the dossier too. */}
            <div className="relative flex items-center">
              <button
                onClick={() => {
                  setShowWc((v) => {
                    if (v) {
                      setWc(null)
                      setWcSpot(null)
                    }
                    return !v
                  })
                }}
                title={t('map.wcLayer')}
                aria-label={t('map.wcLayer')}
                aria-pressed={showWc}
                className={`relative ${SLOT} ${showWc ? 'border-[#8b6fd4] bg-[#8b6fd4]/15 text-[#8b6fd4]' : SLOT_OFF}`}
              >
                {/* waning moon — the world rolls these overnight */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
                {showWc && worldChanges && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#8b6fd4] px-1 text-[10px] font-bold leading-none text-white">
                    {worldChanges.length}
                  </span>
                )}
              </button>
            </div>

            {/* Analyze zone — drag a rectangle, get a combat summary of what
                spawns inside. Turning it off clears the selection + panel. */}
            <div className="relative flex items-center">
              <button
                onClick={() => togglePanel('zone', analyzeMode)}
                title={t('map.zoneLayer')}
                aria-label={t('map.zoneLayer')}
                aria-pressed={analyzeMode}
                className={`relative ${SLOT} ${analyzeMode ? 'border-[#3fa7d6] bg-[#3fa7d6]/15 text-[#3fa7d6]' : SLOT_OFF}`}
              >
                {/* crosshair-corners — "select an area" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              </button>
            </div>

            {/* Profit / wealth legend — a framed chip with a gold coin so it
                clearly reads as the "how rich is this spot" bar, not just a
                swatch lost among the icon slots. Only meaningful while dots show. */}
            {showAll && (
              <div
                className="flex items-center gap-2 rounded-lg border border-line-2 bg-bg-2/70 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                title={t('map.profitLegendHint')}
              >
                <img
                  src="/sprites/crystal-coin.webp"
                  alt=""
                  className="h-4 w-4 shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
                <span className="text-[11px] font-bold uppercase tracking-wide text-fg-mute">
                  {t('map.profitLow')}
                </span>
                <span
                  className="h-3 w-20 rounded-full ring-1 ring-line-2"
                  style={{ background: HEAT_GRADIENT_CSS }}
                />
                <span className="text-[11px] font-bold uppercase tracking-wide text-fg-mute">
                  {t('map.profitHigh')}
                </span>
              </div>
            )}
          </div>

          {/* You & utilities — your character and the hunt finder that reads it,
              then the two actions that act on the page itself (share, help). */}
          <div className={PILL}>
            {/* Your character — settings gear. Lit when a profile is saved; the
                badge shows the character's level once looked up. */}
            <button
              onClick={() => togglePanel('char', charOpen)}
              title={t('map.charTitle')}
              aria-label={t('map.charTitle')}
              aria-pressed={charOpen}
              className={`relative ${SLOT} ${charOpen || charProfile ? SLOT_ON : SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              {character?.level != null && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
                  {character.level}
                </span>
              )}
            </button>

            {/* Everything you run FOR a character, in one slot right beside it:
                the blessing pilgrimages, the hunt finder that reads your level and
                set, and the analyzer that counts what a session actually made.
                They sprout up in that order, nearest slot first. */}
            <HotbarGroup
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {/* toolbox — "your hunting kit" */}
                  <path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
                  <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  <path d="M3 13h18" />
                </svg>
              }
              label={t('map.toolsGroup')}
              accent="#c79a3f"
              active={blessSet !== null || huntOpen || profitOpen}
            >
              {/* Blessings — one slot that asks 5 or 7, then plans the whole
                  pilgrimage: every shrine in the cheapest order, from the city
                  nearest to your view. */}
              <BlessPicker
                label={t('map.blessTitle')}
                fiveLabel={t('map.blessFive')}
                sevenLabel={t('map.blessSeven')}
                value={blessSet}
                onPick={runPilgrimage}
              />

              {/* Hunt Finder — ranks the best hunting zones for your level/vocation/set. */}
              <button
                onClick={() => togglePanel('hunt', huntOpen)}
                title={t('map.huntTitle')}
                aria-label={t('map.huntTitle')}
                aria-pressed={huntOpen}
                className={`${SLOT} ${huntOpen ? SLOT_ON : SLOT_OFF}`}
              >
                {/* crosshair / target — "find a hunt" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
                </svg>
              </button>

              {/* Hunt profit calculator — same tool the bottom-right quick-link
                  opens: paste an analyzer, get the profit after imbuement wear
                  and silver-token recharges. */}
              <button
                onClick={() => togglePanel('profit', profitOpen)}
                title={t('map.hpTitle')}
                aria-label={t('map.hpTitle')}
                aria-pressed={profitOpen}
                className={`${SLOT} ${profitOpen ? SLOT_ON : SLOT_OFF}`}
              >
                {/* two coins — "count the money" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                  <path d="M7 6h1v4" />
                  <path d="m16.71 13.88.7.71-2.82 2.82" />
                </svg>
              </button>
            </HotbarGroup>

            <span className="mx-0.5 h-6 w-px bg-line/50" />

            {/* Share this view */}
            <button
              onClick={share}
              title={t('map.share')}
              aria-label={t('map.share')}
              className={`${SLOT} ${copied ? 'border-canon bg-canon/15 text-canon' : SLOT_OFF}`}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" />
                </svg>
              )}
            </button>

            {/* Site guide — last slot in the bar, where help conventionally sits. */}
            <button
              onClick={() => {
                openPanel(null) // the guide covers the map — clear the cards first
                setShowTour(true)
              }}
              title={t('guide.open')}
              aria-label={t('guide.open')}
              className={`${SLOT} ${SLOT_OFF}`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </button>
          </div>

        </div>
      </div>

      {/* "Your character" settings — a floating card above the hotbar. Type a
          name to save it (localStorage); once saved it's looked up via the
          /api/character proxy and summarised here. This is the wiring the map's
          personal overlay (house pin, deaths) will read from. */}
      {charOpen && (
        <div className={charPos ? 'pointer-events-none fixed inset-0 z-[1002]' : 'pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3'}>
          <div
            ref={charCardRef}
            style={charPos ? { position: 'absolute', left: charPos.x, top: charPos.y } : undefined}
            className="scroll-atlas pointer-events-auto max-h-[78vh] w-[30rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-3.5 shadow-2xl backdrop-blur-md"
          >
            {/* Header doubles as the drag handle — grab it to move the card. */}
            <div
              onPointerDown={startCharDrag}
              onPointerMove={moveCharDrag}
              onPointerUp={endCharDrag}
              onPointerCancel={endCharDrag}
              className="mb-2 flex cursor-grab touch-none select-none items-center gap-1.5 text-accent active:cursor-grabbing"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-widest">{t('map.charTitle')}</span>
              <button
                onClick={() => setCharOpen(false)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={t('map.charTitle')}
                className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-2 text-sm text-fg-dim">{t('map.charHint')}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveChar()
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={charDraft}
                onChange={(e) => setCharDraft(e.target.value)}
                placeholder={t('map.charPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2.5 text-sm font-semibold outline-none transition placeholder:font-normal placeholder:text-fg-mute focus:border-accent"
              />
              <button
                type="submit"
                disabled={!charDraft.trim() || charDraft.trim() === charProfile?.name}
                className="h-9 shrink-0 rounded-lg border border-accent bg-accent px-3 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('map.charSave')}
              </button>
              {charProfile && (
                <button
                  type="button"
                  onClick={clearChar}
                  title={t('map.charClear')}
                  aria-label={t('map.charClear')}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-bg-2 text-fg-mute transition hover:border-accent hover:text-accent"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              )}
            </form>

            {charProfile && (
              <div className="mt-3">
                {charQuery.isLoading ? (
                  <p className="py-2 text-sm text-fg-dim">{t('map.charLoading')}</p>
                ) : charQuery.isError ? (
                  <p className="py-2 text-sm text-accent">{t('map.charError')}</p>
                ) : !character ? (
                  <p className="py-2 text-sm text-fg-dim">{t('map.charNotFound')}</p>
                ) : (
                  <div className="rounded-xl border border-line bg-bg-2 p-3">
                    <div className="text-base font-bold text-fg">{character.name}</div>
                    {character.level != null && (
                      <div className="text-sm text-fg">
                        {t('map.charLevel', { level: character.level, vocation: character.vocation ?? '' })}
                      </div>
                    )}
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm">
                      {character.world && (
                        <>
                          <dt className="font-bold uppercase tracking-wide text-fg-dim">{t('map.charWorld')}</dt>
                          <dd className="text-fg">{character.world}</dd>
                        </>
                      )}
                      {character.guild && (
                        <>
                          <dt className="font-bold uppercase tracking-wide text-fg-dim">{t('map.charGuild')}</dt>
                          <dd className="truncate text-fg">
                            {character.guild.name}
                            {character.guild.rank ? ` · ${character.guild.rank}` : ''}
                          </dd>
                        </>
                      )}
                      {character.houses[0] && (
                        <>
                          <dt className="font-bold uppercase tracking-wide text-fg-dim">{t('map.charHouse')}</dt>
                          <dd className="truncate text-fg">
                            {character.houses[0].name}
                            {character.houses[0].town ? ` · ${character.houses[0].town}` : ''}
                          </dd>
                        </>
                      )}
                    </dl>
                    <div className="mt-2.5 border-t border-line pt-2">
                      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-fg-dim">
                        {t('map.charDeaths')}
                      </div>
                      {character.deaths.length === 0 ? (
                        <p className="text-sm text-fg-dim">{t('map.charNoDeaths')}</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {character.deaths.slice(0, 5).map((d, i) => (
                            <li key={i} className="flex items-baseline gap-1.5 text-sm">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 12h.01M15 12h.01M8 20v2h8v-2M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
                              </svg>
                              <span className="min-w-0 flex-1 text-fg">
                                {d.level != null ? `Lvl ${d.level} · ` : ''}
                                {d.killers.map((k) => k.name).filter(Boolean).join(', ') || d.reason}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* "Your equipment": pick what you actually wear, slot by slot. The
                stat readout below and the Hunt Finder both run on this exact
                set. TibiaData doesn't expose worn items, so it's hand-picked. */}
            {charProfile && (
              <div className="mt-3 rounded-xl border border-line bg-bg-2 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.charGear')}</span>
                  {gearIdList.length > 0 && (
                    <button
                      type="button"
                      onClick={clearGear}
                      className="text-xs font-semibold text-fg-dim transition hover:text-accent"
                    >
                      {t('map.charGearClear')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {GEAR_SLOTS.map((slot) => {
                    const piece = charProfile.gear?.[slot] ?? null
                    const open = gearSlot === slot
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => {
                          setGearSlot(open ? null : slot)
                          setGearQuery('')
                        }}
                        aria-pressed={open}
                        className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition ${open ? 'border-accent bg-accent/10' : piece ? 'border-line-2 bg-bg-2 hover:border-accent' : 'border-dashed border-line bg-bg-2 hover:border-accent'}`}
                      >
                        {piece?.image ? (
                          <img src={piece.image} alt="" className="h-8 w-8 object-contain" loading="lazy" />
                        ) : (
                          <span className="grid h-8 w-8 place-items-center text-xl leading-none text-fg-dim">+</span>
                        )}
                        <span className="text-[11px] font-bold uppercase tracking-wide text-fg-dim">
                          {t(`items.slot.${slot}`)}
                        </span>
                        <span className={`w-full truncate text-xs ${piece ? 'font-semibold text-fg' : 'text-fg-dim'}`}>
                          {piece?.name ?? '—'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Item picker for the open slot: search the catalogue, strongest first. */}
                {gearSlot && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={gearQuery}
                        onChange={(e) => setGearQuery(e.target.value)}
                        placeholder={t('map.charGearSearch', { slot: t(`items.slot.${gearSlot}`) })}
                        spellCheck={false}
                        autoComplete="off"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2.5 text-sm font-semibold outline-none transition placeholder:font-normal placeholder:text-fg-mute focus:border-accent"
                      />
                      {charProfile.gear?.[gearSlot] && (
                        <button
                          type="button"
                          onClick={() => setGearPiece(gearSlot, null)}
                          className="h-9 shrink-0 rounded-lg border border-line-2 bg-bg-2 px-2.5 text-xs font-bold text-fg-dim transition hover:border-accent hover:text-accent"
                        >
                          {t('map.charGearRemove')}
                        </button>
                      )}
                    </div>
                    {gearItemsQuery.isError ? (
                      // A dead API is NOT "no results" — misreporting it sent
                      // us chasing phantom missing-item bugs.
                      <p className="py-2 text-center text-sm text-accent">{t('map.charError')}</p>
                    ) : gearChoices.length === 0 ? (
                      // Never claim "no results" mid-search: that's the lie
                      // that made a working search look broken.
                      <p className="py-2 text-center text-sm text-fg-dim">
                        {gearSearching ? t('map.charLoading') : t('map.charGearEmpty')}
                      </p>
                    ) : (
                      <ul
                        className={`scroll-atlas mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-line transition-opacity ${gearSearching ? 'opacity-50' : ''}`}
                      >
                        {gearChoices.map((it) => (
                          <li key={it.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setGearPiece(gearSlot, {
                                  id: it.id,
                                  slug: it.slug,
                                  name: it.name ?? it.slug,
                                  image: it.primary_image,
                                })
                              }
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-accent/10"
                            >
                              {it.primary_image ? (
                                <img src={it.primary_image} alt="" className="h-7 w-7 shrink-0 object-contain" loading="lazy" />
                              ) : (
                                <span className="h-7 w-7 shrink-0" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{it.name ?? it.slug}</span>
                              <span className="shrink-0 text-xs text-fg-dim">{gearHint(it)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Derived stats of the worn set — the exact numbers the Hunt
                    Finder scores zones with (shared backend math). */}
                {gearIdList.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-dim">{t('map.charGearHint')}</p>
                ) : setStats ? (
                  <div className="mt-2 border-t border-line pt-2">
                    <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">
                      {t('map.charSetStats')}
                    </div>

                    {/* Headline tiles: the three numbers you glance at. */}
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded-lg border border-line-2 bg-bg-2 px-1 py-2">
                        <div className="text-xl font-black leading-none text-fg">{setStats.armor}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-fg-dim">
                          {t('map.charArmor')}
                        </div>
                      </div>
                      <div
                        className="rounded-lg border border-line-2 bg-bg-2 px-1 py-2"
                        title={t('map.charPhysRedHint')}
                      >
                        <div className="text-xl font-black leading-none text-accent">
                          −{setStats.armor_absorb}
                        </div>
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-fg-dim">
                          {t('map.charPhysRed')}
                        </div>
                      </div>
                      <div className="rounded-lg border border-line-2 bg-bg-2 px-1 py-2">
                        <div className="truncate text-sm font-black leading-none text-fg">
                          {setStats.weapon
                            ? (setStats.weapon.type ?? setStats.weapon.category ?? setStats.weapon.name)
                            : '—'}
                        </div>
                        <div className="mt-1.5 truncate text-[10px] font-bold uppercase tracking-wide text-fg-dim">
                          {setStats.weapon?.element
                            ? `${t('map.charWeapon')} · ${elLabel(setStats.weapon.element)}`
                            : t('map.charWeapon')}
                        </div>
                      </div>
                    </div>

                    {/* Resist bars: the compounded protection per element (60% is
                        just the bar scale, not a cap); maluses paint red. */}
                    {Object.entries(setStats.resists).filter(([, p]) => p !== 0).length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-fg-dim">
                          {t('map.huntSetResists')}
                        </div>
                        {Object.entries(setStats.resists)
                          .filter(([, p]) => p !== 0)
                          .sort((a, b) => b[1] - a[1])
                          .map(([el, p]) => (
                            <StatBar
                              key={el}
                              label={elLabel(el)}
                              value={`${signed(p)}%`}
                              pct={(Math.abs(p) / 60) * 100}
                              color={p < 0 ? '#c0392b' : (HUNT_ELEMENT_COLOR[el] ?? '#8a8578')}
                            />
                          ))}
                      </div>
                    )}

                    {/* Skill-bonus bars, scaled to the biggest bonus worn. */}
                    {Object.keys(setStats.bonuses).length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-fg-dim">
                          {t('map.charSkills')}
                        </div>
                        {Object.entries(setStats.bonuses)
                          .sort((a, b) => b[1] - a[1])
                          .map(([skill, pts]) => (
                            <StatBar
                              key={skill}
                              label={SKILL_LABELS[skill] ?? skill}
                              value={signed(pts)}
                              pct={(Math.abs(pts) / skillMax) * 100}
                              color={pts < 0 ? '#c0392b' : 'var(--color-accent)'}
                            />
                          ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-fg-dim">{t('map.charGearHunt')}</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hunt profit calculator — draggable card: paste the analyzer, subtract
          imbuement wear + silver-token recharges from the balance. */}
      <HuntProfitTool open={profitOpen} onClose={() => setProfitOpen(false)} />

      {/* Hunt Finder — a floating card above the hotbar. Filters (vocation +
          level) drive the /api/hunts ranking; each result is a
          hunting zone you can click to fly to, expanding into its per-creature
          breakdown (what to hit it with, reward, danger). */}
      {lorePoi && <LorePanel poi={lorePoi} onClose={() => setLorePoi(null)} />}

      {/* Analyze zone: the drag hint while no box is drawn, then the summary. */}
      {analyzeMode && !analyzeBox && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
          <div className="rounded-xl border border-[#3fa7d6]/50 bg-bg-2/95 px-4 py-2 text-sm font-semibold text-[#3fa7d6] shadow-lg backdrop-blur-md">
            {t('map.zoneHint')}
          </div>
        </div>
      )}
      {analyzeMode && analyzeBox && (
        <ZonePanel
          data={zoneQuery.data}
          loading={zoneQuery.isPending}
          floor={floor}
          onClose={() => setAnalyzeBox(null)}
        />
      )}
      {raid && <RaidPanel raid={raid} onClose={() => setRaid(null)} onPlot={plotCreatureByName} />}
      {/* Mini world change dossier: where it can land and what the world says. */}
      {wc && (
        <WorldChangePanel
          change={wc}
          spot={wcSpot}
          onClose={() => {
            setWc(null)
            setWcSpot(null)
          }}
          onSpot={(s) => openWorldChange(wc, s)}
          onRoute={(s) => routeToWorldChangeSpot(wc, s)}
          onInside={() => openWorldChange(wc, null)}
          onPlot={plotCreatureByName}
        />
      )}
      {/* Pilgrimage stop list — the order the route follows, and the two shrines
          you cannot simply walk into. */}
      {blessStops && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
          <div className="scroll-atlas pointer-events-auto max-h-[60vh] w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-3 shadow-2xl backdrop-blur-md">
            <div className={`flex items-center gap-1.5 text-[#c79a3f] ${blessMin ? '' : 'mb-2'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18M7 8h10" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {t(blessSet === 'seven' ? 'map.blessSeven' : 'map.blessFive')}
              </span>
              {blessMin && (
                <span className="text-[10px] font-bold tabular-nums text-fg-mute">
                  {t('map.blessTiles', { tiles: blessStops.reduce((a, s) => a + s.tiles, 0) })}
                </span>
              )}
              {/* Minimise: folds the list away and LEAVES the route drawn. Only
                  the X below throws the pilgrimage away. */}
              <button
                onClick={() => setBlessMin((v) => !v)}
                aria-pressed={blessMin}
                title={blessMin ? t('map.blessExpand') : t('map.blessCollapse')}
                aria-label={blessMin ? t('map.blessExpand') : t('map.blessCollapse')}
                className={`ml-auto flex h-6 items-center gap-1 rounded-md border border-line-2 text-fg-mute transition hover:border-[#c79a3f] hover:text-[#c79a3f] ${blessMin ? 'px-1.5' : 'w-6 justify-center'}`}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {blessMin ? <path d="m7 14 5 5 5-5M7 10l5-5 5 5" /> : <path d="M5 12h14" />}
                </svg>
                {blessMin && (
                  <span className="text-[10px] font-bold uppercase tracking-wide">{t('map.blessExpand')}</span>
                )}
              </button>
              <button
                onClick={() => {
                  setBlessStops(null)
                  setBlessSet(null)
                  setBlessMin(false)
                  setRoutePlan(null)
                }}
                aria-label={t('common.close')}
                className="grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-[#c79a3f] hover:text-[#c79a3f]"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {!blessMin && (
              <>
            <ol className="space-y-1">
              {blessStops.map((s, i) => {
                const access = SHRINE_ACCESS[s.shrine.id]?.mode
                return (
                  <li key={s.shrine.id}>
                    <button
                      onClick={() => {
                        floorRef.current = s.shrine.z
                        setFloor(s.shrine.z)
                        const m = mapRef.current
                        if (m) m.flyTo(toLatLng(s.shrine.x, s.shrine.y), Math.max(m.getZoom(), 3), { duration: 0.5 })
                      }}
                      className="flex w-full items-baseline gap-2 rounded-md border border-line-2 bg-bg-3/40 px-2 py-1.5 text-left transition hover:border-[#c79a3f]/60"
                    >
                      <span className="shrink-0 text-[11px] font-bold text-[#c79a3f]">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">{s.shrine.name}</span>
                        <span className="block truncate text-[11px] text-fg-dim">
                          {s.shrine.npc}
                          {' · '}
                          {t('map.blessFloor', { floor: s.shrine.z })}
                          {access && (
                            <span className="ml-1 font-semibold text-[#c79a3f]">
                              · {t(access === 'boat' ? 'map.blessByBoat' : 'map.blessByLevitate')}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-fg-mute">
                        {s.reached ? t('map.blessTiles', { tiles: s.tiles }) : t('map.blessNoWalk')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-mute">{t('map.blessNote')}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Rashid's reader: today's exact spot + re-trace of the route to him. */}
      {rashidOpen && (
        <RashidPanel
          stop={rashidStop}
          lang={i18n.language?.slice(0, 2) === 'en' ? 'en' : 'es'}
          onRoute={() => goToRashid(true)}
          onClose={() => setRashidOpen(false)}
        />
      )}

      {/* Yasir's reader: his three candidate docks, each routable. */}
      {yasirOpen && (
        <YasirPanel
          docks={YASIR_DOCKS}
          lang={i18n.language?.slice(0, 2) === 'en' ? 'en' : 'es'}
          onRoute={goToYasirDock}
          onClose={() => setYasirOpen(false)}
        />
      )}

      {huntOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1002] flex justify-center px-3">
          <div className="scroll-atlas pointer-events-auto max-h-[70vh] w-[27rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-2 border-line bg-bg-2/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center gap-1.5 text-accent">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest">{t('map.huntTitle')}</span>
              <button
                onClick={() => setHuntOpen(false)}
                aria-label={t('map.huntTitle')}
                className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-2.5 text-xs text-fg-mute">{t('map.huntHint')}</p>

            {/* Filters: vocation + level. */}
            <div className="mb-2.5 flex items-center gap-1.5">
              <select
                value={huntVoc}
                onChange={(e) => {
                  setHuntVoc(e.target.value)
                  resetHuntSel()
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2 text-sm font-semibold outline-none transition focus:border-accent"
              >
                <option value="">{t('map.huntVocation')}…</option>
                {(['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`items.voc.${v}`)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={huntLevel}
                onChange={(e) => {
                  setHuntLevel(e.target.value)
                  setHuntAuto(false)
                  resetHuntSel()
                }}
                placeholder={t('map.huntLevel')}
                className="h-9 w-20 rounded-lg border border-line bg-bg-2 px-2.5 text-sm font-semibold outline-none transition placeholder:font-normal placeholder:text-fg-mute focus:border-accent"
              />
            </div>
            {huntAuto && character && (
              <p className="mb-2.5 truncate text-[10px] text-fg-mute">
                {t('map.huntFromChar', { name: character.name })}
              </p>
            )}

            {/* Derived-set summary: what you deal and resist. */}
            {hunt && (
              <div className="mb-2.5 rounded-xl border border-line bg-bg-2 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-fg-mute">{t('map.huntSetDeals')}:</span>
                  {hunt.set.source === 'gear' && (
                    <span className="order-last ml-auto rounded bg-accent/15 px-1.5 py-px text-[10px] font-bold text-accent">
                      {t('map.huntSetReal')}
                    </span>
                  )}
                  {hunt.set.damage_elements.map((el) => (
                    <span
                      key={el}
                      className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold"
                      style={{ background: `${HUNT_ELEMENT_COLOR[el] ?? '#8a8578'}22`, color: HUNT_ELEMENT_COLOR[el] ?? '#8a8578' }}
                    >
                      {elLabel(el)}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-fg-mute">{t('map.huntSetResists')}:</span>
                  {Object.entries(hunt.set.resists).filter(([, p]) => p > 0).length === 0 ? (
                    <span className="text-[10px] text-fg-dim">{t('map.huntSetNoResists')}</span>
                  ) : (
                    Object.entries(hunt.set.resists)
                      .filter(([, p]) => p > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([el, p]) => (
                        <span
                          key={el}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-semibold"
                          style={{ background: `${HUNT_ELEMENT_COLOR[el] ?? '#8a8578'}22`, color: HUNT_ELEMENT_COLOR[el] ?? '#8a8578' }}
                        >
                          {elLabel(el)} {p}%
                        </span>
                      ))
                  )}
                  {hunt.set.weapon && (
                    <span className="ml-auto truncate text-[10px] text-fg-dim">
                      {hunt.set.weapon}
                      {hunt.set.weapon_type ? ` (${hunt.set.weapon_type})` : ''}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Results. */}
            {!huntLevelNum || !huntVoc ? (
              <p className="py-3 text-center text-sm text-fg-mute">{t('map.huntNeedInputs')}</p>
            ) : huntQuery.isLoading ? (
              <p className="py-3 text-center text-sm text-fg-mute">{t('map.huntLoading')}</p>
            ) : !hunt || hunt.zones.length === 0 ? (
              <p className="py-3 text-center text-sm text-fg-mute">{t('map.huntNoResults')}</p>
            ) : (
              <div className="space-y-1.5">
                {hunt.zones.map((z) => {
                  const band = dangerBand(z.danger)
                  const sel = z.id === huntZoneId
                  return (
                    <div key={z.id} className={`overflow-hidden rounded-xl border ${sel ? 'border-accent' : 'border-line'} bg-bg-2`}>
                      <button onClick={() => flyToZone(z)} className="w-full px-2.5 py-2 text-left transition hover:bg-accent/5">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-sm font-black leading-none text-accent">
                            {z.match}
                          </span>
                          {/* Guide-style label: the resident names the spot, the
                              area says which one it is ("Rotworms · Edron").
                              Two lines rather than a truncated one — cutting the
                              area off is cutting off the half that locates it. */}
                          <span className="min-w-0 flex-1 text-sm font-bold leading-tight text-fg">
                            {z.name?.split(' — ')[0] ?? `${z.x}, ${z.y}`}
                            {z.name?.includes(' — ') && (
                              <span className="font-semibold text-fg-dim"> · {z.name.split(' — ')[1]}</span>
                            )}
                          </span>
                          <span className="shrink-0 rounded-md border border-line-2 px-1.5 py-0.5 text-[10px] font-bold text-fg-mute">
                            {t('map.floor')} {floorLabel(z.z)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-10 text-[11px] text-fg-dim">
                          {/* Per HOUR, and profit net of supplies — the shape
                              every hunting guide publishes, so the numbers can
                              actually be compared against one. */}
                          <span>{compact(z.exp_h)} {t('map.huntExpKill')}</span>
                          <span
                            style={z.profit_h < 0 ? { color: '#c0392b' } : undefined}
                            title={t('map.huntNetNote', { loot: fmtGold(z.loot_h), supply: fmtGold(z.supply_h) })}
                          >
                            {z.profit_h < 0 ? '−' : ''}{fmtGold(Math.abs(z.profit_h))} {t('map.huntGpKill')}
                          </span>
                          <span className="font-semibold" style={{ color: band.color }}>
                            {t(`map.${band.key}`)}
                          </span>
                          <span>{t('map.huntSpawns', { n: z.spawn_count })}</span>
                          {z.access === 'quest' && (
                            <span className="rounded border border-theory/40 px-1 py-px text-[10px] font-semibold text-theory">
                              {t('map.huntQuestAccess')}
                            </span>
                          )}
                        </div>
                      </button>
                      {sel && (
                        <div className="space-y-1.5 border-t border-line px-2.5 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">
                            {t('map.huntCreaturesHere')}
                          </div>
                          {z.creatures.map((c) => (
                            <div key={c.slug} className="flex items-center gap-2">
                              {c.image ? (
                                <img src={c.image} alt="" className="h-7 w-7 shrink-0" style={{ imageRendering: 'pixelated' }} />
                              ) : (
                                <span className="h-7 w-7 shrink-0 rounded bg-line/40" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    to={`/entry/${c.slug}`}
                                    className="truncate text-xs font-bold text-fg hover:text-accent"
                                  >
                                    {c.name}
                                  </Link>
                                  {c.too_dangerous && (
                                    <span title={t('map.huntTooDangerous')} className="shrink-0 text-[10px] font-bold text-[#c0392b]">
                                      ⚠
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  <span className="text-[10px] text-fg-mute">{t('map.huntHitWith')}:</span>
                                  {c.hit_with.map((el) => (
                                    <span
                                      key={el}
                                      className="inline-flex items-center rounded px-1 py-px text-[10px] font-semibold"
                                      style={{ background: `${HUNT_ELEMENT_COLOR[el] ?? '#8a8578'}22`, color: HUNT_ELEMENT_COLOR[el] ?? '#8a8578' }}
                                    >
                                      {elLabel(el)}
                                    </span>
                                  ))}
                                  <span className="text-[10px] text-fg-dim">
                                    · {compact(c.experience)} exp · {fmtGold(c.gold)} gp
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Community routes gallery — published routes others submitted, most
          popular (most-loaded) first; clicking one loads it onto the map. */}
      {routesOpen && (
        <div className="pointer-events-auto rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
              {t('map.routesGallery')}
            </span>
            <span className="text-xs text-fg-mute">{t('map.routesGalleryHint')}</span>
          </div>
          {/* Search — filters the published set by name or author (server-side, so
              it searches every page, not just the one on screen). */}
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-line bg-bg/50 px-2 focus-within:border-accent">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={routesQuery}
              onChange={(e) => setRoutesQuery(e.target.value)}
              placeholder={t('map.routesSearch')}
              aria-label={t('map.routesSearch')}
              className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-fg outline-none placeholder:text-fg-mute"
            />
          </div>
          {routesLoading ? (
            <p className="py-2 text-sm text-fg-mute">{t('map.routesLoading')}</p>
          ) : communityRoutes && communityRoutes.length > 0 ? (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {communityRoutes.map((r) => {
                const liked = likedRoutes.has(r.id)
                return (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-bg-2 pr-1.5 transition hover:border-accent hover:bg-accent/5"
                >
                  <button
                    onClick={() => loadCommunityRoute(r)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="19" r="2" />
                      <circle cx="18" cy="5" r="2" />
                      <path d="M8 17.5 16 6.5" strokeDasharray="2 3" />
                    </svg>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-fg">{r.name}</span>
                      <span className="block truncate text-xs text-fg-mute">
                        {t('map.buildPoints', { count: r.waypoints.length })}
                        {' · '}
                        {r.connect === 'auto' ? t('map.buildAuto') : t('map.buildStraight')}
                        {r.author ? ` · ${r.author}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-fg-dim">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {r.views}
                    </span>
                  </button>
                  {/* Like: a heart that fills red when this visitor has liked it. */}
                  <button
                    onClick={() => toggleLike(r)}
                    title={liked ? t('map.routeUnlike') : t('map.routeLike')}
                    aria-label={liked ? t('map.routeUnlike') : t('map.routeLike')}
                    aria-pressed={liked}
                    className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold tabular-nums transition ${
                      liked ? 'text-accent' : 'text-fg-mute hover:text-accent'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
                    </svg>
                    {r.likes}
                  </button>
                </div>
                )
              })}
            </div>
          ) : (
            <p className="py-2 text-sm text-fg-mute">
              {routesQueryDebounced ? t('map.routesNoResults') : t('map.routesEmpty')}
            </p>
          )}
          {/* Pager — the gallery serves one page at a time, popular first. */}
          {routesData && routesData.meta.last_page > 1 && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/70 pt-2">
              <button
                onClick={() => setRoutesPage((p) => Math.max(1, p - 1))}
                disabled={routesData.meta.current_page <= 1}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-fg-dim transition hover:border-accent/60 hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-dim"
              >
                ‹ {t('map.routesPrev')}
              </button>
              <span className="text-xs tabular-nums text-fg-mute">
                {t('map.routesPageOf', {
                  page: routesData.meta.current_page,
                  total: routesData.meta.last_page,
                })}
              </span>
              <button
                onClick={() =>
                  setRoutesPage((p) => Math.min(routesData.meta.last_page, p + 1))
                }
                disabled={routesData.meta.current_page >= routesData.meta.last_page}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-fg-dim transition hover:border-accent/60 hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-dim"
              >
                {t('map.routesNext')} ›
              </button>
            </div>
          )}
        </div>
      )}

      {/* Houses panel — houses on the chosen world (filterable by type + rent
          status) + the client-side alert list. A small, draggable window (grab
          the header) so it never gets stuck behind the nav or hotbar. Starts
          centred; `panelPos` overrides once dragged. */}
      {showHouses && housePanelOpen && (
        <div className="pointer-events-none fixed inset-0 z-[1002]">
        <div
          ref={panelRef}
          className="pointer-events-auto absolute flex max-h-[min(82vh,640px)] w-[24rem] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line bg-bg-2/95 shadow-2xl backdrop-blur-md"
          style={
            panelPos
              ? { left: panelPos.x, top: panelPos.y }
              : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
          }
        >
          <div
            onPointerDown={startPanelDrag}
            className="flex cursor-move touch-none select-none items-center justify-between gap-2 border-b border-line/70 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              {/* grip dots */}
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-fg-mute" fill="currentColor">
                <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
              </svg>
              <span className="truncate text-xs font-bold uppercase tracking-widest text-[#b3873f]">
                {t('map.houseBrowseTitle')} · {world}
              </span>
            </div>
            <button
              onClick={() => setHousePanelOpen(false)}
              className="shrink-0 text-fg-mute transition hover:text-fg"
              aria-label={t('map.close')}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Filters — rent status + name search. Both drive this list AND the
              map pins. */}
          <div className="flex flex-col gap-1.5 border-b border-line/70 px-3 py-2.5">
            {/* House vs guildhall — segmented control with live count */}
            <div className="flex gap-0.5 rounded-lg border border-line-2/60 bg-bg/40 p-0.5">
              {(['all', 'house', 'guild'] as const).map((k) => {
                const on = houseKind === k
                const col = k === 'guild' ? '#7c6cf0' : k === 'house' ? '#b3873f' : '#8a8f98'
                const n = kindCounts[k]
                return (
                  <button
                    key={k}
                    onClick={() => setHouseKind(k)}
                    aria-pressed={on}
                    className={`flex-1 rounded-md px-1 py-1.5 text-xs font-semibold transition ${
                      on ? '' : 'text-fg-dim hover:text-fg'
                    }`}
                    style={on ? { background: `${col}22`, color: col, boxShadow: `inset 0 0 0 1px ${col}66` } : undefined}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {k !== 'all' && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: col }} />
                      )}
                      <span className="truncate">
                        {k === 'all' ? t('map.houseKindAll') : k === 'house' ? t('map.houseKindHouse') : t('map.houseKindGuild')}
                      </span>
                      <span className={`shrink-0 tabular-nums ${on ? 'opacity-80' : 'text-fg-dim'}`}>{n}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {/* Rent status — segmented control with colour dot + live count */}
            <div className="flex gap-0.5 rounded-lg border border-line-2/60 bg-bg/40 p-0.5">
              {(['all', 'available', 'rented'] as const).map((s) => {
                const on = houseStatusFilter === s
                const col = s === 'available' ? '#2f9e5a' : s === 'rented' ? '#a13d3d' : '#b3873f'
                const n = statusCounts[s]
                return (
                  <button
                    key={s}
                    onClick={() => setHouseStatusFilter(s)}
                    aria-pressed={on}
                    className={`flex-1 rounded-md px-1 py-1.5 text-xs font-semibold transition ${
                      on ? '' : 'text-fg-dim hover:text-fg'
                    }`}
                    style={on ? { background: `${col}22`, color: col, boxShadow: `inset 0 0 0 1px ${col}66` } : undefined}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {s !== 'all' && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: col }} />
                      )}
                      <span className="truncate">
                        {s === 'all' ? t('map.houseStatusAll') : s === 'available' ? t('map.houseFree') : t('map.houseRented')}
                      </span>
                      <span className={`shrink-0 tabular-nums ${on ? 'opacity-80' : 'text-fg-dim'}`}>{n}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {/* Name search */}
            <div className="relative">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={houseSearch}
                onChange={(e) => setHouseSearch(e.target.value)}
                placeholder={t('map.houseSearchPlaceholder')}
                aria-label={t('map.houseSearchPlaceholder')}
                className="w-full rounded-md border border-line-2 bg-bg-2 py-1.5 pl-7 pr-6 text-xs text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
              />
              {houseSearch && (
                <button
                  onClick={() => setHouseSearch('')}
                  aria-label={t('map.close')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-mute transition hover:text-fg"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {/* City filter */}
            {houseTowns.length > 1 && (
              <select
                value={houseTownFilter}
                onChange={(e) => setHouseTownFilter(e.target.value)}
                aria-label={t('map.houseCityAll')}
                className="w-full rounded-md border border-line-2 bg-bg-2 px-2 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
              >
                <option value="">{t('map.houseCityAll')}</option>
                {houseTowns.map((tn) => (
                  <option key={tn} value={tn}>
                    {tn}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Server housing spend — total monthly rent paid across all rented
              houses on this world (respects the type filter). */}
          <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-bg/40 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-dim">
              {t('map.houseWorldRent')}
            </span>
            <span className="flex items-center gap-1 text-[13px] font-bold text-fg" title={`${worldRentTotal.gold.toLocaleString()} gp · ${worldRentTotal.count}`}>
              <img src="/sprites/crystal-coin.webp" alt="" className="h-3.5 w-3.5" style={{ imageRendering: 'pixelated' }} />
              {fmtGold(worldRentTotal.gold)}
              <span className="text-[11px] font-medium text-fg-dim">{t('map.houseGoldMonth')}</span>
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2.5">
            {/* Alerts controls */}
            <div className="mb-3 rounded-lg border border-line/70 bg-bg/40 p-2.5">
              <button
                onClick={() => setAlertsOpen((v) => !v)}
                aria-expanded={alertsOpen}
                className="flex w-full items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                <span className="truncate">{t('map.houseWatchlist')}</span>
                {watchCount > 0 && (
                  <span className="shrink-0 rounded-full bg-[#b3873f]/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#b3873f]">
                    {watchCount}
                  </span>
                )}
                <svg viewBox="0 0 24 24" className={`ml-auto h-4 w-4 shrink-0 text-fg-mute transition-transform ${alertsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {alertsOpen && (
              <div className="mt-2">
              {/* Browser-alert permission */}
              {notifPerm === 'granted' ? (
                <p className="mb-2 text-xs font-semibold text-[#2f9e5a]">{t('map.houseNotifOn')}</p>
              ) : notifPerm === 'denied' ? (
                <p className="mb-2 text-xs text-fg-dim">{t('map.houseNotifBlocked')}</p>
              ) : (
                <button
                  onClick={async () => setNotifPerm(await requestNotifyPermission())}
                  className="mb-2 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-bold text-accent transition hover:bg-accent/20"
                >
                  {t('map.houseNotifEnable')}
                </button>
              )}

              {/* Whole-world / whole-town watches */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => applyWatches(toggleWorldWatch(watches, world))}
                  className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                    isWorldWatched(watches, world)
                      ? 'border-[#b3873f] bg-[#b3873f]/15 text-[#b3873f]'
                      : 'border-line-2 text-fg-dim hover:border-line hover:text-fg'
                  }`}
                >
                  {t('map.houseWatchWorld', { world })}
                </button>
                {houseTowns.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <select
                      value={townSel}
                      onChange={(e) => setTownSel(e.target.value)}
                      className="rounded-md border border-line-2 bg-bg-2 px-1.5 py-1 text-xs text-fg"
                    >
                      <option value="">{t('map.houseWatchTown', { town: '…' })}</option>
                      {houseTowns.map((tn) => (
                        <option key={tn} value={tn}>
                          {tn}
                        </option>
                      ))}
                    </select>
                    {townSel && (
                      <button
                        onClick={() => applyWatches(toggleTownWatch(watches, world, townSel))}
                        className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                          isTownWatched(watches, world, townSel)
                            ? 'border-[#b3873f] bg-[#b3873f]/15 text-[#b3873f]'
                            : 'border-line-2 text-fg-dim hover:border-line hover:text-fg'
                        }`}
                      >
                        {isTownWatched(watches, world, townSel) ? t('map.houseUnwatch') : t('map.houseWatch')}
                      </button>
                    )}
                  </span>
                )}
              </div>

              {/* Active town watches as removable chips */}
              {watches.some((w) => w.kind === 'town' && w.world === world) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {watches
                    .filter((w): w is Extract<Watch, { kind: 'town' }> => w.kind === 'town' && w.world === world)
                    .map((w) => (
                      <button
                        key={w.town}
                        onClick={() => applyWatches(toggleTownWatch(watches, world, w.town))}
                        className="inline-flex items-center gap-1 rounded-full border border-[#b3873f]/50 bg-[#b3873f]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b3873f]"
                        title={t('map.houseUnwatch')}
                      >
                        {w.town}
                        <span className="text-[11px] leading-none">×</span>
                      </button>
                    ))}
                </div>
              )}

              {/* Watched specific houses */}
              {watchedHouses.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {watchedHouses.map((w) => {
                    const st = houseStatus?.houses[w.id]?.status
                    const full = housesRef.current.find((h) => h.id === w.id)
                    return (
                      <div key={w.id} className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => full && flyToHouse(full)}
                          className="min-w-0 flex-1 truncate text-left font-semibold text-fg transition hover:text-accent"
                        >
                          {w.name}
                          {w.town ? <span className="font-normal text-fg-dim"> · {w.town}</span> : null}
                        </button>
                        {st && (
                          <span
                            className="shrink-0 font-bold"
                            style={{ color: st === 'free' ? '#2f9e5a' : st === 'auctioned' ? '#d08a1e' : '#a13d3d' }}
                          >
                            {st === 'free' ? t('map.houseFree') : st === 'auctioned' ? t('map.houseAuctioned') : t('map.houseRented')}
                          </span>
                        )}
                        <button
                          onClick={() => applyWatches(toggleHouseWatch(watches, world, w.id, w.name, w.town))}
                          className="shrink-0 text-fg-mute transition hover:text-[#a13d3d]"
                          aria-label={t('map.houseUnwatch')}
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {watchedHouses.length === 0 &&
                !watches.some((w) => (w.kind === 'town' || w.kind === 'world') && w.world === world) && (
                  <p className="mt-1.5 text-xs leading-snug text-fg-dim">{t('map.houseWatchlistEmpty')}</p>
                )}

              <p className="mt-2 text-[11px] leading-snug text-fg-dim">{t('map.houseNotifNote')}</p>
              </div>
              )}
            </div>

            {/* Houses list (filtered) */}
            {!houseStatus ? (
              <p className="py-2 text-sm text-fg-dim">{t('map.houseAvailLoading')}</p>
            ) : panelHouses.length === 0 ? (
              <p className="py-2 text-sm text-fg-dim">{t('map.houseListNone', { world })}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {panelHouses.slice(0, HOUSE_LIST_CAP).map(({ h, status, bid }) => {
                  const watched = isHouseWatched(watches, world, h.id)
                  const stCol = status === 'free' ? '#2f9e5a' : status === 'auctioned' ? '#d08a1e' : '#a13d3d'
                  const stLabel = status === 'free' ? t('map.houseFree') : status === 'auctioned' ? t('map.houseAuctioned') : t('map.houseRented')
                  return (
                    <div key={h.id} className="rounded-lg border border-line bg-bg">
                    <div
                      className="flex items-center gap-2 px-2.5 py-1.5"
                    >
                      <button
                        onClick={() => flyToHouse(h)}
                        className="min-w-0 flex-1 text-left"
                        title={t('map.houseFlyTo')}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[15px] font-bold text-fg">{h.name}</span>
                          {freedIds.has(h.id) && (
                            <span className="shrink-0 rounded-full bg-[#2f9e5a]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#2f9e5a]">
                              {t('map.houseJustFreed')}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-fg-dim">
                          {h.town ? `${h.town} · ` : ''}
                          <span style={{ color: stCol }} className="font-semibold">
                            {stLabel}
                            {status === 'auctioned' && bid ? ` · ${fmtGold(bid)}` : ''}
                          </span>
                          {' · '}
                          {fmtGold(h.rent)} {t('map.houseGoldMonth')}
                        </span>
                      </button>
                      <button
                        onClick={() => applyWatches(toggleHouseWatch(watches, world, h.id, h.name, h.town))}
                        title={watched ? t('map.houseUnwatch') : t('map.houseWatch')}
                        aria-label={watched ? t('map.houseUnwatch') : t('map.houseWatch')}
                        className={`shrink-0 rounded-md border p-1.5 transition ${
                          watched
                            ? 'border-[#b3873f] bg-[#b3873f]/15 text-[#b3873f]'
                            : 'border-line-2 text-fg-mute hover:border-line hover:text-fg'
                        }`}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                      </button>
                      {/* Price history — open on any house: a rented one has no live
                          bid trail, but it still carries the sales behind it. */}
                      <button
                        onClick={() => setBidChartFor((v) => (v === h.id ? null : h.id))}
                        title={t('map.bidChartOpen')}
                        aria-label={t('map.bidChartOpen')}
                        aria-pressed={bidChartFor === h.id}
                        className={`shrink-0 rounded-md border p-1.5 transition ${
                          bidChartFor === h.id
                            ? 'border-[#d08a1e] bg-[#d08a1e]/15 text-[#d08a1e]'
                            : 'border-line-2 text-fg-mute hover:border-line hover:text-fg'
                        }`}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 3v18h18M7 15l4-5 3 3 5-7" />
                        </svg>
                      </button>
                    </div>
                    {bidChartFor === h.id && (
                      <div className="border-t border-line px-2 pb-1.5 pt-1">
                        <HouseBidChart world={world} houseId={h.id} />
                      </div>
                    )}
                    </div>
                  )
                })}
                {panelHouses.length > HOUSE_LIST_CAP && (
                  <p className="pt-1 text-center text-[11px] text-fg-dim">
                    {t('map.houseListCap', { shown: HOUSE_LIST_CAP, total: panelHouses.length })}
                  </p>
                )}
                {/* What houses actually sell for — the only place this exists,
                    since TibiaData wipes the bid the moment one changes hands. */}
                <HousePriceIndex world={world} />
              </div>
            )}

            {houseStatus?.synced_at && (
              <p className="mt-2 text-right text-[11px] text-fg-dim/80">
                {t('map.houseSynced', { when: new Date(houseStatus.synced_at).toLocaleString() })}
              </p>
            )}
          </div>
        </div>
        </div>
      )}

      {/* "A house opened up" toast — the client-side alert surface. */}
      {freedToast && (
        <div className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-[#2f9e5a]/50 bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-[#2f9e5a]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-fg">{t('map.houseFreedTitle')}</p>
            <p className="text-xs text-fg-dim">{freedToast}</p>
            <button
              onClick={() => {
                setFreedToast(null)
                setShowHouses(true)
                openPanel('houses')
                setHouseStatusFilter('available')
              }}
              className="mt-1 text-[11px] font-bold uppercase tracking-wider text-accent transition hover:underline"
            >
              {t('map.houseAvailPanel')}
            </button>
          </div>
          <button
            onClick={() => setFreedToast(null)}
            className="shrink-0 text-fg-mute transition hover:text-fg"
            aria-label={t('map.close')}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Item context banner — explains why a batch of creatures got plotted
          ("where does this item drop?") and clears them all in one click. */}
      {(activeItem || itemBusy) && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2.5 rounded-xl border border-interp/40 bg-bg-2/95 px-3 py-2 text-sm shadow-lg backdrop-blur-md">
          {itemBusy && !activeItem ? (
            <span className="font-semibold text-fg-dim">{t('map.itemLoading')}</span>
          ) : activeItem ? (
            <>
              {activeItem.image && (
                <img src={activeItem.image} alt="" loading="lazy" className="sprite h-8 w-8 object-contain" />
              )}
              <span className="font-bold text-fg">{activeItem.name}</span>
              <span className="text-fg-dim">
                {activeItem.total === 0
                  ? t('map.itemNoDroppers')
                  : t('map.itemDropsFrom', { count: activeItem.total })}
              </span>
              {activeItem.plotted.length > 0 && activeItem.total > activeItem.plotted.length && (
                <span className="rounded-[2px] border border-line bg-bg-2 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-fg-mute">
                  +{activeItem.total - activeItem.plotted.length} {t('map.itemMore')}
                </span>
              )}
              {(activeItem.trade?.buy.length ?? 0) > 0 && (
                <button
                  onClick={() => routeToOffer('buy', 0)}
                  title={t('map.itemBuyChipHint')}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-[#c79a3f] transition hover:border-[#c79a3f] hover:bg-[#c79a3f]/30 ${
                    tradeNav?.side === 'buy'
                      ? 'border-[#c79a3f] bg-[#c79a3f]/30'
                      : 'border-[#c79a3f]/70 bg-[#c79a3f]/15'
                  }`}
                >
                  <Icon name="pin" size={14} />
                  {t('map.itemBuyChip', { count: activeItem.trade!.buy.length })}
                </button>
              )}
              {(activeItem.trade?.sell.length ?? 0) > 0 && (
                <button
                  onClick={() => routeToOffer('sell', 0)}
                  title={t('map.itemSellChipHint')}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-[#3f7d31] transition hover:border-[#3f7d31] hover:bg-[#3f7d31]/30 ${
                    tradeNav?.side === 'sell'
                      ? 'border-[#3f7d31] bg-[#3f7d31]/30'
                      : 'border-[#3f7d31]/70 bg-[#3f7d31]/15'
                  }`}
                >
                  <Icon name="pin" size={14} />
                  {t('map.itemSellChip', { count: activeItem.trade!.sell.length })}
                </button>
              )}
              {/* Merchant pager: the chip only ever reaches the best price, so
                  ◀ 2/31 ▶ walks the rest of that side of the board, re-routing
                  to each one. */}
              {tradeNav && routableOffers(tradeNav.side).length > 0 && (() => {
                const offers = routableOffers(tradeNav.side)
                const idx = Math.min(tradeNav.i, offers.length - 1)
                const o = offers[idx]
                const tint = tradeNav.side === 'buy' ? '#c79a3f' : '#3f7d31'
                return (
                  <div
                    className="flex items-center gap-0.5 rounded-lg border bg-bg-2 p-0.5"
                    style={{ borderColor: `${tint}80` }}
                  >
                    <button
                      onClick={() => cycleOffer(-1)}
                      disabled={offers.length < 2}
                      className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t('map.tradePrev')}
                      aria-label={t('map.tradePrev')}
                    >
                      ◀
                    </button>
                    <span className="px-1 text-center leading-tight">
                      <span className="block max-w-[10rem] truncate text-xs font-bold text-fg">{o.npc}</span>
                      <span className="block text-[10px] font-semibold tabular-nums text-fg-mute">
                        {idx + 1}/{offers.length} · {o.price.toLocaleString()} {o.currency ?? t('items.gp')}
                      </span>
                    </span>
                    <button
                      onClick={() => cycleOffer(1)}
                      disabled={offers.length < 2}
                      className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t('map.tradeNext')}
                      aria-label={t('map.tradeNext')}
                    >
                      ▶
                    </button>
                  </div>
                )
              })()}
              <button
                onClick={clearItem}
                className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                ✕ {t('map.itemClear')}
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Active creature bar — right under the search so the respawn switcher
          (◀ 1/4 ▶) is immediately visible after plotting a creature. */}
      {creatures.length > 0 && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {creatures.length > creaturePageSize && (
            <div className="flex items-center gap-0.5 rounded-xl border border-line bg-bg-2 p-0.5 shadow-sm">
              <button
                onClick={() => setCreaturePage(Math.max(0, creaturePageSafe - 1))}
                disabled={creaturePageSafe === 0}
                className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                title={t('map.prevCreatures')}
                aria-label={t('map.prevCreatures')}
              >
                ◀
              </button>
              <span className="px-1 text-xs font-bold tabular-nums text-fg">
                {creaturePageSafe + 1}/{creaturePageCount}
              </span>
              <button
                onClick={() => setCreaturePage(Math.min(creaturePageCount - 1, creaturePageSafe + 1))}
                disabled={creaturePageSafe >= creaturePageCount - 1}
                className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                title={t('map.nextCreatures')}
                aria-label={t('map.nextCreatures')}
              >
                ▶
              </button>
            </div>
          )}
          {creatures
            .slice(creaturePageSafe * creaturePageSize, (creaturePageSafe + 1) * creaturePageSize)
            .map((cr) => (
            <div
              key={cr.slug}
              className="flex items-center gap-2.5 rounded-xl border-2 bg-bg-2 py-1.5 pl-2 pr-2 shadow-sm"
              style={{ borderColor: cr.color }}
            >
              {cr.image && (
                <img src={cr.image} alt="" loading="lazy" className="sprite h-8 w-8 object-contain" />
              )}
              <span className="text-sm font-bold text-fg sm:text-base">{cr.name}</span>
              <span className="text-xs font-semibold tabular-nums text-fg-mute">
                {spawnsOnFloor(cr)}/{cr.spawns.length}
              </span>
              {cr.clusters.length > 0 && (
                <button
                  onClick={() => jumpToBest(cr.slug)}
                  className="flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-1.5 text-xs font-bold text-accent transition hover:bg-accent/25"
                  title={t('map.bestSpawn')}
                >
                  <Icon name="star" size={14} />
                  <span className="tabular-nums">{cr.clusters[0].count}×</span>
                </button>
              )}
              {cr.clusters.length > 0 && (
                <div className="flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
                  <button
                    onClick={() => cycleSpawn(cr.slug, -1)}
                    disabled={cr.clusters.length < 2}
                    className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                    title={t('map.prevSpawn')}
                    aria-label={t('map.prevSpawn')}
                  >
                    ◀
                  </button>
                  <span className="px-1 text-center leading-tight" title={t('map.spawnAreas')}>
                    <span className="block text-[9px] font-bold uppercase tracking-widest text-fg-mute">
                      {t('map.respawn')}
                    </span>
                    <span className="block text-xs font-bold tabular-nums text-fg">
                      {cr.jumpIdx + 1}/{cr.clusters.length}
                    </span>
                  </span>
                  <button
                    onClick={() => cycleSpawn(cr.slug, 1)}
                    disabled={cr.clusters.length < 2}
                    className="grid h-8 w-8 place-items-center rounded-md text-sm text-fg-dim transition hover:bg-line/50 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
                    title={t('map.nextSpawn')}
                    aria-label={t('map.nextSpawn')}
                  >
                    ▶
                  </button>
                </div>
              )}
              <Link
                to={`/entry/${cr.slug}`}
                className="grid h-8 w-8 place-items-center rounded-lg text-fg-mute transition hover:bg-accent/10 hover:text-accent"
                title={t('map.viewEntry')}
                aria-label={t('map.viewEntry')}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Link>
              {cr.clusters.length > 0 && (
                <button
                  onClick={() => routeToSpawn(cr.slug)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-sm text-fg-mute transition hover:bg-accent/10 hover:text-accent"
                  title={t('map.routeToSpawn')}
                  aria-label={t('map.routeToSpawn')}
                >
                  <Icon name="compass" size={16} />
                </button>
              )}
              {/* Kill pulse — how many died yesterday / last 30 days on the
                  world selected on the map. Third sibling of the eye and the
                  compass: look at it, walk to it, or read how hunted it is. */}
              <button
                onClick={() => setKillsSlug((s) => (s === cr.slug ? null : cr.slug))}
                className={`grid h-8 w-8 place-items-center rounded-lg text-sm transition hover:bg-accent/10 hover:text-accent ${
                  killsSlug === cr.slug ? 'bg-accent/15 text-accent' : 'text-fg-mute'
                }`}
                title={t('map.killStats')}
                aria-label={t('map.killStats')}
                aria-pressed={killsSlug === cr.slug}
              >
                <Icon name="bars" size={16} />
              </button>
              <button
                onClick={() => removeCreature(cr.slug)}
                className="grid h-8 w-8 place-items-center rounded-lg text-sm text-fg-mute transition hover:bg-accent/10 hover:text-accent"
                title={t('map.delete')}
                aria-label={t('map.delete')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Kill pulse for the chip whose chart button is lit. Docked right under
          the creature bar; the header repeats the sprite/name so it still reads
          on its own when the bar has paged past that chip. */}
      {(() => {
        const cr = killsSlug ? creatures.find((c) => c.slug === killsSlug) : null
        if (!cr) return null
        return (
          <MapKillPulse
            slug={cr.slug}
            name={cr.name}
            image={cr.image}
            world={world}
            color={cr.color}
            onClose={() => setKillsSlug(null)}
          />
        )
      })()}

      {/* Directions bar — origin/destination pickers (city dropdown or map click).
          Quiet paper inset like the layer panel below, so it blends with the page
          instead of reading as a brighter plate. */}
      {routeMode && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md text-sm">
          {/* Origin */}
          <RouteCityPicker
            placeholder={t('map.routeFrom')}
            valueLabel={routeStart && isLandmark(routeStart) ? routeStart.label! : null}
            pointLabel={
              routeStart && !isLandmark(routeStart) ? routeStart.label ?? t('map.routePoint') : null
            }
            dotClass="bg-canon"
            onSelect={(name) => pickCityEndpoint('start', name)}
            onClear={() => clearRouteEndpoint('start')}
          />

          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-fg-mute" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>

          {/* Destination */}
          <RouteCityPicker
            placeholder={t('map.routeTo')}
            valueLabel={routeEnd && isLandmark(routeEnd) ? routeEnd.label! : null}
            pointLabel={
              routeEnd && !isLandmark(routeEnd) ? routeEnd.label ?? t('map.routePoint') : null
            }
            dotClass="bg-accent"
            onSelect={(name) => pickCityEndpoint('end', name)}
            onClear={() => clearRouteEndpoint('end')}
          />

          {/* Status / itinerary */}
          {routeBusy ? (
            <span className="text-fg-dim">{t('map.routeBusy')}</span>
          ) : routePlan ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-dim">
              {routePlan.totalTiles > 0 && routePlan.legs.length > 1 && (
                <span className="mr-1 rounded-[2px] border border-line bg-bg-2 px-2 py-0.5 font-bold tabular-nums text-fg">
                  {routePlan.totalTiles.toLocaleString()} {t('map.routeDist')}
                </span>
              )}
              {(() => {
                // Gear the player must bring for this route (rope / shovel legs).
                const tools = new Set(
                  routePlan.legs.flatMap((l) => (l.kind === 'stairs' && l.tool ? [l.tool] : [])),
                )
                if (tools.size === 0) return null
                const words = [
                  ...(tools.has('rope') ? [t('map.routeNeedRope')] : []),
                  ...(tools.has('shovel') ? [t('map.routeNeedShovel')] : []),
                  ...(tools.has('levitate') ? [t('map.routeNeedLevitate')] : []),
                ]
                return (
                  <span className="mr-1 rounded-[2px] border border-theory/60 bg-theory/10 px-2 py-0.5 font-semibold text-fg-dim">
                    {tools.has('rope') && <Icon name="rope" />} {tools.has('shovel') && <Icon name="pickaxe" />}{' '}
                    {t('map.routeBring', { items: words.join(' + ') })}
                  </span>
                )
              })()}
              {routePlan.legs
                .filter((leg) => leg.kind !== 'walk' || leg.tiles > 2)
                .map((leg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gold">·</span>}
                  {leg.kind === 'walk' ? (
                    <span className="flex items-center gap-1">
                      <Icon name="walk" />
                      {leg.tiles.toLocaleString()} {t('map.routeDist')}
                    </span>
                  ) : leg.kind === 'boat' ? (
                    <span className="flex items-center gap-1 font-semibold text-interp">
                      <Icon name={leg.icon} />
                      {leg.lineName === 'Barco'
                        ? t('map.routeBoatTo', { city: leg.toName })
                        : `${leg.lineName} → ${leg.toName}`}
                    </span>
                  ) : (
                    <button
                      onClick={() => setFloor(leg.toFloor)}
                      title={t('map.floor')}
                      className="flex items-center gap-1 font-semibold text-accent transition hover:text-accent-2"
                    >
                      <span aria-hidden>
                        {leg.tool === 'rope' ? <Icon name="rope" /> : leg.tool === 'shovel' ? <Icon name="pickaxe" /> : leg.tool === 'levitate' ? <Icon name="sparkles" /> : leg.dir === 'down' ? '▼' : leg.dir === 'up' ? '▲' : '⇄'}
                      </span>
                      {leg.tool === 'rope'
                        ? t('map.routeRope', { floor: floorLabel(leg.toFloor) })
                        : leg.tool === 'shovel'
                          ? t('map.routeShovel', { floor: floorLabel(leg.toFloor) })
                          : leg.tool === 'levitate'
                            ? t('map.routeLevitate', { floor: floorLabel(leg.toFloor) })
                            : leg.dir === 'teleport'
                              ? t('map.routeTeleport', { floor: floorLabel(leg.toFloor) })
                              : t('map.routeStairs', { floor: floorLabel(leg.toFloor) })}
                    </button>
                  )}
                </span>
              ))}
            </span>
          ) : !routeStart || !routeEnd ? (
            <span className="text-fg-dim">{t('map.routeHintStart')}</span>
          ) : null}
          {routeMsg && <span className="font-semibold text-accent">{routeMsg}</span>}

          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Report a wrong route: available once both endpoints are set (a bad
                route, a partial trail or a "no route" are all worth flagging). The
                submission lands in the DB for a routing fix pass. */}
            {routeStart && routeEnd && (
              reportState === 'done' ? (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-canon">
                  <Icon name="check" size={15} />
                  {t('map.routeReportThanks')}
                </span>
              ) : reportState === 'editing' || reportState === 'sending' ? (
                <span className="flex items-center gap-1.5">
                  <input
                    value={reportNote}
                    onChange={(ev) => setReportNote(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') submitRouteReport()
                      else if (ev.key === 'Escape') setReportState('idle')
                    }}
                    autoFocus
                    maxLength={2000}
                    placeholder={t('map.routeReportPlaceholder')}
                    className="h-8 w-52 rounded-lg border border-line bg-bg-2 px-2.5 text-sm text-fg outline-none transition placeholder:text-fg-mute hover:border-line-2 focus:border-accent"
                  />
                  <button
                    onClick={submitRouteReport}
                    disabled={reportState === 'sending'}
                    className="rounded-lg border border-accent bg-accent px-2.5 py-1.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {reportState === 'sending' ? t('map.routeReportSending') : t('map.routeReportSend')}
                  </button>
                  <button
                    onClick={() => setReportState('idle')}
                    className="text-sm font-bold text-fg-mute transition hover:text-fg"
                    aria-label={t('map.routeReportCancel')}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setReportState('editing')}
                  title={t('map.routeReportHint')}
                  className="flex items-center gap-1.5 text-sm font-semibold text-fg-mute transition hover:text-accent"
                >
                  <Icon name="flag" size={15} />
                  {reportState === 'error' ? t('map.routeReportError') : t('map.routeReport')}
                </button>
              )
            )}

            {(routeStart || routeEnd || routePlan) && (
              <button
                onClick={resetRoute}
                className="text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                ✕ {t('map.routeClear')}
              </button>
            )}

            {/* Dismiss the whole directions bar (works even with no route yet). */}
            <button
              onClick={closeRoute}
              title={t('map.routeClose')}
              aria-label={t('map.routeClose')}
              className="grid h-7 w-7 place-items-center rounded-md text-base leading-none text-fg-mute transition hover:bg-bg hover:text-accent"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Route builder bar — name, connection style, and the point count / actions.
          Clicking the map appends ordered waypoints. */}
      {buildMode && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-bg-2/95 px-3 py-2.5 shadow-lg backdrop-blur-md text-sm">
          <input
            value={buildName}
            onChange={(e) => setBuildName(e.target.value)}
            placeholder={t('map.buildNamePlaceholder')}
            className="h-9 min-w-[160px] flex-1 rounded-lg border border-line bg-bg-2 px-3 text-sm font-semibold text-fg outline-none transition placeholder:font-medium placeholder:text-fg-mute hover:border-line-2 focus:border-accent"
          />

          {/* Connection style: auto-route between points, or straight lines */}
          <div className="inline-flex shrink-0 rounded-lg border border-line bg-bg p-1">
            {(
              [
                { key: 'auto', label: t('map.buildAuto') },
                { key: 'straight', label: t('map.buildStraight') },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => setBuildConnect(m.key)}
                className={`rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider transition ${
                  buildConnect === m.key ? 'bg-accent text-white' : 'text-fg-mute hover:text-fg'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <span className="flex items-center gap-2 text-fg-dim">
            {buildBusy ? t('map.buildBusy') : t('map.buildPoints', { count: buildPoints.length })}
            {buildPlan && buildPlan.totalTiles > 0 && !buildBusy && (
              <span className="rounded-[2px] border border-line bg-bg-2 px-2 py-0.5 font-bold tabular-nums text-fg">
                {buildPlan.totalTiles.toLocaleString()} {t('map.routeDist')}
              </span>
            )}
          </span>

          {buildPoints.length > 0 ? (
            <>
              <button
                onClick={publishRoute}
                disabled={!buildName.trim() || publishState === 'sending' || publishState === 'done'}
                title={!buildName.trim() ? t('map.buildPublishNeedName') : t('map.buildPublish')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  publishState === 'done'
                    ? 'bg-canon/15 text-canon'
                    : publishState === 'error'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-accent text-white hover:bg-accent-2'
                }`}
              >
                {publishState === 'sending'
                  ? t('map.buildPublishing')
                  : publishState === 'done'
                    ? `✓ ${t('map.buildPublished')}`
                    : publishState === 'error'
                      ? t('map.buildPublishError')
                      : t('map.buildPublish')}
              </button>
              <button
                onClick={undoBuildPoint}
                className="text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-fg"
              >
                ↶ {t('map.buildUndo')}
              </button>
              <button
                onClick={share}
                className="text-xs font-bold uppercase tracking-wider text-accent transition hover:text-accent-2"
              >
                {copied ? t('map.copied') : t('map.share')}
              </button>
              <button
                onClick={clearBuild}
                className="ml-auto text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                ✕ {t('map.buildClear')}
              </button>
            </>
          ) : (
            <span className="ml-auto text-fg-mute">{t('map.buildHint')}</span>
          )}
        </div>
      )}

        </div>
      </div>

      <p className="pointer-events-none absolute bottom-2 right-2 z-[1000] max-w-[42vw] text-right text-[10px] leading-tight text-fg-mute/70">
        {t('map.disclaimer')}
      </p>

      {/* New-marker naming modal (replaces the old window.prompt) */}
      {markerDraft && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setMarkerDraft(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-bg-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-black tracking-tight text-fg">
              {t('map.markerModalTitle')}
            </h3>
            <p className="mt-1 font-mono text-xs tabular-nums text-fg-mute">
              {markerDraft.x}, {markerDraft.y}, z{markerDraft.floor}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                addMarkerRef.current({
                  id: crypto.randomUUID(),
                  x: markerDraft.x,
                  y: markerDraft.y,
                  floor: markerDraft.floor,
                  label: draftLabel.trim(),
                })
                setMarkerDraft(null)
              }}
            >
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setMarkerDraft(null)
                }}
                placeholder={t('map.markerPrompt')}
                className="mt-3 h-11 w-full rounded-lg border-2 border-line bg-bg px-3 text-sm font-semibold text-fg outline-none transition placeholder:font-medium placeholder:text-fg-mute focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMarkerDraft(null)}
                  className="h-10 rounded-lg border border-line bg-bg-2 px-4 text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg"
                >
                  {t('map.markerCancel')}
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-lg bg-accent px-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-2"
                >
                  {t('map.markerSave')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* "You've been outbid" — a real modal, opened by the check itself (on
          load and on every refresh) so the user never has to go looking in the
          news rail for the one alert that's time-critical. */}
      {outbidToast && (
        <div
          className="fixed inset-0 z-[1400] grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onClick={() => setOutbidToast(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border-2 border-[#c94f4f] bg-bg-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-[#c94f4f]/40 bg-[#c94f4f]/15 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c94f4f]/20 text-[#c94f4f]">
                <Icon name="gavel" size={20} />
              </span>
              <p className="min-w-0 flex-1 text-[15px] font-bold leading-tight text-fg">
                {t('map.houseOutbidTitle')}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[15px] font-bold text-fg">{outbidToast.name}</p>
              <p className="mt-0.5 text-xs text-fg-dim">
                {(housesRef.current.find((h) => h.id === outbidToast.id)?.town ?? '') || world}
              </p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-[#d08a1e]">
                  {fmtGold(outbidToast.bid)}
                </span>
                {outbidToast.bidder && (
                  <span className="min-w-0 truncate text-sm text-fg-dim">· {outbidToast.bidder}</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button
                onClick={() => {
                  const h = housesRef.current.find((x) => x.id === outbidToast.id)
                  setOutbidToast(null)
                  if (h) {
                    if (!showHouses) setShowHouses(true)
                    flyToHouse(h)
                  }
                }}
                className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-accent-2"
              >
                {t('map.houseFlyTo')}
              </button>
              <button
                onClick={() => setOutbidToast(null)}
                className="rounded-lg border border-line-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-fg-dim transition hover:border-line hover:text-fg"
              >
                {t('map.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guided how-to — auto-opens on a first visit, reopenable from the "?" slot */}
      {/* The site manual, opened on the map's own chapter. */}
      <SiteGuide open={showTour} chapter="map" onClose={() => setShowTour(false)} />
    </div>
  )
}

/** Local debounce (kept here to avoid an extra import path). */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
