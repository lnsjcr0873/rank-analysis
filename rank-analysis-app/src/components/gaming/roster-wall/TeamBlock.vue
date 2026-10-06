<script setup lang="ts">
/**
 * 名册墙的单个队伍块：标题 + 队级汇总 + 卡片网格。
 *
 * 上下堆叠布局（ADR-4）：我方一排在上、敌方一排在下。
 * 列数由 `RosterWall` 按容器宽度算出后以 prop 传入——本组件不自己算，
 * 避免两处口径漂移（Akari 的 `columnsNeed` 公式只有一处实现）。
 */
import { computed } from 'vue'

import PlayerCard from './PlayerCard.vue'
import type { RosterWallMember } from '@renderer/features/gaming/roster-wall/member'
import type { KdaOutlier } from '@renderer/features/gaming/roster-wall/playerTags'

const props = defineProps<{
  side: 'ally' | 'enemy'
  title: string
  /** 该队成员（已按设置排序） */
  members: RosterWallMember[]
  columns: number
  championName: (id: number) => string
  masteryByChampion?: Record<string, Record<number, number>>
  isSelfPuuid: string
  kdaOutliers: Map<string, KdaOutlier>
  density?: 'full' | 'slim'
  historyExpanded?: Set<string>
  tagsExpanded?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'toggle-history', puuid: string): void
  (e: 'toggle-tags', puuid: string): void
}>()

const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${props.columns}, 240px)` }))

/** 队级汇总：只对有画像的成员求均值（无画像者不参与，避免拉低） */
const teamSummary = computed(() => {
  const rated = props.members.filter(m => m.analysis.profile !== null)
  if (rated.length === 0)
    return { winRate: null, avgKda: null, shown: 0, empty: props.members.length }
  const winRate =
    rated.reduce((s, m) => s + m.analysis.profile!.winLoss.all.winRate, 0) / rated.length
  const avgKda = rated.reduce((s, m) => s + m.analysis.profile!.summary.avgKda, 0) / rated.length
  return {
    winRate,
    avgKda,
    shown: rated.length,
    empty: props.members.length - rated.length
  }
})
</script>

<template>
  <section class="rw-team">
    <header class="rw-team-head">
      <span class="rw-team-dot" :class="`rw-team-dot--${side}`" />
      <h3 class="rw-team-title">{{ title }}</h3>
      <span v-if="teamSummary.winRate !== null" class="rw-team-meta">
        均胜率 {{ (teamSummary.winRate * 100).toFixed(0) }}% · 均 KDA
        {{ (teamSummary.avgKda ?? 0).toFixed(2) }}
      </span>
      <span v-if="teamSummary.empty > 0" class="rw-team-empty">
        {{ teamSummary.empty }} 人无可用画像
      </span>
    </header>

    <div class="rw-team-grid" :style="gridStyle">
      <template v-for="m in members" :key="m.puuid">
        <PlayerCard
          v-if="m.analysis.profile"
          :profile="m.analysis.profile"
          :puuid="m.puuid"
          :display-name="m.displayName"
          :tag-line="m.tagLine"
          :summoner-level="m.summonerLevel"
          :champion-id="m.championId"
          :position-label="m.positionLabel"
          :autofilled="m.autofilled"
          :solo-tier-label="m.soloTierLabel"
          :flex-tier-label="m.flexTierLabel"
          :solo-tier-key="m.soloTierKey"
          :flex-tier-key="m.flexTierKey"
          :champion-name="championName"
          :mastery-by-champion="masteryByChampion?.[m.puuid]"
          :premade-group="m.premadeGroup"
          :met-total="m.metTotal"
          :is-self="m.isSelf"
          :privacy="m.privacy"
          :masked="m.masked"
          :kda-outlier="kdaOutliers.get(m.puuid) ?? null"
          :density="density"
          :history-expanded="historyExpanded?.has(m.puuid)"
          :tags-expanded="tagsExpanded?.has(m.puuid)"
          @toggle-history="emit('toggle-history', m.puuid)"
          @toggle-tags="emit('toggle-tags', m.puuid)"
        />

        <!-- 不可用画像者：显式空态卡而非静默留白（repo「降级而非中断」纪律） -->
        <div v-else class="rw-card-empty">
          <span class="rw-card-empty-title">无画像</span>
          <span class="rw-card-empty-reason">
            {{ m.analysis.emptyReason === 'no-games' ? '无对局数据' : '对局全部被筛选口径排除' }}
          </span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped src="./TeamBlock.styles.css"></style>
