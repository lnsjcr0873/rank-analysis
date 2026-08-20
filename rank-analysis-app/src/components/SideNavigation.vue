<template>
  <nav
    class="flex h-full w-[64px] flex-col items-center justify-between border-r border-white/[0.08] bg-[rgba(11,15,25,0.92)] py-3 select-none backdrop-blur-xl transition-colors"
  >
    <!-- Top Navigation Items -->
    <div v-if="!isRecordChild" class="flex flex-col items-center gap-2 w-full px-2">
      <!-- Record Nav -->
      <button
        v-if="!!gameStateSummoner?.gameName"
        type="button"
        :class="navItemClass(isCurrentPath('Record'))"
        title="战绩查询与复盘"
        @click="handleMenuClick('Record')"
      >
        <BarChart2 class="h-4 w-4" />
        <span class="text-[10px] font-medium leading-none">战绩</span>
        <div v-if="isCurrentPath('Record')" class="nav-active-bar" />
      </button>

      <!-- Gaming Nav -->
      <button
        v-if="!!gameStateSummoner?.gameName"
        type="button"
        :class="navItemClass(isCurrentPath('Gaming'))"
        title="实时对局与房间侦查"
        @click="handleMenuClick('Gaming')"
      >
        <div class="relative">
          <Gamepad2 class="h-4 w-4" />
          <span
            v-if="isInGame"
            class="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-cyan-400 animate-ping"
          />
          <span v-if="isInGame" class="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-cyan-400" />
        </div>
        <span class="text-[10px] font-medium leading-none">对局</span>
        <div v-if="isCurrentPath('Gaming')" class="nav-active-bar" />
      </button>

      <!-- Growth Nav -->
      <button
        v-if="!!gameStateSummoner?.gameName"
        type="button"
        :class="navItemClass(isCurrentPath('Growth'))"
        title="选手成长与改错清单"
        @click="handleMenuClick('Growth')"
      >
        <TrendingUp class="h-4 w-4" />
        <span class="text-[10px] font-medium leading-none">成长</span>
        <div v-if="isCurrentPath('Growth')" class="nav-active-bar" />
      </button>

      <!-- Settings Nav -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Settings'))"
        title="应用与自动化设置"
        @click="handleMenuClick('Settings')"
      >
        <div class="relative">
          <Settings class="h-4 w-4" />
          <span
            v-if="hasPendingCloudConfig"
            class="pending-badge-dot absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse"
          />
        </div>
        <span class="text-[10px] font-medium leading-none">设置</span>
        <div v-if="isCurrentPath('Settings')" class="nav-active-bar" />
      </button>
    </div>

    <!-- Child Window Navigation -->
    <div v-else class="flex flex-col items-center gap-2 w-full px-2">
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 w-full h-12 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
        title="聚焦回到主窗口"
        @click="backToMain"
      >
        <AppWindow class="h-4 w-4" />
        <span class="text-[10px] font-medium leading-none">主窗口</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 w-full h-12 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
        title="主窗口与战绩窗口横向并排"
        @click="tileSideBySide"
      >
        <Columns class="h-4 w-4" />
        <span class="text-[10px] font-medium leading-none">并排对比</span>
      </button>
    </div>

    <!-- Bottom Status Indicators -->
    <div v-if="!isRecordChild" class="flex flex-col items-center gap-2">
      <!-- LCU Connection Status Button -->
      <button
        type="button"
        :disabled="!isConnected"
        class="relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        :class="
          isConnected
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(34,197,94,0.15)]'
            : 'border-white/10 bg-white/5 text-white/40'
        "
        :title="isConnected ? `已连接客户端: ${gameStateSummoner?.gameName}` : '未连接到游戏客户端'"
        @click="toMe"
      >
        <Link2 v-if="isConnected" class="h-3.5 w-3.5" />
        <Unlink v-else class="h-3.5 w-3.5" />
        <span
          class="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
          :class="isConnected ? 'bg-emerald-400' : 'bg-slate-500'"
        />
      </button>

      <!-- In-Game State Button -->
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all cursor-pointer"
        :class="
          isInGame
            ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 shadow-[0_0_8px_rgba(10,200,185,0.2)] animate-pulse'
            : 'border-white/10 bg-white/5 text-white/40'
        "
        :title="isInGame ? '正在对局中 (点击进入)' : '未在游戏中'"
        @click="goGaming"
      >
        <Gamepad2 class="h-3.5 w-3.5" />
        <span
          class="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
          :class="isInGame ? 'bg-cyan-400' : 'bg-slate-500'"
        />
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  BarChart2,
  Gamepad2,
  TrendingUp,
  Settings,
  Link2,
  Unlink,
  AppWindow,
  Columns
} from 'lucide-vue-next'
import router, { getFirstPath } from '../router'
import { useGameState } from '@renderer/composables/useGameState'
import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'
import {
  isRecordChildWindow,
  focusMainWindow,
  tileWindowsSideBySide
} from '@renderer/utils/windows'

const { summoner: gameStateSummoner, currentPhase } = useGameState()
const cloudStore = useCloudSyncStore()

/** 战绩子窗口（record-*）精简模式 */
const isRecordChild = isRecordChildWindow()

const backToMain = () => {
  void focusMainWindow()
}

const tileSideBySide = () => {
  void tileWindowsSideBySide()
}

/** 云端配置待裁决时为真 */
const hasPendingCloudConfig = computed(() => cloudStore.pendingCloudConfig !== null)

const isConnected = computed(() => !!gameStateSummoner.value?.gameName)
const isInGame = computed(() => currentPhase.value === 'InProgress')

function isCurrentPath(name: string) {
  return getFirstPath(router.currentRoute.value.path) === name
}

function navItemClass(active: boolean) {
  return [
    'relative flex flex-col items-center justify-center gap-1 w-full h-13 rounded-lg transition-all duration-200 cursor-pointer',
    active
      ? 'bg-gradient-to-b from-[#c8aa6e]/20 to-[#c8aa6e]/5 text-[#f0e6d2] shadow-[0_0_12px_rgba(200,170,110,0.15)] border border-[#c8aa6e]/30'
      : 'text-white/50 hover:text-white/90 hover:bg-white/5'
  ]
}

const toMe = () => {
  if (!gameStateSummoner.value?.gameName) return
  void router.push({
    path: '/Record',
    query: {
      name: `${gameStateSummoner.value.gameName}#${gameStateSummoner.value.tagLine}`,
      t: Date.now()
    }
  })
}

const handleMenuClick = (key: string) => {
  if (key === 'Record') {
    const currentName = router.currentRoute.value.query.name as string
    const fallbackName = gameStateSummoner.value?.gameName
      ? `${gameStateSummoner.value.gameName}#${gameStateSummoner.value.tagLine}`
      : ''
    const targetName = currentName || fallbackName
    if (targetName) {
      void router.push({ path: '/Record', query: { name: targetName, t: Date.now() } })
    } else {
      void router.push({ path: '/Record', query: { t: Date.now() } })
    }
  } else {
    void router.push(`/${key}`)
  }
}

const goGaming = () => {
  void router.push('/Gaming')
}
</script>

<style scoped>
.nav-active-bar {
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 2.5px;
  border-radius: 9999px;
  background: linear-gradient(to bottom, #f0e6d2, #c8aa6e);
  box-shadow: 0 0 8px rgba(200, 170, 110, 0.6);
}
</style>
