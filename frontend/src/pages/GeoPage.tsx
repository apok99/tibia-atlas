import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Seo } from '../lib/seo'
import { TILE, toLatLng, ZONES, type Place } from '../lib/zones'

type Status = 'playing' | 'won' | 'lost'
interface SavedGame {
  answer: string // target zone name
  guess: string | null // the name the player picked (null if they never guessed)
  solved: boolean
}

// Zoom the map sits at while veiled (native tile is zoom 0 = 1px/tile; zoom 2 =
// 4px/tile), tight enough that the lit patch is a real challenge. On reveal it
// pulls back to REVEAL_ZOOM so the answer's place in the world reads at a glance.
const PLAY_ZOOM = 2
const REVEAL_ZOOM = 0

// Per-mote layout + timing for the rising particles around the spotlight. Built
// once so the swarm stays stable across renders; negative delays start it
// mid-flight. Mirrors the Bestiary Altar's motes for a shared house style.
const MOTES = Array.from({ length: 16 }, () => ({
  x: `${8 + Math.random() * 84}%`,
  size: `${3 + Math.random() * 4}px`,
  dur: `${3.5 + Math.random() * 3}s`,
  delay: `${-Math.random() * 6}s`,
  drift: `${(Math.random() - 0.5) * 44}px`,
  peak: (0.5 + Math.random() * 0.45).toFixed(2),
}))

// Tibia's daily server save is 10:00 Europe/Berlin (CET/CEST). The daily zone flips
// then — not at UTC midnight — so the puzzle changes with the game's own daily reset
// and is the same for every player regardless of local timezone.
const SERVER_SAVE_HOUR = 10
const SERVER_TZ = 'Europe/Berlin'

// Berlin wall-clock components for a given instant (handles DST via Intl).
function berlinParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SERVER_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return { y: get('year'), mo: get('month'), da: get('day'), h: get('hour'), mi: get('minute'), s: get('second') }
}

// Offset (ms) of Berlin from UTC at the given instant: +1h (CET) or +2h (CEST).
function berlinOffsetMs(d: Date): number {
  const b = berlinParts(d)
  return Date.UTC(b.y, b.mo - 1, b.da, b.h, b.mi, b.s) - d.getTime()
}

// Real UTC instant for a Berlin wall-clock date at the server-save hour. Refines the
// offset once so the result is correct even across a CET/CEST transition.
function serverSaveInstant(y: number, mo: number, da: number): number {
  const naive = Date.UTC(y, mo - 1, da, SERVER_SAVE_HOUR, 0, 0)
  let inst = naive - berlinOffsetMs(new Date(naive))
  inst = naive - berlinOffsetMs(new Date(inst))
  return inst
}

