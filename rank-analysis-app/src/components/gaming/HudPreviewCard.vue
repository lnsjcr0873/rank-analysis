<template>
  <div
    class="hud-preview-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <Monitor class="h-3.5 w-3.5 text-cyan-400" />
        <span class="text-xs font-bold tracking-wide text-white">游戏内 HUD 预览</span>
      </div>
      <button
        type="button"
        class="text-white/40 hover:text-white transition-colors cursor-pointer"
        title="关闭"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- HUD Preview Screen Container -->
    <div
      class="relative flex h-40 w-full flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-b from-[#0a1220] via-[#050811] to-[#04060c] p-2.5 border border-white/10 shadow-inner"
    >
      <!-- Ambient Map Grid Lines -->
      <div
        class="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]"
      ></div>

      <!-- Top Overlay Floating Tactical Hints -->
      <div class="relative z-10 flex flex-col gap-1 items-end self-end">
        <div
          class="flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-0.5 text-[10px] text-cyan-300 border border-cyan-500/30 backdrop-blur-md shadow-sm"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
          <span>下一步建议: 控制小龙坑视野</span>
        </div>
        <div
          class="flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/30 backdrop-blur-md shadow-sm"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          <span>对线压制: 敌方闪现还有 45s</span>
        </div>
      </div>

      <!-- Bottom Mini HUD Player Bar -->
      <div class="relative z-10 flex items-center justify-center gap-2">
        <div
          class="flex items-center gap-1 rounded-xl bg-black/80 p-1.5 border border-white/15 backdrop-blur-lg"
        >
          <!-- Skill Q, W, E, R -->
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-slate-900 border border-white/20 text-[10px] font-bold text-cyan-400"
          >
            Q
          </div>
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-slate-900 border border-white/20 text-[10px] font-bold text-cyan-400"
          >
            W
          </div>
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-slate-900 border border-white/20 text-[10px] font-bold text-cyan-400"
          >
            E
          </div>
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-indigo-950 border border-indigo-500/50 text-[10px] font-bold text-amber-300"
          >
            R
          </div>

          <!-- Spells D, F -->
          <div class="mx-0.5 h-4 w-[1px] bg-white/20"></div>
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-amber-500/20 border border-amber-500/40 text-[9px] font-bold text-amber-300"
          >
            D
          </div>
          <div
            class="flex h-6 w-6 items-center justify-center rounded bg-cyan-500/20 border border-cyan-500/40 text-[9px] font-bold text-cyan-300"
          >
            F
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Monitor, X } from 'lucide-vue-next'
</script>

<style scoped>
.hud-preview-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
