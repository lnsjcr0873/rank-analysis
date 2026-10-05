<script setup lang="ts">
/**
 * 名册墙单张情报卡（复刻 Akari `PlayerInfoCard`，240×375px 固定尺寸）。
 *
 * 层次自上而下：头部 → 三栏统计 → Tag 行 → 英雄环 → 最近对局列表。
 * 打野路径卡（P5）插在三栏统计与 Tag 行之间，当前未接入故不渲染。
 *
 * 样式外置到 `PlayerCard.styles.css`（>200 行必须外置，见 CLAUDE.md），
 * 由 `__tests__/PlayerCard.spec.ts` 的结构金丝雀锁住引用与关键选择器。
 */
import { computed } from 'vue'

import type { PlayerProfileAnalysis } from '@renderer/features/gaming/analysis/types'
import type { TagContext } from '@renderer/features/gaming/roster-wall/playerTags'
import { buildPlayerTags, type KdaOutlier } from '@renderer/features/gaming/roster-wall/playerTags'
import PlayerCardChampions from './PlayerCardChampions.vue'
import PlayerCardHeader from './PlayerCardHeader.vue'
import PlayerCardHistory from './PlayerCardHistory.vue'
import PlayerCardStats from './PlayerCardStats.vue'
import PlayerTagChip from './PlayerTagChip.vue'
import { TAG_COLLAPSED_LIMIT } from '@renderer/features/gaming/roster-wall/playerTags'

/**
 * 预组队历史推断阈值（Akari `premadeTeamInferMatchCountThreshold` 默认 5）。
 *
 * 本实现的预组字母来自后端 `preGroupMarkers`（已按同队次数推断过），
 * 此常量仅用于 Tag 的说明文案，故固定为 Akari 默认值而非设置项。
 */
const PREMADE_INFER_THRESHOLD = 5

const props = defineProps<{
  profile: PlayerProfileAnalysis
  puuid: string
  /** 本局所选英雄；未选人为 0 */
  championId: number
  displayName: string
  tagLine: string
  summonerLevel: number
  positionLabel: string
  autofilled: boolean
  soloTierLabel: string | null
  flexTierLabel: string | null
  soloTierKey: string | null
  flexTierKey: string | null
  championName: (id: number) => string
  masteryByChampion?: Record<number, number>
  /** 预组队字母 A/B/C…；无预组为 null */
  premadeGroup: string | null
  metTotal: number
  isSelf: boolean
  privacy?: boolean
  masked?: boolean
  kdaOutlier: KdaOutlier
  /** 卡片高度档位：full=375 / slim=268 */
  density?: 'full' | 'slim'
  historyExpanded?: boolean
  tagsExpanded?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-history'): void
  (e: 'toggle-tags'): void
  (e: 'open-game', gameId: number): void
}>()

const ctx = computed<TagContext>(() => ({
  isSelf: props.isSelf,
  premadeGroup: props.premadeGroup,
  premadeThreshold: PREMADE_INFER_THRESHOLD,
  metTotal: props.metTotal,
  // P1/P3 接入 SGP frames 后由上层传入；当前恒 undefined ⇒ C 类 Tag 静默
  earlyDeathsWithEnemyJungler: undefined
}))

const allTags = computed(() => buildPlayerTags(props.profile, ctx.value))
const headTagIds = computed(() => new Set(allTags.value.slice(0, 4).map(t => t.id)))
const bodyTags = computed(() => allTags.value.filter(t => !headTagIds.value.has(t.id)))
const shownBodyTags = computed(() =>
  props.tagsExpanded ? bodyTags.value : bodyTags.value.slice(0, TAG_COLLAPSED_LIMIT)
)
const hiddenBodyTags = computed(() => bodyTags.value.length - shownBodyTags.value.length)

/** 近 50 场常玩分路（按场次降序，最多 3 个），timeline 缺失时为空 */
const recentPositions = computed(() => {
  const entries = Object.entries(props.profile.positions ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return entries.slice(0, 3).map(([pos]) => pos)
})

const height = computed(() => (props.density === 'slim' ? '268px' : '375px'))
const collapsedRows = computed(() => (props.density === 'slim' ? 3 : 5))
</script>

<template>
  <div
    class="pcard"
    :class="{ 'pcard--premade': !!premadeGroup, 'pcard--self': isSelf }"
    :style="{ height }"
    :data-puuid="puuid"
  >
    <!-- 预组队色标：右上角菱形（Akari premade deco） -->
    <span v-if="premadeGroup" class="pcard-deco" :data-group="premadeGroup" />

    <PlayerCardHeader
      :champion-id="championId"
      :champion-name="championName(championId)"
      :summoner-level="summonerLevel"
      :display-name="displayName"
      :tag-line="tagLine"
      :position-label="positionLabel"
      :solo-tier-label="soloTierLabel"
      :flex-tier-label="flexTierLabel"
      :solo-tier-key="soloTierKey"
      :flex-tier-key="flexTierKey"
      :tags="allTags"
      :masked="masked"
      :privacy="privacy"
    />

    <PlayerCardStats
      :win-rate="profile.winLoss.all.winRate"
      :game-count="profile.winLoss.all.count"
      :avg-kda="profile.summary.avgKda"
      :kda-outlier="kdaOutlier"
      :position-label="positionLabel"
      :recent-positions="recentPositions"
      :autofilled="autofilled"
      :kills="profile.summary.kills"
      :deaths="profile.summary.deaths"
      :assists="profile.summary.assists"
    />

    <div v-if="shownBodyTags.length" class="pcard-tags">
      <PlayerTagChip v-for="t in shownBodyTags" :key="t.id" :tag="t" />
    </div>
    <div
      v-if="hiddenBodyTags > 0 || (tagsExpanded && bodyTags.length > TAG_COLLAPSED_LIMIT)"
      class="pcard-tags-more"
    >
      <button class="pcard-tags-toggle" type="button" @click="emit('toggle-tags')">
        {{ tagsExpanded ? '收起标签' : `还有 ${hiddenBodyTags} 个标签` }}
      </button>
    </div>

    <PlayerCardChampions
      :champions="profile.champions"
      :champion-name="championName"
      :mastery-by-champion="masteryByChampion"
    />

    <PlayerCardHistory
      :games="profile.games"
      :champion-name="championName"
      :collapsed-rows="collapsedRows"
      :expanded="historyExpanded"
      @toggle-expand="emit('toggle-history')"
      @open-game="emit('open-game', $event)"
    />
  </div>
</template>

<style scoped src="./PlayerCard.styles.css"></style>
