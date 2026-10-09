<script setup lang="ts">
/**
 * 名册墙容器（复刻 Akari `OngoingGamePanel`）：上下堆叠 + 自适应列数。
 *
 * 列数公式在 `columns.ts` 单点实现（ADR-6），本组件只消费结果并传给 TeamBlock，
 * 避免两处口径漂移。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import TeamBlock from './TeamBlock.vue'
import {
  calcColumnsFromContainer,
  CARD_WIDTH_PX
} from '@renderer/features/gaming/roster-wall/columns'
import type { RosterWallMember } from '@renderer/features/gaming/roster-wall/member'
import {
  computeKdaOutliers,
  type KdaOutlier
} from '@renderer/features/gaming/roster-wall/playerTags'

const props = defineProps<{
  ally: RosterWallMember[]
  enemy: RosterWallMember[]
  championName: (id: number) => string
  masteryByChampion?: Record<string, Record<number, number>>
  selfPuuid: string
  density?: 'full' | 'slim'
  /** 打野路径卡开关（设置项，默认开） */
  showJunglePathing?: boolean
  /** 非打野也显示路径卡（设置项，默认关） */
  showJungleForAll?: boolean
  /** 容器参考宽度；缺省用 ResizeObserver 实测 */
  contentWidth?: number
}>()

const container = ref<HTMLElement | null>(null)
const measuredWidth = ref(0)

/** 容器宽度：优先用 prop（便于测试），否则实测；两者都无则退回视口宽 */
const available = computed(() => props.contentWidth ?? measuredWidth.value ?? window.innerWidth)

const columns = computed(() => {
  const maxTeamSize = Math.max(props.ally.length, props.enemy.length, 1)
  return calcColumnsFromContainer(available.value, maxTeamSize)
})

/** KDA 离群需跨玩家比较，故在容器层统一算好后下发 */
const kdaOutliers = computed<Map<string, KdaOutlier>>(() => {
  const entries: Array<{ puuid: string; avgKda: number }> = []
  for (const m of [...props.ally, ...props.enemy]) {
    const p = m.analysis.profile
    if (p) entries.push({ puuid: m.puuid, avgKda: p.summary.avgKda })
  }
  return computeKdaOutliers(entries)
})

/* 卡片内的局部展开态：按 puuid 记录，互不影响 */
const historyExpanded = ref(new Set<string>())
const tagsExpanded = ref(new Set<string>())

function toggleHistory(puuid: string): void {
  const next = new Set(historyExpanded.value)
  next.has(puuid) ? next.delete(puuid) : next.add(puuid)
  historyExpanded.value = next
}

function toggleTags(puuid: string): void {
  const next = new Set(tagsExpanded.value)
  next.has(puuid) ? next.delete(puuid) : next.add(puuid)
  tagsExpanded.value = next
}

/* 实测容器宽度（resize 去抖 180ms，避免拖窗时反复重排） */
let ro: ResizeObserver | null = null
let timer: number | null = null

onMounted(() => {
  if (props.contentWidth !== undefined || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(entries => {
    const w = entries[0]?.contentRect.width ?? 0
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      measuredWidth.value = w
    }, 180)
  })
  if (container.value) ro.observe(container.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (timer !== null) window.clearTimeout(timer)
})
</script>

<template>
  <section ref="container" class="roster-wall">
    <header class="roster-wall-head">
      <h2 class="roster-wall-title">名册墙</h2>
      <span class="roster-wall-note">
        近 50 场历史画像 · 上下堆叠 · 卡片 {{ CARD_WIDTH_PX }}px · {{ columns }} 列
      </span>
    </header>

    <TeamBlock
      v-for="side in ['ally', 'enemy'] as const"
      :key="side"
      :side="side"
      :title="side === 'ally' ? '我方' : '敌方'"
      :members="side === 'ally' ? ally : enemy"
      :columns="columns"
      :champion-name="championName"
      :mastery-by-champion="masteryByChampion"
      :is-self-puuid="selfPuuid"
      :kda-outliers="kdaOutliers"
      :density="density"
      :show-jungle-pathing="showJunglePathing"
      :show-jungle-for-all="showJungleForAll"
      :history-expanded="historyExpanded"
      :tags-expanded="tagsExpanded"
      @toggle-history="toggleHistory"
      @toggle-tags="toggleTags"
    />
  </section>
</template>

<style scoped src="./RosterWall.styles.css"></style>
