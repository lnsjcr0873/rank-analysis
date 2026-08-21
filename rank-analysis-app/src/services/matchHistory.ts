import { invoke } from '@tauri-apps/api/core'
import type { MatchHistory, Game } from '../types/domain/match'

export async function getMatchHistoryByName(
  name: string,
  begIndex: number = 0,
  endIndex: number = 20
): Promise<MatchHistory> {
  return await invoke<MatchHistory>('get_match_history_by_name', {
    name,
    begIndex,
    endIndex
  })
}

export async function getMatchHistoryByPuuid(
  puuid: string,
  begIndex: number = 0,
  endIndex: number = 20
): Promise<MatchHistory> {
  return await invoke<MatchHistory>('get_match_history_by_puuid', {
    puuid,
    begIndex,
    endIndex
  })
}

export async function getGameById(gameId: number): Promise<Game> {
  return await invoke<Game>('get_game_by_id', { gameId })
}
