<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'radix-vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    checked?: boolean
    disabled?: boolean
    class?: string
  }>(),
  {
    checked: false,
    disabled: false,
    class: ''
  }
)

const emit = defineEmits<{
  (e: 'update:checked', value: boolean): void
}>()
</script>

<template>
  <SwitchRoot
    :checked="checked"
    :disabled="disabled"
    :class="
      cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#c8aa6e] data-[state=unchecked]:bg-white/20',
        props.class
      )
    "
    @update:checked="emit('update:checked', $event)"
  >
    <SwitchThumb
      :class="
        cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0'
        )
      "
    />
  </SwitchRoot>
</template>
