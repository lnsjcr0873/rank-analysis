/**
 * 成长报告（D-P1 用户画像：战绩页左栏趋势卡）——纯用户触发式流式生成。
 *
 * 与 D-P2 分析块不同，这里没有轮询/自动发起：用户点「生成」才跑，
 * 可重复点击重新生成（替换旧结果）。样本不足（samples === 0）时不允许生成。
 *
 * @module composables/useGrowthReport
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import { analyzeGrowthReportWithAIStream } from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { toErrorMessage, useAiAnalysis } from './useAiAnalysis'
import type { MinuteCurveInsights } from '@renderer/components/record/minuteCurve'
import type { RecentData } from '@renderer/types/domain/analysis'

/** 生成入参：样本数据 + 可选分时曲线洞察 */
type GrowthInput = { recent: RecentData; curveInsights?: MinuteCurveInsights | null }

export function useGrowthReport(): {
  loading: Ref<boolean>
  result: Ref<string>
  renderedResult: ComputedRef<string>
  generate: (recent: RecentData, curveInsights?: MinuteCurveInsights | null) => Promise<void>
} {
  // 状态机走通用模板；本 composable 只保留业务差异（守卫文案/失败措辞/渲染派生）
  const ai = useAiAnalysis<GrowthInput>({
    guardWarning: input =>
      (input.recent.samples ?? 0) <= 0 ? '近 20 场暂无有效样本，无法生成成长报告' : null,
    generate: (input, callbacks) =>
      analyzeGrowthReportWithAIStream(input.recent, callbacks, input.curveInsights),
    onFail: e => '成长报告生成失败: ' + toErrorMessage(e)
  })
  const renderedResult = computed(() => renderAnalysisReport(ai.result.value))

  async function generate(
    recent: RecentData,
    curveInsights?: MinuteCurveInsights | null
  ): Promise<void> {
    await ai.run({ recent, curveInsights })
  }

  return {
    loading: ai.loading,
    result: ai.result,
    renderedResult,
    generate
  }
}
