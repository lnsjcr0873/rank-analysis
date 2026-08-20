<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'
import LazyImg from '@/components/common/LazyImg.vue'
import { getChampionIconUrl } from '@/utils/champion'

const props = withDefaults(
  defineProps<{
    championId?: number | string
    championName?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    level?: number
    rounded?: 'circle' | 'square'
    border?: 'gold' | 'cyan' | 'win' | 'loss' | 'none'
    class?: string
  }>(),
  {
    size: 'md',
    rounded: 'circle',
    border: 'none'
  }
)

const sizeClasses = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 text-sm',
  xl: 'w-20 h-20 text-base'
}

const borderClasses = {
  none: 'border border-white/10',
  gold: 'border-2 border-[#c8aa6e] shadow-[0_0_10px_rgba(200,170,110,0.35)]',
  cyan: 'border-2 border-[#0ac8b9] shadow-[0_0_10px_rgba(10,200,185,0.35)]',
  win: 'border-2 border-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]',
  loss: 'border-2 border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
}

const iconUrl = computed(() => {
  if (!props.championId && !props.championName) return ''
  return getChampionIconUrl(props.championId)
})
</script>

<template>
  <div
    :class="
      cn(
        'relative inline-block select-none overflow-hidden shrink-0 bg-slate-950',
        rounded === 'circle' ? 'rounded-full' : 'rounded-lg',
        sizeClasses[size],
        borderClasses[border],
        props.class
      )
    "
  >
    <LazyImg
      v-if="iconUrl"
      :src="iconUrl"
      :alt="championName || 'champion'"
      class="w-full h-full object-cover"
    />
    <div v-else class="w-full h-full flex items-center justify-center bg-white/5 text-white/40">
      ?
    </div>

    <!-- Champion Level Tag -->
    <span
      v-if="level !== undefined"
      class="absolute bottom-0 right-0 rounded-tl-md bg-black/85 px-1 text-[9px] font-bold text-amber-300 border-t border-l border-white/20"
    >
      {{ level }}
    </span>
  </div>
</template>
