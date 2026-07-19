import { useEffect, useState } from 'react'

/**
 * Rashid, the travelling merchant: where he is today.
 *
 * He moves to a fixed city each day of the week, switching at the 10:00
 * Europe/Berlin server save — before 10:00 Berlin time he is still in
 * *yesterday's* city. All time math runs in the Europe/Berlin zone via
 * Intl.DateTimeFormat so the answer is correct in any visitor locale.
 * Shared by RashidPage (the answer page) and MapPage (the map marker).
 * The rotation is mirrored in PrerenderController::rashid() — edit both.
 */

export interface RashidStop {
  city: string
  spot: { es: string; en: string }
  /** In-game map coordinates of his exact standing spot (from OT data). */
  x: number
  y: number
  z: number
}

/** Rashid's rotation, indexed by JS weekday (0 = Sunday … 6 = Saturday). */
export const RASHID_ROTATION: RashidStop[] = [
  {
    city: 'Carlin',
    spot: { es: 'en el depot, un piso arriba', en: 'in the depot, one floor up' },
    x: 32328,
    y: 31782,
    z: 6,
  },
  {
    city: 'Svargrond',
    spot: {
      es: 'en el bar del edificio más al norte (el cuartel del Baltic Trader)',
      en: 'in the bar of the northern-most building (the Baltic Trader HQ)',
    },
    x: 32207,
    y: 31155,
    z: 7,
  },
  {
    city: 'Liberty Bay',
    spot: { es: 'en la taberna al oeste del depot', en: 'in the tavern west of the depot' },
    x: 32300,
    y: 32837,
    z: 7,
  },
  {
    city: 'Port Hope',
    spot: { es: 'en la taberna de Clyde, cerca del barco', en: "in Clyde's tavern, near the ship" },
    x: 32577,
    y: 32753,
    z: 7,
  },
  {
    city: 'Ankrahmun',
    spot: { es: 'en la taberna cerca del barco', en: 'in the tavern near the ship' },
    x: 33066,
    y: 32879,
    z: 6,
  },
  {
    city: 'Darashia',
    spot: { es: 'en la taberna de Miraia', en: "in Miraia's tavern" },
    x: 33235,
    y: 32483,
    z: 7,
  },
  {
    city: 'Edron',
    spot: { es: 'en la taberna de Mirabell, encima del depot', en: "in Mirabell's tavern, above the depot" },
    x: 33166,
    y: 31810,
    z: 6,
  },
]

/** Server save happens at 10:00 Europe/Berlin — seconds into the day. */
export const SAVE_SECONDS = 10 * 3600

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Formatter yielding Berlin wall-clock weekday + time regardless of locale. */
const BERLIN_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
})

export interface BerlinNow {
  /** JS-style weekday in Berlin: 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** Seconds elapsed since Berlin midnight. */
  secondsIntoDay: number
}

export function berlinNow(): BerlinNow {
  let weekday = 0
  let h = 0
  let m = 0
  let s = 0
  for (const part of BERLIN_FMT.formatToParts(new Date())) {
    if (part.type === 'weekday') weekday = Math.max(0, WEEKDAY_KEYS.indexOf(part.value))
    else if (part.type === 'hour') h = Number(part.value) % 24
    else if (part.type === 'minute') m = Number(part.value)
    else if (part.type === 'second') s = Number(part.value)
  }
  return { weekday, secondsIntoDay: h * 3600 + m * 60 + s }
}

/** Weekday (0 = Sunday) whose city Rashid is in right now, server-save aware. */
export function rashidEffectiveDay(now: BerlinNow = berlinNow()): number {
  return now.secondsIntoDay < SAVE_SECONDS ? (now.weekday + 6) % 7 : now.weekday
}

/** Where Rashid stands right now. */
export function rashidToday(): RashidStop {
  return RASHID_ROTATION[rashidEffectiveDay()]
}

/**
 * Ticks once a second and applies the server-save rule: before 10:00 Berlin
 * time Rashid is still in yesterday's city.
 */
export function useRashidClock(): { effectiveDay: number; secondsToSave: number } {
  const [now, setNow] = useState<BerlinNow>(berlinNow)
  useEffect(() => {
    const id = window.setInterval(() => setNow(berlinNow()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const beforeSave = now.secondsIntoDay < SAVE_SECONDS
  return {
    effectiveDay: rashidEffectiveDay(now),
    secondsToSave: beforeSave
      ? SAVE_SECONDS - now.secondsIntoDay
      : 86400 - now.secondsIntoDay + SAVE_SECONDS,
  }
}
