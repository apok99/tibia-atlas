import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { localizeAbilityName } from '../lib/abilityName'

/**
 * Unified "Combat" panel for a creature — merges the old DamageAffinity and
 * CreatureAbilities panels into one tactical overview with two halves:
 *
 *   1. "How to defeat it"  — driven by `meta.damage_mods` (exact % per element)
 *      or the legacy `immune_to` / `weak_to` labels. Leads with an actionable
 *      callout ("Best attacked with: Fire, Energy") and a detailed element grid.
 *   2. "Its attacks"       — driven by `meta.abilities` (parsed {{Ability List}}).
 *
 * Each half renders only when it has data; the whole panel renders nothing when
 * neither does.
 */

// ── Elements ────────────────────────────────────────────────────────────────

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

// The seven core elements are always shown; the extras only appear when a
// creature actually has an affinity to them (otherwise they're noise).
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

// A flat glyph/colour lookup so the attacks list can render the same iconography
// as the affinity grid (incl. mana_drain, which has no affinity tile).
const MANA_DRAIN: ElementDef = {
  id: 'mana_drain',
  label: 'Mana drain',
  color: '#4a63a8',
  glyph: (
    <path
      d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
      {...stroke}
    />
  ),
}
const ELEMENT: Record<string, ElementDef> = Object.fromEntries(
  [...CORE, ...EXTRA, MANA_DRAIN].map((e) => [e.id, e]),
)

// ── Abilities ───────────────────────────────────────────────────────────────

interface Ability {
  kind?: string
  name?: string
  damage?: string
  element?: string
}

const KIND_COLOR: Record<string, string> = {
  melee: '#8a8578',
  healing: '#4f9e6a',
  haste: '#c9a24b',
  summon: '#7a6f5d',
}

