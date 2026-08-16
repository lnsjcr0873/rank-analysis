/**
 * AI 分析 composable 状态机通用模板（loading 互斥 / 前置守卫 / 流式累积 /
 * 错误降级 / 可选缓存）。
 *
 * 背景：4 个 AI 分析 composable（useGrowthReport / useGamingAIAnalysis /
 * useLiveAIAnalysis / useMatchAIAnalysis）各自复制 loading/result/try-catch
 * 状态机，文案与降级策略略有差异。本模板收敛公共部分，差异以参数注入。
 *
 * 一期试点：useGrowthReport。
 * 二期登记（形态比试点多一层多路/轮询/代次控制，迁移时需差异参数化）：
 * - useGamingAIAnalysis（kind 多路状态表 + activeKind）
 * - useLiveAIAnalysis（轮询 startPolling/stopPolling + 自动触发）
 * - useMatchAIAnalysis（runToken 代次互斥 + 两阶段 aiState + 结构化报告）
 *
 * @module composables/useAiAnalysis
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { StreamCallbacks } from '@renderer/services/ai'
import { aiCacheGet, aiCachePut, dataPatch } from '@renderer/services/ai/shared/cache'

/** 把 unknown 错误压成一行文案（Error 取 message；字符串透传；其余给兜底） */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || '未知错误'
  if (typeof e === 'string' && e) return e
  return '未知错误'
}

export interface AiAnalysisOptions<TInput> {
  /**
   * 前置守卫：返回非空文案 = 拦截本次生成并以 message.warning 提示；
   * 返回 null/undefined = 放行
   */
  guardWarning?: (input: TInput) => string | null
  /** 流式生成入口（service 层函数，收到模板装配好的回调） */
  generate: (input: TInput, callbacks: StreamCallbacks) => Promise<void>
  /** 失败时生成完整错误文案（各 composable 保留既有措辞），入参为 unknown */
  onFail: (e: unknown) => string
  /**
   * 可选缓存策略：返回非空 key 时启用——
   * 发起前 aiCacheGet 命中则直接写入 result（不请求、不置 loading）；
   * 流式结束后 aiCachePut 落盘（失败静默，best-effort）
   */
  cacheKey?: (input: TInput) => string | null
}

/**
 * 通用 AI 分析状态机。
 *
 * @param opts - 守卫/生成/失败文案/缓存策略（见 AiAnalysisOptions）
 * @returns loading（互斥标志）、result（流式累积文本）、run（发起入口）
 *
 * # 行为
 * - 已在进行中时 run 直接忽略（并发互斥）
 * - 守卫拦截时只弹 warning，不置 loading、不调 generate
 * - onChunk 追加 / onDone 复位 loading / onError 弹错并复位
 * - generate 同步抛错时与 onError 同路径降级
 *
 * # 示例
 * ```ts
 * const ai = useAiAnalysis<RecentData>({
 *   guardWarning: r => ((r.samples ?? 0) <= 0 ? '样本不足' : null),
 *   generate: (r, cb) => analyzeGrowthReportWithAIStream(r, cb),
 *   onFail: e => '成长报告生成失败: ' + toErrorMessage(e)
 * })
 * await ai.run(recent)
 * ```
 */
export function useAiAnalysis<TInput>(opts: AiAnalysisOptions<TInput>) {
  const message = useMessage()
  const loading = ref(false)
  const result = ref('')

  async function run(input: TInput): Promise<void> {
    if (loading.value) return
    const warning = opts.guardWarning?.(input)
    if (warning) {
      message.warning(warning)
      return
    }

    const key = opts.cacheKey?.(input) ?? null
    if (key) {
      const cached = await aiCacheGet(key, dataPatch())
      if (cached !== null) {
        result.value = cached
        return
      }
    }

    loading.value = true
    result.value = ''
    const settle = (): void => {
      loading.value = false
    }

    try {
      await opts.generate(input, {
        onChunk: chunk => {
          result.value += chunk
        },
        onDone: settle,
        onError: error => {
          message.error(opts.onFail(error))
          settle()
        }
      })
    } catch (e: unknown) {
      message.error(opts.onFail(e))
      settle()
    }

    if (key && result.value) {
      aiCachePut(key, dataPatch(), result.value).catch(() => {
        // 落盘失败不影响本次展示，静默
      })
    }
  }

  return { loading, result, run }
}
