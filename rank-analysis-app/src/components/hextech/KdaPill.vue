<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    kills: number
    deaths: number
    assists: number
    kdaRatio?: number
    kpPercent?: number
    size?: 'sm' | 'md' | 'lg'
    class?: string
  }>(),
  {
    size: 'md'
  }
)

const computedKda = computed(() => {
  if (props.kdaRatio !== undefined) return props.kdaRatio
  if (props.deaths === 0) return props.kills + props.assists
  return Number(((props.kills + props.assists) / props.deaths).toFixed(2))
})

const kdaColorClass = computed(() => {
  const kda = computedKda.value
  if (kda >= 5.0) return 'text-amber-300 font-bold'
  if (kda >= 3.0) return 'text-emerald-400 font-semibold'
  if (kda >= 2.0) return 'text-sky-300'
  return 'text-slate-400'
})
</script>

<template>
  <div :class="cn('flex items-center gap-1.5 font-mono select-none', props.class)">
    <div class="flex items-center gap-0.5 text-xs text-white/90">
      <span class="font-bold text-white">{{ kills }}</span>
      <span class="text-white/30">/</span>
      <span class="font-bold text-rose-400">{{ deaths }}</span>
      <span class="text-white/30">/</span>
      <span class="font-bold text-slate-300">{{ assists }}</span>
    </div>
    <div
      v-if="computedKda !== undefined"
      :class="
        cn('rounded bg-white/5 px-1.5 py-0.2 text-[11px] border border-white/10', kdaColorClass)
      "
    >
      {{ computedKda.toFixed(2) }}:1
    </div>
    <div
      v-if="kpPercent !== undefined"
      class="text-[11px] text-white/50"
      :title="'参团率 ' + kpPercent + '%'"
    >
      ({{ kpPercent }}%)
    </div>
  </div>
</template>
