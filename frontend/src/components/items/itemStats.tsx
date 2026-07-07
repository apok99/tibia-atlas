import type { TFunction } from 'i18next'
import type { EquipSlot, ItemStats } from '../../types'

/** Head-to-toe slot order shared by the album filter and the configurator. */
export const SLOT_ORDER: EquipSlot[] = [
  'head',
  'neck',
  'body',
  'weapon',
  'offhand',
  'legs',
  'finger',
  'feet',
  'ammo',
]

/** Short chip labels for the wiki skill-bonus names. */
const SKILL_LABELS: Record<string, string> = {
  'magic level': 'ML',
  'distance fighting': 'Dist',
  'sword fighting': 'Sword',
  'axe fighting': 'Axe',
  'club fighting': 'Club',
  'fist fighting': 'Fist',
  shielding: 'Shield',
  speed: 'Speed',
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** The handful of numeric stat chips worth showing for an item, slot-aware. */
export function statChips(item: ItemStats | null | undefined, t: TFunction): { label: string; value: string }[] {
  if (!item) return []
  const chips: { label: string; value: string }[] = []
  if (item.attack != null)
    chips.push({
      label: t('items.atk'),
      // Modern element weapons split their punch: "8 +46 fire".
      value: item.element_attack
        ? `${item.attack} +${item.element_attack} ${item.element_attack_type ?? ''}`.trim()
        : String(item.attack),
    })
  else if (item.atk_mod != null) chips.push({ label: t('items.atk'), value: signed(item.atk_mod) })
  if (item.hit_mod != null) chips.push({ label: 'Hit', value: `${signed(item.hit_mod)}%` })
  if (item.defense != null)
    chips.push({ label: t('items.def'), value: item.defense_mod ? `${item.defense} ${item.defense_mod}` : String(item.defense) })
  if (item.armor != null) chips.push({ label: t('items.arm'), value: String(item.armor) })
  if (item.damage_range) chips.push({ label: 'Dmg', value: item.damage_range })
  // Skill bonuses (magic level, distance fighting…) — the stats that actually
  // decide modern best-in-slot, so they get chips right next to Atk/Arm.
  for (const [skill, points] of Object.entries(item.bonuses ?? {})) {
    chips.push({ label: SKILL_LABELS[skill] ?? skill, value: signed(points) })
  }
  // Elemental resistances, e.g. "fire +5%".
  for (const [element, pct] of Object.entries(item.resists ?? {})) {
    chips.push({ label: element, value: `${signed(pct)}%` })
  }
  return chips
}

/** Coloured dots for the vocations that can use an item (empty = all). */
export function VocationDots({ vocations }: { vocations: string[] }) {
  if (!vocations.length) return null
  const colour: Record<string, string> = {
    knight: 'bg-rose-400',
    paladin: 'bg-emerald-400',
    sorcerer: 'bg-sky-400',
    druid: 'bg-amber-300',
  }
  return (
    <span className="flex items-center gap-0.5" title={vocations.join(', ')}>
      {vocations.map((v) => (
        <span key={v} className={`h-1.5 w-1.5 rounded-full ${colour[v] ?? 'bg-fg-mute'}`} />
      ))}
    </span>
  )
}
