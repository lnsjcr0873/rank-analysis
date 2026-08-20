<template>
  <div v-if="visible" class="overlay-container fixed top-3 right-3 w-80 select-none pointer-events-none z-50">
    <div
      class="overlay-card rounded-xl border border-white/15 bg-[rgba(10,15,26,0.88)] p-3.5 shadow-2xl backdrop-blur-xl transition-all"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
        <div class="flex items-center gap-1.5">
          <Sparkles class="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
          <span class="text-xs font-bold uppercase tracking-wider gold-gradient-text">
            实时战术建议
          </span>
        </div>
        <span class="text-[9px] font-mono text-white/40">HUD ACTIVE</span>
      </div>

      <!-- Action Items -->
      <div class="flex flex-col gap-2">
        <div
          v-for="(a, i) in actions"
          :key="i"
          class="flex items-start gap-2 rounded-lg p-2 transition-colors border"
          :class="[
            a.urgency === 'high'
              ? 'border-amber-500/40 bg-amber-500/10 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
              : 'border-white/10 bg-white/5'
          ]"
        >
          <!-- Urgency Icon -->
          <div class="flex-shrink-0 mt-0.5">
            <AlertTriangle
              v-if="a.urgency === 'high'"
              class="h-4 w-4 text-amber-400 animate-bounce"
            />
            <Crosshair v-else class="h-4 w-4 text-cyan-400" />
          </div>

          <!-- Kind & Reason -->
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span
                class="text-xs font-bold leading-none"
                :style="{ color: URGENCY_COLORS[a.urgency] ?? '#f0e6d2' }"
              >
                {{ NEXT_ACTION_LABELS[a.kind] ?? a.kind }}
              </span>
              <span
                v-if="a.urgency === 'high'"
                class="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black text-amber-300 border border-amber-500/40"
              >
                优先
              </span>
            </div>
            <span class="mt-1 text-[11px] leading-snug text-white/75">
              {{ a.reason }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Sparkles, AlertTriangle, Crosshair } from 'lucide-vue-next'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'

const actions = ref<NextAction[]>([])
const visible = ref(false)
let unlisten: UnlistenFn | null = null

onMounted(async () => {
  unlisten = await listen<NextAction[]>('overlay:update', event => {
    actions.value = event.payload
    visible.value = (event.payload?.length ?? 0) > 0
  })
})

onUnmounted(() => {
  unlisten?.()
})
</script>

<style>
html,
body {
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow: hidden;
  user-select: none;
}

#overlay-app {
  background: transparent !important;
}
</style>
