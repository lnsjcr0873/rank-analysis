import { invoke } from '@tauri-apps/api/core'
import type { championOption } from '../types/domain/champion'

export async function getChampionOptions(): Promise<championOption[]> {
  return await invoke<championOption[]>('get_champion_options')
}
export interface GameModeOption {
  value: number
  label: string
}
export async function getGameModes(): Promise<GameModeOption[]> {
  return await invoke('get_game_modes')
}
