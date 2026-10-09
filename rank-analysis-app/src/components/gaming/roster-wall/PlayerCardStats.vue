<script setup lang="ts">
/**
 * 名册墙卡片的三栏统计：胜率 / 场均 KDA / 分路。
 *
 * 染色口径（沿用 Akari `PlayerInfoCardStats`）：
 * - 胜率 ≥ 53% 绿、≤ 47% 红、之间中性（0.47~0.53 是噪声区，不该判定优劣）
 * - KDA 用**跨局离群判定**（IQR 0.65，见 `computeKdaOutliers`）而非绝对阈值——
 *   同场 10 人里谁明显强于他人比"是否超过某个固定 KDA"更有信息量
 *
 * 颜色一律走 `--win` / `--loss`，**不用品牌金**（CODE_QUALITY：胜负数据必须语义色）。
 */
import { computed } from 'vue'
import { NPopover } from 'naive-ui'

import type { KdaOutlier } from '@renderer/features/gaming/roster-wall/playerTags'

const props = defineProps<{
  winRate: number
  gameCount: number
  avgKda: number
  kdaOutlier: KdaOutlier
  /** 本局分路文字（如「打野」） */
  positionLabel: string
  /** 近 50 场常玩分路（最多 3 个），为空表示 timeline 缺失 */
  recentPositions: string[]
  /** 本局分路是否由系统自动分配（补位） */
  autofilled: boolean
  kills: number
  deaths: number
  assists: number
}>()

const winTone = computed<'win' | 'neutral' | 'loss'>(() => {
  if (props.winRate >= 0.53) return 'win'
  if (props.winRate <= 0.47) return 'loss'
  return 'neutral'
})

const kdaTone = computed<'win' | 'neutral' | 'loss'>(() => {
  if (props.kdaOutlier === 'over') return 'win'
  if (props.kdaOutlier === 'below') return 'loss'
  return 'neutral'
})
</script>

<template>
  <div class="pcard-stats">
    <n-popover :delay="80" trigger="hover">
      <template #trigger>
        <span class="pcard-stat" :class="`pcard-stat--${winTone}`">
          {{ (winRate * 100).toFixed(0) }}%<span class="pcard-stat-n">({{ gameCount }})</span>
        </span>
      </template>
      <div class="pcard-stat-detail">
        近 {{ gameCount }} 场胜率 {{ (winRate * 100).toFixed(2) }}%
      </div>
    </n-popover>

    <n-popover :delay="80" trigger="hover">
      <template #trigger>
        <span class="pcard-stat" :class="`pcard-stat--${kdaTone}`">{{ avgKda.toFixed(2) }}</span>
      </template>
      <div class="pcard-stat-detail">
        跨局场均 KDA {{ avgKda.toFixed(2) }}<br />
        累计 {{ kills }} / {{ deaths }} / {{ assists }}（K/D/A）
      </div>
    </n-popover>

    <n-popover v-if="recentPositions.length" :delay="80" trigger="hover">
      <template #trigger>
        <span class="pcard-pos">
          <span v-if="autofilled" class="pcard-autofill">补位</span>
          <span class="pcard-pos-now">{{ positionLabel }}</span>
          <span v-if="recentPositions.length" class="pcard-pos-div" />
          <span v-for="p in recentPositions.slice(0, 3)" :key="p" class="pcard-pos-recent">{{
            p
          }}</span>
        </span>
      </template>
      <div class="pcard-stat-detail">近 50 场常玩分路：{{ recentPositions.join(' · ') }}</div>
    </n-popover>

    <span v-else class="pcard-pos">
      <span class="pcard-pos-now">{{ positionLabel }}</span>
    </span>
  </div>
</template>

<style scoped>
.pcard-stats {
  display: flex;
  align-items: center;
  margin: var(--space-4) 0;
}

.pcard-stat {
  flex: 1;
  text-align: center;
  font-size: var(--font-size-md);
  font-weight: 700;
  line-height: 1.2;
  cursor: default;
}

.pcard-stat-n {
  font-size: var(--font-size-2xs);
  font-weight: 400;
  opacity: 0.7;
}

.pcard-stat--win {
  color: var(--win-bright);
}
.pcard-stat--loss {
  color: var(--loss-bright);
}
.pcard-stat--neutral {
  color: var(--text-primary);
}

.pcard-stat-detail {
  max-width: 220px;
  font-size: var(--font-size-2xs);
  line-height: 1.6;
  color: var(--text-secondary);
}

.pcard-pos {
  flex: 1.2;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: var(--font-size-2xs);
  cursor: default;
}

.pcard-autofill {
  padding: 0 3px;
  border-radius: 2px;
  background: var(--tag-danger);
  color: var(--tag-on-danger);
  font-weight: 700;
}

.pcard-pos-now {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.pcard-pos-div {
  width: 1px;
  height: 10px;
  background: var(--border-strong);
}

.pcard-pos-recent {
  color: var(--text-tertiary);
}
</style>
