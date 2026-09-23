import { describe, it, expect, vi, beforeEach } from 'vitest'

const getConfigByIpc = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc
}))

describe('useRecordV2', () => {
  beforeEach(() => {
    getConfigByIpc.mockReset()
    vi.resetModules()
  })

  it('读取配置键 record.v2Enabled，返回开关 ref', async () => {
    getConfigByIpc.mockResolvedValue(true)
    const { useRecordV2 } = await import('./useRecordV2')
    const flag = useRecordV2()
    await vi.waitFor(() => {
      expect(flag.value).toBe(true)
    })
    expect(getConfigByIpc).toHaveBeenCalledWith('record.v2Enabled')
  })

  it('配置缺失时按开启兜底', async () => {
    getConfigByIpc.mockResolvedValue(undefined)
    const { useRecordV2 } = await import('./useRecordV2')
    const flag = useRecordV2()
    await vi.waitFor(() => {
      expect(flag.value).toBe(true)
    })
  })

  it('读取失败（无 Tauri 后端/网络）时按开启兜底，不悬挂 reject', async () => {
    getConfigByIpc.mockRejectedValue(new Error('no backend'))
    const { useRecordV2 } = await import('./useRecordV2')
    const flag = useRecordV2()
    await vi.waitFor(() => {
      expect(flag.value).toBe(true)
    })
  })

  it('配置为 false 时返回关闭态', async () => {
    getConfigByIpc.mockResolvedValue(false)
    const { useRecordV2 } = await import('./useRecordV2')
    const flag = useRecordV2()
    await vi.waitFor(() => {
      expect(flag.value).toBe(false)
    })
  })
})
