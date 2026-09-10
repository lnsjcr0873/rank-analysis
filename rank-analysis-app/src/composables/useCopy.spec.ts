/**
 * useCopy 单元测试：剪贴板写入结果映射为成功/失败提示（R29-2），
 * 以及瞬时锁竞争下的自动重试（R29-3：Windows 剪贴板独占资源）。
 * naive-ui 的 useMessage 经 mock 注入，避免依赖 MessageProvider 上下文。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('naive-ui', () => ({
  useMessage: () => messageMock
}))

import { useCopy } from './useCopy'

describe('useCopy', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator as object, 'clipboard')
  })

  /** 推进微任务（含 retry 链的微任务 + 已触发的 timer 回调内的微任务） */
  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  it('shows success toast when clipboard write resolves', async () => {
    writeText.mockResolvedValue(undefined)
    const { copy } = useCopy()
    void copy('玩家#520')
    await flushMicrotasks()
    expect(writeText).toHaveBeenCalledWith('玩家#520')
    expect(messageMock.success).toHaveBeenCalledWith('复制成功')
    expect(messageMock.error).not.toHaveBeenCalled()
  })

  it('retries transient clipboard lock failures then shows success', async () => {
    // 第一次写入被其他程序占用（Clipboard locked），第二次成功
    writeText.mockRejectedValueOnce(new Error('Clipboard locked'))
    writeText.mockResolvedValueOnce(undefined)
    const { copy } = useCopy()
    const done = copy('玩家#520')
    await flushMicrotasks()
    // 第一次失败 → 进入 80ms 退避重试
    await vi.advanceTimersByTimeAsync(80)
    await flushMicrotasks()
    await done
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(messageMock.success).toHaveBeenCalledWith('复制成功')
    expect(messageMock.error).not.toHaveBeenCalled()
  })

  it('shows error toast when clipboard write keeps failing after retries', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const { copy } = useCopy()
    const done = copy('玩家#520')
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(80) // retry 1
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(160) // retry 2（最终失败）
    await flushMicrotasks()
    await done
    expect(messageMock.error).toHaveBeenCalledWith('复制失败')
    expect(messageMock.success).not.toHaveBeenCalled()
  })
})
