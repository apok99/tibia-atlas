/**
 * Yasir, the other merchant that never stands still.
 *
 * Unlike Rashid he keeps no schedule: his ship docks at one of three ports and
 * which one is not predictable, so we show all three candidates instead of a
 * fake certainty. The coordinates mirror TravellingNpcs::YASIR on the backend
 * (taken from the OT `oriental_trader` world change) — edit both.
 */

export interface YasirDock {
  city: string
  spot: { es: string; en: string }
  /** In-game map coordinates of his ship's deck. */
  x: number
  y: number
  z: number
}

export const YASIR_DOCKS: YasirDock[] = [
  {
    city: 'Ankrahmun',
    spot: { es: 'en su barco, atracado al sur de la ciudad', en: 'on his ship, docked south of the city' },
    x: 33102,
    y: 32884,
    z: 6,
  },
  {
    city: 'Carlin',
    spot: { es: 'en su barco, atracado al este del depot', en: 'on his ship, docked east of the depot' },
    x: 32400,
    y: 31815,
    z: 6,
  },
  {
    city: 'Liberty Bay',
    spot: { es: 'en su barco, atracado al sur del depot', en: 'on his ship, docked south of the depot' },
    x: 32314,
    y: 32895,
    z: 6,
  },
]
