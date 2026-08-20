<template>
  <div
    class="growth-radar-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <TrendingUp class="h-3.5 w-3.5 text-emerald-400" />
        <span class="text-xs font-bold tracking-wide text-white">成长分析</span>
      </div>
      <button
        type="button"
        class="text-white/40 hover:text-white transition-colors cursor-pointer"
        title="关闭"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Main Content: Radar Chart on Left + Targets on Right -->
    <div class="grid grid-cols-2 gap-3 items-center">
      <!-- SVG 5-Axis Radar Chart -->
      <div class="relative flex h-36 w-full items-center justify-center">
        <svg viewBox="-60 -60 120 120" class="h-full w-full overflow-visible">
          <!-- Background concentric polygons -->
          <polygon
            points="0,-45 42.8,-13.9 26.4,36.4 -26.4,36.4 -42.8,-13.9"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            stroke-width="1"
          />
          <polygon
            points="0,-30 28.5,-9.3 17.6,24.3 -17.6,24.3 -28.5,-9.3"
            fill="none"
            stroke="rgba(255, 255, 255, 0.06)"
            stroke-width="1"
          />
          <polygon
            points="0,-15 14.3,-4.6 8.8,12.1 -8.8,12.1 -14.3,-4.6"
            fill="none"
            stroke="rgba(255, 255, 255, 0.04)"
            stroke-width="1"
          />

          <!-- 5 Axes -->
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="-45"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-dasharray="2 2"
          />
          <line
            x1="0"
            y1="0"
            x2="42.8"
            y2="-13.9"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-dasharray="2 2"
          />
          <line
            x1="0"
            y1="0"
            x2="26.4"
            y2="36.4"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-dasharray="2 2"
          />
          <line
            x1="0"
            y1="0"
            x2="-26.4"
            y2="36.4"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-dasharray="2 2"
          />
          <line
            x1="0"
            y1="0"
            x2="-42.8"
            y2="-13.9"
            stroke="rgba(255, 255, 255, 0.1)"
            stroke-dasharray="2 2"
          />

          <!-- Player Data Polygon with glowing fill -->
          <polygon
            points="0,-38 36,-11 20,28 -22,26 -35,-12"
            fill="rgba(6, 182, 212, 0.25)"
            stroke="#06b6d4"
            stroke-width="2"
            filter="drop-shadow(0 0 6px rgba(6, 182, 212, 0.5))"
          />

          <!-- Axis Labels -->
          <text x="0" y="-50" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.6)">
            补刀效率
          </text>
          <text x="50" y="-12" text-anchor="start" font-size="7" fill="rgba(255,255,255,0.6)">
            视野控制
          </text>
          <text x="30" y="46" text-anchor="start" font-size="7" fill="rgba(255,255,255,0.6)">
            生存能力
          </text>
          <text x="-30" y="46" text-anchor="end" font-size="7" fill="rgba(255,255,255,0.6)">
            团战参与
          </text>
          <text x="-50" y="-12" text-anchor="end" font-size="7" fill="rgba(255,255,255,0.6)">
            对线压制
          </text>
        </svg>
      </div>

      <!-- Improvement Targets List -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[10px] font-bold text-white/60">改进目标</span>

        <div
          class="flex flex-col gap-1 rounded-lg bg-white/[0.03] p-1.5 border border-white/5 text-[10px]"
        >
          <div class="flex items-center justify-between text-white/80 font-medium">
            <span>降低前10分钟死亡率</span>
            <ChevronRight class="h-3 w-3 text-white/30" />
          </div>
          <div class="flex items-center gap-2 text-[9px] text-white/40">
            <span>目标: &lt;1次</span>
            <span class="text-rose-400">当前: 1.8次</span>
          </div>
        </div>

        <div
          class="flex flex-col gap-1 rounded-lg bg-white/[0.03] p-1.5 border border-white/5 text-[10px]"
        >
          <div class="flex items-center justify-between text-white/80 font-medium">
            <span>提升前中期参团率</span>
            <ChevronRight class="h-3 w-3 text-white/30" />
          </div>
          <div class="flex items-center gap-2 text-[9px] text-white/40">
            <span>目标: &gt;65%</span>
            <span class="text-amber-300">当前: 52%</span>
          </div>
        </div>

        <div
          class="flex flex-col gap-1 rounded-lg bg-white/[0.03] p-1.5 border border-white/5 text-[10px]"
        >
          <div class="flex items-center justify-between text-white/80 font-medium">
            <span>提高大招命中率</span>
            <ChevronRight class="h-3 w-3 text-white/30" />
          </div>
          <div class="flex items-center gap-2 text-[9px] text-white/40">
            <span>目标: &gt;70%</span>
            <span class="text-emerald-400">当前: 56%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Action Button -->
    <div class="mt-2.5">
      <button
        type="button"
        class="w-full rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 py-1.5 text-xs font-bold text-white shadow-[0_0_10px_rgba(168,85,247,0.3)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
        @click="router.push('/Growth')"
      >
        查看详细分析
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TrendingUp, X, ChevronRight } from 'lucide-vue-next'
import router from '@renderer/router'
</script>

<style scoped>
.growth-radar-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
