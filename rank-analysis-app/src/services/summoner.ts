import { invoke } from '@tauri-apps/api/core'
import type { Summoner } from '../types/domain/player'

export async function getMySummoner(): Promise<Summoner> {
  return await invoke<Summoner>('get_my_summoner')
}

export async function getSummonerByName(name: string): Promise<Summoner> {
  return await invoke<Summoner>('get_summoner_by_name', { name })
}

export async function getSummonerByPuuid(puuid: string): Promise<Summoner> {
  return await invoke<Summoner>('get_summoner_by_puuid', { puuid })
}
