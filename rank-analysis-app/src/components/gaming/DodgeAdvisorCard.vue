<template>
  <div
    class="dodge-advisor-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2.5 mb-3">
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 items-center justify-center rounded-lg border" :class="badgeClass">
          <ShieldAlert v-if="result.recommendation === 'dodge'" class="h-3.5 w-3.5 text-rose-400" />
          <AlertCircle
            v-else-if="result.recommendation === 'caution'"
            class="h-3.5 w-3.5 text-amber-400"
          />
          <CheckCircle2 v-else class="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div>
          <span class="text-xs font-bold text-white tracking-wide"
            >对局质量与秒退诊断 (Dodge Advisor)</span
          >
        </div>
      </div>

      <!-- Recommendation Pill -->
      <span
        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold border"
        :class="recommendationPillClass"
      >
        <span>{{ recommendationLabel }}</span>
      </span>
    </div>

    <!-- Score & Expected EV -->
    <div class="grid grid-cols-3 gap-2 rounded-xl bg-white/[0.03] p-2.5 border border-white/5 mb-3">
      <div class="flex flex-col items-center justify-center">
        <span class="text-[10px] text-white/50">对局质量分</span>
        <span class="text-lg font-black font-mono" :class="scoreColorClass">{{
          result.qualityScore
        }}</span>
      </div>
      <div class="flex flex-col items-center justify-center border-x border-white/10">
        <span class="text-[10px] text-white/50">预测胜率</span>
        <span class="text-lg font-black font-mono text-cyan-300"
          >{{ result.predictedWinRate }}%</span
        >
      </div>
      <div class="flex flex-col items-center justify-center">
        <span class="text-[10px] text-white/50">排位净期望 (EV)</span>
        <span
          class="text-lg font-black font-mono"
          :class="result.expectedLpEv >= 0 ? 'text-emerald-400' : 'text-rose-400'"
        >
          {{ result.expectedLpEv >= 0 ? '+' : '' }}{{ result.expectedLpEv }} LP
        </span>
      </div>
    </div>

    <!-- Summary Text -->
    <div
      class="text-xs leading-relaxed text-white/80 bg-white/[0.02] p-2.5 rounded-lg border border-white/5 mb-3"
    >
      💡 <span class="font-medium">{{ result.summary }}</span>
    </div>

    <!-- Risks & Advantages Breakdown -->
    <div class="flex flex-col gap-1.5">
      <!-- Risks -->
      <div
        v-for="(risk, i) in result.risks"
        :key="`risk-${i}`"
        class="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 text-[11px]"
      >
        <span class="font-bold text-rose-400 shrink-0">⚠️ {{ risk.title }}:</span>
        <span class="text-white/70">{{ risk.detail }}</span>
      </div>

      <!-- Advantages -->
      <div
        v-for="(adv, i) in result.advantages"
        :key="`adv-${i}`"
        class="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-[11px]"
      >
        <span class="font-bold text-emerald-400 shrink-0">✨ {{ adv.title }}:</span>
        <span class="text-white/70">{{ adv.detail }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-vue-next'
import type { DodgeAdvisorResult } from '@renderer/features/gaming/services/dodgeAdvisor'

const props = defineProps<{
  result: DodgeAdvisorResult
}>()

const recommendationLabel = computed(() => {
  switch (props.result.recommendation) {
    case 'play':
      return '🟢 推荐开局'
    case 'caution':
      return '🟡 谨慎观察'
    case 'dodge':
      return '🔴 建议秒退'
    default:
      return '推荐开局'
  }
})

const recommendationPillClass = computed(() => {
  switch (props.result.recommendation) {
    case 'play':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'caution':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    case 'dodge':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
    default:
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  }
})

const badgeClass = computed(() => {
  switch (props.result.recommendation) {
    case 'play':
      return 'bg-emerald-500/15 border-emerald-500/30'
    case 'caution':
      return 'bg-amber-500/15 border-amber-500/30'
    case 'dodge':
      return 'bg-rose-500/15 border-rose-500/30'
    default:
      return 'bg-emerald-500/15 border-emerald-500/30'
  }
})

const scoreColorClass = computed(() => {
  if (props.result.qualityScore >= 70) return 'text-emerald-400'
  if (props.result.qualityScore >= 50) return 'text-cyan-300'
  if (props.result.qualityScore >= 40) return 'text-amber-400'
  return 'text-rose-400'
})
</script>

<style scoped>
.dodge-advisor-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
