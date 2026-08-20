<script setup lang="ts">
import { computed } from 'vue'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-white/10 text-white/90 hover:bg-white/15 active:bg-white/20 border border-white/10 shadow-sm',
        gold: 'bg-gradient-to-r from-[#c8aa6e] to-[#785a28] text-black font-semibold hover:brightness-110 active:brightness-95 shadow-[0_0_12px_rgba(200,170,110,0.3)] border border-[#f0e6d2]/30',
        cyan: 'bg-gradient-to-r from-[#0ac8b9] to-[#005a82] text-white font-semibold hover:brightness-110 active:brightness-95 shadow-[0_0_12px_rgba(10,200,185,0.3)] border border-[#a3f7f0]/30',
        win: 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 active:bg-emerald-500/40 border border-emerald-500/40 shadow-[0_0_10px_rgba(34,197,94,0.2)]',
        destructive:
          'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 active:bg-rose-500/40 border border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.2)]',
        outline:
          'border border-white/15 bg-transparent hover:bg-white/10 text-white/80 active:bg-white/15',
        secondary:
          'bg-slate-800/80 text-slate-200 hover:bg-slate-700/80 border border-slate-700/50',
        ghost: 'hover:bg-white/10 text-white/70 hover:text-white active:bg-white/15',
        link: 'text-[#c8aa6e] underline-offset-4 hover:underline p-0 h-auto'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-2.5 text-xs',
        lg: 'h-10 rounded-md px-6 text-base',
        icon: 'h-8 w-8 p-0 rounded-full',
        'icon-sm': 'h-6 w-6 p-0 rounded-full text-xs'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type ButtonProps = {
  variant?: NonNullable<Parameters<typeof buttonVariants>[0]>['variant']
  size?: NonNullable<Parameters<typeof buttonVariants>[0]>['size']
  class?: string
  disabled?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'default',
  size: 'default',
  disabled: false,
  loading: false
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const computedClass = computed(() =>
  cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)
)
</script>

<template>
  <button :class="computedClass" :disabled="disabled || loading" @click="emit('click', $event)">
    <svg
      v-if="loading"
      class="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      ></circle>
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
    <slot />
  </button>
</template>
