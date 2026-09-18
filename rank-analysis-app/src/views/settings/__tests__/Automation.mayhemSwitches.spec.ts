import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }))

vi.mock('@renderer/composables/useInGameServices', () => ({
  setMayhemAssistEnabled: vi.fn()
}))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { setMayhemAssistEnabled } from '@renderer/composables/useInGameServices'
import Automation from '../Automation.vue'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockSetMayhemAssistEnabled = vi.mocked(setMayhemAssistEnabled)

describe('Automation.vue - mayhem assist & capture switches', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'settings.auto.executeAtSecs') return 5
      return null
    })
    mockPut.mockResolvedValue(undefined)
  })

  it('defaults mayhemAssistEnabled and mayhemCaptureEnabled to false', async () => {
    const wrapper = mount(Automation, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const mayhemCard = wrapper.findAll('.n-card').find(c => c.text().includes('大乱斗 3 选 1 推荐'))
    expect(mayhemCard).toBeDefined()

    const switches = mayhemCard!.findAll('.n-switch')
    expect(switches.length).toBe(2)
    // 默认两个开关均处于关闭状态
    expect(switches[0].classes()).not.toContain('n-switch--active')
    expect(switches[1].classes()).not.toContain('n-switch--active')
    // 截图开关受 assist 开关门禁限制处于 disabled
    expect(switches[1].classes()).toContain('n-switch--disabled')
  })

  it('toggles mayhemAssistEnabled: persists to config and syncs in-game services', async () => {
    const wrapper = mount(Automation, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const mayhemCard = wrapper.findAll('.n-card').find(c => c.text().includes('大乱斗 3 选 1 推荐'))
    const assistSwitch = mayhemCard!.findAll('.n-switch')[0]

    await assistSwitch.trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.mayhemAssistEnabled, true)
    expect(mockSetMayhemAssistEnabled).toHaveBeenCalledWith(true)
  })

  it('toggles mayhemCaptureEnabled when assist is enabled', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'settings.auto.executeAtSecs') return 5
      if (key === CONFIG_KEYS.mayhemAssistEnabled) return true
      return null
    })

    const wrapper = mount(Automation, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const mayhemCard = wrapper.findAll('.n-card').find(c => c.text().includes('大乱斗 3 选 1 推荐'))
    const captureSwitch = mayhemCard!.findAll('.n-switch')[1]

    expect(captureSwitch.classes()).not.toContain('n-switch--disabled')
    await captureSwitch.trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.mayhemCaptureEnabled, true)
  })
})
