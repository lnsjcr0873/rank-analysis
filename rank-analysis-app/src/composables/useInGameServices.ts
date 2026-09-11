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

/** 局内下一动作建议：全局单例，Gaming 只读展示，服务负责轮询更新 */
export const inGameNextActions = ref<NextAction[]>([])

const NEXT_ACTION_THROTTLE_MS = 30_000
const NEXT_ACTION_POLL_MS = 2_000

let nextActionTimer: ReturnType<typeof setInterval> | null = null
let lastNextActionAt = 0
let serviceStarted = false

async function pollNextActions(sessionData: SessionData): Promise<void> {
  if (sessionData.phase !== 'InProgress') return
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
    // 推送数据到 overlay 窗口（4b overlay POC）
    invoke('push_overlay_data', { actions: inGameNextActions.value }).catch(e => {
      console.warn('push_overlay_data failed:', e)
    })
  } catch {
    inGameNextActions.value = []
  }
}

function startMayhemAssistIfNeeded(queueId: number): void {
  if (queueId === 2400) {
    const s = getSharedAssistScheduler()
    if (!s.running) {
      s.start()
    }
  }
}

function stopMayhemAssist(): void {
  const s = getSharedAssistScheduler()
  if (s.running) {
    s.stop()
  }
}

/** 启动全局局内循环（幂等）：phase/queueId 驱动轮询 + 浮窗 + mayhem 调度。 */
function ensureInGameLoop(sessionData: SessionData): void {
  if (serviceStarted) return
  serviceStarted = true
  watch([() => sessionData.phase, () => sessionData.queueId], ([phase, queueId]) => {
    if (phase === 'InProgress') {
      // 先建/显示窗口再首推：overlay 懒创建，若先 poll 后 show，
      // 首条 overlay:update 会落在窗口 mount+listen 就绪之前而丢失。
      void invoke('show_overlay_window').catch(() => {})
      lastNextActionAt = 0
      void pollNextActions(sessionData)
      if (!nextActionTimer) {
        nextActionTimer = setInterval(() => void pollNextActions(sessionData), NEXT_ACTION_POLL_MS)
      }
      if (queueId === 2400) {
        startMayhemAssistIfNeeded(queueId)
      } else {
        stopMayhemAssist()
      }
    } else {
      if (nextActionTimer) {
        clearInterval(nextActionTimer)
        nextActionTimer = null
      }
      inGameNextActions.value = []
      stopMayhemAssist()
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
