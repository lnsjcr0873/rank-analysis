<template>
  <nav
    class="flex h-full w-[145px] shrink-0 flex-col justify-between border-r border-white/[0.08] bg-[rgba(9,13,22,0.95)] p-3 select-none backdrop-blur-2xl transition-all"
  >
    <!-- Top Navigation Section -->
    <div v-if="!isRecordChild" class="flex flex-col gap-1.5 w-full">
      <!-- 1. 战绩复盘 (RECORD) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Record'))"
        title="战绩复盘与查询"
        @click="handleMenuClick('Record')"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg"
            :class="isCurrentPath('Record') ? 'bg-indigo-500/30 text-indigo-300' : 'text-white/60'"
          >
            <BarChart2 class="h-4 w-4" />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('Record') ? 'text-white' : 'text-white/80'"
            >
              战绩复盘
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              RECORD
            </span>
          </div>
        </div>
      </button>

      <!-- 2. 实时对局 (GAMING) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Gaming'))"
        title="实时对局侦查"
        @click="handleMenuClick('Gaming')"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="relative flex h-7 w-7 items-center justify-center rounded-lg"
            :class="isCurrentPath('Gaming') ? 'bg-indigo-500/30 text-cyan-300' : 'text-white/60'"
          >
            <Gamepad2 class="h-4 w-4" />
            <span
              v-if="isInGame"
              class="absolute top-1 right-1 h-2 w-2 rounded-full bg-cyan-400 animate-ping"
            />
            <span v-if="isInGame" class="absolute top-1 right-1 h-2 w-2 rounded-full bg-cyan-400" />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('Gaming') ? 'text-white' : 'text-white/80'"
            >
              实时对局
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              GAMING
            </span>
          </div>
        </div>
      </button>

      <!-- 3. AI 军师 (TACTICAL) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Tactical'))"
        title="AI 军师阵容与对局推演"
        @click="handleTacticalClick"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg"
            :class="isCurrentPath('Tactical') ? 'bg-indigo-500/30 text-amber-300' : 'text-white/60'"
          >
            <Sparkles class="h-4 w-4" />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('Tactical') ? 'text-white' : 'text-white/80'"
            >
              AI 军师
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              TACTICAL
            </span>
          </div>
        </div>
      </button>

      <!-- 4. 游戏内 HUD (OVERLAY) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('OverlayView'))"
        title="游戏内悬浮 HUD 窗"
        @click="handleOverlayClick"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg"
            :class="
              isCurrentPath('OverlayView') ? 'bg-indigo-500/30 text-cyan-300' : 'text-white/60'
            "
          >
            <Layers class="h-4 w-4" />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('OverlayView') ? 'text-white' : 'text-white/80'"
            >
              游戏内 HUD
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              OVERLAY
            </span>
          </div>
        </div>
      </button>

      <!-- 5. 成长分析 (GROWTH) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Growth'))"
        title="选手成长与改错清单"
        @click="handleMenuClick('Growth')"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg"
            :class="isCurrentPath('Growth') ? 'bg-indigo-500/30 text-emerald-300' : 'text-white/60'"
          >
            <TrendingUp class="h-4 w-4" />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('Growth') ? 'text-white' : 'text-white/80'"
            >
              成长分析
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              GROWTH
            </span>
          </div>
        </div>
      </button>

      <!-- 6. 设置中心 (SETTINGS) -->
      <button
        type="button"
        :class="navItemClass(isCurrentPath('Settings'))"
        title="应用与自动化设置"
        @click="handleMenuClick('Settings')"
      >
        <div class="flex items-center gap-2.5 w-full">
          <div
            class="relative flex h-7 w-7 items-center justify-center rounded-lg"
            :class="
              isCurrentPath('Settings') ? 'bg-indigo-500/30 text-indigo-300' : 'text-white/60'
            "
          >
            <Settings class="h-4 w-4" />
            <span
              v-if="hasPendingCloudConfig"
              class="pending-badge-dot absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse"
            />
          </div>
          <div class="flex flex-col text-left">
            <span
              class="text-xs font-bold leading-tight"
              :class="isCurrentPath('Settings') ? 'text-white' : 'text-white/80'"
            >
              设置中心
            </span>
            <span class="text-[9px] font-mono tracking-wider text-white/40 leading-tight">
              SETTINGS
            </span>
          </div>
        </div>
      </button>
    </div>

    <!-- Child Window Navigation Mode -->
    <div v-else class="flex flex-col gap-2 w-full">
      <button
        type="button"
        class="flex items-center gap-2 w-full rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
        title="聚焦回到主窗口"
        @click="backToMain"
      >
        <AppWindow class="h-4 w-4 text-indigo-300" />
        <span class="text-xs font-medium">主窗口</span>
      </button>

      <button
        type="button"
        class="flex items-center gap-2 w-full rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
        title="主窗口与战绩窗口横向并排"
        @click="tileSideBySide"
      >
        <Columns class="h-4 w-4 text-cyan-300" />
        <span class="text-xs font-medium">并排对比</span>
      </button>
    </div>

    <!-- Bottom Section: Quick Tools, Launch Button & Version -->
    <div v-if="!isRecordChild" class="flex flex-col gap-3 w-full border-t border-white/10 pt-3">
      <!-- Quick Tools List -->
      <div class="flex flex-col gap-1 text-[11px] text-white/60">
        <button
          type="button"
          class="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 hover:text-white transition-colors cursor-pointer text-left"
          @click="tileSideBySide"
        >
          <AppWindow class="h-3.5 w-3.5 text-indigo-400" />
          <span>多窗口管理</span>
        </button>

        <button
          type="button"
          class="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 hover:text-white transition-colors cursor-pointer text-left"
          @click="router.push('/Settings/PlayerNotes')"
        >
          <BookmarkCheck class="h-3.5 w-3.5 text-amber-400" />
          <span>玩家备注</span>
        </button>

        <button
          type="button"
          class="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 hover:text-white transition-colors cursor-pointer text-left"
          @click="toMe"
        >
          <FileText class="h-3.5 w-3.5 text-cyan-400" />
          <span>对局记录库</span>
        </button>

        <button
          type="button"
          class="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5 hover:text-white transition-colors cursor-pointer text-left"
          @click="router.push('/Settings/DataSync')"
        >
          <Cloud class="h-3.5 w-3.5 text-blue-400" />
          <span>云端同步</span>
        </button>
      </div>

      <!-- Primary Action: 一键启动游戏 Button -->
      <button
        type="button"
        :disabled="launchingGame"
        class="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 px-3 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:brightness-110 hover:shadow-[0_0_20px_rgba(59,130,246,0.6)] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
        @click="handleLaunchGame"
      >
        <Play v-if="!launchingGame" class="h-3.5 w-3.5 fill-current" />
        <span v-if="!launchingGame">一键启动游戏</span>
        <span v-else>正在拉起...</span>
      </button>

      <!-- Footer Version & Check Update -->
      <div class="flex items-center justify-between text-[10px] text-white/40 px-1 font-mono">
        <span>版本: 4b.0.0</span>
        <button
          type="button"
          class="hover:text-cyan-400 cursor-pointer transition-colors"
          @click="onCheckUpdateManual"
        >
          检查更新
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BarChart2,
  Gamepad2,
  TrendingUp,
  Settings,
  AppWindow,
  Columns,
  Sparkles,
  Layers,
  BookmarkCheck,
  FileText,
  Cloud,
  Play
} from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import { showOverlayWindow } from '@renderer/services/overlay'
import router, { getFirstPath } from '../router'
import { useGameState } from '@renderer/composables/useGameState'
import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'
import { useAppUpdate } from '@renderer/composables/useAppUpdate'
import { launchLeagueByIpc } from '@renderer/services/ipc'
import {
  isRecordChildWindow,
  focusMainWindow,
  tileWindowsSideBySide
} from '@renderer/utils/windows'

