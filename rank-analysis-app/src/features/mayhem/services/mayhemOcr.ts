/**
 * Mayhem OCR 引擎预热（无 Pinia 依赖的独立入口）。
 *
 * `mayhem_assist_tick` 用 `ModelDownloadMode::Never`——它**永不**下载 rec 模型，
 * 模型没就绪时只会一直返回 `ocr-warming-up`，表现为进大乱斗后推荐永不出现。
 * 因此凡是「启动三选一监听」的路径都必须顺带预热。
 *
 * 抽成独立函数而非 store 方法：`useInGameServices` 是模块级服务，不该依赖
 * Pinia 激活上下文（也避免在无 store 的调用点抛 getActivePinia 错）。
 */

/** 预热结果 */
export type PrewarmResult = 'ready' | 'started' | 'unavailable'

/**
 * 幂等预热 OCR 引擎：后端已就绪则立即返回；未编 OCR 的构建跳过。
 * @param onState 可选状态回调，供 store 展示「准备中」
 */
export async function prewarmMayhemOcr(
  onState?: (warming: boolean) => void
): Promise<PrewarmResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const status = (await invoke('mayhem_ocr_status')) as { ready?: boolean }
    if (status.ready) return 'ready'
  } catch {
    // 未编译 OCR 的构建无此命令：直接跳过，不影响手动三选一
    return 'unavailable'
  }
  onState?.(true)
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('mayhem_ocr_prewarm')
    return 'started'
  } catch (e) {
    console.warn('[mayhem] OCR 预热失败（tick 会报 ocr-warming-up，可重试）:', e)
    return 'unavailable'
  } finally {
    onState?.(false)
  }
}
