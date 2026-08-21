import { invoke } from '@tauri-apps/api/core'

export async function relaunchAsAdmin(): Promise<void> {
  return await invoke('relaunch_as_admin')
}

export async function cacheCdragonIcons(): Promise<[number, number]> {
  return await invoke('cache_cdragon_icons')
}

export async function getDeviceId(): Promise<string> {
  return await invoke<string>('get_device_id')
}
