<template>
  <div class="record-page flex h-full flex-col gap-3 p-3 select-none overflow-hidden">
    <!-- Top Player Bar -->
    <PlayerBar
      :summoner="summoner"
      :rank="rank"
      :solo5v5="solo5v5"
      :flex="flex"
      :recent-data="recentData"
      :tags="tags"
      :platform-id-cn="platformIdCn"
      :is-cross-region="isCrossRegion"
    />

    <!-- Main Content Area: Side Panel + Match History -->
    <div class="record-main relative flex flex-1 gap-4 min-h-0">
      <!-- Wide Screen Sticky Left Panel -->
      <aside
        v-if="!isMobile && !isCompact"
        class="record-side w-[320px] shrink-0 overflow-y-auto pr-1"
      >
        <UserSidePanel
          :rank="rank"
          :solo5v5="solo5v5"
          :flex="flex"
          :recent-data="recentData"
          :mode="mode"
          :is-cross-region="isCrossRegion"
          :champion-pool="championPool"
          :hovered-champion="hoveredChampion"
          :games="games"
          :my-puuid="summoner.puuid"
          :active-champion="activeChampion"
          @mode-change="updateMode"
          @select-champion="championFilterCmd = $event"
          @open-game="focusGameId = $event"
        />
      </aside>

      <!-- Compact Screen Drawer Trigger Button -->
      <button
        v-if="isCompact"
        type="button"
        class="record-side-trigger absolute top-2 left-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[rgba(15,22,36,0.85)] text-white/70 shadow-md backdrop-blur-md hover:border-[#c8aa6e]/60 hover:text-white cursor-pointer transition-all"
        :title="sideOpen ? '收起侧栏' : '打开侧栏'"
        @click="sideOpen = !sideOpen"
      >
        <Menu class="h-4 w-4" />
      </button>

      <!-- Drawer for Compact Mode -->
      <n-drawer
        v-if="isCompact"
        v-model:show="sideOpen"
        placement="left"
        :width="320"
        :auto-focus="false"
        :show-mask="false"
      >
        <n-drawer-content closable :native-scrollbar="false" class="record-side-drawer">
          <UserSidePanel
            :rank="rank"
            :solo5v5="solo5v5"
            :flex="flex"
            :recent-data="recentData"
            :mode="mode"
            :is-cross-region="isCrossRegion"
            :champion-pool="championPool"
            :hovered-champion="hoveredChampion"
            :games="games"
            :my-puuid="summoner.puuid"
            :active-champion="activeChampion"
            @mode-change="updateMode"
            @select-champion="championFilterCmd = $event"
            @open-game="focusGameId = $event"
          />
        </n-drawer-content>
      </n-drawer>

      <!-- Center Match History List -->
      <main
        :ref="el => bindContentScroll(el)"
        class="record-content flex-1 overflow-y-auto px-1 pb-6"
      >
        <div class="record-content-inner max-w-[1280px] mx-auto flex flex-col gap-4">
          <MatchHistory
            :focus-game-id="focusGameId"
            :champion-filter="championFilterCmd"
            @hover-champion="hoveredChampion = $event"
            @leave-champion="hoveredChampion = null"
            @pool-change="championPool = $event"
            @games-change="games = $event"
            @focus-handled="focusGameId = null"
            @champion-filter-handled="championFilterCmd = 0"
            @filter-change="activeChampion = $event.championId"
          />
        </div>
      </main>

      <!-- Back to Top Floating Button -->
      <Transition name="fab">
        <button
          v-if="showBackTop"
          type="button"
          class="record-back-top absolute right-4 bottom-6 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,22,36,0.9)] text-white/80 shadow-xl backdrop-blur-md hover:border-[#c8aa6e]/60 hover:text-white cursor-pointer transition-all"
          title="回到顶部"
          @click="scrollToTop"
        >
          <ArrowUp class="h-4 w-4" />
        </button>
      </Transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import { ArrowUp, Menu } from 'lucide-vue-next'
import MatchHistory from '../components/record/MatchHistory.vue'
import PlayerBar from '../components/record/PlayerBar.vue'
import UserSidePanel from '../components/record/UserSidePanel.vue'
import type { Game } from '../types/domain/match'
import type { ChampionPoolEntry } from '../components/record/championPool'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import { usePlayerRecordData } from '@renderer/composables/usePlayerRecordData'

const { isMobile, isCompact } = useBreakpoint()
const sideOpen = ref(false)

watch(isCompact, compact => {
  if (!compact) sideOpen.value = false
})

const BACK_TOP_THRESHOLD = 400
const showBackTop = ref(false)
const contentEl = ref<HTMLElement | null>(null)

function onContentScroll() {
  showBackTop.value = (contentEl.value?.scrollTop ?? 0) > BACK_TOP_THRESHOLD
}

function scrollToTop() {
  contentEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function bindContentScroll(el: Element | ComponentPublicInstance | null) {
  const target = el instanceof HTMLElement ? el : null
  if (contentEl.value === target) return
  contentEl.value?.removeEventListener('scroll', onContentScroll)
  contentEl.value = target
  target?.addEventListener('scroll', onContentScroll)
  showBackTop.value = (target?.scrollTop ?? 0) > BACK_TOP_THRESHOLD
}

onBeforeUnmount(() => {
  contentEl.value?.removeEventListener('scroll', onContentScroll)
})

const {
  summoner,
  rank,
  solo5v5,
  flex,
  recentData,
  tags,
  platformIdCn,
  mode,
  isCrossRegion,
  updateMode
} = usePlayerRecordData()

const championPool = ref<ChampionPoolEntry[]>([])
const hoveredChampion = ref<number | null>(null)
const games = ref<Game[]>([])
const focusGameId = ref<number | null>(null)
const championFilterCmd = ref(0)
const activeChampion = ref(0)
</script>

<style scoped>
.record-side::-webkit-scrollbar {
  display: none;
}

.fab-enter-active,
.fab-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
