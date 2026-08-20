<script setup lang="ts">
import { computed } from 'vue'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring select-none',
  {
    variants: {
      variant: {
        default: 'bg-white/10 text-white/90 border border-white/10',
        win: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold',
        loss: 'bg-rose-500/15 text-rose-400 border border-rose-500/30 font-semibold',
        mvp: 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.25)] font-bold',
        svp: 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold',
        gold: 'bg-[#c8aa6e]/15 text-[#f0e6d2] border border-[#c8aa6e]/30',
        cyan: 'bg-[#0ac8b9]/15 text-[#a3f7f0] border border-[#0ac8b9]/30',
        warning: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
        secondary: 'bg-slate-800 text-slate-300 border border-slate-700',
        outline: 'text-white/80 border border-white/20 bg-transparent'
      },
      size: {
        default: 'px-2 py-0.5 text-xs',
        sm: 'px-1.5 py-0.2 text-[10px]',
        lg: 'px-3 py-1 text-sm'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type BadgeProps = {
  variant?: NonNullable<Parameters<typeof badgeVariants>[0]>['variant']
  size?: NonNullable<Parameters<typeof badgeVariants>[0]>['size']
  class?: string
}

const props = withDefaults(defineProps<BadgeProps>(), {
  variant: 'default',
  size: 'default'
})

const computedClass = computed(() =>
  cn(badgeVariants({ variant: props.variant, size: props.size }), props.class)
)
</script>

<template>
  <div :class="computedClass">
    <slot />
  </div>
</template>
