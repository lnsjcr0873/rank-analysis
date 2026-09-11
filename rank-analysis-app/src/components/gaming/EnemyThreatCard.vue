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
  /** 敌方匿名（Riot 反侦查）：有敌方但全无身份，渲染显式引导而非静默空白 */
  anonymous?: boolean
}>()

const visible = computed(() => (props.ratings?.length ?? 0) > 0 || props.anonymous === true)

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
    <!-- 敌方匿名（Riot 反侦查）：显式引导而非静默白板 -->
    <div v-if="anonymous && ratings.length === 0" class="threat-anon">
      <div class="threat-anon-title">敌方已开启匿名防侦查</div>
      <div class="threat-anon-body">
        高分段/新版本选人期 Riot 不下发敌方身份，无法查询个人战绩。
        建议参考「阵容强度」与「关键对线」（OP.GG 对位大数据）做 BP 决策；
        进入加载画面后身份可见，可再查看玩家画像。
      </div>
    </div>
    <template v-else>
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
    </template>
  </div>
</template>

<style scoped>
.threat-card {
  margin: 0 0 12px;
  border-radius: 8px;
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  overflow: hidden;
}

/* 敌方匿名引导：与威胁头同级的信息块 */
.threat-anon {
  padding: 10px 12px;
}

.threat-anon-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e5e5e5);
  margin-bottom: 4px;
}

.threat-anon-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #aaa);
}

.threat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 2px solid;
  border-color: inherit;
}

.threat-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e5e5e5);
}

.threat-value {
  font-size: 14px;
  font-weight: 700;
}

.threat-list {
  padding: 4px 0;
}

.threat-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.04));
}

.threat-row:last-child {
  border-bottom: none;
}

.threat-row-low {
  opacity: 0.6;
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
  font-weight: 600;
  color: #fff;
}

.threat-pos {
  font-size: 12px;
  color: var(--text-secondary, #999);
  text-transform: capitalize;
}

.threat-encounter {
  font-size: 11px;
  color: var(--text-tertiary, #888);
  margin-left: auto;
}

.threat-row-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.threat-stat {
  font-size: 12px;
  color: var(--text-secondary, #aaa);
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
  background: var(--bg-tag, rgba(255, 255, 255, 0.08));
  color: var(--text-secondary, #aaa);
}

.threat-caveats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.threat-caveat {
  font-size: 11px;
  color: var(--text-tertiary, #777);
  font-style: italic;
}
</style>
