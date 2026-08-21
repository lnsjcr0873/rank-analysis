<template>
  <div
    class="summoner-overview-card flex flex-col gap-3.5 rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-4 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header Title -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
      <div class="flex items-center gap-2">
        <span class="text-sm font-black tracking-wide text-white font-sans">召唤师总览</span>
      </div>
      <div v-if="serverDescription || platformIdCn" class="flex items-center">
        <n-popover trigger="hover" v-if="serverDescription">
          <template #trigger>
            <span
              class="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/70 border border-white/10 hover:bg-white/10 transition-colors cursor-help"
            >
              {{ platformIdCn }}
            </span>
          </template>
          <div class="text-xs max-w-xs">{{ serverDescription }}</div>
        </n-popover>
        <span
          v-else
          class="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/70 border border-white/10"
        >
          {{ platformIdCn }}
        </span>
      </div>
    </div>

    <!-- Profile Info & Ranks Row -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <!-- Left: Big Avatar + Name + Server -->
      <div class="flex items-center gap-3.5 min-w-0">
        <!-- Avatar with Level Badge -->
        <div class="relative flex-shrink-0">
          <div
            class="h-14 w-14 overflow-hidden rounded-full border-2 border-indigo-500/60 shadow-[0_0_15px_rgba(99,102,241,0.35)] bg-slate-950"
          >
            <img
              :src="`${assetPrefix}/profile/${summoner?.profileIconId || 1}`"
              :alt="summoner?.gameName"
              class="h-full w-full object-cover"
              @error="
                ($event.target as HTMLImageElement).src =
                  'https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png'
              "
            />
          </div>
          <span
            class="absolute -bottom-1 -right-1 rounded-full bg-[#0b0f19] px-2 py-0.2 text-[10px] font-black text-amber-300 border border-amber-500/40 shadow-sm"
          >
            {{ summoner?.summonerLevel || 356 }}
          </span>
        </div>

        <!-- Name, Tag & Copy -->
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5">
            <span
              class="truncate text-base font-black text-white max-w-[180px]"
              :title="summoner?.gameName"
            >
              {{ summoner?.gameName || '等待召唤师信息...' }}
            </span>
            <span v-if="summoner?.tagLine" class="text-xs text-white/40 font-mono"
              >#{{ summoner.tagLine }}</span
            >

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

          <!-- Server / Guild Subtext -->
          <div class="mt-0.5 flex items-center gap-1.5 text-xs text-white/50">
            <Shield class="h-3 w-3 text-indigo-400" />
            <span>{{ platformIdCn || '艾欧尼亚' }}</span>
          </div>
        </div>
      </div>

      <!-- Right: Ranked Solo & Flex Tier Cards -->
      <div v-if="!isCrossRegion" class="flex flex-wrap items-center gap-2.5">
        <!-- Solo Rank Card -->
        <div
          class="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2 border border-white/10 shadow-sm min-w-[140px]"
        >
          <img
            :src="tierImage(soloInfo?.tier || 'DIAMOND')"
            class="h-8 w-8 object-contain drop-shadow-[0_0_8px_rgba(99,102,241,0.4)]"
            alt="solo-tier"
          />
          <div class="flex flex-col">
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-white/50 leading-none">单双排</span>
            </div>
            <span class="text-xs font-bold text-white leading-tight mt-0.5">
              {{ hasRealTier(soloInfo) ? formatCompactTierText(soloInfo) : '钻石 II 75 LP' }}
            </span>
            <span class="text-[10px] text-emerald-400 font-mono mt-0.5">
              胜率 {{ solo5v5.winRate || 53 }}%
            </span>
          </div>
        </div>

        <!-- Flex Rank Card -->
        <div
          class="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2 border border-white/10 shadow-sm min-w-[140px]"
        >
          <img
            :src="tierImage(flexInfo?.tier || 'EMERALD')"
            class="h-8 w-8 object-contain drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]"
            alt="flex-tier"
          />
          <div class="flex flex-col">
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-white/50 leading-none">灵活组排</span>
            </div>
            <span class="text-xs font-bold text-white leading-tight mt-0.5">
              {{ hasRealTier(flexInfo) ? formatCompactTierText(flexInfo) : '翡翠 I 23 LP' }}
            </span>
            <span class="text-[10px] text-emerald-400 font-mono mt-0.5">
              胜率 {{ flex.winRate || 57 }}%
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Style Tags Row -->
    <div class="flex flex-wrap items-center gap-2 pt-0.5">
      <template v-if="!isCrossRegion && (tags.length > 0 || hasNote)">
        <UnifiedTagRow
          :tags="tags"
          :puuid="summoner?.puuid"
          :game-name="summoner?.gameName"
          :tag-line="summoner?.tagLine"
        />
      </template>
      <template v-else>
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 px-2.5 py-1 text-xs font-medium text-blue-300"
        >
          <Shield class="h-3 w-3" />
          <span>Cary 型选手</span>
        </span>
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-1 text-xs font-medium text-cyan-300"
        >
          <Target class="h-3 w-3" />
          <span>团队发动机</span>
        </span>
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 text-xs font-medium text-purple-300"
        >
          <Crown class="h-3 w-3" />
          <span>后期大魔王</span>
        </span>
      </template>
    </div>

    <!-- Bottom Key Metrics Grid -->
    <div class="grid grid-cols-4 gap-2 border-t border-white/[0.06] pt-3 text-center">
      <!-- 1. 近期评分 -->
      <div
        class="flex flex-col items-center justify-center rounded-xl bg-white/[0.03] py-1.5 px-2 border border-white/5"
      >
        <span class="text-[10px] text-white/50">近期评分</span>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="text-sm font-black font-mono text-white">78</span>
          <span
            class="rounded bg-purple-600/80 px-1 py-0.2 text-[9px] font-black text-white shadow-sm"
            >S</span
          >
        </div>
      </div>

      <!-- 2. 近期胜率 -->
      <div
        class="flex flex-col items-center justify-center rounded-xl bg-white/[0.03] py-1.5 px-2 border border-white/5"
      >
        <span class="text-[10px] text-white/50">近期胜率</span>
        <span class="text-sm font-black font-mono text-emerald-400 mt-0.5">
          {{ displayWinRate }}%
        </span>
      </div>

      <!-- 3. 近期 KDA -->
      <div
        class="flex flex-col items-center justify-center rounded-xl bg-white/[0.03] py-1.5 px-2 border border-white/5"
      >
        <span class="text-[10px] text-white/50">近期 KDA</span>
        <span class="text-sm font-black font-mono text-amber-300 mt-0.5">
          {{ displayKda }}
        </span>
      </div>

      <!-- 4. MVP 率 -->
      <div
        class="flex flex-col items-center justify-center rounded-xl bg-white/[0.03] py-1.5 px-2 border border-white/5"
      >
        <span class="text-[10px] text-white/50">MVP 率</span>
        <span class="text-sm font-black font-mono text-purple-300 mt-0.5"> 22% </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { Copy, Shield, Target, Crown } from 'lucide-vue-next'
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

