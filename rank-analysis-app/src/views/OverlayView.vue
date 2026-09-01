<script setup lang="ts">
/**
 * 对局内 Overlay 视图（B1 多面板宿主）。
 *
 * - 兼容通道：`overlay:update`（NextAction 列表，Gaming 轮询推送）
 * - 面板信封：`overlay:panel` → { panel, payload }，按注册表分发渲染
 *   （mayhem-augments = 三选一卡组；后续面板在此扩展）
 * - `overlay:config` 可选推送 { maxItems, opacity } 覆盖本地偏好。
 * 透明背景 + 鼠标穿透由 Rust 端窗口属性控制（set_ignore_cursor_events）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { NEXT_ACTION_LABELS, URGENCY_COLORS, type NextAction } from '@renderer/services/nextAction'
import { loadOverlayPrefs, saveOverlayPrefs, type OverlayPrefs } from '@renderer/utils/overlayPrefs'

import MayhemAugmentPanel from '../components/overlay/MayhemAugmentPanel.vue'
import {
  isMayhemAugmentsPayload,
  type MayhemAugmentsPayload,
  type OverlayPanelEnvelope
} from '../features/overlay/panels'

const actions = ref<NextAction[]>([])
const prefs = ref<OverlayPrefs>(loadOverlayPrefs())
const mayhemAugments = ref<MayhemAugmentsPayload | null>(null)
const companionText = ref('')
let bubbleTimer: ReturnType<typeof setTimeout> | null = null

/** 任一面板有内容即显示 overlay 窗口内容 */
const hasContent = computed(
  () =>
    actions.value.length > 0 ||
    (mayhemAugments.value?.candidates.length ?? 0) > 0 ||
    companionText.value.length > 0
)

/**
 * 内容有无 ↔ 窗口显隐必须**双向**同步。
 *
 * 这里不能只写 hide 分支、也不能带 `immediate`：OverlayView 是 overlay 窗口的根组件
 * （overlay.ts 里 `createApp(OverlayView).mount`），`immediate` 会在 setup 阶段——早于
 * onMounted 拉 `get_overlay_state` 快照——就以空内容触发一次，把 Rust 端刚 show 出来的
 * 窗口立刻隐藏；而缺 show 分支则意味着随后数据到位也永远不会再显示出来。
 */
watch(hasContent, async val => {
  await invoke(val ? 'show_overlay_window' : 'hide_overlay_window').catch(() => {})
})

/** 屏幕高度自适应：每条约 26px，预留头部与边距，避免低分辨率下溢出屏幕 */
const maxByHeight = ref(99)
function updateMaxByHeight(): void {
  maxByHeight.value = Math.max(1, Math.floor((window.innerHeight - 64) / 26))
}
const shown = computed(() =>
  actions.value.slice(0, Math.min(prefs.value.maxItems, maxByHeight.value))
)
const cardStyle = computed(() => ({ opacity: String(prefs.value.opacity) }))

let unlistenUpdate: UnlistenFn | null = null
let unlistenConfig: UnlistenFn | null = null
let unlistenPanel: UnlistenFn | null = null

function applyPanelEnvelope(env: OverlayPanelEnvelope | null | undefined) {
  if (!env) return
  const { panel, payload } = env
  if (panel === 'mayhem-augments') {
    mayhemAugments.value = isMayhemAugmentsPayload(payload) ? payload : null
  } else if (panel === 'companion-bubble') {
    const text =
      typeof (payload as { text?: unknown })?.text === 'string'
        ? (payload as { text: string }).text
        : ''
    companionText.value = text
    // 气泡自动消失（桥接层不推送清空消息时的兜底）
    if (bubbleTimer) clearTimeout(bubbleTimer)
    if (text) {
      bubbleTimer = setTimeout(() => {
        companionText.value = ''
      }, 6000)
    }
  }
}

