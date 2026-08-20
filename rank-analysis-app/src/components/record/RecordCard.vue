<template>
  <div
    class="record-card group relative flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg border p-2.5 transition-all duration-200"
    :class="[
      isWin
        ? 'border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-[rgba(14,20,33,0.7)] to-[rgba(14,20,33,0.7)] hover:border-emerald-500/50 hover:from-emerald-500/15'
        : 'border-rose-500/30 bg-gradient-to-r from-rose-500/10 via-[rgba(14,20,33,0.7)] to-[rgba(14,20,33,0.7)] hover:border-rose-500/50 hover:from-rose-500/15',
      expanded ? 'ring-1 ring-[#c8aa6e]/50 shadow-md' : ''
    ]"
    role="button"
    tabindex="0"
    @click="openDetail"
    @keyup.enter="openDetail"
    @mouseenter="emit('hover-champion', games.participants[0].championId)"
    @mouseleave="emit('leave-champion')"
  >
    <!-- Left: Result Badge + Mode/Duration -->
    <div class="flex items-center gap-2.5 min-w-[90px]">
      <span
        class="record-card-result-label flex h-7 w-7 items-center justify-center rounded-md text-xs font-black shadow-sm"
        :class="[
          isWin
            ? 'record-card-text-win bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(34,197,94,0.2)]'
            : 'record-card-text-loss bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
        ]"
      >
        {{ resultLabel }}
      </span>

      <n-tooltip trigger="hover" placement="top">
        <template #trigger>
          <div class="record-card-time flex flex-col">
            <span class="font-mono text-xs font-bold text-white/90 leading-none">
              {{ durationText }}
            </span>
            <span class="record-card-mode mt-0.5 text-[10px] text-white/40 leading-none">
              {{ modeShortText }}
            </span>
          </div>
        </template>
        <span>{{ dateText }}</span>
      </n-tooltip>
    </div>

    <!-- Champion Avatar & Spells -->
    <div class="record-card-champion flex items-center gap-2 min-w-[120px]">
      <div class="relative">
        <LazyImg
          class="record-card-champion-img h-9 w-9 rounded-full object-cover border border-white/20 bg-slate-950"
          :src="`${assetPrefix}/champion/${games.participants[0].championId}`"
          alt="champion"
        />

        <!-- MVP / SVP Badge -->
        <span
          v-if="games.mvp"
          class="record-card-mvp absolute -bottom-1 -left-1 rounded px-1 py-0 text-[8px] font-black border"
          :class="
            games.mvp === 'MVP'
              ? 'record-card-mvp-gold bg-amber-500/90 text-black border-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
              : 'record-card-mvp-silver bg-slate-400/90 text-black border-slate-200'
          "
        >
          {{ games.mvp }}
        </span>
      </div>

      <!-- Spells (Vertical) -->
      <div class="flex flex-col gap-0.5">
        <span
          v-if="spell1Id > 0"
          class="record-card-spell h-4 w-4 overflow-hidden rounded border border-white/10 bg-black"
        >
          <LazyImg
            :src="assets.srcOf('spell', spell1Id)"
            class="h-full w-full object-cover"
            alt="spell"
          />
        </span>
        <span
          v-if="spell2Id > 0"
          class="record-card-spell h-4 w-4 overflow-hidden rounded border border-white/10 bg-black"
        >
          <LazyImg
            :src="assets.srcOf('spell', spell2Id)"
            class="h-full w-full object-cover"
            alt="spell"
          />
        </span>
      </div>

      <!-- Champion Name -->
      <span class="truncate text-xs font-semibold text-white/90 max-w-[70px]" :title="championName">
        {{ championName }}
      </span>
    </div>

    <!-- KDA & CS -->
    <div class="record-card-kda flex flex-col min-w-[105px]">
      <div class="flex items-center gap-0.5 font-mono text-xs font-bold text-white/90">
        <span class="text-white">{{ games.participants[0].stats?.kills }}</span>
        <span class="text-white/30">/</span>
        <span class="text-rose-400">{{ games.participants[0].stats?.deaths }}</span>
        <span class="text-white/30">/</span>
        <span class="text-slate-300">{{ games.participants[0].stats?.assists }}</span>
      </div>
      <span class="record-card-cs text-[10px] text-white/40 font-mono">{{ csText }}</span>
    </div>

    <!-- Damage / Taken Mini Bar -->
    <div class="record-card-damage flex flex-col gap-1 min-w-[90px]">
      <div class="record-card-minibar flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <span
          class="record-card-minibar-seg record-card-minibar-dmg bg-rose-500/80"
          :style="{ width: `${minibarSegWidth(rate('damageDealtToChampionsRate'))}%` }"
          title="输出占比"
        />
        <span
          class="record-card-minibar-seg record-card-minibar-taken bg-sky-500/80"
          :style="{ width: `${minibarSegWidth(rate('damageTakenRate'))}%` }"
          title="承伤占比"
        />
        <span
          class="record-card-minibar-seg record-card-minibar-heal bg-emerald-500/80"
          :style="{ width: `${minibarSegWidth(rate('healRate'))}%` }"
          title="治疗占比"
        />
      </div>
      <span class="font-mono text-[10px] text-white/70 text-right">
        {{ formatCompactNumber(games.participants[0].stats?.totalDamageDealtToChampions ?? 0) }}
        伤害
      </span>
    </div>

    <!-- Kill Participation Rate -->
    <div class="min-w-[65px] text-right">
      <span
        class="font-mono text-xs font-semibold"
        :style="{ color: groupRateColor(games.participants[0].stats?.groupRate ?? 0, isDark) }"
      >
        {{ Math.round(games.participants[0].stats?.groupRate ?? 0) }}%
      </span>
      <span class="block text-[9px] text-white/40">参团率</span>
    </div>

    <!-- Items / Augments Slots -->
    <div class="record-card-slots flex items-center gap-1">
      <template v-if="usesAugments">
        <span
          v-for="(augmentId, index) in displayedAugmentIds.slice(0, 4)"
          :key="`record-augment-${index}`"
          :class="[
            'record-card-slot h-6 w-6 overflow-hidden rounded border border-white/15 bg-black',
            augmentRarityClass(assets.detailOf('perk', augmentId)?.rarity, 'record-card-augment')
          ]"
        >
          <LazyImg
            :src="assets.srcOf('perk', augmentId)"
            class="h-full w-full object-cover"
            alt="augment"
          />
        </span>
        <span
          v-for="i in Math.max(0, 4 - displayedAugmentIds.slice(0, 4).length)"
          :key="`aug-${i}`"
          class="h-6 w-6 rounded border border-white/5 bg-white/[0.02]"
        />
      </template>
      <template v-else>
        <n-tooltip
          v-for="(itemId, index) in itemIds.slice(0, 4)"
          :key="`record-item-${index}`"
          trigger="hover"
          placement="top"
          :disabled="!assets.detailOf('item', itemId)"
        >
          <template #trigger>
            <span
              v-if="itemId > 0"
              class="record-card-slot h-6 w-6 overflow-hidden rounded border border-white/15 bg-black"
            >
              <LazyImg
                :src="assets.srcOf('item', itemId)"
                class="h-full w-full object-cover"
                alt="item"
              />
            </span>
            <span v-else class="h-6 w-6 rounded border border-white/5 bg-white/[0.02]" />
          </template>
          <AssetTooltipContent
            v-if="itemId > 0"
            :icon-src="assets.srcOf('item', itemId)"
            :name="assets.detailOf('item', itemId)?.name ?? ''"
            :description="assets.detailOf('item', itemId)?.description ?? ''"
          />
        </n-tooltip>
      </template>
    </div>

    <!-- Expand Chevron -->
    <div class="flex items-center pl-1">
      <ChevronDown
        class="h-4 w-4 text-white/40 transition-transform duration-200 group-hover:text-white"
        :class="{ 'rotate-180 text-amber-300': expanded }"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { NTooltip } from 'naive-ui'
