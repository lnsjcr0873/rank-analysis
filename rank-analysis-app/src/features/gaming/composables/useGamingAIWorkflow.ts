import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { useGamingAIAnalysis } from '@renderer/composables/useGamingAIAnalysis'
import { useLiveAIAnalysis } from '@renderer/composables/useLiveAIAnalysis'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import type { SessionData } from '@renderer/types/domain/gaming'
import type { OpggMode } from '@renderer/services/opgg'
import type { BpDecision } from '@renderer/types/bpDecision'

export type AITabKey = 'champSelect' | 'live' | 'game'

export function useGamingAIWorkflow(
  sessionData: SessionData,
  opggMode: ComputedRef<OpggMode>,
  mySummoner: Ref<any>,
  bpDecision: Ref<BpDecision | null>,
  lineupScores: Ref<any>
) {
  const route = useRoute()

  const ai = useGamingAIAnalysis(sessionData, opggMode, {
    champSelectExtras: computed(() => ({
      bpDecision: bpDecision.value,
      lineupScore: lineupScores.value
    }))
  })
  const live = useLiveAIAnalysis(sessionData, { mySummoner })

  const aiTab = ref<AITabKey>('champSelect')

  const defaultAiTab = computed<AITabKey>(() => {
    if (sessionData.phase === 'ChampSelect') return 'champSelect'
    if (sessionData.phase === 'InProgress') return 'live'
    return 'game'
  })

  watch(
    () => sessionData.phase,
    () => {
      aiTab.value = defaultAiTab.value
    }
  )

  const champSelectRendered = computed<string>(() => {
    const raw = ai.kindState.champSelect.result.value
    return raw ? renderAnalysisReport(raw) : ''
  })

  const gameRendered = computed<string>(() => {
    const raw = ai.kindState.game.result.value
    return raw ? renderAnalysisReport(raw) : ''
  })

  const liveUpdatedAt = computed<string>(() => {
    const t = live.lastPollAt.value
    if (!t) return ''
    const d = new Date(t)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  })

  const currentTabLoading = computed<boolean>(() => {
    if (aiTab.value === 'live') return live.loading.value
    return ai.kindState[aiTab.value].loading.value
  })

  const aiPanelTitle = computed<string>(() => {
    const phase = sessionData.phase
    const name =
      phase === 'ChampSelect'
        ? '选人期阵容分析'
        : phase === 'InProgress'
          ? '对局实时分析'
          : '赛后整局复盘'
    return `AI 战术军师 · ${name}`
  })

  function handleOpenPanel(): void {
    const tab = defaultAiTab.value
    aiTab.value = tab
    ai.showPanel.value = true
    if (tab === 'live') live.ensureStarted()
    else ai.openPanel()
  }

  function rerunCurrentTab(): void {
    if (aiTab.value === 'live') void live.rerun()
    else void ai.rerunKind(aiTab.value)
  }

  watch(
    () => route?.query?.openAi,
    openAi => {
      if (openAi) {
        handleOpenPanel()
      }
    },
    { immediate: true }
  )

  return {
    ai,
    live,
    aiTab,
    champSelectRendered,
    gameRendered,
    liveUpdatedAt,
    currentTabLoading,
    aiPanelTitle,
    handleOpenPanel,
    rerunCurrentTab
  }
}
