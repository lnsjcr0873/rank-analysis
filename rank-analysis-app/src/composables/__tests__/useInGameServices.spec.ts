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

vi.mock('@renderer/companion/bridge', () => ({
  startLiveBridge: vi.fn(),
  stopLiveBridge: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc } from '@renderer/services/ipc'
import {
  useInGameServices,
  setOverlayDisabled,
  setLiveGamePollDisabled,
  setMayhemAssistEnabled,
  inGameNextActions
} from '../useInGameServices'
import {
  mayhemAssistBlockedReason,
  ASSIST_BLOCKED_DISABLED
} from '@renderer/features/mayhem/assistState'

import { type NextAction } from '@renderer/services/nextAction'

const mockInvoke = vi.mocked(invoke)
const mockGetConfig = vi.mocked(getConfigByIpc)

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

/**
 * 回归：助手被设置关闭时必须留下**可见原因**。
 *
 * 此前 `startMayhemAssistIfNeeded` 在 `mayhemAssistEnabled === false` 时只
 * `stopMayhemAssist()` 就 return，界面上按钮仍显示「启动对局监听」，
 * 进大乱斗既无推荐也无 band-detect.jsonl，用户完全无从判断原因。
 */
describe('useInGameServices mayhem assist blocked reason', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScheduler.running = false
    mayhemAssistBlockedReason.value = ''
    mockGetConfig.mockResolvedValue(false)
  })

  it('setMayhemAssistEnabled(false) 记录「设置已关闭」原因', () => {
    setMayhemAssistEnabled(false)
    expect(mayhemAssistBlockedReason.value).toBe(ASSIST_BLOCKED_DISABLED)
  })

  it('setMayhemAssistEnabled(true) 清除之前的阻塞原因', () => {
    mayhemAssistBlockedReason.value = ASSIST_BLOCKED_DISABLED
    setMayhemAssistEnabled(true)
    expect(mayhemAssistBlockedReason.value).toBe('')
  })
})
