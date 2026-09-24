<template>
  <div class="record-page">
    <PlayerBar
      :summoner="summoner"
      :rank="rank"
      :recent-data="recentData"
      :tags="tags"
      :platform-id-cn="platformIdCn"
      :is-cross-region="isCrossRegion"
      @refresh="refreshTick++"
    />
    <div class="record-main">
      <!-- 宽窗（>=1064）：左栏常驻，顶部为分页（Akari 对齐）；窄窗：隐藏并改用 NDrawer 抽屉 -->
      <aside v-if="!isMobile && !isCompact" class="record-side">
        <MatchHistoryPagination class="record-side-pagination" />
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
      <!-- 窄窗：左栏入口 + 浮动分页收进内容区顶粘工具条（Akari @1064 紧凑布局） -->
      <main :ref="el => bindContentScroll(el)" class="record-content">
        <div v-if="isCompact" class="record-content-rail">
          <n-button
            circle
            quaternary
            class="record-side-trigger"
            :title="sideOpen ? '收起侧栏' : '打开侧栏'"
            @click="sideOpen = !sideOpen"
          >
            <template #icon>
              <n-icon><Menu /></n-icon>
            </template>
          </n-button>
          <MatchHistoryPagination floating class="record-rail-pagination" />
        </div>
        <div class="record-content-inner">
          <MatchHistory
            :focus-game-id="focusGameId"
            :champion-filter="championFilterCmd"
            :open-game-id="openGameId"
            :refresh-tick="refreshTick"
            @open="openGame"
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
      <!-- 回到顶部 FAB：内容区滚动超过阈值后显示，点击平滑回顶 -->
      <Transition name="fab">
        <n-button
          v-if="showBackTop"
          circle
          class="record-back-top"
          title="回到顶部"
          @click="scrollToTop"
        >
          <template #icon>
            <n-icon><ArrowUp /></n-icon>
          </template>
        </n-button>
      </Transition>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { onMounted, onBeforeUnmount, computed, ref, watch, type ComponentPublicInstance } from 'vue'
import { NButton, NIcon, NDrawer, NDrawerContent } from 'naive-ui'
import { ArrowUp, Menu } from 'lucide-vue-next'
import MatchHistory from '../components/record/MatchHistory.vue'
import MatchHistoryPagination from '../components/record/MatchHistoryPagination.vue'
import PlayerBar from '../components/record/PlayerBar.vue'
import UserSidePanel from '../components/record/UserSidePanel.vue'
import type { Game } from '../types/domain/match'
import type { ChampionPoolEntry } from '../components/record/championPool'
import { useBreakpoint } from '@renderer/composables/useBreakpoint'
import { usePlayerRecordData } from '@renderer/composables/usePlayerRecordData'
import { shouldYieldToEditableTarget } from '@renderer/utils/domHotkey'

const { isMobile, isCompact } = useBreakpoint()

/**
 * 当前打开的对局 id（单一事实源）：详情一律在 MatchHistory 就地内嵌展开，
 * 这里只承接选中同步、键盘步进与重进会话恢复。
 */
const openGameId = ref<number | null>(null)

/** 聚焦记忆（会话级）：重进战绩页自动恢复上次聚焦的对局（就地展开承接） */
const FOCUS_KEY = 'record.focusGameId'
function openGame(g: Game | null) {
  openGameId.value = g?.gameId ?? null
  try {
    if (g) sessionStorage.setItem(FOCUS_KEY, String(g.gameId))
    else sessionStorage.removeItem(FOCUS_KEY)
  } catch {
    /* 隐私模式写失败静默 */
  }
}

/**
 * 键盘切换：Esc 收回、←/→ 上/下一个对局。
 * 详情统一为就地展开，openGameId 承接列表定位/翻页，各断点行为一致。
 */
