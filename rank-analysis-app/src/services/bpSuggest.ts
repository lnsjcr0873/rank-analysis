import { invoke } from '@tauri-apps/api/core'
import type { BpSuggestResult } from '../types/bpSuggest'
import type { Position } from '../types/rules'

export async function getBpSuggest(position?: Position): Promise<BpSuggestResult> {
  return await invoke<BpSuggestResult>('get_bp_suggest', { position })
}
