/**
 * 局内常驻服务（debug4-4）。
 *
 * 此前对局中的下一动作轮询（nextActions）、Overlay 悬浮窗显隐、大乱斗三选一
 * 监听全部写在 Gaming.vue 的 `<script setup>` 里：用户切页（对局中去看战绩/
 * 设置是被允许的）即触发 onUnmounted，浮窗被隐藏、调度器被强停、轮询被清。
 *
 * 这里提升到应用全局层：Framework 常驻挂载并持有 `useSessionSync` 引用计数，
 * Gaming 卸载不再撕掉监听与定时器；Gaming 只读共享的 `inGameNextActions` 做展示。
 * 仅主窗口启动（子窗口/overlay 窗口不重复调度），由 Framework 负责调用。
 *
 * @module composables/useInGameServices
 */
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSessionSync } from './useSessionSync'
import { gameSummoner } from './useGameState'
import { getSharedAssistScheduler } from '@renderer/features/mayhem/trigger'
import { getNextActions, type NextAction } from '@renderer/services/nextAction'
import type { SessionData } from '@renderer/types/domain/gaming'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { loadOverlayPrefs } from '@renderer/utils/overlayPrefs'
import { startLiveBridge, stopLiveBridge } from '@renderer/companion/bridge'

/** 局内下一动作建议：全局单例，Gaming 只读展示，服务负责轮询更新 */
export const inGameNextActions = ref<NextAction[]>([])

const NEXT_ACTION_THROTTLE_MS = 30_000
const NEXT_ACTION_POLL_MS = 5_000

let nextActionTimer: ReturnType<typeof setInterval> | null = null
let lastNextActionAt = 0
let serviceStarted = false
let currentSessionData: SessionData | null = null

async function isOverlayDisabled(): Promise<boolean> {
  if (loadOverlayPrefs().disabled) return true
  try {
    return (await getConfigByIpc<boolean>(CONFIG_KEYS.disableOverlay)) === true
  } catch {
    return false
  }
}

async function isLiveGamePollDisabled(): Promise<boolean> {
  try {
    return (await getConfigByIpc<boolean>(CONFIG_KEYS.disableLiveGamePoll)) === true
  } catch {
    return false
  }
}

async function isMayhemAssistEnabled(): Promise<boolean> {
  try {
    return (await getConfigByIpc<boolean>(CONFIG_KEYS.mayhemAssistEnabled)) === true
  } catch {
    return false
  }
}

async function pollNextActions(sessionData: SessionData): Promise<void> {
  if (sessionData.phase !== 'InProgress') return
  if (await isLiveGamePollDisabled()) {
    inGameNextActions.value = []
    return
  }
  const now = Date.now()
  if (now - lastNextActionAt < NEXT_ACTION_THROTTLE_MS) return
  lastNextActionAt = now
  const mePuuid = gameSummoner.value?.puuid ?? ''
  const me = sessionData.subteams.flatMap(s => s.players).find(p => p.summoner.puuid === mePuuid)
  if (!me || me.championId <= 0) return
  try {
    const actions = await getNextActions(
      me.championId,
      gameSummoner.value?.gameName ?? '',
      mePuuid,
      sessionData.queueId
    )
    // 后端/测试桩可能返回 undefined：归一为数组，避免模板读 length 崩溃
    inGameNextActions.value = Array.isArray(actions) ? actions : []
    // 推送数据到 overlay 窗口（4b overlay POC，仅在未禁用浮窗时推送）
    if (!(await isOverlayDisabled())) {
      invoke('push_overlay_data', { actions: inGameNextActions.value }).catch(e => {
        console.warn('push_overlay_data failed:', e)
      })
    }
  } catch {
    inGameNextActions.value = []
  }
}

