import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type { EntryType } from '../types'

export interface GlossaryItem {
  slug: string
  type: EntryType
  name: string
  image: string | null
  /** Present (true) only for boss creatures — powers the map's boss search. */
  boss?: boolean
  /**
   * Present (true) for the subset with a real server-side respawn — world and
   * raid bosses. Lever/quest bosses are `boss` but not `world_boss`: they're
   * permanently up on a per-player cooldown, so a respawn reading is meaningless
   * and the map rail leaves them out.
   */
  world_boss?: boolean
  /** Boss spawntypes (Raid/Unique/Unblockable/Triggered/Regular/Event) — for the Boss Watch tabs. Multi-valued. */
  spawn_type?: string[]
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
