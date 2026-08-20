<script setup lang="ts">
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
  TooltipArrow
} from 'radix-vue'
import { cn } from '@/utils/cn'

withDefaults(
  defineProps<{
    content?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
    delayDuration?: number
  }>(),
  {
    side: 'top',
    sideOffset: 6,
    delayDuration: 150
  }
)
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="sideOffset"
          :class="
            cn(
              'z-50 overflow-hidden rounded-md border border-white/10 bg-[rgba(15,22,36,0.95)] px-3 py-1.5 text-xs text-white/90 shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
            )
          "
        >
          <slot name="content">
            {{ content }}
          </slot>
          <TooltipArrow class="fill-[rgba(15,22,36,0.95)]" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
