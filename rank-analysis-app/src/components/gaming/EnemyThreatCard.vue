<script setup lang="ts">
/**
 * 赛前敌方威胁评级卡片（M4 战场六）。
 *
 * 展示 champ-select 阶段敌方玩家的威胁评级、风格标签、相遇次数。
 * 数据不足时降级展示，绝不编造。
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
  <div v-if="visible" class="threat-card">
    <!-- 最高威胁指示条 -->
    <div class="threat-header" :style="{ borderColor: maxThreatColor }">
      <span class="threat-label">敌方威胁评级</span>
      <span class="threat-value" :style="{ color: maxThreatColor }">{{ maxThreatLabel }}</span>
    </div>

    <!-- 逐玩家列表 -->
    <div class="threat-list">
      <div
        v-for="r in ratings"
        :key="r.puuid"
        class="threat-row"
        :class="{ 'threat-row-low': r.threatLevel === 'Low' }"
      >
        <div class="threat-row-header">
          <span class="threat-badge" :style="{ background: THREAT_LEVEL_COLORS[r.threatLevel] }">
            {{ THREAT_LEVEL_LABELS[r.threatLevel] }}
          </span>
          <span class="threat-pos">{{ r.position || '?' }}</span>
          <span v-if="r.encounterCount > 0" class="threat-encounter">
            交手 {{ r.encounterCount }} 局
          </span>
        </div>

        <div class="threat-row-stats">
          <span class="threat-stat"> 表现分 {{ formatScore(r.recentPerformance) }} </span>
          <span class="threat-stat"> 胜率 {{ formatPercent(r.mainChampionWinRate) }} </span>
          <span class="threat-stat"> 侵略性 {{ formatScore(r.laneAggression) }} </span>
        </div>

        <div v-if="r.styleTags.length > 0" class="threat-tags">
          <span v-for="tag in r.styleTags" :key="tag" class="threat-tag">{{ tag }}</span>
        </div>

        <div v-if="r.caveats.length > 0" class="threat-caveats">
          <span v-for="c in r.caveats" :key="c" class="threat-caveat">{{ c }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.threat-card {
  margin: 8px 0 0;
  border-radius: 8px;
  background: rgba(18, 25, 38, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.threat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 2px solid;
  border-color: inherit;
  background: rgba(255, 255, 255, 0.03);
}

.threat-label {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
}

.threat-value {
  font-size: 14px;
  font-weight: 800;
}

.threat-list {
  padding: 4px 0;
}

.threat-row {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.threat-row:last-child {
  border-bottom: none;
}

.threat-row-low {
  opacity: 0.8;
}

.threat-row-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.threat-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}

.threat-pos {
  font-size: 12px;
  color: #cbd5e1;
  font-weight: 600;
  text-transform: capitalize;
}

.threat-encounter {
  font-size: 11px;
  color: #fbbf24;
  font-weight: 500;
  margin-left: auto;
}

.threat-row-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.threat-stat {
  font-size: 12px;
  color: #cbd5e1;
  font-weight: 500;
}

.threat-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.threat-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  font-weight: 500;
}

.threat-caveats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.threat-caveat {
  font-size: 11px;
  color: #fbbf24;
  font-style: normal;
}
</style>
