<template>
  <header
    class="flex h-13 w-full select-none items-center justify-between border-b border-white/[0.08] bg-[rgba(9,13,22,0.95)] px-4 backdrop-blur-2xl transition-colors"
    data-tauri-drag-region
  >
    <!-- Left: Brand Logo, Title & 4b Badge -->
    <div class="flex items-center gap-3" data-tauri-drag-region>
      <div
        class="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-cyan-500 p-0.5 shadow-[0_0_12px_rgba(99,102,241,0.4)]"
      >
        <div class="flex h-full w-full items-center justify-center rounded-[10px] bg-[#0b0f19]">
          <svg class="h-4 w-4 text-cyan-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>
      <div class="flex items-center gap-2" data-tauri-drag-region>
        <span class="text-sm font-black tracking-wide text-white font-sans"> LoL 战绩助手 </span>
        <span
          class="rounded-full bg-purple-900/60 px-2 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.25)]"
        >
          4b
        </span>
      </div>
    </div>

    <!-- Center: Search & Region Selector with Ctrl + K shortcut -->
    <div class="flex items-center">
      <div
        class="flex h-9 w-[380px] items-center rounded-lg border border-white/10 bg-[#131929]/90 px-2.5 transition-all focus-within:border-indigo-500/80 focus-within:bg-[#161f33] focus-within:shadow-[0_0_15px_rgba(99,102,241,0.2)]"
      >
        <Search class="h-3.5 w-3.5 text-white/40 mr-2 shrink-0" />

        <!-- Region Dropdown Trigger -->
        <n-dropdown
          trigger="click"
          size="small"
          :options="regionDropdownOptions"
          @select="onRegionSelect"
        >
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <span class="font-medium text-[11px]">{{ selectedRegionLabel }}</span>
            <ChevronDown class="h-3 w-3 text-white/40" />
          </button>
        </n-dropdown>

        <span class="mx-2 h-3.5 w-[1px] bg-white/15 shrink-0" />

        <!-- Search Input -->
        <input
          v-model="searchValue"
          type="text"
          placeholder="搜索召唤师名称#TAG"
          class="flex-1 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none"
          @keyup.enter="onClinkSearch"
        />

        <!-- Shortcut Badge -->
        <div
          class="flex items-center gap-1 text-[10px] font-mono text-white/40 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded shadow-sm shrink-0"
        >
          <span>Ctrl</span>
          <span>·</span>
          <span>K</span>
        </div>
      </div>
    </div>

    <!-- Right: Update Pill, Action Icons, User Profile & Window Controls -->
    <div class="flex items-center gap-2" data-tauri-drag-region>
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

      <!-- Notification Bell -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        title="通知中心"
      >
        <Bell class="h-4 w-4" />
      </button>

      <!-- Cloud Sync Button -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        title="云端同步"
        @click="router.push('/Settings/DataSync')"
      >
        <Cloud class="h-4 w-4" />
      </button>

      <!-- Settings Button -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        title="系统设置"
        @click="router.push('/Settings')"
      >
        <Settings class="h-4 w-4" />
      </button>

      <span class="mx-1 h-4 w-[1px] bg-white/10" />

      <!-- User Profile Chip -->
      <div
        class="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 px-2 py-1 border border-white/10 cursor-pointer transition-all"
        :title="
          summoner?.gameName
            ? `点击查看 ${summoner.gameName}#${summoner.tagLine} 的战绩`
            : '未连接到客户端'
        "
        @click="toMyRecord"
      >
        <div
          class="relative flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600/40 border border-indigo-400/40 overflow-hidden"
        >
          <img
            v-if="summoner?.profileIconId"
            :src="`${assetPrefix}/profile/${summoner.profileIconId}`"
            class="h-full w-full object-cover"
            alt="avatar"
          />
          <User v-else class="h-3.5 w-3.5 text-indigo-200" />
          <span
            class="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full"
            :class="isConnected ? 'bg-emerald-400 ring-1 ring-black' : 'bg-slate-500'"
          />
        </div>
        <div class="flex flex-col">
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-white leading-tight truncate max-w-[90px]">
              {{ summoner?.gameName || (isConnected ? '加载中...' : '未登录') }}
            </span>
            <ChevronDown class="h-3 w-3 text-white/50" />
          </div>
          <span
            class="text-[9px] leading-tight"
            :class="isConnected ? 'text-emerald-400 font-medium' : 'text-white/40'"
          >
            {{ isConnected ? '在线' : '离线' }}
          </span>
        </div>
      </div>

      <span class="mx-1 h-4 w-[1px] bg-white/10" />

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
  Minus,
  Square,
  X,
  ArrowUpCircle,
  Bell,
  Cloud,
  Settings,
  User
} from 'lucide-vue-next'
import { Window } from '@tauri-apps/api/window'

import router from '@renderer/router'
import { useGameState, lcuConnected } from '@renderer/composables/useGameState'
import { getSgpRegions } from '@renderer/features/record/services/sgp'
import { useAppUpdate } from '@renderer/composables/useAppUpdate'
import { GATE_SETTLE_MS, GATE_FALLBACK_MS } from '@renderer/composables/useStartupDialogs'
import { assetPrefix } from '@renderer/services/http'

/** 当前应用窗口实例，用于执行窗口控制操作 */
const currentWindow = Window.getCurrent()

/** 搜索输入框的值 */
const searchValue = ref('')

/** 选中的大区 platformId（空 = 当前区，走本地 LCU；非空走 SGP 跨区查询） */
const selectedRegion = ref('')
/** 大区下拉选项列表 */
const regionOptions = ref<{ label: string; value: string }[]>([])
onMounted(async () => {
  try {
    regionOptions.value = await getSgpRegions()
  } catch {
    regionOptions.value = []
  }
})
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

/** 当前登录召唤师信息与连接状态 */
const { isConnected, summoner } = useGameState()

const toMyRecord = (): void => {
  const s = summoner.value
  if (s?.gameName) {
    void router.push({
      path: '/Record',
      query: {
        name: `${s.gameName}#${s.tagLine}`,
        t: Date.now()
      }
    })
  } else {
    void router.push({
      path: '/Record',
      query: { t: Date.now() }
    })
  }
}

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