onMounted(async () => {
  updateMaxByHeight()
  window.addEventListener('resize', updateMaxByHeight)

  // 1. 初始化时主动从 Rust 端获取最新状态快照（防止事件先于监听器到达而丢失）
  try {
    const state = (await invoke('get_overlay_state')) as {
      panel?: OverlayPanelEnvelope
      actions?: NextAction[]
    }
    if (Array.isArray(state?.actions)) {
      actions.value = state.actions
    }
    if (state?.panel) {
      applyPanelEnvelope(state.panel)
    }
  } catch (e) {
    console.warn('[overlay] get_overlay_state 初始化异常:', e)
  }

  // 2. 注册实时事件监听
  try {
    unlistenUpdate = await listen<NextAction[]>('overlay:update', event => {
      actions.value = Array.isArray(event.payload) ? event.payload : []
    })
    unlistenConfig = await listen<Partial<OverlayPrefs>>('overlay:config', async event => {
      const merged = { ...prefs.value, ...(event.payload ?? {}) }
      prefs.value = { ...merged }
      saveOverlayPrefs(prefs.value)
      if (event.payload?.anchor) {
        const { setOverlayLayout } = await import('../features/overlay/panels')
        await setOverlayLayout(320, 200, event.payload.anchor).catch(() => {})
      }
    })
    unlistenPanel = await listen<OverlayPanelEnvelope>('overlay:panel', event => {
      applyPanelEnvelope(event.payload)
    })
  } catch (e) {
    console.warn('overlay event listen failed:', e)
  }
})

onUnmounted(() => {
  unlistenUpdate?.()
  unlistenConfig?.()
  unlistenPanel?.()
  window.removeEventListener('resize', updateMaxByHeight)
})
</script>

<template>
  <div v-if="hasContent" class="overlay-container">
    <div v-if="companionText" class="overlay-card overlay-bubble" :style="cardStyle">
      {{ companionText }}
    </div>

    <div v-if="mayhemAugments" class="overlay-card ov-gap" :style="cardStyle">
      <MayhemAugmentPanel :payload="mayhemAugments" />
    </div>

    <div v-if="shown.length" class="overlay-card ov-gap" :style="cardStyle">
      <div class="overlay-header">下一动作建议</div>
      <div class="overlay-list">
        <div
          v-for="(a, i) in shown"
          :key="i"
          class="overlay-item"
          :class="`overlay-item-${a.urgency}`"
        >
          <span
            class="overlay-urgency"
            :style="{ color: URGENCY_COLORS[a.urgency] ?? 'var(--text-tertiary)' }"
          >
            {{ a.urgency === 'high' ? '!' : '·' }}
          </span>
          <span class="overlay-kind">{{ NEXT_ACTION_LABELS[a.kind] ?? a.kind }}</span>
          <span class="overlay-reason">{{ a.reason }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 全局透明背景：Rust 端 transparent:true + CSS 透明 */
html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

#overlay-app {
  background: transparent;
  width: 100vw;
  height: 100vh;
}
</style>

<style scoped>
.overlay-container {
  width: 100%;
  height: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

.overlay-card {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-sunken, #0f1015) 90%, transparent),
    color-mix(in srgb, var(--bg-raised, #161822) 94%, transparent)
  );
  border: 1px solid var(--brand-border, rgba(200, 155, 60, 0.4));
  border-top: 2px solid var(--brand, #c89b3c);
  clip-path: var(--clip-corner-md);
  padding: 10px 12px;
  backdrop-filter: blur(12px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}

/* 多面板纵向堆叠时的间距 */
.ov-gap {
  margin-top: 10px;
}

/* AI 搭子气泡：圆角、更柔和的边框，与数据卡区分 */
.overlay-bubble {
  border: 1px solid var(--brand-border);
  border-left: 3px solid var(--brand);
  clip-path: none;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--text-primary);
}

.overlay-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: 8px;
}
.overlay-header::before {
  content: '';
  width: 6px;
  height: 6px;
  transform: rotate(45deg);
  background: var(--brand);
  box-shadow: var(--glow-brand);
}

.overlay-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 条目插入时淡入下滑：maxItems 增减时高度变化平滑 */
.overlay-item {
  animation: ov-in 0.25s var(--ease-expo, ease-out) both;
}

@keyframes ov-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .overlay-item {
    animation: none;
  }
}

.overlay-item {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.4;
}

.overlay-urgency {
  flex-shrink: 0;
  font-weight: var(--font-weight-bold);
  width: 12px;
}

.overlay-kind {
  font-weight: var(--font-weight-semibold);
  flex-shrink: 0;
  min-width: 60px;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  color: var(--text-secondary);
}

.overlay-reason {
  color: var(--text-secondary);
}
</style>