import { formatCompactNumber, formatGameDate } from '@renderer/utils/format'
import { useTheme } from '@renderer/composables/useTheme'
import { groupRateColor } from '@renderer/utils/colors'
import { assetPrefix } from '@renderer/services/http'
import { augmentRarityClass } from '@renderer/utils/augment'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'
import AssetTooltipContent from './AssetTooltipContent.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'

const props = withDefaults(
  defineProps<{
    recordType?: boolean
    games: Game
    championOptions?: championOption[]
    expanded?: boolean
  }>(),
  { championOptions: () => [], expanded: false }
)

const emit = defineEmits<{
  'open-detail': []
  'hover-champion': [championId: number]
  'leave-champion': []
}>()

const injected = inject(recordAssetsKey, null)
const assets = injected ?? useRecordAssets()

const isWin = computed(() => props.games.participants[0].stats.win)
const isCherry = computed(() => props.games.gameMode === 'CHERRY')
const usesAugments = computed(() => isCherry.value || props.games.queueId === 2400)
const placement = computed(() => props.games.participants[0]?.stats?.subteamPlacement ?? 0)

const MODE_SHORT: Record<number, string> = {
  400: '匹配',
  420: '单双',
  430: '单双',
  440: '灵活',
  450: '极地',
  460: '极地',
  490: '斗魂',
  700: '斗魂',
  720: '斗魂',
  1010: '斗魂',
  1700: '斗魂',
  1710: '斗魂',
  830: '人机',
  840: '人机',
  850: '人机'
}

