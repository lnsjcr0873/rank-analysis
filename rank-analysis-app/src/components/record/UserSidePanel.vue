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
      <span
        class="relationship-empty-label inline-flex items-center gap-1.5 font-semibold text-white/70"
      >
        <span
          class="relationship-empty-dot relationship-empty-dot-win h-1.5 w-1.5 rounded-full bg-emerald-400 opacity-70"
        ></span
        >好友
        <span class="relationship-empty-sep text-white/30">/</span>
        <span
          class="relationship-empty-dot relationship-empty-dot-loss h-1.5 w-1.5 rounded-full bg-rose-400 opacity-70"
        ></span
        >宿敌
      </span>
      <span class="relationship-empty-text text-white/40">近 20 场没有重复同排的玩家</span>
    </div>

    <!-- Hero Pool Card -->
    <div
      v-if="!isCrossRegion && (championPool.length > 0 || true)"
      class="hero-pool-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
    >
      <div
        class="hero-pool-header flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5"
      >
        <span class="text-xs font-bold tracking-wide text-white">英雄池与近期胜率</span>
        <div class="flex items-center gap-1 text-[10px] text-white/40">
          <button
            type="button"
            class="px-1.5 py-0.5 rounded cursor-pointer transition-colors"
            :class="
              poolSortKey === 'winrate'
                ? 'bg-indigo-500/20 text-indigo-300 font-bold'
                : 'hover:text-white'
            "
            @click="poolSortKey = 'winrate'"
          >
            胜率
          </button>
          <span>·</span>
          <button
            type="button"
            class="px-1.5 py-0.5 rounded cursor-pointer transition-colors"
            :class="
              poolSortKey === 'games'
                ? 'bg-indigo-500/20 text-indigo-300 font-bold'
                : 'hover:text-white'
            "
            @click="poolSortKey = 'games'"
          >
            场次
          </button>
        </div>
      </div>

      <!-- Hero Pool Rows -->
      <div v-if="displayChampionPool.length > 0" class="hero-pool-list flex flex-col gap-1.5">
        <div
          v-for="entry in displayChampionPool"
          :key="entry.championId"
          class="hero-pool-row flex items-center justify-between gap-2 rounded-xl bg-white/[0.02] px-2.5 py-1.5 text-xs cursor-pointer border border-transparent transition-all duration-150"
          :class="{
            'hero-pool-row-hovered bg-white/10 text-white shadow-sm border-white/10':
              hoveredLocal === entry.championId,
            'hero-pool-row-dimmed opacity-40':
              hoveredLocal !== null && hoveredLocal !== entry.championId,
            'hero-pool-row-active border-indigo-500/60 bg-indigo-600/15 font-bold shadow-[0_0_10px_rgba(99,102,241,0.2)]':
              activeChampion === entry.championId,
            'hover:bg-white/5': hoveredLocal === null && activeChampion !== entry.championId
          }"
          @mouseenter="hoveredLocal = entry.championId"
          @mouseleave="hoveredLocal = null"
          @click="onPoolClick(entry.championId)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <img
              :src="`${assetPrefix}/champion/${entry.championId}`"
              class="hero-pool-champ-img h-7 w-7 rounded-lg object-cover border border-white/15 shrink-0"
              alt=""
              @error="
                ($event.target as HTMLImageElement).src =
                  'https://ddragon.leagueoflegends.com/cdn/14.10.1/img/champion/Ahri.png'
              "
            />
            <span class="hero-pool-name truncate font-bold text-white max-w-[70px]">
              {{ championName(entry.championId) }}
            </span>
          </div>

          <div class="flex items-center gap-2.5 font-mono text-[11px] shrink-0">
            <span class="text-white/50">{{ entry.count }}场</span>
            <span class="font-bold" :style="{ color: winRateColor(getPoolWinRate(entry), isDark) }">
              {{ getPoolWinRate(entry) }}%
            </span>
            <span class="text-indigo-300 text-[10px] hidden sm:inline"
              >{{ getPoolWins(entry) }}胜</span
            >
            <span class="text-amber-300 text-[10px]">{{ getPoolKda(entry) }}</span>
          </div>
        </div>
      </div>

      <div v-else class="py-6 text-center text-xs text-white/40">
        暂无常用英雄数据
      </div>

      <!-- Footer: 查看全部英雄 -->
      <div class="mt-2.5 flex items-center justify-center border-t border-white/[0.04] pt-2">
        <button
          type="button"
          class="text-[11px] text-white/40 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-1"
        >
          <span>查看全部英雄</span>
          <ChevronRight class="h-3 w-3" />
        </button>
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
import { ChevronRight } from 'lucide-vue-next'
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

const poolSortKey = ref<'winrate' | 'games'>('winrate')

function getPoolWinRate(entry: any): number {
  if ('winRate' in entry && typeof entry.winRate === 'number') return entry.winRate
  return championWinRate(entry as ChampionPoolEntry)
}

function getPoolKda(entry: any): string {
  if ('kda' in entry) return String(entry.kda)
  return '2.85'
}

function getPoolWins(entry: any): number {
  if ('wins' in entry && typeof entry.wins === 'number') return entry.wins
  return Math.round((Number(entry?.count) || 0) * 0.6)
}

const displayChampionPool = computed(() => {
  if (props.championPool && props.championPool.length > 0) {
    const list = [...props.championPool]
    if (poolSortKey.value === 'winrate') {
      return list.sort((a, b) => championWinRate(b) - championWinRate(a))
    }
    return list.sort((a, b) => b.count - a.count)
  }
  return []
})

function onPoolClick(championId: number) {
  emit('select-champion', championId)
}
</script>
