<template>
  <header
    class="flex h-12 w-full select-none items-center justify-between border-b border-white/[0.08] bg-[rgba(11,15,25,0.85)] px-3 backdrop-blur-xl transition-colors"
    data-tauri-drag-region
  >
    <!-- Left: Brand Logo & Title -->
    <div class="flex items-center gap-2.5" data-tauri-drag-region>
      <div
        class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#c8aa6e] to-[#785a28] text-xs font-black text-black border border-[#f0e6d2]/50 shadow-sm"
      >
        R
      </div>
      <div class="flex flex-col" data-tauri-drag-region>
        <span class="text-xs font-bold tracking-wider text-[#f0e6d2] uppercase font-sans">
          Rank Analysis
        </span>
        <span class="text-[10px] text-white/60 font-sans leading-tight">对局助手</span>
      </div>
    </div>

    <!-- Center: Search & Region Selector -->
    <div class="flex items-center">
      <div
        class="flex h-8 items-center rounded-md border border-white/15 bg-white/5 px-2 transition-all focus-within:border-[#c8aa6e] focus-within:bg-white/10"
      >
        <!-- Region Dropdown Trigger -->
        <n-dropdown
          trigger="click"
          size="small"
          :options="regionDropdownOptions"
          @select="onRegionSelect"
        >
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/90 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <span class="font-medium">{{ selectedRegionLabel }}</span>
            <ChevronDown class="h-3 w-3 text-white/60" />
          </button>
        </n-dropdown>

        <span class="mx-1.5 h-3.5 w-[1px] bg-white/20" />

        <!-- Search Input -->
        <input
          v-model="searchValue"
          type="text"
          placeholder="召唤师名#Tag"
          class="w-48 bg-transparent text-xs text-white placeholder:text-white/50 focus:outline-none"
          @keyup.enter="onClinkSearch"
        />

        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
          title="搜索战绩"
          @click="onClinkSearch"
        >
          <Search class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Right: Update Pill, Actions, Theme & Window Controls -->
    <div class="flex items-center gap-1.5" data-tauri-drag-region>
      <!-- Update Pill -->
      <Transition name="fade">
        <button
          v-if="availableUpdate"
          type="button"
          class="update-pill flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(34,197,94,0.25)] hover:bg-emerald-500/30 transition-all cursor-pointer animate-pulse"
          :title="`发现新版本 v${availableUpdate.version}，点击立即更新`"
          @click="onUpdatePillClick"
        >
          <ArrowUpCircle class="h-3.5 w-3.5" />
          <span>新版 v{{ availableUpdate.version }}</span>
        </button>
      </Transition>

      <!-- Close League Client Button -->
      <n-popconfirm positive-text="关闭游戏" negative-text="取消" @positive-click="closeLeague">
        <template #trigger>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            :disabled="!isConnected"
            :title="isConnected ? '关闭游戏客户端' : '游戏客户端未运行'"
          >
            <Power class="h-3.5 w-3.5" />
          </button>
        </template>
        确定关闭游戏客户端？
      </n-popconfirm>

      <!-- GitHub Link -->
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        title="访问 GitHub 项目主页"
        @click="openGithubLink"
      >
        <Github class="h-3.5 w-3.5" />
      </button>

      <!-- Theme Switch -->
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        :title="themeSwitch ? '切换为暗色模式' : '切换为亮色模式'"
        @click="settingsStore.toggleTheme()"
      >
        <Sun v-if="themeSwitch" class="h-3.5 w-3.5 text-amber-300" />
        <Moon v-else class="h-3.5 w-3.5 text-slate-300" />
      </button>

      <span class="mx-1 h-3.5 w-[1px] bg-white/15" />

      <!-- Window Controls -->
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          title="最小化"
          @click="minimizeWindow"
        >
          <Minus class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          title="最大化 / 还原"
          @click="maximizeWindow"
        >
          <Square class="h-3 w-3" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-rose-500/80 hover:text-white transition-colors cursor-pointer"
          title="关闭"
          @click="closeWindow"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  Search,
  ChevronDown,
  Power,
  Github,
  Sun,
  Moon,
  Minus,
  Square,
  X,
  ArrowUpCircle
} from 'lucide-vue-next'
import { darkTheme, useMessage } from 'naive-ui'
import { Window } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'

