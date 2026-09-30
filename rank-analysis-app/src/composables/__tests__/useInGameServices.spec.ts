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

/**
 * 调度器桩：`start`/`stop` 必须像真实实现一样改写 `running`，
 * 否则断言「写回共享 running 是否等于调度器真实态」会永远失败。
 */
const mockScheduler = {
  start: vi.fn(() => {
    mockScheduler.running = true
  }),
  stop: vi.fn(() => {
    mockScheduler.running = false
  }),
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
  mayhemAssistRunning,
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
    mayhemAssistRunning.value = false
    mockGetConfig.mockResolvedValue(false)
  })

  it('setMayhemAssistEnabled(false) 记录「设置已关闭」原因', () => {
    mockScheduler.running = true
    setMayhemAssistEnabled(false)
    expect(mayhemAssistBlockedReason.value).toBe(ASSIST_BLOCKED_DISABLED)
  })

  it('setMayhemAssistEnabled(true) 清除之前的阻塞原因', () => {
    mayhemAssistBlockedReason.value = ASSIST_BLOCKED_DISABLED
    setMayhemAssistEnabled(true)
    expect(mayhemAssistBlockedReason.value).toBe('')
  })
})

/**
 * 回归：共享 `running` 必须与调度器真实态一致。
 *
 * `mayhemAssistRunning` 原先是 store 私有 `ref(false)`，全局路径
 * `startMayhemAssistIfNeeded` / `stopMayhemAssist` 只写 reason 不写 running，
 * 于是 Mayhem 页按钮与横幅读到的是过期货：
 * - 全局自动开启 → 按钮仍显示「启动对局监听」
 * - 全局停掉 → 按钮仍显示绿色「已开启」，且横幅因
 *   `assistBlocked && !assistRunning` 为 false 被吞掉，又变回静默失效。
 */
describe('useInGameServices mayhem assist running sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScheduler.running = false
    mayhemAssistBlockedReason.value = ''
    mayhemAssistRunning.value = false
  })

  it('setMayhemAssistEnabled(true) 把运行态写回共享 ref', () => {
    setMayhemAssistEnabled(true)
    expect(mayhemAssistRunning.value).toBe(true)
  })

  it('setMayhemAssistEnabled(false) 同时清掉运行态，否则按钮永远显示已开启', () => {
    setMayhemAssistEnabled(true)
    expect(mayhemAssistRunning.value).toBe(true)

    setMayhemAssistEnabled(false)
    expect(mayhemAssistRunning.value).toBe(false)
  })

  it('停止后 reason 与 running 成对写入，横幅不会被 !running 吞掉', () => {
    mockScheduler.running = true
    mayhemAssistRunning.value = true

    setMayhemAssistEnabled(false)

    // 横幅渲染条件是 assistBlocked && !assistRunning，两者必须同时成立
    expect(mayhemAssistBlockedReason.value).not.toBe('')
    expect(mayhemAssistRunning.value).toBe(false)
  })

  it('运行态与调度器真实态始终一致（不靠推断）', () => {
    setMayhemAssistEnabled(true)
    expect(mayhemAssistRunning.value).toBe(mockScheduler.running)

    setMayhemAssistEnabled(false)
    expect(mayhemAssistRunning.value).toBe(mockScheduler.running)
  })
})
