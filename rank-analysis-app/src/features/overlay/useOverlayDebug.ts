import { onMounted, onUnmounted } from 'vue'
import { useOverlayDebugStore } from './stores/overlayDebugStore'

/**
 * 浮窗掉帧诊断探针，仅在浮窗 URL 带 `?debug=1` 时启用。
 *
 * ## 判读方法
 *
 * 装好后在浏览器里直接开浮窗页面（开发态）：
 * `http://localhost:1420/overlay.html?debug=1`
 *
 * 然后按 A/B 三组各读一次右上角读数：
 *
 * | A/B | 操作 | 期望读数 | 结论 |
 * |---|---|---|---|
 * | A | 浮窗显示「有内容」，助手开 | 记录 fps / 面板次数 | 基线 |
 * | B | 关三选一助手（设置 → 大乱斗），浮窗内容不变 | 面板次数不再涨 | 确认截屏在跑 |
 * | C | 清空浮窗内容（无面板、无 NextAction） | fps 是否回升 | 回升 → 渲染负载；不回升 → DWM 合成 |
 * | D | 关掉浮窗（设置里禁用） | 游戏帧率 | 判断浮窗本身的影响 |
 *
 * 关键判据是 **B 与 C 的组合**：
 *
 * - C 不回升 + B 让游戏帧率恢复 → 嫌疑是 Rust 端 `transparent` + `always_on_top`
 *   的 DWM 合成开销，截屏不是主因。
 * - C 回升 → 前端渲染负载有份，进一步看 B 判断截屏是否也在贡献。
 *
 * 还要配合两个**外部**数据（探针给不出，必须实测）：任务管理器里的应用 CPU%，
 * 以及游戏是独占全屏还是无边框全屏——独占全屏下截屏的开销与无边框差一个量级。
 *
 * 探针关闭时（默认）不注册任何 rAF / 定时器，正式使用零开销。
 *
 * @module features/overlay/useOverlayDebug
 */

/**
 * localStorage 开关键名。打包后的 EXE 里浮窗 URL 由 Rust 端固定为
 * `overlay.html`，无法附加 `?debug=1`，所以必须留一个运行时开关，
 * 否则探针只在开发态可用、对实测毫无意义。
 *
 * 在浏览器 DevTools 控制台执行 `localStorage.setItem('ra.overlay.debug','1')`
 * 后重启浮窗即可；设回 `'0'` 或 `removeItem` 关闭。
 */
export const OVERLAY_DEBUG_KEY = 'ra.overlay.debug'

/** 打开浮窗掉帧诊断读数（供 DevTools 或设置页调用）。 */
export function enableOverlayDebug(): void {
  try {
    localStorage.setItem(OVERLAY_DEBUG_KEY, '1')
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略：仅诊断功能
  }
}

/** 关闭浮窗掉帧诊断读数。 */
export function disableOverlayDebug(): void {
  try {
    localStorage.removeItem(OVERLAY_DEBUG_KEY)
  } catch {
    // 同上
  }
}

/**
 * 判断诊断探针是否启用：`?debug=1`（开发态）或 localStorage 开关（打包态）。
 *
 * 两路都认的原因：开发时用 query 临时开、不污染用户偏好；打包后只能用
 * localStorage。只留一路会让探针在另一半场景里形同虚设。
 */
export function overlayDebugEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') return true
    return localStorage.getItem(OVERLAY_DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 挂载掉帧采样（rAF）。
 *
 * @param isContentEmpty - 返回浮窗当前是否无内容，用于把渲染负载与合成负载分开
 */
export function useOverlayDebug(isContentEmpty: () => boolean): void {
  // 先判开关再取 store：关闭时连 store 都不实例化，更不注册 rAF。
  // 浮窗是常驻透明置顶窗口，正常使用路径必须零副作用。
  if (!overlayDebugEnabled()) return

  const dbg = useOverlayDebugStore()

  let rafId = 0
  let last = 0

  const loop = (t: number) => {
    if (last > 0) dbg.sample(t - last)
    last = t
    dbg.setContentEmpty(isContentEmpty())
    rafId = requestAnimationFrame(loop)
  }

  onMounted(() => {
    dbg.enable()
    rafId = requestAnimationFrame(loop)
  })

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  })
}
