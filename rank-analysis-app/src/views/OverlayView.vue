<template>
  <div
    v-if="visible"
    class="overlay-container fixed top-3 right-3 select-none pointer-events-auto z-50 transition-all duration-300"
    :class="isMiniMode ? 'w-auto max-w-sm' : 'w-80'"
  >
    <!-- Mini Capsule Mode -->
    <div
      v-if="isMiniMode"
      class="mini-capsule-card flex items-center gap-2 rounded-full border border-indigo-500/40 bg-[rgba(10,15,26,0.92)] px-3 py-1.5 shadow-2xl backdrop-blur-xl transition-all cursor-pointer hover:border-cyan-400/60"
      @click="isMiniMode = false"
    >
      <div class="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 animate-pulse shrink-0">
        <Sparkles class="h-2.5 w-2.5" />
      </div>
      <span
        v-if="topAction"
        class="text-[11px] font-bold text-white truncate max-w-[220px]"
        :style="{ color: URGENCY_COLORS[topAction.urgency] ?? '#fff' }"
      >
        [{{ NEXT_ACTION_LABELS[topAction.kind] ?? topAction.kind }}] {{ topAction.reason }}
      </span>
      <span v-else class="text-[11px] text-white/60">战术 HUD 待命中</span>
      <Maximize2 class="h-3 w-3 text-white/40 hover:text-white shrink-0 ml-1" />
    </div>

    <!-- Full Tactical Hub Mode -->
    <div
      v-else
      class="overlay-card rounded-xl border border-white/15 bg-[rgba(10,15,26,0.88)] p-3.5 shadow-2xl backdrop-blur-xl transition-all"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
        <div class="flex items-center gap-1.5">
          <Sparkles class="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
          <span class="text-xs font-bold uppercase tracking-wider text-cyan-300">
            实时战术建议
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-[10px] text-white/40 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
            title="切换为迷你胶囊"
            @click="isMiniMode = true"
          >
            <Minimize2 class="h-3 w-3" />
            <span>极简</span>
          </button>
          <span class="text-[9px] font-mono text-white/40">HUD ACTIVE</span>
        </div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Sparkles, AlertTriangle, Crosshair, Minimize2, Maximize2 } from 'lucide-vue-next'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'

const actions = ref<NextAction[]>([])
const visible = ref(true)
const isMiniMode = ref(false)
let unlisten: UnlistenFn | null = null

const topAction = computed(() => {
  if (!actions.value || actions.value.length === 0) return null
  const highPriority = actions.value.find(a => a.urgency === 'high')
  return highPriority ?? actions.value[0]
})

onMounted(async () => {
  try {
    unlisten = await listen<NextAction[]>('overlay:update', event => {
      actions.value = event.payload ?? []
      visible.value = (event.payload?.length ?? 0) > 0
    })
  } catch {
    // ignore
  }
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
