import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))

vi.mock('@renderer/services/knowledge', () => ({
  getKnowledgeStatus: vi.fn(),
  forceUpdateKnowledge: vi.fn()
}))

vi.mock('@renderer/features/overlay/hotkeys', () => ({
  applyOverlayHotkey: vi.fn()
}))

vi.mock('@renderer/composables/useInGameServices', () => ({
  setOverlayDisabled: vi.fn(),
  setLiveGamePollDisabled: vi.fn()
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

import { invoke } from '@tauri-apps/api/core'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import {
  setOverlayDisabled,
  setLiveGamePollDisabled
} from '@renderer/composables/useInGameServices'
import General from '../General.vue'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)
const mockSetOverlayDisabled = vi.mocked(setOverlayDisabled)
const mockSetLiveGamePollDisabled = vi.mocked(setLiveGamePollDisabled)

describe('General.vue - overlay and live game poll switches', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockGet.mockResolvedValue(null)
    mockPut.mockResolvedValue(undefined)
  })

  it('defaults disableOverlay and disableLiveGamePoll to false when config is missing', async () => {
    const wrapper = mount(General, {
      global: { plugins: [naive] }
    })
    await vi.dynamicImportSettled()

    // 找到对局浮窗内的「禁用浮窗」开关
    const overlayItem = wrapper.findAll('.n-form-item').find(el => el.text().includes('对局浮窗'))
    expect(overlayItem).toBeDefined()
    const overlaySwitch = overlayItem!.find('.n-switch')
    expect(overlaySwitch.classes()).not.toContain('n-switch--active')

    // 找到对局数据轮询内的「禁用 1-2s allgamedata 轮询」开关
    const pollItem = wrapper.findAll('.n-form-item').find(el => el.text().includes('对局数据轮询'))
    expect(pollItem).toBeDefined()
    const pollSwitch = pollItem!.find('.n-switch')
    expect(pollSwitch.classes()).not.toContain('n-switch--active')
  })

  it('toggles disableOverlay: persists to config and syncs in-game services', async () => {
    const wrapper = mount(General, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const overlayItem = wrapper.findAll('.n-form-item').find(el => el.text().includes('对局浮窗'))
    const overlaySwitch = overlayItem!.findAll('.n-switch')[0]

    // 开启「禁用浮窗」
    await overlaySwitch.trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.disableOverlay, true)
    expect(mockSetOverlayDisabled).toHaveBeenCalledWith(true)
  })

  it('toggles disableLiveGamePoll: persists to config and syncs in-game services', async () => {
    const wrapper = mount(General, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const pollItem = wrapper.findAll('.n-form-item').find(el => el.text().includes('对局数据轮询'))
    const pollSwitch = pollItem!.find('.n-switch')

    // 开启「禁用轮询」
    await pollSwitch.trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await wrapper.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.disableLiveGamePoll, true)
    expect(mockSetLiveGamePollDisabled).toHaveBeenCalledWith(true)
  })

  it('clicks preview overlay button: invokes preview_overlay_window', async () => {
    const wrapper = mount(General, {
      global: { plugins: [naive] }
    })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const overlayItem = wrapper.findAll('.n-form-item').find(el => el.text().includes('对局浮窗'))
    const previewBtn = overlayItem!.findAll('button').find(b => b.text().includes('测试并预览浮窗'))
    expect(previewBtn).toBeDefined()
    await previewBtn!.trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(mockInvoke).toHaveBeenCalledWith('preview_overlay_window')
  })
})
