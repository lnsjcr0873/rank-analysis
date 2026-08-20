<template>
  <div
    class="ai-tactical-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <Sparkles class="h-3.5 w-3.5 text-indigo-400" />
        <span class="text-xs font-bold tracking-wide text-white">AI 战术军师</span>
      </div>
      <button
        type="button"
        class="text-white/40 hover:text-white transition-colors cursor-pointer"
        title="关闭"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-2 mb-2.5">
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer"
        :class="
          activeTab === 'champ'
            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-sm'
            : 'text-white/50 hover:bg-white/5'
        "
        @click="activeTab = 'champ'"
      >
        选人阶段
      </button>
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer"
        :class="
          activeTab === 'strategy'
            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-sm'
            : 'text-white/50 hover:bg-white/5'
        "
        @click="activeTab = 'strategy'"
      >
        对局策略
      </button>
    </div>

    <!-- Strategy Content -->
    <div class="flex flex-col gap-2 rounded-xl bg-white/[0.03] p-2.5 border border-white/5 text-xs">
      <!-- 阵容优点 -->
      <div class="flex flex-col gap-1">
        <span class="text-[10px] font-bold text-emerald-400">阵容优点</span>
        <div class="flex flex-wrap gap-1.5">
          <span
            class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            开团能力强
          </span>
          <span
            class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            后期输出充足
          </span>
        </div>
      </div>

      <!-- 阵容缺点 -->
      <div class="flex flex-col gap-1">
        <span class="text-[10px] font-bold text-rose-400">阵容缺点</span>
        <div class="flex flex-wrap gap-1.5">
          <span
            class="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
            缺乏爆发
          </span>
          <span
            class="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-300"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
            前期较弱
          </span>
        </div>
      </div>

      <!-- 对局关键点 -->
      <div class="flex flex-col gap-1">
        <span class="text-[10px] font-bold text-cyan-400">对局关键点</span>
        <div class="flex flex-col gap-1 text-[11px] text-white/70">
          <span class="flex items-center gap-1.5">
            <span class="h-1 w-1 rounded-full bg-cyan-400"></span>
            中野联动推线控制河道视野
          </span>
          <span class="flex items-center gap-1.5">
            <span class="h-1 w-1 rounded-full bg-cyan-400"></span>
            下路防 Gank，注意推线时机
          </span>
        </div>
      </div>
    </div>

    <!-- Action Button -->
    <div class="mt-2.5">
      <button
        type="button"
        class="w-full rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 py-1.5 text-xs font-bold text-white shadow-[0_0_10px_rgba(168,85,247,0.3)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
        @click="emit('generate')"
      >
        生成完整报告
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'

const emit = defineEmits<{
  generate: []
}>()

const activeTab = ref<'champ' | 'strategy'>('champ')
</script>

<style scoped>
.ai-tactical-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