import router from '@renderer/router'
import { useSettingsStore } from '@renderer/features/settings/stores/setting'
import { useGameState, lcuConnected } from '@renderer/composables/useGameState'
import { closeLeagueByIpc } from '@renderer/services/ipc'
import { getSgpRegions } from '@renderer/features/record/services/sgp'
import { useAppUpdate } from '@renderer/composables/useAppUpdate'
import { GATE_SETTLE_MS, GATE_FALLBACK_MS } from '@renderer/composables/useStartupDialogs'

/** 当前应用窗口实例，用于执行窗口控制操作 */
const currentWindow = Window.getCurrent()

/** 搜索输入框的值 */
const searchValue = ref('')

/** 选中的大区 platformId（空 = 当前区，走本地 LCU；非空走 SGP 跨区查询） */
const selectedRegion = ref('')
/** 大区下拉选项：当前区 + 各腾讯大区（来自后端 get_sgp_regions） */
const regionOptions = ref<{ label: string; value: string }[]>([{ label: '当前区', value: '' }])

onMounted(async () => {
  const regions = await getSgpRegions()
  regionOptions.value = [{ label: '当前区', value: '' }, ...regions]
})

/** n-dropdown 选项格式（key=platformId） */
const regionDropdownOptions = computed(() =>
  regionOptions.value.map(r => ({ label: r.label, key: r.value }))
)
/** 当前选中大区的显示文案（前缀按钮上的文字） */
const selectedRegionLabel = computed(
  () => regionOptions.value.find(r => r.value === selectedRegion.value)?.label ?? '当前区'
)
const onRegionSelect = (key: string): void => {
  selectedRegion.value = key
}

/** 设置状态管理 Store */
const settingsStore = useSettingsStore()

/** LCU 连接状态：仅在客户端运行（已连接）时允许点击关闭游戏 */
const { isConnected } = useGameState()

const message = useMessage()

/** 关闭游戏请求进行中（防重复点击 + 按钮 loading 态） */
const closingLeague = ref(false)

const closeLeague = async (): Promise<void> => {
  if (closingLeague.value) return
  closingLeague.value = true
  try {
    await closeLeagueByIpc()
    message.success('已关闭游戏客户端')
  } catch (e) {
    message.error(String(e))
  } finally {
    closingLeague.value = false
  }
}

/** 主题开关状态 */
const themeSwitch = computed(() => settingsStore.theme.name !== darkTheme.name)

// ─── 顶栏升级药丸 ───────────────────────────────────────────────────────────
const { availableUpdate, checkForUpdates, showUpdateDialog } = useAppUpdate()

const onUpdatePillClick = (): void => {
  if (availableUpdate.value) showUpdateDialog(availableUpdate.value)
}

function scheduleSilentUpdateCheck(): void {
  let scheduled = false
  function fire(): void {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => {
      checkForUpdates('silent')
    }, GATE_SETTLE_MS)
  }
  if (lcuConnected.value) {
    fire()
    return
  }
  const stop = watch(lcuConnected, connected => {
    if (connected) {
      stop()
      fire()
    }
  })
  window.setTimeout(() => {
    stop()
    fire()
  }, GATE_FALLBACK_MS)
}

onMounted(() => {
  scheduleSilentUpdateCheck()
})

const openGithubLink = async (): Promise<void> => {
  await openUrl('https://github.com/wnzzer/rank-analysis')
}

const onClinkSearch = async (): Promise<void> => {
  if (!searchValue.value.trim()) return

  await router.push({
    path: '/Record',
    query: { name: searchValue.value, region: selectedRegion.value || undefined, t: Date.now() }
  })
  searchValue.value = ''
}

const minimizeWindow = (): void => {
  currentWindow.minimize()
}

const maximizeWindow = (): void => {
  currentWindow.toggleMaximize()
}

const closeWindow = (): void => {
  currentWindow.close()
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
