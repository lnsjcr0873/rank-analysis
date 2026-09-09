/**
 * DiagnosticsModal 同步反馈回归（R16）
 *
 * mayhemStore.sync 失败/忙碌时，诊断台不得显示"校验完成"；
 * 必须按返回结果如实反馈成功/失败/忙碌。
 *
 * @module components/common/__tests__/DiagnosticsModal.sync
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import DiagnosticsModal from '../DiagnosticsModal.vue'

const syncMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/', name: 'home' }) }))
vi.mock('@renderer/composables/useGameState', () => ({
  useGameState: () => ({
    isConnected: ref(false),
    summoner: ref(null),
    currentPhase: ref(null)
  })
}))
vi.mock('@renderer/features/mayhem/stores/mayhemStore', () => ({
  useMayhemStore: () => ({
    status: { ready: true, activeVersion: '16.16.3' },
    sync: syncMock
  })
}))

async function clickResync(wrapper: ReturnType<typeof mount>): Promise<void> {
  const btns = wrapper.findAll('.diag-mini-btn')
  const target = btns.find(b => b.text().includes('校验数据') || b.text().includes('校验'))
  expect(target).toBeTruthy()
  await target!.trigger('click')
  await flushPromises()
}

describe('DiagnosticsModal 校验反馈（R16）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sync 失败 → 显示校验失败，不显示校验完成', async () => {
    syncMock.mockResolvedValue({ ok: false, error: '同步失败：断网' })
    const wrapper = mount(DiagnosticsModal, { props: { show: true } })
    await clickResync(wrapper)
    expect(wrapper.text()).toContain('校验失败')
    expect(wrapper.text()).not.toContain('校验完成')
    wrapper.unmount()
  })

  it('sync 忙碌 → 显示忙碌中，不显示校验完成', async () => {
    syncMock.mockResolvedValue({ ok: false, busy: true })
    const wrapper = mount(DiagnosticsModal, { props: { show: true } })
    await clickResync(wrapper)
    expect(wrapper.text()).toContain('同步忙碌中')
    expect(wrapper.text()).not.toContain('校验完成')
    wrapper.unmount()
  })

  it('sync 成功 → 显示校验完成', async () => {
    syncMock.mockResolvedValue({ ok: true })
    const wrapper = mount(DiagnosticsModal, { props: { show: true } })
    await clickResync(wrapper)
    expect(wrapper.text()).toContain('校验完成')
    wrapper.unmount()
  })
})
