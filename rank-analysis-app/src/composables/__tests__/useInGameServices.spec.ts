import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

vi.mock('../useSessionSync', () => ({
  useSessionSync: () => ({
    sessionData: {
      phase: 'InProgress',
      queueId: 2400,
      subteams: []
    }
  })
}))

vi.mock('../useGameState', () => ({
  gameSummoner: { value: { puuid: 'test-puuid', gameName: 'tester' } }
}))

const mockScheduler = {
  start: vi.fn(),
  stop: vi.fn(),
  running: false
}

vi.mock('@renderer/features/mayhem/trigger', () => ({
  getSharedAssistScheduler: () => mockScheduler
}))

vi.mock('@renderer/services/nextAction', () => ({
  getNextActions: vi.fn().mockResolvedValue([])
}))

import { invoke } from '@tauri-apps/api/core'
import {
  useInGameServices,
  setOverlayDisabled,
  setLiveGamePollDisabled,
  setMayhemAssistEnabled,
  inGameNextActions
} from '../useInGameServices'

import { type NextAction } from '@renderer/services/nextAction'

const mockInvoke = vi.mocked(invoke)

describe('useInGameServices switches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScheduler.running = false
  })

  it('setOverlayDisabled(true) immediately invokes hide_overlay_window', async () => {
    useInGameServices()
    await setOverlayDisabled(true)
    expect(mockInvoke).toHaveBeenCalledWith('hide_overlay_window')
  })

  it('setLiveGamePollDisabled(true) clears inGameNextActions', () => {
    useInGameServices()
    const dummyAction: NextAction = {
      kind: 'buy_item',
      championId: 1,
      itemId: 1001,
      reason: '测试',
      urgency: 'low',
      validUntil: Date.now() + 1000
    }
    inGameNextActions.value = [dummyAction]
    setLiveGamePollDisabled(true)
    expect(inGameNextActions.value).toEqual([])
  })

  it('setMayhemAssistEnabled(false) calls stop on scheduler', () => {
    mockScheduler.running = true
    setMayhemAssistEnabled(false)
    expect(mockScheduler.stop).toHaveBeenCalled()
  })

  it('setMayhemAssistEnabled(true) calls start on scheduler when in mayhem mode', () => {
    mockScheduler.running = false
    setMayhemAssistEnabled(true)
    expect(mockScheduler.start).toHaveBeenCalled()
  })
})