// The puzzle's date key: the Berlin calendar date whose 10:00 server save opened the
// currently-active puzzle. Before 10:00 Berlin we're still on the previous day's zone.
function serverSaveDateKey(d = new Date()): string {
  const b = berlinParts(d)
  // Subtract the server-save hour from the wall clock, then read the date. This lands
  // on the previous calendar day whenever it's before 10:00 Berlin.
  const shifted = new Date(Date.UTC(b.y, b.mo - 1, b.da, b.h - SERVER_SAVE_HOUR, b.mi, b.s))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`
}

// FNV-1a string hash → a stable 32-bit number, used to seed the daily pick.
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// The zone everyone guesses today: a deterministic index into the shared pool.
function zoneForDate(date: string): Place {
  return ZONES[hashStr(`geo:${date}`) % ZONES.length]
}

// A labelled map pin (correct answer = accent, wrong guess = muted red).
function pinIcon(label: string, kind: 'correct' | 'guess'): L.DivIcon {
  const esc = label.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return L.divIcon({
    className: '',
    html: `<div class="geo-pin geo-pin-${kind}"><span class="geo-pin-dot"></span><span class="geo-pin-label">${esc}</span></div>`,
    iconSize: [0, 0],
  })
}

export function GeoPage() {
  const { t } = useTranslation()
  const date = useMemo(() => serverSaveDateKey(), [])
  const target = useMemo(() => zoneForDate(date), [date])
  const storageKey = `geo:v1:${date}`

  const [status, setStatus] = useState<Status>('playing')
  const [guessZone, setGuessZone] = useState<Place | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Place | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const revealLayerRef = useRef<L.LayerGroup | null>(null)

  // Rehydrate today's result — this game is one-and-done per day.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const g = JSON.parse(saved) as SavedGame
        setStatus(g.solved ? 'won' : 'lost')
        setGuessZone(g.guess ? ZONES.find((z) => z.name === g.guess) ?? null : null)
        return
      }
    } catch {
      /* corrupt save — start fresh */
    }
    setStatus('playing')
    setGuessZone(null)
  }, [storageKey])

  // Build the locked minimap centred on today's zone. Rebuilt only if the target
  // changes (i.e. a new day while the tab is open).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const map = L.map(el, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      minZoom: -5,
      maxZoom: 6,
      zoomSnap: 0.25,
    })

    const TibiaTiles = L.GridLayer.extend({
      createTile(coords: { x: number; y: number }) {
        const img = document.createElement('img')
        img.alt = ''
        img.style.imageRendering = 'pixelated'
        img.onerror = () => {
          img.style.visibility = 'hidden'
        }
        img.src = `/minimap/Minimap_Color_${coords.x * TILE}_${coords.y * TILE}_${target.floor}.png`
        return img
      },
    })
    new (TibiaTiles as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
      tileSize: TILE,
      minNativeZoom: 0,
      maxNativeZoom: 0,
      minZoom: -5,
      maxZoom: 6,
      noWrap: true,
    }).addTo(map)

    map.setView(toLatLng(target.x, target.y), PLAY_ZOOM)
    // Lock every interaction while veiled — panning/zooming would let players
    // scout the coastline for the answer.
    map.dragging.disable()
    map.scrollWheelZoom.disable()
    map.doubleClickZoom.disable()
    map.boxZoom.disable()
    map.keyboard.disable()
    map.touchZoom.disable()

    mapRef.current = map
    revealLayerRef.current = L.layerGroup().addTo(map)
    // The container is often laid out after the map initialises; nudge Leaflet to
    // remeasure so tiles fill it.
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      revealLayerRef.current = null
    }
  }, [target])

  // On reveal (win or loss): drop the veil, unlock the map, pin the answer (plus
  // the player's guess and the gap between them on a miss), and pull the camera
  // back so the zone's place in the world is clear.
  useEffect(() => {
    const map = mapRef.current
    const grp = revealLayerRef.current
    if (!map || !grp || status === 'playing') return

    map.dragging.enable()
    map.scrollWheelZoom.enable()
    map.doubleClickZoom.enable()
    map.touchZoom.enable()
    map.keyboard.enable()

    grp.clearLayers()
    L.marker(toLatLng(target.x, target.y), { icon: pinIcon(target.name, 'correct') }).addTo(grp)

    if (status === 'lost' && guessZone && guessZone.name !== target.name) {
      L.marker(toLatLng(guessZone.x, guessZone.y), { icon: pinIcon(guessZone.name, 'guess') }).addTo(grp)
      L.polyline([toLatLng(guessZone.x, guessZone.y), toLatLng(target.x, target.y)], {
        color: '#d23d2f',
        weight: 2,
        opacity: 0.8,
        dashArray: '6 8',
      }).addTo(grp)
      map.fitBounds(
        L.latLngBounds([toLatLng(guessZone.x, guessZone.y), toLatLng(target.x, target.y)]).pad(0.45),
        { maxZoom: 3, animate: true },
      )
    } else {
      map.setView(toLatLng(target.x, target.y), REVEAL_ZOOM, { animate: true })
    }
  }, [status, target, guessZone])

  // Close the suggestion dropdown on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 1800)
  }, [])

  // Up to 8 name matches for the current query.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return ZONES.filter((z) => z.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query])

  const pick = useCallback((z: Place) => {
    setSelected(z)
    setQuery(z.name)
    setOpen(false)
  }, [])

  const submit = useCallback(() => {
    if (busy || status !== 'playing') return
    const q = query.trim().toLowerCase()
    const guess = selected ?? ZONES.find((z) => z.name.toLowerCase() === q) ?? null
    if (!guess) {
      flash(t('geo.pickOne'))
      return
    }
    setBusy(true)
    const solved = guess.name === target.name
    setGuessZone(guess)
    setStatus(solved ? 'won' : 'lost')
    setOpen(false)
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ answer: target.name, guess: guess.name, solved } satisfies SavedGame),
      )
    } catch {
      /* ignore quota / private-mode failures */
    }
    setBusy(false)
  }, [busy, status, query, selected, target, storageKey, flash, t])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && matches[highlight]) pick(matches[highlight])
      else submit()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const finished = status !== 'playing'
  // Chebyshev distance in tiles (sqm) — how far the guess sat from the answer.
  const missTiles =
    guessZone && status === 'lost'
      ? Math.round(Math.hypot(guessZone.x - target.x, guessZone.y - target.y))
      : 0
  const mapHash = `#x=${target.x}&y=${target.y}&z=3&f=${target.floor}`

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center">
      <Seo title={t('geo.brand')} description={t('geo.subtitle')} path="/geo" />

      <header className="mb-5 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.25em] text-accent">{t('geo.kicker')}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{t('geo.title')}</h1>
        <p className="mt-2 text-sm text-fg-mute">{t('geo.subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-line px-3 py-1 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('geo.oneShot')}
          </span>
        </div>
      </header>

      {/* The spotlight map */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-black shadow-lg">
        {/* Inline bg (not a class) so it beats Leaflet's default grey — empty
            ocean then reads as water, matching the main map. */}
        <div ref={containerRef} className="h-[58vh] min-h-[360px] w-full" style={{ background: '#336699' }} />
        {/* Dark veil with a lit circle over the mystery zone. */}
        <div
          className="geo-veil"
          data-hidden={finished ? 'true' : 'false'}
          aria-hidden="true"
        />
        {/* Rising motes, only while the zone is veiled. */}
        {!finished && (
          <div className="altar-particles" style={{ '--mote-color': 'rgb(196 167 240)', '--mote-glow': 'rgba(196, 167, 240, 0.75)' } as React.CSSProperties} aria-hidden="true">
            {MOTES.map((m, i) => (
              <span
                key={i}
                className="altar-mote"
                style={{ '--x': m.x, '--size': m.size, '--dur': m.dur, '--delay': m.delay, '--drift': m.drift, '--peak': m.peak } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>

      {/* Guess box */}
      {!finished && (
        <div ref={boxRef} className="relative mt-6 w-full max-w-md">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
                setOpen(true)
                setHighlight(0)
              }}
              onFocus={() => query && setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={t('geo.placeholder')}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !query.trim()}
              className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {t('geo.guess')}
            </button>
          </div>

          {open && matches.length > 0 && (
            <ul className="absolute z-[500] mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
              {matches.map((z, i) => (
                <li key={z.name}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(z)}
                    className={`block w-full px-4 py-2 text-left text-sm ${
                      i === highlight ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-line/40'
                    }`}
                  >
                    {z.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Toast */}
      <div className="mt-3 h-5 text-center text-sm font-semibold text-fg">{toast ?? ''}</div>

      {!finished && (
        <p className="mt-1 max-w-md text-center text-xs text-fg-mute">{t('geo.howTo')}</p>
      )}

      {/* End-of-game panel */}
      {finished && (
        <ResultPanel
          status={status}
          target={target}
          date={date}
          missTiles={missTiles}
          mapHash={mapHash}
        />
      )}
    </div>
  )
}

function ResultPanel({
  status,
  target,
  date,
  missTiles,
  mapHash,
}: {
  status: Status
  target: Place
  date: string
  missTiles: number
  mapHash: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const countdown = useCountdown()

  const share = () => {
    const mark = status === 'won' ? '🟩' : '🟥'
    const header = `${t('geo.brand')} ${date}`
    const url = `${window.location.origin}/geo`
    const text = `${header}\n${mark} ${t(status === 'won' ? 'geo.shareWon' : 'geo.shareLost')}\n${url}`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="mt-2 w-full max-w-md rounded-xl border border-line bg-surface p-5 text-center">
      <p className={`text-lg font-black ${status === 'won' ? 'text-emerald-500' : 'text-accent'}`}>
        {t(status === 'won' ? 'geo.won' : 'geo.lost')}
      </p>

      <div className="mt-3 flex flex-col items-center gap-1">
        <p className="text-xs uppercase tracking-widest text-fg-mute">{t('geo.answerWas')}</p>
        <span className="text-xl font-black text-accent">{target.name}</span>
        {status === 'lost' && missTiles > 0 && (
          <p className="mt-1 text-xs text-fg-mute">{t('geo.missBy', { n: missTiles })}</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={share}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
        >
          {copied ? t('geo.copied') : t('geo.share')}
        </button>
        <Link
          to={`/map${mapHash}`}
          className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-fg transition hover:border-line-2"
        >
          {t('geo.viewOnMap')}
        </Link>
      </div>

      <p className="mt-4 text-xs text-fg-mute">
        {t('geo.nextIn')} <span className="font-mono font-bold text-fg">{countdown}</span>
      </p>
    </div>
  )
}

/** HH:MM:SS until the next server save (10:00 Berlin); reloads the page at zero. */
function useCountdown(): string {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const now = new Date()
  const b = berlinParts(now)
  // Next server save: today's 10:00 Berlin if we haven't reached it yet, else tomorrow's.
  const rollover = b.h >= SERVER_SAVE_HOUR ? new Date(Date.UTC(b.y, b.mo - 1, b.da + 1)) : null
  const next = rollover
    ? serverSaveInstant(rollover.getUTCFullYear(), rollover.getUTCMonth() + 1, rollover.getUTCDate())
    : serverSaveInstant(b.y, b.mo, b.da)
  const ms = next - now.getTime()
  if (ms <= 0) {
    window.setTimeout(() => window.location.reload(), 500)
    return '00:00:00'
  }
  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
