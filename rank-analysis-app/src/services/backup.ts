import { invoke } from '@tauri-apps/api/core'

export async function exportBackup(path: string): Promise<void> {
  return await invoke('export_backup', { path })
}

export async function readTextFile(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path })
}

export async function applyConfigSnapshot(snapshot: unknown): Promise<void> {
  return await invoke('apply_config_snapshot', { snapshot })
}
