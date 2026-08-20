<template>
  <div
    class="relationship-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <Users class="h-3.5 w-3.5 text-indigo-400" />
        <span class="text-xs font-bold tracking-wide text-white">好友与宿敌</span>
      </div>
      <button
        type="button"
        class="text-white/40 hover:text-white transition-colors cursor-pointer"
        title="关闭"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Tabs: 同队表现 / 对位表现 -->
    <div class="flex items-center gap-2 mb-2.5">
      <button
        type="button"
        class="rounded-lg px-2 py-0.5 text-xs font-bold transition-all cursor-pointer"
        :class="
          activeTab === 'team'
            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
            : 'text-white/50 hover:bg-white/5'
        "
        @click="activeTab = 'team'"
      >
        同队表现
      </button>
      <button
        type="button"
        class="rounded-lg px-2 py-0.5 text-xs font-bold transition-all cursor-pointer"
        :class="
          activeTab === 'vs'
            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
            : 'text-white/50 hover:bg-white/5'
        "
        @click="activeTab = 'vs'"
      >
        对位表现
      </button>
    </div>

    <!-- List -->
    <div class="flex flex-col gap-2">
      <div
        v-for="entry in displayList"
        :key="entry.puuid"
        class="flex items-center justify-between rounded-xl bg-white/[0.03] p-2 border border-white/5 hover:bg-white/[0.06] cursor-pointer transition-all"
        @click="onPlayerClick(entry)"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300 border border-white/10 shrink-0"
          >
            {{ entry.name.slice(0, 2) }}
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-bold text-white truncate max-w-[80px]">{{ entry.name }}</span>
            <span class="text-[10px] text-white/40 leading-tight mt-0.5">{{
              entry.encounter
            }}</span>
          </div>
        </div>

        <div class="flex items-center gap-2.5 shrink-0">
          <div class="flex flex-col items-end">
            <span
              class="font-mono text-xs font-bold"
              :class="entry.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ entry.winRate }}%
            </span>
            <span class="text-[9px] text-white/40 font-mono">{{ entry.record }}</span>
          </div>

          <span class="rounded px-1.5 py-0.5 text-[9px] font-bold" :class="entry.tagClass">
            {{ entry.tag }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Users, X } from 'lucide-vue-next'
import { searchSummoner } from '@renderer/utils/navigation'
import type { OneGamePlayerSummoner } from '@renderer/types/domain/analysis'

const props = withDefaults(
  defineProps<{
    variant?: 'friend' | 'dispute'
    summoners?: OneGamePlayerSummoner[]
    isDark?: boolean
  }>(),
  {
    variant: 'friend',
    summoners: () => [],
    isDark: true
  }
)

const emit = defineEmits<{
  'open-game': [gameId: number]
}>()

const activeTab = ref<'team' | 'vs'>('team')

const demoFriendsAndRivals = [
  {
    puuid: 'r-1',
    name: '玩家X',
    encounter: '多次同队',
    winRate: 62,
    record: '5胜3负',
    tag: '宿敌',
    tagClass: 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
  },
  {
    puuid: 'r-2',
    name: '玩家Y',
    encounter: '经常同排',
    winRate: 33,
    record: '2胜8负',
    tag: '二叔',
    tagClass: 'bg-slate-500/20 text-slate-300 border border-slate-500/40'
  },
  {
    puuid: 'r-3',
    name: '玩家Z',
    encounter: '车队开黑',
    winRate: 80,
    record: '4胜1负',
    tag: '铁哥们',
    tagClass: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
  }
]

const displayList = computed(() => {
  if (props.summoners && props.summoners.length > 0) {
    return props.summoners.map((s, index) => ({
      puuid: s.Summoner?.puuid || `puuid-${index}`,
      name: s.Summoner?.gameName || `玩家${index + 1}`,
      encounter: `${s.OneGamePlayer?.length || 1} 次遇到`,
      winRate: parseInt(String(s.winRate).replace('%', '')) || 50,
      record: `${s.OneGamePlayer?.filter(g => g.win)?.length || 0}胜${s.OneGamePlayer?.filter(g => !g.win)?.length || 0}负`,
      tag: props.variant === 'friend' ? '铁哥们' : '宿敌',
      tagClass:
        props.variant === 'friend'
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
    }))
  }
  return demoFriendsAndRivals
})

function onPlayerClick(entry: any) {
  if (entry?.gameId) {
    emit('open-game', entry.gameId)
  } else if (entry?.name) {
    searchSummoner(entry.name)
  }
}
</script>

<style scoped>
.relationship-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
