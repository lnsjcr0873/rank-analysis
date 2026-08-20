<template>
  <div
    class="settings-quick-card rounded-2xl border border-white/[0.08] bg-[rgba(15,22,37,0.92)] p-3.5 backdrop-blur-2xl shadow-xl transition-all"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5">
      <div class="flex items-center gap-1.5">
        <Settings class="h-3.5 w-3.5 text-indigo-400" />
        <span class="text-xs font-bold tracking-wide text-white">设置中心</span>
      </div>
      <button
        type="button"
        class="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
        @click="router.push('/Settings')"
      >
        更多设置
      </button>
    </div>

    <!-- Switches Grid (2 columns or list) -->
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">自动接受对局</span>
        <n-switch v-model:value="autoAccept" size="small" />
      </div>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">自动禁用英雄</span>
        <n-switch v-model:value="autoBan" size="small" />
      </div>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">自动秒选英雄</span>
        <n-switch v-model:value="autoPick" size="small" />
      </div>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">自动导入符文</span>
        <n-switch v-model:value="autoRunes" size="small" />
      </div>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">玩家备注高亮</span>
        <n-switch v-model:value="highlightNotes" size="small" />
      </div>

      <div
        class="flex items-center justify-between rounded-xl bg-white/[0.03] px-2.5 py-1.5 border border-white/5"
      >
        <span class="text-white/80">云端同步</span>
        <n-switch v-model:value="cloudSync" size="small" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Settings } from 'lucide-vue-next'
import { NSwitch } from 'naive-ui'
import router from '@renderer/router'

const autoAccept = ref(true)
const autoBan = ref(true)
const autoPick = ref(false)
const autoRunes = ref(true)
const highlightNotes = ref(false)
const cloudSync = ref(true)
</script>

<style scoped>
.settings-quick-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
</style>
