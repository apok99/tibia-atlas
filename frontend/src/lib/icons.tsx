import type { CSSProperties } from 'react'

// Shared line-icon set (24x24, stroke, no fill) in the same Lucide-style as the
// map POI icons. These replaced the colourful emoji pictographs that used to sit
// in the UI (paw, crown, flame, sailboat…) so the parchment/atlas theme stays
// consistent — a real icon set reads far clearer than emoji, and recolours
// cleanly in both light and dark modes because everything inherits currentColor.
//
// Inner markup is shared between the React <Icon> component and iconMarkup(), the
// raw-string form needed inside Leaflet divIcon HTML.
export const ICON_INNER: Record<string, string> = {
  // Search-ranking entry types
  paw: '<circle cx="6.5" cy="10" r="1.5"/><circle cx="10" cy="6.5" r="1.6"/><circle cx="14" cy="6.5" r="1.6"/><circle cx="17.5" cy="10" r="1.5"/><path d="M12 11.5c-2.4 0-4.3 1.8-4.3 3.9C7.7 17 9 18 12 18s4.3-1 4.3-2.6c0-2.1-1.9-3.9-4.3-3.9z"/>',
  crown: '<path d="M3 8l3.5 3L12 5l5.5 6L21 8l-2 11H5z"/><path d="M5 19h14"/>',
  castle: '<path d="M4 21V8h16v13M4 8V5h3v3M10 8V5h4v3M17 8V5h3v3M9 21v-4a3 3 0 0 1 6 0v4M3 21h18"/>',
  scroll: '<path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3M19 17V5a2 2 0 0 0-2-2H4"/>',
  shield: '<path d="M12 2l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  // Raid-boss heat marks
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  // Sea / ice / carpet transport lines
  sailboat: '<path d="M3 18h18l-2 3H5z"/><path d="M12 4v10M12 6l6 8H12z"/>',
  ship: '<path d="M3 18h18l-2 4H5z"/><path d="M5 18l1.2-7h8l3 7M9.5 11V7h3v4"/>',
  snowflake: '<path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10M12 6l2.5-1.5M12 6 9.5 4.5M12 18l2.5 1.5M12 18l-2.5-1.5"/>',
  sparkles: '<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9z"/><path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  // Route tools / legs
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M3 21h16M12.5 12h.01"/>',
  rope: '<path d="M9 3c-3.5 2-3.5 6 0 8s3.5 6 0 8M13 3c-3.5 2-3.5 6 0 8s3.5 6 0 8"/>',
  walk: '<path d="M6 3.2a1.8 1.8 0 0 1 1.8 1.8c0 1.9-.9 2.8-.9 4.7a1.4 1.4 0 0 1-2.8 0c0-1.9 0-2.8-.5-4.7A1.8 1.8 0 0 1 6 3.2zM4 15h3.2M17 8.2a1.8 1.8 0 0 1 1.8 1.8c0 1.9-.9 2.8-.9 4.7a1.4 1.4 0 0 1-2.8 0c0-1.9 0-2.8-.5-4.7A1.8 1.8 0 0 1 17 8.2zM15 20h3.2"/>',
  pickaxe: '<path d="M2 22l8-8M12 4c-3 0-6 1.5-8 4l4 4c2-2.5 3.5-5.5 4-8zM12 4c3 0 6 1.5 8 4l-4 4c-2-2.5-3.5-5.5-4-8z"/>',
}

export type IconName = keyof typeof ICON_INNER

/** Inline line-icon. Inherits size from font (1em) and colour from currentColor. */
export function Icon({
  name,
  className,
  style,
  size,
}: {
  name: string
  className?: string
  style?: CSSProperties
  size?: number | string
}) {
  const inner = ICON_INNER[name]
  if (!inner) return null
  const s = size ?? '1em'
  return (
    <svg
      viewBox="0 0 24 24"
      width={s}
      height={s}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

/** Raw <svg> string for the same icon — for Leaflet divIcon HTML templates. */
export function iconMarkup(name: string, cls = ''): string {
  const inner = ICON_INNER[name] ?? ''
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${
    cls ? ` class="${cls}"` : ''
  }>${inner}</svg>`
}
