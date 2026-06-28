export type Locale = 'es' | 'en'

export type EntryType =
  | 'creature'
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

export interface Paginated<T> {
  data: T[]
  meta: {
    current_page: number
    last_page: number
    total: number
    per_page: number
  }
}
