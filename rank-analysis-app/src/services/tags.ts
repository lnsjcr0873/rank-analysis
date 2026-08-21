import { invoke } from '@tauri-apps/api/core'
import type { TagConfig } from '../types/tagSuggest'

export async function saveTagConfigs(configs: TagConfig[]): Promise<void> {
  return await invoke('save_tag_configs', { configs })
}

export async function getAllTagConfigs(): Promise<TagConfig[]> {
  return await invoke('get_all_tag_configs')
}
