<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    type?: string
    placeholder?: string
    disabled?: boolean
    class?: string
  }>(),
  {
    type: 'text',
    disabled: false,
    class: ''
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void
  (e: 'change', event: Event): void
  (e: 'keydown', event: KeyboardEvent): void
}>()

const computedClass = computed(() =>
  cn(
    'flex h-9 w-full rounded-md border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/90 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-white/40 focus-visible:outline-none focus-visible:border-[#c8aa6e]/60 focus-visible:ring-1 focus-visible:ring-[#c8aa6e]/40 disabled:cursor-not-allowed disabled:opacity-50',
    props.class
  )
)
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="computedClass"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @change="emit('change', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>
