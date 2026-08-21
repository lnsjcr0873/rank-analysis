import { invoke } from '@tauri-apps/api/core'
import { NextAction } from '@renderer/services/nextAction'

export async function pushOverlayData(actions: NextAction[]) {
  return await invoke('push_overlay_data', { actions })
}

export async function showOverlayWindow() {
  return await invoke('show_overlay_window')
}

export async function hideOverlayWindow() {
  return await invoke('hide_overlay_window')
}
