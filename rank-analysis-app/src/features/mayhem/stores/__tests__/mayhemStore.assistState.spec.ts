import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../services/mayhemData', () => ({
  getMayhemChampions: vi.fn(),
  getMayhemAugments: vi.fn(),
  getMayhemChampionDetail: vi.fn(),
  getMayhemStatus: vi.fn(),
  syncMayhemData: vi.fn(),
  getMyChampionStats: vi.fn(),
  getMyAugmentStats: vi.fn(),
  extractMayhemChampions: vi.fn(() => [])
}))

const mockScheduler = {
  start: vi.fn(() => {
    mockScheduler.running = true
  }),
  stop: vi.fn(() => {
    mockScheduler.running = false
  }),
  running: false
}

vi.mock('../../trigger', () => ({
  getSharedAssistScheduler: () => mockScheduler,
  onSharedAssistTick: vi.fn()
}))

vi.mock('../../services/mayhemOcr', () => ({
  prewarmMayhemOcr: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/features/overlay/panels', () => ({
  setOverlayClickThrough: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/services/ipc', () => ({
  putConfigByIpc: vi.fn().mockResolvedValue(undefined)
}))

import { useMayhemStore } from '../mayhemStore'
import { mayhemAssistBlockedReason, mayhemAssistRunning } from '../../assistState'

/**
 * 回归：store 的 `assistRunning` / `assistBlockedReason` 必须**跟随**共享模块 ref，
 * 不能是 store 私有 state。
 *
 * 私有 `ref(false)` 会让 Mayhem 页按钮只跟随「用户点按钮」这一条路径更新：
 * 全局自动开启时仍显示「启动对局监听」，全局停掉时仍显示绿色「已开启」，
 * 后者还会让横幅条件 `assistBlocked && !assistRunning` 为 false，把阻塞提示吞掉。
 *
 * 断言走**行为**而非引用相等：Pinia 在 store 实例上会自动解包 ref，
 * `store.assistRunning` 拿到的是原始 boolean，比不出引用身份；而「外部写共享
 * ref 后 store 是否随之变」恰好就是私有 ref 与共享 ref 的唯一可观测差别。
 */
describe('mayhemStore assist state tracks shared module refs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockScheduler.running = false
    mayhemAssistRunning.value = false
    mayhemAssistBlockedReason.value = ''
  })

  it('外部（全局服务）写共享 ref 后，按钮状态随之变化', () => {
    const store = useMayhemStore()
    expect(store.assistRunning).toBe(false)

    // 模拟 useInGameServices 的全局自动启动写回
    mayhemAssistRunning.value = true
    expect(store.assistRunning).toBe(true)

    mayhemAssistRunning.value = false
    mayhemAssistBlockedReason.value = '已在设置中关闭自动识别（设置 → 大乱斗 → 三选一助手）'
    expect(store.assistRunning).toBe(false)
    expect(store.assistBlockedReason).not.toBe('')
  })

  it('store 侧写入也反映回共享 ref（双向一致）', () => {
    const store = useMayhemStore()

    store.toggleAssist()
    expect(store.assistRunning).toBe(true)
    expect(mayhemAssistRunning.value).toBe(true)

    store.toggleAssist()
    expect(store.assistRunning).toBe(false)
    expect(mayhemAssistRunning.value).toBe(false)
  })

  it('store 内不存在与共享 ref 脱钩的私有 running 副本', () => {
    const store = useMayhemStore()
    // 私有 ref 会让 store 里的值与共享 ref 互不影响；共享 ref 下必须同步
    mayhemAssistRunning.value = true
    expect(store.$state.assistRunning).toBe(true)
  })

  it('toggleAssist 起停后与调度器真实态一致', () => {
    const store = useMayhemStore()

    store.toggleAssist()
    expect(store.assistRunning).toBe(true)
    expect(mockScheduler.running).toBe(true)

    store.toggleAssist()
    expect(store.assistRunning).toBe(false)
    expect(mockScheduler.running).toBe(false)
  })

  it('stopAssist 带原因时清掉 running，让横幅能显示', () => {
    const store = useMayhemStore()
    store.toggleAssist()
    expect(store.assistRunning).toBe(true)

    store.stopAssist('已在设置中关闭自动识别（设置 → 大乱斗 → 三选一助手）')

    expect(store.assistRunning).toBe(false)
    expect(store.assistBlockedReason).toBe('已在设置中关闭自动识别（设置 → 大乱斗 → 三选一助手）')
  })
})
