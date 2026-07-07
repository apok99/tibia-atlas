import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface AltarHints {
  class?: string
  hitpoints?: number
  difficulty?: string
  weak_to?: string
}

export interface AltarPoolItem {
  slug: string
  name: string
}

export interface AltarToday {
  date: string
  next_save: string
  /** Letters per word of the answer's name, e.g. [3, 7] for "Orc Warlord". */
  word_shape: number[]
  hints: AltarHints
  /** Every guessable creature, for the autocomplete. Never names the answer. */
  pool: AltarPoolItem[]
}

export interface AltarReveal {
  name: string
  slug: string
  image: string | null
}

export interface AltarGuessResponse {
  valid: boolean
  date?: string
  solved?: boolean
  /** Present once the (single) guess is spent — the game is always over then. */
  answer?: AltarReveal
}

/** Today's silhouette puzzle: shape, light hints and the guess dictionary. */
export function useAltarToday() {
  return useQuery({
    queryKey: ['altar', 'today'],
    // Creature names are English proper nouns (same for everyone), so no lang key.
    queryFn: async () => {
      const { data } = await api.get<AltarToday>('/altar/today')
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** Score the single guess against today's answer (server-side). */
export async function postAltarGuess(slug: string) {
  const { data } = await api.post<AltarGuessResponse>('/altar/guess', { slug })
  return data
}
