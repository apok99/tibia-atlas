import { useEffect, useState } from 'react'

/**
 * Resolved recharts palette pulled from the active atlas theme. Charts must not
 * hardcode hex colours: the dark-theme greys (#2c2f38 grid, #76705f ticks) turn
 * into harsh near-black stripes on the cream parchment. Reading the CSS
 * variables keeps gridlines a soft aged rule by day and cool grey by night.
 */
export interface ChartTheme {
  grid: string
  axis: string
  tick: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  /** Primary / secondary series colours — the atlas wax-seal reds by day. */
  accent: string
  accent2: string
  /** Gilt series colour — gold flourish by day, bright gold by night. */
  gold: string
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim()
  return v || fallback
}

function readTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement)
  return {
    grid: readVar(styles, '--color-line', '#c9b184'),
    axis: readVar(styles, '--color-line', '#c9b184'),
    tick: readVar(styles, '--color-fg-dim', '#574327'),
    tooltipBg: readVar(styles, '--color-surface', '#f2e8ce'),
    tooltipBorder: readVar(styles, '--color-line-2', '#a98f5f'),
    tooltipText: readVar(styles, '--color-fg', '#2a1f12'),
    accent: readVar(styles, '--color-accent', '#9c3b2e'),
    accent2: readVar(styles, '--color-accent-2', '#b8503b'),
    gold: readVar(styles, '--color-theory', '#a2854e'),
  }
}

/** Shared recharts <Tooltip contentStyle> so every chart's tooltip themes alike. */
export function chartTooltipStyle(t: ChartTheme) {
  return {
    background: t.tooltipBg,
    border: `1px solid ${t.tooltipBorder}`,
    borderRadius: 8,
    color: t.tooltipText,
    fontSize: 12,
  } as const
}

/** Chart colours that follow the day/night atlas, re-read when the theme flips. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readTheme)

  useEffect(() => {
    setTheme(readTheme())
    const obs = new MutationObserver(() => setTheme(readTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return theme
}