const modeShortText = computed(() => {
  const known = MODE_SHORT[props.games.queueId]
  if (known) return known
  const fallback = (props.games.queueName || '').slice(0, 4)
  return fallback || '对局'
})

const dateText = computed(() => formatGameDate(props.games.gameCreationDate))
const spell1Id = computed(() => props.games.participants[0]?.spell1Id ?? 0)
const spell2Id = computed(() => props.games.participants[0]?.spell2Id ?? 0)

const csText = computed(() => {
  const s = props.games.participants[0]?.stats
  const minutes = props.games.gameDuration / 60
  if (!s || minutes <= 0) return '0.0 CS/分'
  const cs = (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0)
  return `${(cs / minutes).toFixed(1)} CS/分`
})

const resultLabel = computed(() => {
  if (isCherry.value && placement.value > 0) {
    return `第 ${placement.value} 名`
  }
  return isWin.value ? '胜' : '负'
})

const durationText = computed(() => {
  const totalSeconds = Math.round(props.games.gameDuration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const championName = computed(() => {
  const id = props.games.participants[0].championId
  return props.championOptions.find(option => option.value === id)?.label ?? `英雄 ${id}`
})

const augmentIds = computed(() => {
  const s = props.games.participants[0].stats
  return [
    s.playerAugment1,
    s.playerAugment2,
    s.playerAugment3,
    s.playerAugment4,
    s.playerAugment5,
    s.playerAugment6
  ].filter(id => id > 0)
})

const displayedAugmentIds = computed(() => {
  const ids = augmentIds.value
  return ids.length <= 6 ? ids : ids.slice(0, 5)
})

const itemIds = computed(() => {
  const s = props.games.participants[0].stats
  return [s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6]
})

const rate = (key: 'damageDealtToChampionsRate' | 'damageTakenRate' | 'healRate') =>
  props.games.participants[0]?.stats?.[key] ?? 0

const minibarSegWidth = (val: number) => {
  if (!val || val <= 0) return 0
  return Math.min(100, Math.max(0, val))
}

const { isDark } = useTheme()

const openDetail = () => {
  emit('open-detail')
}
</script>
