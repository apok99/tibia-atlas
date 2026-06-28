import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type {
  Entry,
  EntryListItem,
  Facets,
  LibraryBook,
  LibraryIndex,
  Paginated,
} from '../types'

interface EntryFilters {
  type?: string
  q?: string
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

/** Available filter facets (classifications, boss count) for a given entry type. */
export function useFacets(type?: string) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['facets', i18n.language, type],
    queryFn: async () => {
      const { data } = await api.get<Facets>('/entries/facets', { params: { type } })
      return data
    },
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
export function useRandomEntries(count = 5, excludeSlug?: string) {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['entries-random', i18n.language, count, excludeSlug],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/entries/random', {
        params: { count, exclude: excludeSlug },
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