const { summoner: gameStateSummoner, currentPhase } = useGameState()
const cloudStore = useCloudSyncStore()

let checkForUpdates: ((mode?: any) => Promise<any>) | null = null
try {
  const appUpdate = useAppUpdate()
  checkForUpdates = appUpdate.checkForUpdates
} catch {
  // Outside naive-ui notification/dialog provider (e.g. in isolated component unit tests)
}

let message: ReturnType<typeof useMessage> | null = null
try {
  message = useMessage()
} catch {
  // Outside naive-ui message provider in isolated unit tests
}

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

const isInGame = computed(() => currentPhase.value === 'InProgress')

function isCurrentPath(name: string) {
  return getFirstPath(router.currentRoute.value.path) === name
}

function navItemClass(active: boolean) {
  return [
    'relative flex items-center w-full px-2.5 py-2 rounded-xl transition-all duration-200 cursor-pointer',
    active
      ? 'bg-gradient-to-r from-indigo-600/35 to-purple-600/20 text-white border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.25)]'
      : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
  ]
}

const toMe = () => {
  if (!gameStateSummoner.value?.gameName) {
    void router.push('/Record')
    return
  }
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
    const isAlreadyRecord = router.currentRoute.value.path === '/Record'
    const currentName = isAlreadyRecord ? (router.currentRoute.value.query.name as string) : ''
    const fallbackName = gameStateSummoner.value?.gameName
      ? `${gameStateSummoner.value.gameName}#${gameStateSummoner.value.tagLine}`
      : ''
    const targetName = currentName || fallbackName
    if (targetName) {
      void router.push({ path: '/Record', query: { name: targetName, t: Date.now() } })
    } else {
      void router.push({ path: '/Record', query: { t: Date.now() } })
    }
  } else if (key === 'Settings') {
    void router.push('/Settings/Automation')
  } else {
    void router.push(`/${key}`)
  }
}

const handleTacticalClick = () => {
  void router.push({ path: '/Gaming', query: { openAi: '1', t: Date.now() } })
}

const handleOverlayClick = async () => {
  try {
    await showOverlayWindow()
    message?.success('游戏内 HUD 置顶悬浮窗已激活')
  } catch {
    message?.info('游戏内 HUD 已就绪，进入对局后自动激活')
  }
  void router.push('/Settings/Automation')
}

const launchingGame = ref(false)
const handleLaunchGame = async () => {
  if (launchingGame.value) return
  launchingGame.value = true
  try {
    await launchLeagueByIpc()
    message?.success('游戏启动指令已发送')
  } catch (err) {
    message?.error(String(err) || '启动失败')
  } finally {
    launchingGame.value = false
  }
}

const onCheckUpdateManual = () => {
  if (checkForUpdates) {
    void checkForUpdates('manual')
  }
}
</script>
