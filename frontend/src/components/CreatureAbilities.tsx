import { useTranslation } from 'react-i18next'

/**
 * "Attacks & abilities" panel for a creature. Driven by `meta.abilities` — the
 * parsed TibiaWiki {{Ability List}}. Each entry is one attack: a named spell
 * (proper name kept as-is) or a generic `kind` (melee/healing/haste/summon) the
 * UI translates. `damage` is a range string ("60-140") and `element` a frontend
 * element id, shown as a colour-coded chip. Renders nothing without data.
 */

interface Ability {
  kind?: string
  name?: string
  damage?: string
  element?: string
}

// Element/kind accent colours — the elemental subset mirrors DamageAffinity.
const COLOR: Record<string, string> = {
  physical: '#8a8578',
  fire: '#c0592f',
  energy: '#7d5aa8',
  ice: '#4f8fb0',
  earth: '#5f8a3e',
  holy: '#c69a3a',
  death: '#6d5a86',
  drown: '#3f7495',
  life_drain: '#a8455c',
  mana_drain: '#4a63a8',
}

const KIND_COLOR: Record<string, string> = {
  melee: '#8a8578',
  healing: '#4f9e6a',
  haste: '#c9a24b',
  summon: '#7a6f5d',
}

export function CreatureAbilities({ meta }: { meta: Record<string, unknown> }) {
  const { t } = useTranslation()

  const raw = meta?.abilities
  const abilities = Array.isArray(raw)
    ? (raw as Ability[]).filter((a) => a && (typeof a.name === 'string' || typeof a.kind === 'string'))
    : []
  if (abilities.length === 0) return null

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">
          {t('abilities.title')}
        </h2>
      </header>

      <ul className="divide-y divide-line">
        {abilities.map((a, i) => {
          // Label: translate the generic kind, else use the spell's proper name.
          const label = a.kind
            ? a.kind === 'summon' && a.name
              ? `${t('abilities.kind.summon')}: ${a.name}`
              : t(`abilities.kind.${a.kind}`, { defaultValue: a.name ?? a.kind })
            : (a.name ?? '')

          const dotColor =
            (a.element && COLOR[a.element]) || (a.kind && KIND_COLOR[a.kind]) || '#8a8578'
          const elColor = a.element ? COLOR[a.element] ?? '#8a8578' : null
          const elLabel = a.element
            ? t(`elements.${a.element}`, { defaultValue: a.element.replace(/_/g, ' ') })
            : null

          return (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
              <span className="flex-1 text-sm font-medium text-fg">{label}</span>
              {a.damage && (
                <span className="font-mono text-xs font-semibold tabular-nums text-fg-dim">
                  {a.damage}
                </span>
              )}
              {elLabel && elColor && (
                <span
                  className="rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: elColor, background: `${elColor}1f` }}
                >
                  {elLabel}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
