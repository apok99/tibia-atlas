import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type { EntryType } from '../types'

export interface GlossaryItem {
  slug: string
  type: EntryType
  name: string
  image: string | null
}

/** Index of all published entry names in the active locale, for auto-linking. */
export function useGlossary() {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['glossary', i18n.language],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ data: GlossaryItem[] }>('/glossary')
      return data.data
    },
  })
}
