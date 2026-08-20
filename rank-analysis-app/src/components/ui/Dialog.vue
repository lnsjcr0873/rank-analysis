<script setup lang="ts">
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose
} from 'radix-vue'
import { X } from 'lucide-vue-next'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    open?: boolean
    title?: string
    description?: string
    maxWidth?: string
    class?: string
  }>(),
  {
    open: false,
    maxWidth: 'max-w-lg'
  }
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        :class="
          cn(
            'fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-[rgba(15,22,36,0.95)] p-6 shadow-2xl backdrop-blur-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-xl',
            maxWidth,
            props.class
          )
        "
      >
        <div class="flex flex-col space-y-1.5 text-center sm:text-left">
          <DialogTitle
            v-if="title"
            class="text-lg font-semibold leading-none tracking-tight text-white/95"
          >
            {{ title }}
          </DialogTitle>
          <DialogDescription v-if="description" class="text-sm text-white/60">
            {{ description }}
          </DialogDescription>
        </div>

        <slot />

        <DialogClose
          class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none text-white/70 hover:text-white"
        >
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