// Small generic glyphs for the non-elemental ability kinds.
const KIND_GLYPH: Record<string, ReactNode> = {
  melee: <path d="M14.5 17.5 3 6V3h3l11.5 11.5m-4.5 1.5 6-6M16 16l4 4" {...stroke} />,
  healing: <path d="M12 5v14M5 12h14" {...stroke} />,
  haste: <path d="m13 2-9 12h7l-2 8 9-12h-7z" {...stroke} />,
  summon: (
    <>
      <circle cx="12" cy="8" r="3.2" {...stroke} />
      <path d="M5 21a7 7 0 0 1 14 0" {...stroke} />
    </>
  ),
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

/** Peak numeric damage from a "250-550" / "1,200-6,500" range (max of all numbers). */
function peakDamage(dmg?: string): number | null {
  if (typeof dmg !== 'string') return null
  const nums = dmg.replace(/,/g, '').match(/\d+/g)
  if (!nums) return null
  return Math.max(...nums.map(Number))
}

function statusFromPct(pct: number): Status {
  if (pct === 0) return 'immune'
  if (pct < 100) return 'resistant'
  if (pct > 100) return 'weak'
  return 'neutral'
}

/** A small round element badge — glyph on a tinted disc. Shared by chips. */
function ElementIcon({ def, size = 18, tint }: { def: ElementDef; size?: number; tint?: string }) {
  const color = tint ?? def.color
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{ height: size, width: size, color, background: `${color}22` }}
    >
      <svg viewBox="0 0 24 24" style={{ height: size * 0.62, width: size * 0.62 }}>
        {def.glyph}
      </svg>
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function CreatureCombat({ meta }: { meta: Record<string, unknown> }) {
  const { t, i18n } = useTranslation()
  const lang = (i18n.language || 'es').slice(0, 2)

  // --- Affinity data ---------------------------------------------------------
  const rawMods = meta?.damage_mods
  const mods =
    rawMods && typeof rawMods === 'object' && !Array.isArray(rawMods)
      ? (rawMods as Record<string, number>)
      : null
  const weakSet = parseLabels(meta?.weak_to)
  const immuneSet = parseLabels(meta?.immune_to)

  const hasAffinity = mods
    ? Object.values(mods).some((p) => p !== 100)
    : weakSet.size > 0 || immuneSet.size > 0

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

  const extra = EXTRA.filter((e) => resolve(e).status !== 'neutral')
  const elements = [...CORE, ...extra]
  const weakEls = elements.filter((e) => resolve(e).status === 'weak')
  const immuneEls = elements.filter((e) => resolve(e).status === 'immune')

  // --- Abilities data --------------------------------------------------------
  const rawAbilities = meta?.abilities
  const abilities = Array.isArray(rawAbilities)
    ? (rawAbilities as Ability[]).filter(
        (a) => a && (typeof a.name === 'string' || typeof a.kind === 'string'),
      )
    : []
  const hasAbilities = abilities.length > 0

  // Peak elemental damage per element — powers the "predominant element" chart.
  const damageByElement = new Map<string, number>()
  for (const a of abilities) {
    if (!a.element || !ELEMENT[a.element]) continue
    const peak = peakDamage(a.damage)
    if (peak == null || peak <= 1) continue
    damageByElement.set(a.element, Math.max(damageByElement.get(a.element) ?? 0, peak))
  }
  const damageRows = [...damageByElement.entries()]
    .map(([id, val]) => ({ def: ELEMENT[id], val }))
    .sort((a, b) => b.val - a.val)
  const maxDamage = damageRows[0]?.val ?? 0

  if (!hasAffinity && !hasAbilities) return null

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">
          {t('combat.title')}
        </h2>
      </header>

      {/* ── HALF 1 — How to defeat it ─────────────────────────────────────── */}
      {hasAffinity && (
        <div className="border-b border-line">
          <SubHeader label={t('combat.howToBeat')}>
            <div className="hidden items-center gap-3 text-[10px] font-bold uppercase tracking-wider sm:flex">
              <LegendDot color={WEAK} label={t('affinity.weak')} />
              <LegendDot color={RESIST} label={t('affinity.resistant')} />
              <LegendDot color={IMMUNE_GREY} label={t('affinity.immune')} />
            </div>
          </SubHeader>

          {/* Actionable callout: what to hit it with, what to avoid. */}
          <div className="flex flex-col gap-2 px-4 pb-1">
            {weakEls.length > 0 ? (
              <TacticLine
                icon="⚔"
                accent={WEAK}
                label={t('combat.bestWith')}
                chips={weakEls}
                resolve={resolve}
                t={t}
              />
            ) : (
              <p className="text-xs text-fg-mute">{t('combat.noWeakness')}</p>
            )}
            {immuneEls.length > 0 && (
              <TacticLine
                icon="⊘"
                accent={IMMUNE_GREY}
                muted
                label={t('combat.noEffect')}
                chips={immuneEls}
                resolve={resolve}
                t={t}
              />
            )}
          </div>

          {/* Detailed element grid with exact numbers. */}
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
            {elements.map((el) => {
              const { status, pct } = resolve(el)
              const isWeak = status === 'weak'
              const isResist = status === 'resistant'
              const isImmune = status === 'immune'

              const accent = isWeak ? WEAK : isResist ? RESIST : isImmune ? IMMUNE_GREY : null
              const iconTint = isImmune ? IMMUNE_GREY : el.color

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
                    isImmune ? 'opacity-80' : '',
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
                    className={`font-mono text-[11px] font-bold tabular-nums leading-none${isWeak || isResist ? '' : ' text-fg-dim'}`}
                    style={isWeak || isResist ? { color: accent ?? undefined } : undefined}
                  >
                    {value}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── HALF 2 — Its attacks ──────────────────────────────────────────── */}
      {hasAbilities && (
        <div>
          <SubHeader label={t('combat.itsAttacks')}>
            <span className="text-[10px] font-semibold text-fg-mute">
              {t('combat.attacksHint')}
            </span>
          </SubHeader>

          {/* Predominant-element chart: peak damage per element, tallest first. */}
          {damageRows.length >= 2 && (
            <div className="px-4 pb-3 pt-1">
              <div className="mb-2 flex items-baseline gap-2">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-mute">
                  {t('combat.byElement')}
                </h4>
                <span className="text-[10px] text-fg-mute">{t('combat.byElementHint')}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {damageRows.map(({ def, val }, idx) => (
                  <div key={def.id} className="flex items-center gap-2">
                    <ElementIcon def={def} size={18} />
                    <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-fg-dim">
                      {t(`elements.${def.id}`)}
                    </span>
                    <div className="relative h-3.5 flex-1 overflow-hidden rounded-[3px] bg-bg-2">
                      <div
                        className="h-full rounded-[3px]"
                        style={{
                          width: `${maxDamage ? Math.max(6, (val / maxDamage) * 100) : 0}%`,
                          background: def.color,
                          opacity: idx === 0 ? 1 : 0.66,
                        }}
                      />
                    </div>
                    {idx === 0 && (
                      <span
                        className="shrink-0 rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: def.color, background: `${def.color}1f` }}
                      >
                        {t('combat.predominant')}
                      </span>
                    )}
                    <span className="w-12 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-fg">
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ul className="divide-y divide-line">
            {abilities.map((a, i) => {
              const label = a.kind
                ? a.kind === 'summon' && a.name
                  ? `${t('abilities.kind.summon')}: ${a.name}`
                  : t(`abilities.kind.${a.kind}`, { defaultValue: a.name ?? a.kind })
                : a.name
                  ? localizeAbilityName(a.name, lang)
                  : ''

              const elDef = a.element ? ELEMENT[a.element] : null
              const kindColor = a.kind ? KIND_COLOR[a.kind] : null
              const dotColor = elDef?.color ?? kindColor ?? '#8a8578'
              const elLabel = a.element
                ? t(`elements.${a.element}`, { defaultValue: a.element.replace(/_/g, ' ') })
                : null

              // Prefer the element glyph; fall back to the ability-kind glyph.
              const glyph = elDef?.glyph ?? (a.kind ? KIND_GLYPH[a.kind] : null)

              return (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                  {glyph ? (
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                      style={{ color: dotColor, background: `${dotColor}22` }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4">
                        {glyph}
                      </svg>
                    </span>
                  ) : (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: dotColor }}
                    />
                  )}
                  <span className="flex-1 text-sm font-medium text-fg">{label}</span>
                  {a.damage && (
                    <span className="font-mono text-xs font-semibold tabular-nums text-fg-dim">
                      {a.damage}
                    </span>
                  )}
                  {elLabel && elDef && (
                    <span
                      className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: elDef.color, background: `${elDef.color}1f` }}
                    >
                      {elLabel}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

// ── Small building blocks ────────────────────────────────────────────────────

function SubHeader({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-dim">{label}</h3>
      <div className="ml-auto">{children}</div>
    </div>
  )
}

function TacticLine({
  icon,
  accent,
  label,
  chips,
  resolve,
  t,
  muted,
}: {
  icon: string
  accent: string
  label: string
  chips: ElementDef[]
  resolve: (el: ElementDef) => { status: Status; pct: number | null }
  t: (k: string) => string
  muted?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span
        className="text-xs font-bold"
        style={{ color: muted ? 'var(--color-fg-mute)' : accent }}
        aria-hidden
      >
        {icon}
      </span>
      <span className={`text-xs font-semibold ${muted ? 'text-fg-mute' : 'text-fg-dim'}`}>
        {label}
      </span>
      {chips.map((el) => {
        const { pct } = resolve(el)
        return (
          <span
            key={el.id}
            className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] font-semibold"
            style={{
              borderColor: muted ? 'var(--color-line)' : `${accent}66`,
              background: muted ? 'var(--color-bg-2)' : `${accent}14`,
              color: muted ? 'var(--color-fg-mute)' : 'var(--color-fg)',
            }}
          >
            <ElementIcon def={el} size={16} tint={muted ? IMMUNE_GREY : el.color} />
            {t(`elements.${el.id}`)}
            {pct !== null && !muted && (
              <span className="font-mono tabular-nums" style={{ color: accent }}>
                {pct}%
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1" style={{ color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}
