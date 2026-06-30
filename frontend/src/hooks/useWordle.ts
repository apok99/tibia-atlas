import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type Tile = 'correct' | 'present' | 'absent'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export interface WordleToday {
  date: string
  length: number
  difficulty: Difficulty
  max_attempts: number
  next_save: string
  words: string[]
}

export interface GuessResponse {
  valid: boolean
  date?: string
  result?: Tile[]
  solved?: boolean
  /** Present only once the game is over (won or out of tries). */
  answer?: string
  name?: string
  slug?: string | null
  image?: string | null
}

/** Today's puzzle shape + the dictionary of valid guesses (no answer). */
export function useWordleToday() {
  return useQuery({
    queryKey: ['wordle', 'today'],
    // The word is locale-agnostic (English names) so it doesn't key on language.
    queryFn: async () => {
      const { data } = await api.get<WordleToday>('/wordle/today')
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** Score one guess against today's answer (server-side). */
export async function postGuess(guess: string, attempt: number) {
  const { data } = await api.post<GuessResponse>('/wordle/guess', { guess, attempt })
  return data
}
