<script setup lang="ts">
import { TabsRoot, TabsList, TabsTrigger } from 'radix-vue'
import { cn } from '@/utils/cn'

type TabItem = {
  value: string
  label: string
  icon?: any
  badge?: string | number
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: TabItem[]
    class?: string
    listClass?: string
  }>(),
  {
    class: '',
    listClass: ''
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
}>()
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    :class="cn('w-full', props.class)"
    @update:model-value="emit('update:modelValue', $event as string)"
  >
    <TabsList
      :class="
        cn(
          'inline-flex h-9 items-center justify-center rounded-lg bg-white/5 p-1 text-white/60 border border-white/10',
          listClass
        )
      "
    >
      <TabsTrigger
        v-for="item in items"
        :key="item.value"
        :value="item.value"
        class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[#c8aa6e]/20 data-[state=active]:text-[#f0e6d2] data-[state=active]:border data-[state=active]:border-[#c8aa6e]/40 data-[state=active]:shadow-sm cursor-pointer gap-1.5"
      >
        <component :is="item.icon" v-if="item.icon" class="w-3.5 h-3.5" />
        <span>{{ item.label }}</span>
        <span
          v-if="item.badge !== undefined"
          class="ml-1 rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-white/80"
        >
          {{ item.badge }}
        </span>
      </TabsTrigger>
    </TabsList>

    <slot />
  </TabsRoot>
</template>
