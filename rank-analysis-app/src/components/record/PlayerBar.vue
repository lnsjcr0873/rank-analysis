<template>
  <div
    class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[rgba(14,20,33,0.75)] p-3.5 backdrop-blur-xl shadow-lg transition-all"
  >
    <!-- Left: Identity Section (Avatar, Name, Tag, Copy, Note) -->
    <div class="flex items-center gap-3 min-w-0">
      <!-- Avatar with Level Badge -->
      <div class="relative flex-shrink-0">
        <div
          class="h-11 w-11 overflow-hidden rounded-full border-2 border-[#c8aa6e]/60 shadow-[0_0_10px_rgba(200,170,110,0.25)] bg-slate-950"
        >
          <img
            :src="`${assetPrefix}/profile/${summoner?.profileIconId}`"
            :alt="summoner?.gameName"
            class="h-full w-full object-cover"
            @error="
              ($event.target as HTMLImageElement).src =
                'https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png'
            "
          />
        </div>
        <span
          class="absolute -bottom-1 -right-1 rounded-full bg-black/90 px-1.5 py-0.2 text-[10px] font-bold text-amber-300 border border-white/20 shadow-sm"
        >
          {{ summoner?.summonerLevel }}
        </span>
      </div>

      <!-- Name & Tag -->
      <div class="flex flex-col min-w-0">
        <div class="flex items-center gap-1.5">
          <span
            class="truncate text-sm font-bold text-white/95 max-w-[160px]"
            :title="summoner?.gameName"
          >
            {{ summoner?.gameName }}
          </span>
          <span class="text-xs text-white/40 font-mono">#{{ summoner?.tagLine }}</span>

          <button
            type="button"
            class="flex h-5 w-5 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="复制召唤师名称及Tag"
            @click="copyName"
          >
            <Copy class="h-3 w-3" />
          </button>

          <PlayerNoteBadge
            v-if="summoner?.puuid"
            :puuid="summoner?.puuid"
            :game-name="summoner?.gameName"
            :tag-line="summoner?.tagLine"
            size="normal"
          />
        </div>

        <!-- Platform/Server Tag -->
        <div class="mt-0.5 flex items-center gap-1.5">
          <n-popover trigger="hover" v-if="serverDescription">
            <template #trigger>
              <span
                class="inline-flex items-center rounded bg-white/5 px-1.5 py-0.2 text-[10px] text-white/60 border border-white/10 hover:bg-white/10 transition-colors cursor-help"
              >
                {{ platformIdCn }}
              </span>
            </template>
            <div class="text-xs max-w-xs">{{ serverDescription }}</div>
          </n-popover>
          <span
            v-else
            class="inline-flex items-center rounded bg-white/5 px-1.5 py-0.2 text-[10px] text-white/60 border border-white/10"
          >
            {{ platformIdCn }}
          </span>
        </div>
      </div>
    </div>

    <!-- Center: Rank & Winrate Stats -->
    <div v-if="!isCrossRegion" class="flex flex-wrap items-center gap-4">
      <!-- Solo Rank Badge -->
      <div
        v-if="hasRealTier(soloInfo)"
        class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 border border-white/10"
      >
        <img :src="tierImage(soloInfo.tier)" class="h-7 w-7 object-contain drop-shadow" alt="" />
        <div class="flex flex-col">
          <span class="text-[10px] text-white/50 leading-none">单双排位</span>
          <span class="text-xs font-bold text-amber-200/90 leading-tight">
            {{ formatCompactTierText(soloInfo) }}
          </span>
        </div>
      </div>

      <!-- Solo 5v5 Win Rate -->
      <div
        class="flex flex-col items-center rounded-lg bg-white/5 px-3 py-1 border border-white/10"
      >
        <span class="text-[10px] text-white/50">单双胜率</span>
        <span
          class="text-xs font-bold font-mono"
          :class="solo5v5.winRate >= 50 ? 'text-emerald-400' : 'text-slate-300'"
        >
          {{ solo5v5.winRate }}%
        </span>
      </div>

      <!-- Flex Win Rate -->
      <div
        class="flex flex-col items-center rounded-lg bg-white/5 px-3 py-1 border border-white/10"
      >
        <span class="text-[10px] text-white/50">灵活胜率</span>
        <span
          class="text-xs font-bold font-mono"
          :class="flex.winRate >= 50 ? 'text-emerald-400' : 'text-slate-300'"
        >
          {{ flex.winRate }}%
        </span>
      </div>

      <!-- Recent 20 Games -->
      <div
        class="flex flex-col items-center rounded-lg bg-white/5 px-3 py-1 border border-white/10"
      >
        <span class="text-[10px] text-white/50">近20场战绩</span>
        <div class="flex items-center gap-1 text-xs font-bold font-mono">
          <span class="text-emerald-400">{{ recentData.wins }}W</span>
          <span class="text-rose-400">{{ recentData.losses }}L</span>
        </div>
      </div>
    </div>

    <!-- Right: Tags Row -->
    <div v-if="!isCrossRegion && (tags.length > 0 || hasNote)" class="flex items-center">
      <UnifiedTagRow
        :tags="tags"
        :puuid="summoner?.puuid"
        :game-name="summoner?.gameName"
        :tag-line="summoner?.tagLine"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { Copy } from 'lucide-vue-next'
import { NPopover, useMessage } from 'naive-ui'
import { assetPrefix } from '@renderer/services/http'
import type { Rank, RecentWinRate, Summoner } from '@renderer/types/domain/player'
import type { RankTag, RecentData } from '@renderer/types/domain/analysis'
import { usePlayerNotesStore } from '@renderer/features/settings/stores/playerNotes'
import { formatCompactTierText, hasRealTier } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import UnifiedTagRow from '@renderer/components/common/UnifiedTagRow.vue'

const props = defineProps<{
  summoner: Summoner
  rank: Rank
  solo5v5: RecentWinRate
  flex: RecentWinRate
  recentData: RecentData
  tags: RankTag[]
  platformIdCn: string
  isCrossRegion: boolean
}>()

const serverDesc: Record<string, string> = {
  联盟一区: '联盟一区：祖安、皮尔特沃夫、巨神峰、教育网、男爵领域、均衡教派、影流、守望之海',
  联盟二区: '联盟二区：卡拉曼达、暗影岛、征服之海、诺克萨斯、战争学院、雷瑟守备',
  联盟三区: '联盟三区：班德尔城、裁决之地、水晶之痕、钢铁烈阳、皮城警备',
  联盟四区: '联盟四区：比尔吉沃特、弗雷尔卓德、扭曲丛林',
  联盟五区: '联盟五区：德玛西亚、无畏先锋、恕瑞玛、巨龙之巢'
}

const serverDescription = computed(() => serverDesc[props.platformIdCn])

const soloInfo = computed(() => props.rank.queueMap.RANKED_SOLO_5x5)

const notesStore = usePlayerNotesStore()
const hasNote = computed(
  () => !!props.summoner?.puuid && !!notesStore.getNote(props.summoner.puuid)
)

const message = useMessage()
const copyName = () => {
  if (!props.summoner?.gameName) return
  navigator.clipboard
    .writeText(props.summoner.gameName + '#' + props.summoner.tagLine)
    .then(() => message.success('复制成功'))
    .catch(() => message.error('复制失败'))
}
</script>
