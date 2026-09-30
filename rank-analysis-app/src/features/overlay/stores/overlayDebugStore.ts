import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * 浮窗**掉帧诊断**状态（纯前端，不依赖后端新命令）。
 *
 * ## 为什么要这个
 *
 * 浮窗掉帧有两个互斥嫌疑，且都不在前端 JS：
 *
 * 1. Rust 端 `overlay/mod.rs` 的 `transparent(true)` + `always_on_top(true)`
 *    在 Windows DWM 下强制走每帧合成路径；
 * 2. 大乱斗助手的截屏循环（`features/mayhem/trigger.ts`，idle 1s /
 *    baseline 探针 5s / burst 期密集抓帧）——游戏若为独占全屏，截屏比浮窗
 *    本身更容易拖游戏帧率。
 *
 * `OverlayView.vue` 本身无 `setInterval` / `requestAnimationFrame`，overlay CSS
 * 也无 `backdrop-filter`，所以**排除前端渲染**只需读三个数：
 *
 * - `fps` / `frameJitterMs`：浮窗自己的渲染帧率与抖动。**清空内容后仍低**
 *   → 嫌疑 1（DWM 合成）；清空后回升 → 嫌疑 1 可疑度大幅下降。
 * - `panelPushCount`：三选一面板推送次数，即助手「命中」次数的代理指标。
 *   截屏嫌疑 2 越强，它涨得越快。
 * - `contentEmpty`：当前浮窗是否无内容，用于把「渲染负载」与「合成负载」分开。
 *
 * 两个嫌疑靠 `fps × contentEmpty × panelPushCount` 三元组即可劈开，不必肉眼估。
 *
 * 仅在浮窗 URL 带 `?debug=1` 时启用（见 {@link useOverlayDebug}），正常使用时
 * 不启动任何 rAF / 定时器，零开销。
 *
 * @module features/overlay/stores/overlayDebugStore
 */

export const useOverlayDebugStore = defineStore('overlayDebug', () => {
  const enabled = ref(false)
  /** 浮窗实测帧率（rAF 采样，EMA 平滑） */
  const fps = ref(0)
  /** 帧时间标准差（ms），越大越不稳 */
  const frameJitterMs = ref(0)
  /** 三选一面板推送次数（助手命中代理指标） */
  const panelPushCount = ref(0)
  /** 浮窗是否无内容 */
  const contentEmpty = ref(true)

  /** 采样窗口内累积的帧间隔，用于算抖动 */
  let jitterSamples: number[] = []

  const label = computed(() => {
    if (!enabled.value) return ''
    const parts = [`${Math.round(fps.value)}fps`]
    if (jitterSamples.length > 4) parts.push(`±${frameJitterMs.value.toFixed(1)}ms`)
    parts.push(contentEmpty.value ? '空内容' : '有内容')
    parts.push(`面板${panelPushCount.value}次`)
    return parts.join('  ')
  })

  function setContentEmpty(v: boolean): void {
    contentEmpty.value = v
  }

  /** 记录一次面板推送（助手命中代理）。 */
  function notePanelPush(): void {
    panelPushCount.value += 1
  }

  /**
   * 写入一帧采样：维护 EMA 平滑 fps 与帧时间标准差。
   *
   * @param deltaMs 与上一帧的间隔（ms）。>1000 的间隔视为窗口最小化/失焦导致
   * 的假帧，丢弃，否则会把 fps 拉到个位数并污染整个窗口。
   */
  function sample(deltaMs: number): void {
    if (deltaMs <= 0 || deltaMs > 1000) return
    const instant = 1000 / deltaMs
    fps.value = fps.value === 0 ? instant : fps.value * 0.9 + instant * 0.1
    jitterSamples.push(deltaMs)
    // 滑动窗口：约 1s @60fps，够反映抖动又不至于让读数迟钝
    if (jitterSamples.length > 90) jitterSamples.shift()
    if (jitterSamples.length > 4) {
      const mean = jitterSamples.reduce((a, b) => a + b, 0) / jitterSamples.length
      const variance =
        jitterSamples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / jitterSamples.length
      frameJitterMs.value = Math.sqrt(variance)
    }
  }

  function reset(): void {
    fps.value = 0
    frameJitterMs.value = 0
    panelPushCount.value = 0
    contentEmpty.value = true
    jitterSamples = []
  }

  function enable(): void {
    enabled.value = true
  }

  return {
    enabled,
    fps,
    frameJitterMs,
    panelPushCount,
    contentEmpty,
    label,
    setContentEmpty,
    notePanelPush,
    sample,
    reset,
    enable
  }
})
