/**
 * useAiAnalysis 模板单元测试。
 *
 * 回归重点（模板三路径 + 扩展）：
 * - loading 互斥：进行中重复 run 被忽略
 * - 缓存命中：直接写入 result，不请求、不置 loading
 * - 错误降级：onError 与 generate 抛错同路径——弹错 + 复位
 * - 前置守卫：warning 拦截，不置 loading、不调 generate
 * - 流式累积：onChunk 追加 / onDone 复位；带缓存时 done 后落盘
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { StreamCallbacks } from '@renderer/services/ai'
import { useAiAnalysis, toErrorMessage, type AiAnalysisOptions } from './useAiAnalysis'

const messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', () => ({ useMessage: () => messageStub }))
vi.mock('@renderer/services/ai/shared/cache', () => ({
  aiCacheGet: vi.fn(),
  aiCachePut: vi.fn(),
  dataPatch: () => 'patch-9.9'
}))

import { aiCacheGet, aiCachePut } from '@renderer/services/ai/shared/cache'

let captured: StreamCallbacks | null = null
const neverSettled = new Promise<void>(() => {})

function makeOptions(over: Partial<AiAnalysisOptions<string>> = {}): AiAnalysisOptions<string> {
  return {
    generate: vi.fn((_input, cb) => {
      captured = cb
      return neverSettled
    }) as AiAnalysisOptions<string>['generate'],
    onFail: e => '失败: ' + toErrorMessage(e),
    ...over
  }
}

function withSetup<T>(composable: () => T): T {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return () => null
    }
  })
  const wrapper = mount(Wrapper)
  wrapper.unmount()
  return result
}

describe('useAiAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured = null
  })

  it('流式：chunk 累积、done 复位 loading', async () => {
    vi.mocked(aiCacheGet).mockResolvedValue(null)
    const ai = withSetup(() => useAiAnalysis(makeOptions()))

    void ai.run('in1')
    await nextTick()
    expect(ai.loading.value).toBe(true)

    captured!.onChunk('第一段')
    captured!.onChunk('第二段')
    expect(ai.result.value).toBe('第一段第二段')

    captured!.onDone()
    await nextTick()
    expect(ai.loading.value).toBe(false)
    expect(messageStub.error).not.toHaveBeenCalled()
  })

  it('loading 互斥：进行中重复 run 被忽略', async () => {
    vi.mocked(aiCacheGet).mockResolvedValue(null)
    const gen = vi.fn().mockReturnValue(neverSettled)
    const ai = withSetup(() => useAiAnalysis(makeOptions({ generate: gen as never })))

    void ai.run('a')
    await nextTick()
    await ai.run('b')

    expect(gen).toHaveBeenCalledTimes(1)
    expect(ai.loading.value).toBe(true)
  })

  it('缓存命中：直接写入 result，不请求且不置 loading', async () => {
    const gen = vi.fn()
    vi.mocked(aiCacheGet).mockResolvedValue('缓存结果')
    vi.mocked(aiCachePut).mockResolvedValue(undefined)
    const ai = withSetup(() =>
      useAiAnalysis(
        makeOptions({
          generate: gen as never,
          cacheKey: () => 'key-1'
        })
      )
    )

    await ai.run('in')

    expect(ai.result.value).toBe('缓存结果')
    expect(gen).not.toHaveBeenCalled()
    expect(ai.loading.value).toBe(false)
    expect(aiCacheGet).toHaveBeenCalledWith('key-1', 'patch-9.9')
  })

  it('错误降级(onError)：弹错并复位 loading', async () => {
    vi.mocked(aiCacheGet).mockResolvedValue(null)
    const ai = withSetup(() => useAiAnalysis(makeOptions()))

    void ai.run('in')
    await nextTick()
    captured!.onError('模型超时')
    await nextTick()

    expect(messageStub.error).toHaveBeenCalledWith(expect.stringContaining('模型超时'))
    expect(ai.loading.value).toBe(false)
  })

  it('错误降级(generate 抛错)：与 onError 同路径', async () => {
    vi.mocked(aiCacheGet).mockResolvedValue(null)
    const gen = vi.fn().mockRejectedValue(new Error('ipc down'))
    const ai = withSetup(() => useAiAnalysis(makeOptions({ generate: gen as never })))

    await ai.run('in')
    await nextTick()

    expect(messageStub.error).toHaveBeenCalledWith(expect.stringContaining('ipc down'))
    expect(ai.loading.value).toBe(false)
  })

  it('前置守卫：warning 拦截，不置 loading、不调 generate', async () => {
    const gen = vi.fn()
    const ai = withSetup(() =>
      useAiAnalysis(
        makeOptions({
          generate: gen as never,
          guardWarning: input => (input === 'empty' ? '样本不足' : null)
        })
      )
    )

    await ai.run('empty')
    await nextTick()

    expect(messageStub.warning).toHaveBeenCalledWith('样本不足')
    expect(gen).not.toHaveBeenCalled()
    expect(ai.loading.value).toBe(false)
  })

  it('带缓存：done(=generate resolve)后落盘最终结果', async () => {
    vi.mocked(aiCacheGet).mockResolvedValue(null)
    vi.mocked(aiCachePut).mockResolvedValue(undefined)
    let resolveGen: () => void = () => {}
    const gen = vi.fn((_i: string, cb: StreamCallbacks) => {
      captured = cb
      return new Promise<void>(r => (resolveGen = r))
    })
    const ai = withSetup(() =>
      useAiAnalysis(
        makeOptions({
          generate: gen as never,
          cacheKey: input => 'key-' + input
        })
      )
    )

    void ai.run('abc')
    await nextTick()
    captured!.onChunk('最终')
    captured!.onDone()
    resolveGen()
    await new Promise<void>(r => setTimeout(r, 0))

    expect(aiCachePut).toHaveBeenCalledWith('key-abc', 'patch-9.9', '最终')
  })

  describe('toErrorMessage', () => {
    it('Error 取 message', () => {
      expect(toErrorMessage(new Error('boom'))).toBe('boom')
    })
    it('字符串透传', () => {
      expect(toErrorMessage('模型超时')).toBe('模型超时')
    })
    it('其余给兜底文案', () => {
      expect(toErrorMessage(null)).toBe('未知错误')
      expect(toErrorMessage(42)).toBe('未知错误')
      expect(toErrorMessage('')).toBe('未知错误')
    })
  })
})
