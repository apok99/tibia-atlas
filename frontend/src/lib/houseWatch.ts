// Client-side house watchlist + "just freed" detection for the map's houses
// layer. Deliberately server-free: watches and the last-seen status snapshot
// live in localStorage, and transitions (rented → available) are diffed on the
// client against the twice-daily /api/houses snapshot. The only "notification"
// channel is the browser Notification API (no VAPID/push server), so OS alerts
// only fire while a tab is open; on a later visit the diff still surfaces what
// freed while away, shown as an in-app toast.

export type HouseLiveStatus = 'rented' | 'auctioned' | 'free'

// A house counts as "available" (worth alerting on) when it's free or on
// auction — i.e. anyone can bid. Rented houses are taken.
export const isAvailable = (s: HouseLiveStatus | undefined | null): boolean =>
  s === 'free' || s === 'auctioned'

// One watch entry. Scopes, widest → narrowest:
//   world — any house that frees up on this world
//   town  — any house that frees up in this town on this world
//   house — one specific house on this world
export type Watch =
  | { kind: 'world'; world: string }
  | { kind: 'town'; world: string; town: string }
  | { kind: 'house'; world: string; id: number; name: string; town: string | null }

const WATCH_KEY = 'tibia:house-watches'
const SEEN_PREFIX = 'tibia:house-seen:' // + world

// ---- watchlist persistence -------------------------------------------------

export function loadWatches(): Watch[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Watch[]) : []
  } catch {
    return []
  }
}

export function saveWatches(watches: Watch[]): void {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(watches))
  } catch {
    /* storage full / disabled — watches just won't persist */
  }
}

export function isHouseWatched(watches: Watch[], world: string, id: number): boolean {
  return watches.some((w) => w.kind === 'house' && w.world === world && w.id === id)
}

export function isTownWatched(watches: Watch[], world: string, town: string): boolean {
  return watches.some((w) => w.kind === 'town' && w.world === world && w.town === town)
}

export function isWorldWatched(watches: Watch[], world: string): boolean {
  return watches.some((w) => w.kind === 'world' && w.world === world)
}

// Whether a given house is covered by ANY active watch (its own id, its town,
// or a whole-world watch).
export function houseCovered(
  watches: Watch[],
  world: string,
  id: number,
  town: string | null,
): boolean {
  return watches.some((w) => {
    if (w.world !== world) return false
    if (w.kind === 'world') return true
    if (w.kind === 'town') return town != null && w.town === town
    return w.kind === 'house' && w.id === id
  })
}

// Toggle helpers return a NEW array (immutable-friendly for React state).
export function toggleHouseWatch(
  watches: Watch[],
  world: string,
  id: number,
  name: string,
  town: string | null,
): Watch[] {
  return isHouseWatched(watches, world, id)
    ? watches.filter((w) => !(w.kind === 'house' && w.world === world && w.id === id))
    : [...watches, { kind: 'house', world, id, name, town }]
}

export function toggleTownWatch(watches: Watch[], world: string, town: string): Watch[] {
  return isTownWatched(watches, world, town)
    ? watches.filter((w) => !(w.kind === 'town' && w.world === world && w.town === town))
    : [...watches, { kind: 'town', world, town }]
}

export function toggleWorldWatch(watches: Watch[], world: string): Watch[] {
  return isWorldWatched(watches, world)
    ? watches.filter((w) => !(w.kind === 'world' && w.world === world))
    : [...watches, { kind: 'world', world }]
}

// ---- last-seen snapshot + freed diff ---------------------------------------

export type StatusMap = Record<number, HouseLiveStatus>

// Returns null when we've never stored a snapshot for this world (so the first
// load doesn't report every currently-available house as "just freed").
export function loadSeen(world: string): StatusMap | null {
  try {
    const raw = localStorage.getItem(SEEN_PREFIX + world)
    if (!raw) return null
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? (obj as StatusMap) : null
  } catch {
    return null
  }
}

export function saveSeen(world: string, statuses: StatusMap): void {
  try {
    localStorage.setItem(SEEN_PREFIX + world, JSON.stringify(statuses))
  } catch {
    /* ignore */
  }
}

