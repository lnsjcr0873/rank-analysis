<template>
  <div
    class="aram-balance-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-bold tracking-wide text-white">大乱斗平衡性 & 备选席诊断 (ARAM)</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="text-white/40 hover:text-white transition-colors cursor-pointer"
          :class="{ 'animate-spin': isUpdating }"
          title="更新平衡性数据"
          @click="handleUpdateFandom"
        >
          <RefreshCw class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="text-white/40 hover:text-white transition-colors cursor-pointer"
          title="关闭"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Team Damage Ratio Bar -->
    <div class="mb-3 rounded-xl bg-white/[0.02] p-2 border border-white/5">
      <div class="flex items-center justify-between text-[10px] text-white/60 mb-1 font-mono">
        <span class="text-orange-400 font-bold">物理伤害 (AD): {{ compAnalysis.adPercent }}%</span>
        <span class="text-indigo-400 font-bold">魔法伤害 (AP): {{ compAnalysis.apPercent }}%</span>
      </div>
      <div class="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex">
        <div class="bg-gradient-to-r from-amber-500 to-orange-500 h-full" :style="{ width: `${compAnalysis.adPercent}%` }" />
        <div class="bg-gradient-to-r from-indigo-500 to-cyan-500 h-full" :style="{ width: `${compAnalysis.apPercent}%` }" />
      </div>
      <div class="mt-1.5 text-[10px] text-white/70">
        {{ compAnalysis.statusText }}
      </div>
    </div>

    <!-- Bench Recommendation Alert -->
    <div v-if="compAnalysis.recommendations.length > 0" class="mb-2.5 flex flex-col gap-1.5">
      <div
        v-for="rec in compAnalysis.recommendations"
        :key="rec.championId"
        class="flex items-center justify-between gap-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 p-2 text-xs"
      >
        <div class="flex items-center gap-2">
          <Sparkles class="h-3.5 w-3.5 text-cyan-300 animate-pulse shrink-0" />
          <div class="flex flex-col">
            <span class="font-bold text-cyan-300">推荐换入【{{ rec.name }}】</span>
            <span class="text-[10px] text-white/70">{{ rec.reason }}</span>
          </div>
        </div>
        <span class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-mono text-indigo-300 border border-indigo-500/40 shrink-0">
          {{ rec.buffSummary }}
        </span>
      </div>
    </div>

    <!-- Current Champion Balance Info -->
    <div class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
      <div
        class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 border border-white/10 overflow-hidden"
      >
        <img
          src="https://ddragon.leagueoflegends.com/cdn/14.10.1/img/champion/TwistedFate.png"
          alt="TF"
          class="h-full w-full object-cover"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
      </div>

      <div class="flex flex-col flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-bold text-white">卡牌大师</span>
          <span class="text-[10px] text-white/50">崔斯特</span>
        </div>
        <div class="flex items-center gap-3 text-[10px] mt-1 font-mono">
          <span class="text-emerald-400 font-bold">Buff: 造成伤害 ↑5%</span>
          <span class="text-rose-400 font-bold">Nerf: 承受伤害 ↑5%</span>
        </div>
        <div class="flex items-center gap-2 text-[10px] text-white/40 mt-0.5">
          <span>韧性: 20%</span>
          <span>技能急速: 0</span>
        </div>
      </div>
    </div>

    <!-- Footer Action -->
    <div class="mt-2.5 flex items-center justify-center border-t border-white/[0.04] pt-2">
      <button
        type="button"
        class="text-[11px] text-white/50 hover:text-cyan-400 transition-colors cursor-pointer flex items-center gap-1"
      >
        <span>查看全部英雄</span>
        <ChevronRight class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { X, ChevronRight, RefreshCw, Sparkles } from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { analyzeAramComp } from '@renderer/features/gaming/services/aramAdvisor'

const props = withDefaults(
  defineProps<{
    myTeamChampionIds?: number[]
    benchChampionIds?: number[]
  }>(),
  {
    myTeamChampionIds: () => [1, 103, 99, 134],
    benchChampionIds: () => [15, 11]
  }
)

const isUpdating = ref(false)

const compAnalysis = computed(() =>
  analyzeAramComp(
    props.myTeamChampionIds,
    props.benchChampionIds,
    id => (id === 15 ? '希维尔' : id === 11 ? '无极剑圣' : `英雄${id}`)
  )
)

async function handleUpdateFandom() {
  if (isUpdating.value) return
  isUpdating.value = true
  try {
    await invoke('update_fandom_data')
  } catch (error) {
    console.warn('[fandom] update failed', error)
  } finally {
    isUpdating.value = false
  }
}
</script>

<style scoped>
.aram-balance-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
