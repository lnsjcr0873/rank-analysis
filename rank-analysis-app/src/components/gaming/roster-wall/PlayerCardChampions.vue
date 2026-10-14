<script setup lang="ts">
/**
 * 名册墙卡片的英雄使用环。
 *
 * 复刻 Akari `PlayerInfoCardChampionUsage`：按场次取前 N 个英雄，
 * 每个 20px 方形图标，**环色按该英雄胜率**（≥50% 蓝 / <50% 红），熟练度 ≥60 加星标。
 *
 * 环色走 `--champ-ring-win/loss`（语义=该英雄的胜率倾向），不用 --win/--loss：
 * 后者在本页已表示"玩家本人的胜负"，同符号两义会误导。
 */
import { computed } from 'vue'
import { NPopover } from 'naive-ui'

import type { AggregatedChampionAnalysis } from '@renderer/features/gaming/analysis/types'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'

const props = defineProps<{
  champions: AggregatedChampionAnalysis[]
  championName: (id: number) => string
  /**
   * 熟练度等级（championId → level），来自 `RecentPlayerProfile.currentChampionMastery`。
   * 缺失时该英雄不显示星标（缺数据不编造）。
   */
  masteryByChampion?: Record<number, number>
  /** 熟练度达此等级加星标（Akari `STARRED_CHAMPION_LEVEL` = 60） */
  masteryStarLevel?: number
  /** 最多展示几个 */
  max?: number
}>()

const { getChampionUrl } = useAssetUrl()

const limit = computed(() => props.max ?? 9)
const starLevel = computed(() => props.masteryStarLevel ?? 60)

const shown = computed(() => props.champions.slice(0, limit.value))
const overflow = computed(() => props.champions.length - shown.value.length)

/** 该英雄是否已点亮星标（熟练度数据缺失时为 false） */
function isStarred(championId: number): boolean {
  const level = props.masteryByChampion?.[championId]
  return typeof level === 'number' && level >= starLevel.value
}
</script>

<template>
  <div v-if="shown.length" class="pcard-champs">
    <n-popover v-for="c in shown" :key="c.championId" :delay="80" trigger="hover">
      <template #trigger>
        <span
          class="pcard-champ"
          :class="{
            'pcard-champ--win': c.winLoss.winRate >= 0.5,
            'pcard-champ--loss': c.winLoss.winRate < 0.5
          }"
          :title="`${championName(c.championId)} · ${c.count} 场 · 胜率 ${(c.winLoss.winRate * 100).toFixed(0)}%`"
        >
          <img class="pcard-champ-img" :src="getChampionUrl(c.championId)" alt="" />
          <span v-if="isStarred(c.championId)" class="pcard-champ-star">★</span>
        </span>
      </template>
      <div class="pcard-champ-detail">
        <div class="pcard-champ-name">{{ championName(c.championId) }}</div>
        <div>{{ c.count }} 场 · 胜率 {{ (c.winLoss.winRate * 100).toFixed(1) }}%</div>
        <div>跨局 {{ c.score.total.toFixed(2) }} / 17</div>
        <div v-if="isStarred(c.championId)">熟练度已点亮（≥ {{ starLevel }} 级）</div>
        <div v-if="c.positions && Object.keys(c.positions).length">
          常玩分路：{{ Object.keys(c.positions).join(' · ') }}
        </div>
      </div>
    </n-popover>
    <span v-if="overflow > 0" class="pcard-champ-overflow" :title="`还有 ${overflow} 个英雄`">
      +{{ overflow }}
    </span>
  </div>
</template>

<style scoped>
.pcard-champs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-bottom: var(--space-4);
}

.pcard-champ {
  position: relative;
  width: 20px;
  height: 20px;
  border-radius: 2px;
  border: 1px solid transparent;
  cursor: default;
}

.pcard-champ--win {
  border-color: var(--champ-ring-win);
}

.pcard-champ--loss {
  border-color: var(--champ-ring-loss);
}

.pcard-champ-img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 1px;
  object-fit: cover;
  background: var(--bg-sunken);
}

.pcard-champ-star {
  position: absolute;
  right: -2px;
  bottom: -3px;
  font-size: var(--font-size-2xs);
  line-height: 1;
  color: var(--champ-mastery);
  text-shadow: 0 0 2px var(--bg-base);
  pointer-events: none;
}

.pcard-champ-overflow {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  background: var(--bg-raised);
  border-radius: 2px;
}

.pcard-champ-detail {
  max-width: 200px;
  font-size: var(--font-size-2xs);
  line-height: 1.6;
  color: var(--text-secondary);
}

.pcard-champ-name {
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2px;
}
</style>