function onGlobalKey(e: KeyboardEvent) {
  if (openGameId.value == null) return
  if (shouldYieldToEditableTarget(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    openGame(null)
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    stepDetail(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    stepDetail(1)
  }
}

/** 详情步进：按全量列表顺序（找不到当前项时禁用步进） */
const detailIndex = computed(() => {
  const id = openGameId.value
  return id === null ? -1 : games.value.findIndex(g => g.gameId === id)
})
function stepDetail(dir: -1 | 1) {
  const next = games.value[detailIndex.value + dir]
  if (next) openGame(next)
}

/** 窄窗左栏抽屉开关（进入宽窗时自动关闭，避免跨断点残留） */
const sideOpen = ref(false)

/** 断点回到宽窗（左栏常驻）时关闭抽屉，避免残留遮罩/状态 */
watch(isCompact, compact => {
  if (!compact) sideOpen.value = false
})

/** 回到顶部 FAB：内容区滚动超过阈值显示，点击平滑回顶 */
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

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
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

/** 左栏英雄池数据与当前 hover 高亮（由 MatchHistory 上抛） */
const championPool = ref<ChampionPoolEntry[]>([])
const hoveredChampion = ref<number | null>(null)
/** 近期对局全量（由 MatchHistory 上抛，供键盘步进与聚焦恢复使用） */
const games = ref<Game[]>([])

/** PlayerBar 刷新计数：递增后下发 MatchHistory 重新拉当前召唤师最近对局 */
const refreshTick = ref(0)

/** 聚焦恢复：列表数据到达后，若会话内记录了上次聚焦的对局则自动重开（就地展开） */
watch(games, list => {
  if (openGameId.value != null || !list.length) return
  try {
    const stored = sessionStorage.getItem(FOCUS_KEY)
    if (!stored) return
    const target = list.find(g => String(g.gameId) === stored)
    if (target) openGame(target)
  } catch {
    /* 隐私模式读取失败静默 */
  }
})

/** 好友/宿敌弹窗点击对局：交给 MatchHistory 定位并就地展开（处理后清空） */
const focusGameId = ref<number | null>(null)
/** 英雄池点击：作为一次性命令下发给 MatchHistory 设置英雄筛选（处理后清空） */
const championFilterCmd = ref(0)
/** 战绩列表当前生效的英雄筛选（MatchHistory 上抛，用于英雄池选中态） */
const activeChampion = ref(0)

/** 英雄池换源（切模式/换召唤师）后，被过滤的英雄可能已不在新池中——
 *  不复位会让战绩列表停留在旧英雄筛选，显示「没有匹配的对局」。 */
watch(championPool, pool => {
  if (activeChampion.value && !pool.some(e => e.championId === activeChampion.value)) {
    activeChampion.value = 0
  }
})
</script>
<style scoped>
/* 整页 token 覆盖:所有子组件 var(--font-size-*) 自动跟随 viewport 缩放 (1100→2200) */
.record-page {
  --font-size-2xs: clamp(10px, calc(10px + (100vw - 1100px) * 2 / 1100), 12px);
  --font-size-xs: clamp(11px, calc(11px + (100vw - 1100px) * 2 / 1100), 13px);
  --font-size-sm: clamp(12px, calc(12px + (100vw - 1100px) * 2 / 1100), 14px);
  --font-size-base: clamp(13px, calc(13px + (100vw - 1100px) * 3 / 1100), 16px);
  --font-size-md: clamp(14px, calc(14px + (100vw - 1100px) * 4 / 1100), 18px);
  --font-size-lg: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  --font-size-xl: clamp(18px, calc(18px + (100vw - 1100px) * 5 / 1100), 23px);

  /* ===== 金工 2.0 迁移桥：旧 token 名 → 奥术金工 token（var() 引用使深浅主题自动跟随） =====
     让整块战绩模块（含子组件的 scoped 样式）在不逐文件改的前提下，
     语义色/表面/边框/阴影统一落入 v3「Hextech Forge」语言：灰中性表面、
     金工描边、金橙强调，替换旧玻璃白 + 亮橙。 */
  --semantic-win: var(--win);
  --semantic-loss: var(--loss);
  --semantic-warn: var(--warn);
  --semantic-win-bright: var(--win-bright);
  --semantic-loss-bright: var(--loss-bright);
  --accent-gold: var(--brand);
  --accent-gold-deep: var(--brand-strong);
  --accent-blue: var(--info);
  --accent-sky: var(--info);
  --bg-elevated: var(--bg-raised);
  --glass-bg-low: var(--bg-hover);
  --glass-bg-mid: var(--surface-card);
  --glass-bg-high: var(--bg-active);
  --glass-border: var(--border-strong);
  --glass-highlight: none;
  --shadow-sm: var(--shadow-1);
  --shadow-md: var(--shadow-2);
  --shadow-lg: var(--shadow-3);
  --win-bar-gradient: linear-gradient(180deg, var(--win-bright), var(--win));
  --loss-bar-gradient: linear-gradient(180deg, var(--loss-bright), var(--loss));

  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-12);
}

.record-main {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: var(--space-16);
  position: relative;
}

/* 左栏：独立滚动 + sticky 聚合内容（长列表滚动时左栏不丢） */
.record-side {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: var(--space-4);
  scrollbar-width: none;
}

.record-side::-webkit-scrollbar {
  display: none;
}

/* 左栏顶部页签：与左栏卡片列同宽对齐 */
.record-side-pagination {
  padding: var(--space-6) var(--space-4) var(--space-12);
  margin-bottom: var(--space-8);
  border-bottom: 1px solid var(--border-subtle);
}

/* 窄窗内容区顶粘工具条：左栏入口 + 浮动分页（浮动覆盖在上方，不占文档流） */
.record-content-rail {
  position: sticky;
  top: 0;
  z-index: var(--z-dock);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  margin: 0 calc(-1 * var(--space-8)) var(--space-12);
  padding: var(--space-8);
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--bg-base) 72%, transparent);
  border-bottom: 1px solid var(--border-subtle);
}

/* 窄窗抽屉触发按钮：内容区左上角悬浮，hover 金工描边 */
.record-side-trigger {
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-1);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.record-side-trigger:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
  transform: scale(1.05);
}

/* 窄窗抽屉：与常驻左栏同宽、同视觉（glass 卡片列） */
.record-side-drawer :deep(.n-drawer-body) {
  padding: var(--space-12);
}

.record-side-drawer :deep(.n-drawer-content-wrapper) {
  background: var(--bg-surface);
  border-right: 1px solid var(--border-strong);
}

/* 回到顶部 FAB：右下角悬浮，raised 面与抽屉触发钮同风格 */
.record-back-top {
  position: absolute;
  right: var(--space-8);
  bottom: var(--space-16);
  z-index: var(--z-dock); /* debug6:禁ad-hoc 30，dock档 */
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-2);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.record-back-top:hover {
  color: var(--text-primary);
  border-color: var(--brand-border);
  transform: translateY(-2px);
}

.fab-enter-active,
.fab-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-spring);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.record-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0 var(--space-8) var(--space-20) var(--space-8);
}

/* 宽屏 (>1400) 时内容居中,上限 1280 防过宽稀疏 */
.record-content-inner {
  max-width: 1280px;
  margin: 0 auto;
}

/* 战绩列表滚动条细化：6px 圆角细条替代系统默认宽条（与详情页一致） */
.record-content::-webkit-scrollbar {
  width: 6px;
}

.record-content::-webkit-scrollbar-thumb {
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
}

.record-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-tertiary) 55%, transparent);
}

.record-content::-webkit-scrollbar-track {
  background: transparent;
}
</style>
