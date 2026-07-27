import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { GameId } from '../lib/gameRun'

/** One board slot: a linked Tibia character's best run of the day. */
export interface BoardRow {
  rank: number
  char_name: string
  world: string | null
  level: number | null
  vocation: string | null
  attempts: number
  time_ms: number
}

export interface Board {
  game: GameId
  date: string
  next_save: string
  /** How many characters solved today's puzzle (the board itself is capped at 10). */
  players: number
  top: BoardRow[]
  /** The queried character's standing, even when it falls outside the top 10. */
  you: BoardRow | null
}

export interface SubmitResult extends Board {
  ok: true
  /** False when today's stored run was already as good or better. */
  improved: boolean
}

const boardKey = (game: GameId, char: string) => ['gameBoard', game, char]

/** Today's top 10 for one game, plus where `charName` stands (if given). */
export function useLeaderboard(game: GameId, charName?: string) {
  return useQuery({
    queryKey: boardKey(game, charName ?? ''),
    queryFn: async () => {
      const { data } = await api.get<Board>(`/games/${game}/board`, {
        params: charName ? { char: charName } : undefined,
      })
      return data
    },
    // The board only moves when someone finishes; a short window is plenty and
    // keeps a tab left open on the page from polling hard.
    staleTime: 30 * 1000,
  })
}

/** Post a solved run. Throws on a rejected character (422) or a network error. */
export async function submitScore(
  game: GameId,
  body: { char_name: string; attempts: number; time_ms: number },
): Promise<SubmitResult> {
  const { data } = await api.post<SubmitResult>(`/games/${game}/board`, body)
  return data
}

/** Refresh every cached view of a game's board (any linked-character variant). */
export function useBoardRefresher() {
  const qc = useQueryClient()
  return (game: GameId) => qc.invalidateQueries({ queryKey: ['gameBoard', game] })
}