async function startMayhemAssistIfNeeded(queueId: number): Promise<void> {
  if (queueId === 2400) {
    if (await isMayhemAssistEnabled()) {
      const s = getSharedAssistScheduler()
      if (!s.running) {
        s.start()
      }
    } else {
      stopMayhemAssist()
    }
  }
}

function stopMayhemAssist(): void {
  const s = getSharedAssistScheduler()
  if (s.running) {
    s.stop()
  }
}

/** 动态响应设置变更：禁用/启用浮窗 */
export async function setOverlayDisabled(disabled: boolean): Promise<void> {
  if (disabled) {
    void invoke('hide_overlay_window').catch(() => {})
  } else if (currentSessionData?.phase === 'InProgress') {
    void invoke('show_overlay_window').catch(() => {})
  }
}

/** 动态响应设置变更：禁用/启用对局实时轮询 */
export function setLiveGamePollDisabled(disabled: boolean): void {
  if (disabled) {
    if (nextActionTimer) {
      clearInterval(nextActionTimer)
      nextActionTimer = null
    }
    inGameNextActions.value = []
  } else if (currentSessionData?.phase === 'InProgress') {
    lastNextActionAt = 0
    void pollNextActions(currentSessionData)
    if (!nextActionTimer) {
      nextActionTimer = setInterval(
        () => void pollNextActions(currentSessionData!),
        NEXT_ACTION_POLL_MS
      )
    }
  }
}

/** 动态响应设置变更：禁用/启用大乱斗 3 选 1 推荐 */
export function setMayhemAssistEnabled(enabled: boolean): void {
  if (enabled) {
    if (currentSessionData?.phase === 'InProgress' && currentSessionData.queueId === 2400) {
      const s = getSharedAssistScheduler()
      if (!s.running) {
        s.start()
      }
    }
  } else {
    stopMayhemAssist()
  }
}

/** 启动全局局内循环（幂等）：phase/queueId 驱动轮询 + 浮窗 + mayhem 调度。 */
function ensureInGameLoop(sessionData: SessionData): void {
  if (serviceStarted) return
  serviceStarted = true
  currentSessionData = sessionData
  watch([() => sessionData.phase, () => sessionData.queueId], async ([phase, queueId]) => {
    if (phase === 'InProgress') {
      // 先建/显示窗口再首推：overlay 懒创建，若先 poll 后 show，
      // 首条 overlay:update 会落在窗口 mount+listen 就绪之前而丢失。
      // 仅在未禁用浮窗时呼出
      if (!(await isOverlayDisabled())) {
        void invoke('show_overlay_window').catch(() => {})
      }
      // 仅在未禁用局内轮询时启动定时器
      if (!(await isLiveGamePollDisabled())) {
        lastNextActionAt = 0
        void pollNextActions(sessionData)
        if (!nextActionTimer) {
          nextActionTimer = setInterval(
            () => void pollNextActions(sessionData),
            NEXT_ACTION_POLL_MS
          )
        }
      }
      // 仅在已开启大乱斗 3 选 1 推荐时启动调度器
      if (queueId === 2400) {
        await startMayhemAssistIfNeeded(queueId)
      } else {
        stopMayhemAssist()
      }
      // AI 搭子桥：对局进行中按需启动
      startLiveBridge()
    } else {
      if (nextActionTimer) {
        clearInterval(nextActionTimer)
        nextActionTimer = null
      }
      inGameNextActions.value = []
      stopMayhemAssist()
      stopLiveBridge()
      void invoke('hide_overlay_window').catch(() => {})
    }
  })
}

/**
 * 局内常驻服务入口（Framework 主窗口调用一次）。
 *
 * 调用即持有 `useSessionSync` 一份引用计数：Gaming 切页卸载后监听不断；
 * 返回共享的 nextActions 供展示层只读绑定。
 */
export function useInGameServices(): { nextActions: typeof inGameNextActions } {
  const { sessionData } = useSessionSync()
  ensureInGameLoop(sessionData)
  return { nextActions: inGameNextActions }
}
