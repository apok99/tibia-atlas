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

/** The handful of numeric stat chips worth showing for an item, slot-aware. */
export function statChips(item: ItemStats | null | undefined, t: TFunction): { label: string; value: string }[] {
  if (!item) return []
  const chips: { label: string; value: string }[] = []
  if (item.attack != null) chips.push({ label: t('items.atk'), value: String(item.attack) })
  if (item.defense != null)
    chips.push({ label: t('items.def'), value: item.defense_mod ? `${item.defense} ${item.defense_mod}` : String(item.defense) })
  if (item.armor != null) chips.push({ label: t('items.arm'), value: String(item.armor) })
  if (item.damage_range) chips.push({ label: 'Dmg', value: item.damage_range })
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
