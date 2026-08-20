<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    class?: string
    hoverable?: boolean
    glass?: boolean
    glow?: 'none' | 'gold' | 'cyan' | 'win' | 'loss'
  }>(),
  {
    hoverable: false,
    glass: true,
    glow: 'none'
  }
)

const glowClasses = {
  none: '',
  gold: 'border-[#c8aa6e]/40 shadow-[0_0_15px_rgba(200,170,110,0.15)]',
  cyan: 'border-[#0ac8b9]/40 shadow-[0_0_15px_rgba(10,200,185,0.15)]',
  win: 'border-emerald-500/40 shadow-[0_0_15px_rgba(34,197,94,0.15)]',
  loss: 'border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
}

const computedClass = computed(() =>
  cn(
    'rounded-lg border border-white/[0.08] transition-all duration-200',
    props.glass ? 'bg-[rgba(14,20,33,0.72)] backdrop-blur-md' : 'bg-slate-900/90',
    props.hoverable && 'hover:border-white/20 hover:bg-[rgba(22,31,51,0.85)] hover:shadow-lg',
    glowClasses[props.glow],
    props.class
  )
)
</script>

<template>
  <div :class="computedClass">
    <slot />
  </div>
</template>
