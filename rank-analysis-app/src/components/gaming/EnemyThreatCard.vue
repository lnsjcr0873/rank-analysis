<script setup lang="ts">
/**
 * 赛前敌方威胁评级卡片（M4 战场六）
 */
import { computed } from 'vue'
import type { ThreatRating } from '@renderer/services/scouting'
import { THREAT_LEVEL_LABELS, THREAT_LEVEL_COLORS } from '@renderer/services/scouting'

const props = defineProps<{
  ratings: ThreatRating[]
}>()

const visible = computed(() => (props.ratings?.length ?? 0) > 0)

const maxThreat = computed(() => {
  if (!props.ratings || props.ratings.length === 0) return null
  const ord: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 }
  return props.ratings.reduce((a, b) => (ord[a.threatLevel] >= ord[b.threatLevel] ? a : b))
})

const maxThreatColor = computed(() => {
  if (!maxThreat.value) return '#888'
  return THREAT_LEVEL_COLORS[maxThreat.value.threatLevel]
})

const maxThreatLabel = computed(() => {
  if (!maxThreat.value) return ''
  return THREAT_LEVEL_LABELS[maxThreat.value.threatLevel]
})

function formatPercent(v: number | null): string {
  if (v === null || v === undefined) return '-'
  return `${(v * 100).toFixed(0)}%`
}

function formatScore(v: number): string {
  return v.toFixed(1)
}
</script>

<template>
  <div
    v-if="visible"
    class="threat-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- 最高威胁指示条 Header -->
    <div
      class="threat-header flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2"
      :style="{ borderColor: maxThreatColor }"
    >
      <span class="threat-label text-xs font-bold tracking-wide text-white">敌方威胁评级</span>
      <span class="threat-value text-xs font-black" :style="{ color: maxThreatColor }">{{
        maxThreatLabel
      }}</span>
    </div>

    <!-- 逐玩家列表 -->
    <div class="threat-list flex flex-col gap-2">
      <div
        v-for="r in ratings"
        :key="r.puuid"
        class="threat-row flex flex-col gap-1.5 rounded-xl bg-white/[0.03] p-2.5 border border-white/5 hover:bg-white/[0.06] transition-all"
        :class="{ 'threat-row-low opacity-75': r.threatLevel === 'Low' }"
      >
        <div class="threat-row-header flex items-center gap-2">
          <span
            class="threat-badge rounded px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm"
            :style="{ background: THREAT_LEVEL_COLORS[r.threatLevel] }"
          >
            {{ THREAT_LEVEL_LABELS[r.threatLevel] }}
          </span>
          <span class="threat-pos text-xs font-bold text-slate-300">{{ r.position || '?' }}</span>
          <span
            v-if="r.encounterCount > 0"
            class="threat-encounter text-[11px] font-bold text-amber-300 ml-auto"
          >
            交手 {{ r.encounterCount }} 局
          </span>
        </div>

        <div class="threat-row-stats flex items-center gap-3 text-xs text-white/70">
          <span class="threat-stat">表现分 {{ formatScore(r.recentPerformance) }}</span>
          <span class="threat-stat">胜率 {{ formatPercent(r.mainChampionWinRate) }}</span>
          <span class="threat-stat">侵略性 {{ formatScore(r.laneAggression) }}</span>
        </div>

        <div v-if="r.styleTags.length > 0" class="threat-tags flex flex-wrap gap-1">
          <span
            v-for="tag in r.styleTags"
            :key="tag"
            class="threat-tag rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-bold text-rose-300"
          >
            {{ tag }}
          </span>
        </div>

        <div v-if="r.caveats.length > 0" class="threat-caveats flex flex-wrap gap-1">
          <span
            v-for="c in r.caveats"
            :key="c"
            class="threat-caveat text-[10px] text-amber-300 font-medium"
          >
            {{ c }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.threat-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
