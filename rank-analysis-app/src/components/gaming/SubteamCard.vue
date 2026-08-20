<template>
  <div class="subteam-card" :class="isMine ? 'subteam-card-mine' : 'subteam-card-enemy'">
    <div class="subteam-card-header">
      <div class="flex items-center gap-2">
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="
            isMine
              ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]'
              : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
          "
        />
        <span class="subteam-card-title">{{ isMine ? '我方队伍' : '敌方队伍' }}</span>
        <n-tag v-if="isMine" size="tiny" type="info" round :bordered="false">我方</n-tag>
        <n-tag v-else size="tiny" type="error" round :bordered="false">敌方</n-tag>
      </div>
      <span class="text-xs text-slate-400 font-mono"
        >{{ subteam.players.length }}/{{ expectedSize }} 人</span
      >
    </div>
    <div class="subteam-card-body">
      <template
        v-for="(p, i) of subteam.players"
        :key="`subteam-${subteam.subteamId}-${i}-${p.summoner.puuid}`"
      >
        <ChampionIntelCard
          v-if="phase === 'ChampSelect' && !p.summoner.puuid"
          :champion-id="p.championId"
          :pick-state="p.pickState"
          :mode="opggMode"
          :my-champion-ids="isMine ? EMPTY_IDS : myChampionIds"
          :density="density"
          :my-puuid="myPuuid"
          :my-position="myPosition"
          :queue-id="queueId"
          :tier="tier"
          :style="{ '--stagger-i': i }"
        />
        <PlayerCard
          v-else
          :session-summoner="p"
          :type-cn="typeCn"
          :mode-type="modeType"
          :queue-id="queueId"
          :img-url="tiersBySubteam[subteam.subteamId]?.[i]?.imgUrl ?? ''"
          :tier-cn="tiersBySubteam[subteam.subteamId]?.[i]?.tierCn ?? '无'"
          :team="isMine ? 'mine' : 'enemy'"
          :density="density"
          :opgg-mode="opggMode"
          :pick-state="phase === 'ChampSelect' ? p.pickState : ''"
          :is-self="!!myPuuid && p.summoner.puuid === myPuuid"
          :tier="tier"
          :style="{ '--stagger-i': i }"
        />
      </template>
      <div v-for="i in placeholderCount" :key="`placeholder-${i}`" class="subteam-card-empty">
        <span>{{ phase === 'ChampSelect' ? '等待选人…' : '已离开' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import PlayerCard from './PlayerCard.vue'
import ChampionIntelCard from './ChampionIntelCard.vue'
import type { Subteam } from '@renderer/types/domain/gaming'
import type { TierDisplay } from '@renderer/composables/useSessionTiers'
import type { OpggMode } from '@renderer/services/opgg'

/**
 * 空英雄 id 列表的稳定引用。
 * 若在模板里内联 `:my-champion-ids="isMine ? [] : myChampionIds"`，`isMine` 分支每次
 * 重渲染都会产生一个新的 `[]`，导致 ChampionIntelCard 的 watch 认为数组"变了"而重拉数据。
 * 提到 setup 顶层，让同一组件实例在整个生命周期内复用同一个空数组引用。
 */
const EMPTY_IDS: number[] = []

interface Props {
  subteam: Subteam
  isMine: boolean
  expectedSize: number
  typeCn: string
  modeType: string
  queueId: number
  tiersBySubteam: Record<number, TierDisplay[]>
  density: 'normal' | 'compact'
  /** 会话阶段（ChampSelect 时启用敌方情报卡渲染 + 空位占位文案） */
  phase?: string
  /** OP.GG 数据模式，透传给情报卡 */
  opggMode?: OpggMode
  /** 我方已亮出的英雄 id 列表，仅敌方情报卡用于克制提示 */
  myChampionIds?: number[]
  /** 自己的 puuid，用于在对应玩家卡上标「我」（空 = 不标） */
  myPuuid?: string
  /** 我本局分路（小写 LCU 命名 top/jungle/...；空 = 未知），透传给情报卡做分路跟随 */
  myPosition?: string
  /** OP.GG 段位分段，透传给 ChampionIntelCard 的对位弹窗 */
  tier?: string
}

const props = withDefaults(defineProps<Props>(), {
  density: 'normal',
  phase: '',
  opggMode: 'ranked',
  myChampionIds: () => [],
  myPuuid: '',
  myPosition: '',
  tier: 'emerald_plus'
})
const placeholderCount = computed(() =>
  Math.max(0, props.expectedSize - props.subteam.players.length)
)
</script>

<style scoped>
.subteam-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(14, 20, 32, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}

.subteam-card-mine {
  border-top: 2px solid #38bdf8;
}

.subteam-card-enemy {
  border-top: 2px solid #f43f5e;
}

.subteam-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.subteam-card-title {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
}

.subteam-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.subteam-card-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #94a3b8;
  font-size: 12px;
  min-height: 60px;
}
</style>