// Flatten the /api/houses payload to a plain id → status map for storage/diff.
export function toStatusMap(
  houses: Record<number, { status: HouseLiveStatus }>,
): StatusMap {
  const out: StatusMap = {}
  for (const [id, v] of Object.entries(houses)) out[Number(id)] = v.status
  return out
}

// House ids that transitioned from rented (taken) to available (free/auction)
// between two snapshots AND are covered by a watch. `prev === null` (first ever
// snapshot for the world) yields no hits by design.
export function diffFreed(
  prev: StatusMap | null,
  curr: StatusMap,
  watches: Watch[],
  world: string,
  townOf: (id: number) => string | null,
): number[] {
  if (!prev) return []
  const freed: number[] = []
  for (const [idStr, status] of Object.entries(curr)) {
    const id = Number(idStr)
    const before = prev[id]
    // A real "it opened up" event: was taken, now anyone can bid.
    if (before === 'rented' && isAvailable(status) && houseCovered(watches, world, id, townOf(id))) {
      freed.push(id)
    }
  }
  return freed
}

// ---- auction outbid watch ---------------------------------------------------
// Last-seen bid per BELLED (house-kind watch) auctioned house, so a later
// per-house lookup can tell "someone raised the bid" — and, when the stored
// bidder is the user's own configured character, "you've been outbid". Fully
// client-side like the freed diff above; the resulting alerts are local news
// entries merged into the map's news rail.

export type BidSeen = Record<number, { bid: number; bidder: string | null }>

const BID_SEEN_PREFIX = 'tibia:house-bid-seen:' // + world

export function loadBidSeen(world: string): BidSeen {
  try {
    const raw = localStorage.getItem(BID_SEEN_PREFIX + world)
    const obj = raw ? JSON.parse(raw) : null
    return obj && typeof obj === 'object' ? (obj as BidSeen) : {}
  } catch {
    return {}
  }
}

export function saveBidSeen(world: string, seen: BidSeen): void {
  try {
    localStorage.setItem(BID_SEEN_PREFIX + world, JSON.stringify(seen))
  } catch {
    /* ignore */
  }
}

// A locally-generated news entry (new bid / outbid on a belled auction).
// Persisted per world so it survives a reload; the shape mirrors the server's
// world events so the news rail can render both interchangeably. Local ids are
// negative — server ids are positive, so the two can never collide as keys.
export type LocalBidEvent = {
  id: number
  type: 'house_bid' | 'house_outbid'
  ref_id: number
  title: string | null
  town: string | null
  meta: { bid?: number; bidder?: string | null }
  occurred_at: string
}

const BID_EVENTS_PREFIX = 'tibia:house-bid-events:' // + world
const BID_EVENTS_MAX = 20

export function loadBidEvents(world: string): LocalBidEvent[] {
  try {
    const raw = localStorage.getItem(BID_EVENTS_PREFIX + world)
    const arr = raw ? JSON.parse(raw) : null
    if (!Array.isArray(arr)) return []
    // Match the server feed's 30-day horizon so old alerts age out.
    const cutoff = Date.now() - 30 * 86400_000
    return (arr as LocalBidEvent[]).filter((e) => new Date(e.occurred_at).getTime() >= cutoff)
  } catch {
    return []
  }
}

export function saveBidEvents(world: string, events: LocalBidEvent[]): void {
  try {
    localStorage.setItem(BID_EVENTS_PREFIX + world, JSON.stringify(events.slice(0, BID_EVENTS_MAX)))
  } catch {
    /* ignore */
  }
}

// ---- browser Notification API (no push server, no keys) --------------------

export function notifyPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'denied' : Notification.permission
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

// Fire an OS notification if (and only if) the user granted permission. A no-op
// otherwise — the in-app toast is the always-on fallback.
export function osNotify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // eslint-disable-next-line no-new
      new Notification(title, { body, tag: 'tibia-house-freed', icon: '/favicon.ico' })
    }
  } catch {
    /* some browsers throw if constructed without a SW in certain contexts */
  }
}
