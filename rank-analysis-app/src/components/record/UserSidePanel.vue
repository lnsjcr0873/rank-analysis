<template>
  <div class="user-side-panel flex flex-col gap-3 h-full select-none">
    <!-- Cross Region Notice -->
    <div
      v-if="isCrossRegion"
      class="rounded-xl border border-white/10 bg-[rgba(15,22,36,0.7)] p-3 text-xs leading-relaxed text-white/60 backdrop-blur-md"
    >
      跨区查询：仅提供该大区的对局战绩，段位 / 胜率 / 标签暂不支持跨区。
    </div>

    <!-- Friends & Rivals Grid -->
    <div v-if="!isCrossRegion && hasRelations" class="flex gap-3">
      <RelationshipPanel
        variant="friend"
        :summoners="recentData.friendAndDispute.friendsSummoner"
        :is-dark="isDark"
        @open-game="emit('open-game', $event)"
      />
      <RelationshipPanel
        variant="dispute"
        :summoners="recentData.friendAndDispute.disputeSummoner"
        :is-dark="isDark"
        @open-game="emit('open-game', $event)"
      />
    </div>

    <!-- Empty Friends / Rivals Placeholder -->
    <div
      v-else-if="!isCrossRegion"
      class="relationship-empty-row flex items-center justify-between rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
    >
      <span class="relationship-empty-label inline-flex items-center gap-1.5 font-semibold text-white/70">
        <span class="relationship-empty-dot relationship-empty-dot-win h-1.5 w-1.5 rounded-full bg-emerald-400 opacity-70"></span>好友
        <span class="relationship-empty-sep text-white/30">/</span>
        <span class="relationship-empty-dot relationship-empty-dot-loss h-1.5 w-1.5 rounded-full bg-rose-400 opacity-70"></span>宿敌
      </span>
      <span class="relationship-empty-text text-white/40">近 20 场没有重复同排的玩家</span>
    </div>

    <!-- Hero Pool Card -->
    <div
      v-if="!isCrossRegion && championPool.length > 0"
      class="hero-pool-card rounded-xl border border-white/10 bg-[rgba(15,22,36,0.75)] p-3 backdrop-blur-xl shadow-md"
    >
      <div class="hero-pool-header text-xs font-bold text-white/80 border-b border-white/10 pb-2 mb-2">
        英雄池（近 {{ championPool.length }} 场）
      </div>

      <div class="hero-pool-list flex flex-col gap-1">
        <div
          v-for="entry in championPool"
          :key="entry.championId"
          class="hero-pool-row flex items-center gap-2 rounded-lg px-2 py-1 text-xs cursor-pointer transition-all duration-150"
          :class="{
            'hero-pool-row-hovered bg-white/10 text-white shadow-sm': hoveredLocal === entry.championId,
            'hero-pool-row-dimmed opacity-40': hoveredLocal !== null && hoveredLocal !== entry.championId,
            'hero-pool-row-active border border-[#c8aa6e]/60 bg-[#c8aa6e]/15 font-bold shadow-[0_0_8px_rgba(200,170,110,0.2)]':
              activeChampion === entry.championId,
            'hover:bg-white/5': hoveredLocal === null && activeChampion !== entry.championId
          }"
          @mouseenter="hoveredLocal = entry.championId"
          @mouseleave="hoveredLocal = null"
          @click="onPoolClick(entry.championId)"
        >
          <img
            :src="`${assetPrefix}/champion/${entry.championId}`"
            class="hero-pool-champ-img h-6 w-6 rounded-full object-cover border border-white/15"
            alt=""
          />
          <span class="hero-pool-name truncate flex-1 font-semibold text-white/90">
            {{ championName(entry.championId) }}
          </span>
          <span
            class="font-mono hero-pool-winrate font-bold text-xs"
            :style="{ color: winRateColor(championWinRate(entry), isDark) }"
          >
            {{ championWinRate(entry) }}%
          </span>
          <span class="font-mono hero-pool-count text-[11px] text-white/40">
            {{ entry.count }}场
          </span>
        </div>
      </div>
    </div>

    <!-- Rank Cards -->
    <div v-if="!isCrossRegion" class="flex flex-col gap-2.5">
      <RankCard label="单双排" :queue-info="rank.queueMap.RANKED_SOLO_5x5" :recent="solo5v5" />
      <RankCard label="灵活组排" :queue-info="rank.queueMap.RANKED_FLEX_SR" :recent="flex" />
    </div>

    <!-- Recent Stats Table -->
    <RecentStatsTable
      v-if="!isCrossRegion"
      :recent-data="recentData"
      :mode="mode"
      :is-dark="isDark"
      @mode-change="updateMode"
    />

    <!-- Growth & Trend Card -->
    <GrowthTrendCard
      v-if="!isCrossRegion"
      :recent-data="recentData"
      :mode="mode"
      :is-dark="isDark"
      :games="games"
      :my-puuid="myPuuid"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '@renderer/features/settings/stores/setting'
import { assetPrefix } from '@renderer/services/http'
import { winRateColor } from '@renderer/utils/colors'
import type { Rank, RecentWinRate } from '@renderer/types/domain/player'
import type { RecentData } from '@renderer/types/domain/analysis'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'
import RelationshipPanel from './RelationshipPanel.vue'
import RankCard from './RankCard.vue'
import RecentStatsTable from './RecentStatsTable.vue'
import GrowthTrendCard from './GrowthTrendCard.vue'
import { championWinRate, type ChampionPoolEntry } from './championPool'

const props = defineProps<{
  rank: Rank
  solo5v5: RecentWinRate
  flex: RecentWinRate
  recentData: RecentData
  mode: string
  isCrossRegion: boolean
  championPool: ChampionPoolEntry[]
  hoveredChampion: number | null
  games: Game[]
  myPuuid: string
  activeChampion?: number
}>()

const emit = defineEmits<{
  'mode-change': [value: string | number, option: { label?: string }]
  'select-champion': [championId: number]
  'open-game': [gameId: number]
}>()

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

const hasRelations = computed(
  () =>
    (props.recentData.friendAndDispute?.friendsSummoner?.length ?? 0) > 0 ||
    (props.recentData.friendAndDispute?.disputeSummoner?.length ?? 0) > 0
)

const updateMode = (value: string | number, option: { label?: string }) => {
  emit('mode-change', value, option)
}

const championOptions = ref<championOption[]>([])
onMounted(async () => {
  try {
    championOptions.value = await invoke<championOption[]>('get_champion_options')
  } catch {
    championOptions.value = []
  }
})

const hoveredLocal = ref<number | null>(props.hoveredChampion)
watch(
  () => props.hoveredChampion,
  value => {
    hoveredLocal.value = value
  }
)

const championName = (id: number) =>
  championOptions.value.find(option => option.value === id)?.label ?? `英雄 ${id}`

function onPoolClick(championId: number) {
  emit('select-champion', championId)
}
</script>
