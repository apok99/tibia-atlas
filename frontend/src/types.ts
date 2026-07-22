export type Locale = 'es' | 'en'

export type EntryType =
  | 'creature'
  | 'npc'
  | 'character'
  | 'city'
  | 'location'
  | 'organization'
  | 'quest'
  | 'event'
  | 'item'
  | 'concept'

export type EntryStatus = 'draft' | 'in_review' | 'published'

export type SourceType =
  | 'official_article'
  | 'cipsoft_publication'
  | 'tibia_wiki'
  | 'internet'
  | 'other'

export interface Source {
  id: number
  type: SourceType
  authority: number
  title: string
  url: string | null
  note: string | null
}

/** A creature spawn point as absolute Tibia game coordinates. */
export interface Spawn {
  x: number
  y: number
  z: number
}

/** The seven editorial sections of a Tibia Atlas article. */
export interface EntryContent {
  overview: string | null
  canon: string | null
  interpretations: string | null
  theories: string | null
  research_gaps: string | null
}

/** A single hit from the global autocomplete search (entries + item catalogue). */
export interface SearchResult {
  slug: string
  type: EntryType
  name: string
  image: string | null
}

export interface EntryListItem {
  id: number
  slug: string
  type: EntryType
  status: EntryStatus
  featured: boolean
  primary_image: string | null
  locale: Locale | null
  name: string | null
  overview: string | null
  /** All-time view count (popularity). */
  view_count?: number
  /** Views within the trending window (last 72h); only set by /entries/trending. */
  trend_views?: number | null
  /** Whether this entry is a boss creature (meta.rank === 'Boss'). */
  boss?: boolean
  /** Official bestiary difficulty (creatures only), e.g. "Medium". */
  difficulty?: string | null
  /** Recommended level (quests only), from meta.recommended_level. */
  recommended_level?: number | null
  /** Region the quest takes place in (quests only). */
  region?: string | null
  /** Access requirement, e.g. "Premium" (quests only). */
  access?: string | null
  /** Item stats (items only); null for every other type. */
  item?: ItemStats | null
  reviewed?: boolean
  reviewed_at?: string | null
  available_locales?: Locale[] | null
  published_at: string | null
}

export interface Entry {
  id: number
  slug: string
  type: EntryType
  type_label: string
  status: EntryStatus
  featured: boolean
  primary_image: string | null
  meta: Record<string, unknown>
  locale: Locale | null
  name: string | null
  content: EntryContent
  available_locales: Locale[]
  sources: Source[]
  related: EntryListItem[]
  /** Items this creature drops (creatures only); absent for other types. */
  loot?: LootItem[]
  /** Creature spawn points (absolute game coords) for the hunting map. */
  spawns: Spawn[]
  spawn_count: number
  published_at: string | null
  updated_at: string | null
}

/** A readable in-game Tibia book in the library index (no full text). */
export interface LibraryBookItem {
  slug: string
  title: string | null
  author: string | null
  location: string | null
  group: string
  char_len: number
  blurb: string | null
  is_lore_important: boolean
}

/** A shelf (location grouping) in the library, with its book count. */
export interface LibraryGroup {
  name: string
  count: number
}

export interface LibraryIndex {
  data: LibraryBookItem[]
  groups: LibraryGroup[]
  total: number
}

/** A single book with its full text in the active locale. */
export interface LibraryBook {
  slug: string
  title: string | null
  author: string | null
  location: string | null
  group: string
  booktype: string | null
  source_url: string | null
  locale: Locale | null
  available_locales: Locale[]
  blurb: string | null
  text: string | null
  is_lore_important: boolean
}

export interface Facets {
  classifications: { value: string; count: number }[]
  bosses: number
}

/** Canonical equipment slot used by the album filters and the configurator. */
export type EquipSlot =
  | 'head'
  | 'neck'
  | 'body'
  | 'weapon'
  | 'offhand'
  | 'legs'
  | 'finger'
  | 'feet'
  | 'ammo'