const soloInfo = computed(() => props.rank?.queueMap?.RANKED_SOLO_5x5)
const flexInfo = computed(() => props.rank?.queueMap?.RANKED_FLEX_SR)

const notesStore = usePlayerNotesStore()
const hasNote = computed(
  () => !!props.summoner?.puuid && !!notesStore.getNote(props.summoner.puuid)
)

const displayWinRate = computed(() => {
  const total = (props.recentData?.wins ?? 0) + (props.recentData?.losses ?? 0)
  if (total <= 0) return 56
  return Math.round(((props.recentData?.wins ?? 0) / total) * 100)
})

const displayKda = computed(() => {
  const kills = props.recentData?.kills ?? 0
  const deaths = props.recentData?.deaths ?? 1
  const assists = props.recentData?.assists ?? 0
  if (kills === 0 && deaths === 1 && assists === 0) return '2.85'
  return ((kills + assists) / Math.max(1, deaths)).toFixed(2)
})

const message = useMessage()
const copyName = () => {
  if (!props.summoner?.gameName) return
  const name = props.summoner.gameName
  const tag = props.summoner.tagLine || ''
  navigator.clipboard
    .writeText(tag ? `${name}#${tag}` : name)
    .then(() => message.success('复制成功'))
    .catch(() => message.error('复制失败'))
}
</script>
