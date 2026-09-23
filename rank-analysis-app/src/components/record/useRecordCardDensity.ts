import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * RecordCard v2 折叠卡密度档（以卡片自身宽度判定）。
 *
 * 已封版计划：>=900 阵容列常显（wide）；720–900 hover 揭示（medium）；
 * <720 退化为 compact（无阵容列）。
 */
export type RecordCardDensity = 'compact' | 'medium' | 'wide'

export const RECORD_CARD_DENSITY_BREAKPOINTS = {
  /** compact → medium 的临界宽度 */
  medium: 720,
  /** medium → wide 的临界宽度 */
  wide: 900
} as const

/**
 * 宽度 → 密度档。左闭右开：720 算 medium，900 算 wide。
 */
export function getRecordCardDensity(width: number): RecordCardDensity {
  if (width >= RECORD_CARD_DENSITY_BREAKPOINTS.wide) return 'wide'
  if (width >= RECORD_CARD_DENSITY_BREAKPOINTS.medium) return 'medium'
  return 'compact'
}

/**
 * 监听根元素宽度（ResizeObserver）。
 *
 * jsdom / 无 ResizeObserver 环境不报错，宽度保持 0 → 天然落到 compact 档，
 * 保证既有测试与 P0 性能基线（39 节点折叠卡）不受布局测量影响。
 */
export function useRecordCardWidth(root: Ref<HTMLElement | null>) {
  const width = ref(0)
  let observer: ResizeObserver | null = null
  let started = false

  const measure = () => {
    const el = root.value
    if (el) width.value = Math.round(el.getBoundingClientRect().width)
  }

  const start = () => {
    const el = root.value
    if (!el || started) return
    started = true
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure())
      observer.observe(el)
    }
  }

  const stop = () => {
    observer?.disconnect()
    observer = null
    started = false
  }

  onBeforeUnmount(stop)

  return { width, start, stop }
}
