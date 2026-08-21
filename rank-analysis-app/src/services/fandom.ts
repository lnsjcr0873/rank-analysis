import { invoke } from '@tauri-apps/api/core'

export async function updateFandomData(): Promise<void> {
  return await invoke('update_fandom_data')
}
