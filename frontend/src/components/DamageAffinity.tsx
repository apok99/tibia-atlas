import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

/**
 * Visual "elemental affinity" chart for a creature. Driven by `meta.damage_mods`
 * — a map of { elementId: percent } where the percent is how much damage of that
 * element the creature takes (0 = immune, <100 = resistant, >100 = weak). Shows
 * the standard Tibia damage elements as colour-coded tiles WITH the exact %, so
 * the player sees not just *what* hurts it but *how much*.
 *
 * Falls back to the older immune_to / weak_to label strings (no percentages)
 * when damage_mods hasn't been backfilled yet. Renders nothing without data.
 */

type Status = 'weak' | 'resistant' | 'immune' | 'neutral'

interface ElementDef {
  /** i18n key under `elements.*` and key inside meta.damage_mods. */
  id: string
  /** Label as written by the importer in immune_to / weak_to (fallback path). */
  label: string
  /** Brand colour for the element. */
  color: string
  glyph: ReactNode
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const WEAK = '#b0402d' // muted seal red — reads as "weak" without neon
const RESIST = '#3f6b7a' // muted slate
const IMMUNE_GREY = '#8a7550' // warm parchment grey

// The seven core elements are always shown; Drown and Life drain only appear
// when a creature actually has an affinity to them (otherwise they're noise).
const CORE: ElementDef[] = [
  {
    id: 'physical',
    label: 'Physical',
    color: '#8a8578',
    glyph: (
      <>
        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" {...stroke} />
        <path d="m13 19 6-6M16 16l4 4M19 21l2-2" {...stroke} />
      </>
    ),
  },
  {
    id: 'fire',
    label: 'Fire',
    color: '#c0592f',
    glyph: (
      <path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        {...stroke}
      />
    ),
  },
  {
    id: 'energy',
    label: 'Energy',
    color: '#7d5aa8',
    glyph: (
      <path
        d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
        {...stroke}
      />
    ),
  },
  {
    id: 'ice',
    label: 'Ice',
    color: '#4f8fb0',
    glyph: (
      <>
        <path d="M2 12h20M12 2v20" {...stroke} />
        <path d="m20 16-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4" {...stroke} />
      </>
    ),
  },
  {
    id: 'earth',
    label: 'Earth',
    color: '#5f8a3e',
    glyph: (
      <path
        d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"
        {...stroke}
      />
    ),
  },
  {
    id: 'holy',
    label: 'Holy',
    color: '#c69a3a',
    glyph: (
      <>
        <circle cx="12" cy="12" r="4" {...stroke} />
        <path
          d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"
          {...stroke}
        />
      </>
    ),
  },
  {
    id: 'death',
    label: 'Death',
    color: '#6d5a86',
    glyph: (
      <>
        <path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" {...stroke} />
        <path d="M8 20v2h8v-2" {...stroke} />
        <circle cx="9" cy="12" r="1.3" {...stroke} />
        <circle cx="15" cy="12" r="1.3" {...stroke} />
      </>
    ),
  },
]

const EXTRA: ElementDef[] = [
  {
    id: 'drown',
    label: 'Drown',
    color: '#3f7495',
    glyph: (
      <>
        <path d="M2 7c.6.5 1.2 1 2.5 1C7 8 7 6 9.5 6c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" {...stroke} />
        <path d="M2 13c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" {...stroke} />
        <path d="M2 19c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" {...stroke} />
      </>
    ),
  },
  {
    id: 'life_drain',
    label: 'Life drain',
    color: '#a8455c',
    glyph: (
      <>
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z" {...stroke} />
        <path d="M3.5 12H9l.8-1.5 2 4 1.7-5 1.2 2.5h4.3" {...stroke} />
      </>
    ),
  },
]

/** Split a "Fire, Holy" style meta string into a lowercased label set. */
function parseLabels(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

function statusFromPct(pct: number): Status {
  if (pct === 0) return 'immune'
  if (pct < 100) return 'resistant'
  if (pct > 100) return 'weak'
  return 'neutral'
}

export function DamageAffinity({ meta }: { meta: Record<string, unknown> }) {
  const { t } = useTranslation()

  // Preferred path: exact percentages per element.
  const rawMods = meta?.damage_mods
  const mods =
    rawMods && typeof rawMods === 'object' && !Array.isArray(rawMods)
      ? (rawMods as Record<string, number>)
      : null

  // Fallback path: only immune/weak labels, no numbers.
  const weakSet = parseLabels(meta?.weak_to)
  const immuneSet = parseLabels(meta?.immune_to)

  const hasData = mods
    ? Object.values(mods).some((p) => p !== 100)
    : weakSet.size > 0 || immuneSet.size > 0
  if (!hasData) return null

  /** Resolve an element to { status, pct } from whichever data we have. */
  const resolve = (el: ElementDef): { status: Status; pct: number | null } => {
    if (mods && typeof mods[el.id] === 'number') {
      const pct = mods[el.id]
      return { status: statusFromPct(pct), pct }
    }
    const key = el.label.toLowerCase()
    if (weakSet.has(key)) return { status: 'weak', pct: null }
    if (immuneSet.has(key)) return { status: 'immune', pct: 0 }
    return { status: 'neutral', pct: mods ? 100 : null }
  }

  // Always show the seven core elements; add Drown / Life drain only if they
  // carry a non-neutral affinity for this creature.
  const extra = EXTRA.filter((e) => resolve(e).status !== 'neutral')
  const elements = [...CORE, ...extra]

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">
          {t('affinity.title')}
        </h2>
        <div className="ml-auto hidden items-center gap-3 text-[10px] font-bold uppercase tracking-wider sm:flex">
          <LegendDot color={WEAK} label={t('affinity.weak')} />
          <LegendDot color={RESIST} label={t('affinity.resistant')} />
          <LegendDot color={IMMUNE_GREY} label={t('affinity.immune')} />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
        {elements.map((el) => {
          const { status, pct } = resolve(el)
          const isWeak = status === 'weak'
          const isResist = status === 'resistant'
          const isImmune = status === 'immune'
          const isNeutral = status === 'neutral'

          const accent = isWeak ? WEAK : isResist ? RESIST : isImmune ? IMMUNE_GREY : null
          const iconTint = isImmune ? IMMUNE_GREY : el.color

          // The "how much" value: exact % when known, else a label hint.
          // In the label-only fallback path (no damage_mods) we only know the
          // weak/immune elements — everything else is *normal*, NOT immune.
          const value =
            pct !== null
              ? `${pct}%`
              : isWeak
                ? `↑ ${t('affinity.weak')}`
                : isImmune
                  ? t('affinity.immune')
                  : t('affinity.neutral')

          return (
            <div
              key={el.id}
              title={
                isWeak
                  ? t('affinity.weakHint')
                  : isResist
                    ? t('affinity.resistHint')
                    : isImmune
                      ? t('affinity.immuneHint')
                      : t('affinity.neutralHint')
              }
              style={{
                borderColor: isWeak ? WEAK : isResist ? RESIST : 'var(--color-line)',
                background: isWeak ? `${WEAK}1f` : isResist ? `${RESIST}14` : 'var(--color-bg-2)',
                boxShadow: isWeak ? `0 0 20px -8px ${WEAK}` : undefined,
              }}
              className={[
                'relative flex flex-col items-center gap-1.5 rounded-[3px] border px-2 py-3 text-center transition',
                isImmune ? 'opacity-60 grayscale' : '',
              ].join(' ')}
            >
              {(isWeak || isResist) && (
                <span
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-[11px] font-black text-white shadow"
                  style={{ background: accent ?? undefined }}
                >
                  {isWeak ? '▲' : '▼'}
                </span>
              )}
              <span
                className="relative grid h-11 w-11 place-items-center rounded-full"
                style={{
                  color: iconTint,
                  background: `${iconTint}22`,
                  boxShadow: isWeak ? `0 0 14px -2px ${iconTint}` : undefined,
                }}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6">
                  {el.glyph}
                </svg>
                {isImmune && (
                  <span className="absolute h-px w-9 rotate-45 bg-fg-mute" aria-hidden />
                )}
              </span>
              <span className="text-[11px] font-semibold leading-tight text-fg">
                {t(`elements.${el.id}`)}
              </span>
              <span
                className={`font-mono text-[11px] font-bold tabular-nums leading-none${isNeutral ? ' text-fg-mute' : ''}`}
                style={isNeutral ? undefined : { color: accent ?? undefined }}
              >
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1" style={{ color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}
