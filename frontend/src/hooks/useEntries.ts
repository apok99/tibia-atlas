import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type {
  Entry,
  EntryListItem,
  Facets,
  ItemDetail,
  ItemFacets,
  LibraryBook,
  LibraryIndex,
  Loadout,
  Paginated,
  SearchResult,
} from '../types'

interface EntryFilters {
  type?: string
  q?: string
  /** How `q` matches names: anywhere in the text (default) or only as a prefix. */
  q_mode?: 'starts' | 'contains'
  featured?: boolean
  classification?: string
  boss?: '0' | '1'
  page?: number
  per_page?: number
}

export function useEntries(filters: EntryFilters = {}) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['entries', i18n.language, filters],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/entries', { params: filters })
      return data
    },
  })
}

/**
 * Global autocomplete search across published lore + the whole item catalogue,
 * ranked (name matches first). Disabled until the term is at least 2 chars.
 */
export function useSearch(q: string) {
  const { i18n } = useTranslation()
  const term = q.trim()
  return useQuery({
    queryKey: ['search', i18n.language, term],
    enabled: term.length >= 2,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: SearchResult[] }>('/search', { params: { q: term } })
      return data.data
    },
    placeholderData: keepPreviousData,
  })
}

/**
 * Fire-and-forget: record that a search result was actually opened. This is what
 * feeds "most searched" — we log the chosen entry's slug, never the raw typed
 * text, so half-typed fragments don't pollute the ranking and the same entry
 * never appears twice.
 */
export function logSearchClick(slug: string) {
  api.post('/search/click', { slug }).catch(() => {})
}

/** Available filter facets (classifications, boss count) for a given entry type. */
export function useFacets(type?: string) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['facets', i18n.language, type],
    queryFn: async () => {
      const { data } = await api.get<Facets>('/entries/facets', { params: { type } })
      return data
    },
    // Facets only change on (rare) content edits.
    staleTime: 5 * 60 * 1000,
  })
}

/** Most-viewed entries in the last 72h (mixed types) for the home carousel. */
export function useTrending(count = 9) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['trending', i18n.language, count],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/entries/trending', {
        params: { count },
      })
      return data.data
    },
  })
}

/** Entries ordered by all-time popularity, optionally filtered by type. */
export function usePopular(filters: { type?: string; page?: number; per_page?: number } = {}) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['popular', i18n.language, filters],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/entries/popular', {
        params: filters,
      })
      return data
    },
  })
}

/** Random sample of entries for the rotating "recommended reading" widget. */
export function useRandomEntries(
  count = 5,
  opts: { excludeSlug?: string; preferImages?: boolean } = {},
) {
  const { excludeSlug, preferImages } = opts
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['entries-random', i18n.language, count, excludeSlug, preferImages],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/entries/random', {
        params: { count, exclude: excludeSlug, images: preferImages ? 1 : undefined },
      })
      return data.data
    },
  })
}

/** The in-game library index: books (light) + shelf groups, optionally filtered. */
export function useLibrary(filters: { q?: string; group?: string } = {}) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['library', i18n.language, filters],
    queryFn: async () => {
      const { data } = await api.get<LibraryIndex>('/books', { params: filters })
      return data
    },
    // Keep the current list on screen while it reloads (e.g. on a language
    // switch or a new search term) instead of flashing back to a loading state.
    placeholderData: keepPreviousData,
    // The library only changes on (rare) imports.
    staleTime: 5 * 60 * 1000,
  })
}

/** One readable book with its full text in the active locale. */
export function useLibraryBook(slug: string | undefined) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['library-book', i18n.language, slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await api.get<{ data: LibraryBook }>(`/books/${slug}`)
      return data.data
    },
    // Keep the book text visible while it re-loads in the other language.
    placeholderData: keepPreviousData,
  })
}

/** The item catalogue, paginated and filterable (album gallery). */
export function useItems(
  filters: {
    category?: string
    slot?: string
    vocation?: string
    equippable?: '0' | '1'
    q?: string
    /** 'power' pages strongest-first (gear picker); default is by id (album). */
    sort?: 'power'
    /** '1' trims the payload to what a picker renders (name/image/stats). */
    light?: '1'
    page?: number
    per_page?: number
  } = {},
  enabled = true,
) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['items', i18n.language, filters],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/items', { params: filters })
      return data
    },
    placeholderData: keepPreviousData,
    // The catalogue only changes on (rare) imports.
    staleTime: 5 * 60 * 1000,
  })
}

// Aggregated combat stats for a worn equipment set (the map's character gear):
// what /api/items/set-stats computes with the same math the Hunt Finder uses.
export type SetStats = {
  vocation: string
  items: { id: number; slug: string; slot: string }[]
  armor: number
  resists: Record<string, number>
  /** % of an incoming physical hit the armor absorbs in the hunt model. */
  physical_reduction: number
  damage_elements: string[]
  bonuses: Record<string, number>
  weapon: {
    name: string | null
    type: string | null
    category: string | null
    attack: number | null
    element_attack: number | null
    element: string | null
    hands: string | null
  } | null
}

/** Combat stats for a picked equipment set (entry ids, pre-sorted for a stable key). */
export function useSetStats(ids: number[], vocation: string) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['set-stats', i18n.language, ids.join('-'), vocation],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await api.get<{ data: SetStats }>('/items/set-stats', {
        params: { items: ids.join(','), vocation },
      })
      return data.data
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })
}

/** Item categories with counts + overall totals (album sections + progress). */
export function useItemFacets() {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['item-facets', i18n.language],
    queryFn: async () => {
      const { data } = await api.get<ItemFacets>('/items/facets')
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** Full detail for one item (the album click-through modal). */
export function useItemDetail(slug: string | undefined) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['item-detail', i18n.language, slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await api.get<{ data: ItemDetail }>(`/items/${slug}`)
      return data.data
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** Best-in-slot loadout (+ alternatives) for a level and vocation. */
export function useLoadout(level: number, vocation: string, enabled = true) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['loadout', i18n.language, level, vocation],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<Loadout>('/items/loadout', { params: { level, vocation } })
      return data
    },
    placeholderData: keepPreviousData,
  })
}

export function useEntry(slug: string | undefined) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['entry', i18n.language, slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await api.get<{ data: Entry }>(`/entries/${slug}`)
      return data.data
    },
  })
}