/** Structured item stats attached to item entries (EntryListItem.item). */
export interface ItemStats {
  category: string | null
  object_class: string | null
  slot: EquipSlot | null
  vocations: string[]
  level: number | null
  attack: number | null
  /** Elemental damage on modern weapons (Sanguine Blade: attack 8 + fire 46). */
  element_attack?: number | null
  /** Element of element_attack, e.g. "fire". */
  element_attack_type?: string | null
  /** Flat attack bonus on modern gear (wiki atk_mod). */
  atk_mod?: number | null
  /** Hit-chance bonus on modern gear (wiki hit_mod). */
  hit_mod?: number | null
  defense: number | null
  defense_mod: string | null
  armor: number | null
  /** Skill bonuses, e.g. { "magic level": 2, "speed": 15 }. */
  bonuses?: Record<string, number> | null
  /** Elemental resistances in %, e.g. { "fire": 5, "ice": -2 }. */
  resists?: Record<string, number> | null
  power: number | null
  weight: number | null
  hands: string | null
  weapon_type: string | null
  damage_range: string | null
  damage_type: string | null
  imbue_slots: number | null
}

/** An NPC that buys or sells an item, with the price when fixed. */
export interface NpcDeal {
  npc: string
  price?: number
}

/** A stop on a travelling merchant's circuit. */
export interface TradeStop {
  city: string
  coords: [number, number, number]
}

/**
 * One merchant's offer for an item, from the real server shop data: price,
 * map spawn tiles, and the travel info for the two roaming traders (Rashid's
 * weekly circuit, Yasir's random docks).
 */
export interface TradeOffer {
  npc: string
  /** Lore-entry slug when the NPC has a published page. */
  slug: string | null
  image: string | null
  city: string | null
  /** Non-gold currency item name (e.g. "gold token"); null = plain gold. */
  currency: string | null
  coords: [number, number, number][] | null
  travelling: {
    kind: 'weekly' | 'roaming'
    today?: TradeStop
    schedule?: { day: number; city: string }[]
    spots?: TradeStop[]
  } | null
  price: number
}

/** A merchant found by the map's NPC search, with its walkable spawn tiles. */
export interface MapNpc {
  npc: string
  /** Lore-entry slug when the NPC has a published page. */
  slug: string | null
  image: string | null
  city: string | null
  coords: [number, number, number][]
  travelling: TradeOffer['travelling']
}

/** Where to buy / sell one item ("buy" = you pay, "sell" = the NPC pays you). */
export interface ItemTrade {
  buy: TradeOffer[]
  sell: TradeOffer[]
}

/** A creature that drops an item, resolved to its lore entry when it exists. */
export interface Dropper {
  name: string
  slug: string | null
  image: string | null
  published: boolean
}

/** An item a creature drops, linking through to its catalogue page. */
export interface LootItem {
  slug: string
  name: string
  image: string | null
  /** Best gp estimate (NPC price or wiki value), for ranking; null if unknown. */
  value: number | null
}

/** Full item detail (the album's click-through modal). */
export interface ItemDetail {
  slug: string
  name: string | null
  image: string | null
  overview: string | null
  notes: string | null
  item: ItemStats
  value: string | null
  npc_value: number | null
  npc_buy: NpcDeal[]
  npc_sell: NpcDeal[]
  dropped_by: Dropper[]
  wiki_url: string | null
}

/** Item category with its count, for album sections + progress denominators. */
export interface ItemCategory {
  value: string
  count: number
}

export interface ItemFacets {
  categories: ItemCategory[]
  total: number
  equippable: number
}

/**
 * Weapon-style cards the configurator expands the weapon slot into, for
 * vocations that master several weapon types (knight: sword/axe/club,
 * paladin: bow/crossbow).
 */
export type WeaponCardSlot =
  | 'weapon_sword'
  | 'weapon_axe'
  | 'weapon_club'
  | 'weapon_bow'
  | 'weapon_crossbow'

/** One equipment slot's recommendation in the loadout configurator. */
export interface LoadoutSlot {
  slot: EquipSlot | WeaponCardSlot
  best: EntryListItem
  alternatives: EntryListItem[]
}

export interface Loadout {
  level: number
  vocation: string
  slots: LoadoutSlot[]
}

export interface Paginated<T> {
  data: T[]
  meta: {
    current_page: number
    last_page: number
    total: number
    per_page: number
  }
}
