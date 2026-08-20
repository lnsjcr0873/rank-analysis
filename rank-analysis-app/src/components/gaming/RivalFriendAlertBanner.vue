<template>
  <div
    v-if="alerts.length > 0"
    class="rival-friend-alert-banner mb-3 flex flex-col gap-2 select-none animate-fadeIn"
  >
    <div
      v-for="(alert, idx) in alerts"
      :key="idx"
      class="flex items-center justify-between gap-3 rounded-xl border p-2.5 shadow-lg backdrop-blur-xl transition-all"
      :class="[
        alert.type === 'rival'
          ? 'border-rose-500/50 bg-rose-950/40 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
          : alert.type === 'friend'
            ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
            : 'border-amber-500/50 bg-amber-950/40 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
      ]"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <div
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
          :class="[
            alert.type === 'rival'
              ? 'border-rose-500/50 bg-rose-500/20 text-rose-300 animate-pulse'
              : alert.type === 'friend'
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                : 'border-amber-500/50 bg-amber-500/20 text-amber-300'
          ]"
        >
          <Swords v-if="alert.type === 'rival'" class="h-4 w-4" />
          <Sparkles v-else-if="alert.type === 'friend'" class="h-4 w-4" />
          <AlertTriangle v-else class="h-4 w-4" />
        </div>

        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-black tracking-wide">{{ alert.title }}</span>
            <span
              class="rounded px-1.5 py-0.2 text-[10px] font-bold border"
              :class="[
                alert.type === 'rival'
                  ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                  : alert.type === 'friend'
                    ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                    : 'border-amber-500/60 bg-amber-500/20 text-amber-300'
              ]"
            >
              {{ alert.badge }}
            </span>
          </div>
          <span class="text-[11px] leading-tight opacity-80 truncate">{{ alert.detail }}</span>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span class="text-[10px] font-mono opacity-60">{{ alert.side === 'enemy' ? '敌方阵营' : '己方队伍' }}</span>
        <button
          type="button"
          class="text-white/40 hover:text-white transition-colors cursor-pointer p-1"
          @click="dismissAlert(idx)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Swords, Sparkles, AlertTriangle, X } from 'lucide-vue-next'

export interface RadarAlert {
  type: 'rival' | 'friend' | 'warning'
  title: string
  badge: string
  detail: string
  side: 'ally' | 'enemy'
}

const props = withDefaults(
  defineProps<{
    alerts?: RadarAlert[]
  }>(),
  {
    alerts: () => [
      {
        type: 'rival',
        title: '宿敌玩家撞车！',
        badge: '历史宿敌',
        detail: '敌方中单与你历史对局 5 次（胜率 20%），请集中注意力谨慎对线！',
        side: 'enemy'
      }
    ]
  }
)

const activeAlerts = ref<RadarAlert[]>([...props.alerts])

function dismissAlert(index: number) {
  activeAlerts.value.splice(index, 1)
}
</script>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.animate-fadeIn {
  animation: fadeIn 0.25s ease-out;
}
</style>
