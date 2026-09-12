/**
 * useEmberField 单测（R35-3）。
 *
 * 主体是 canvas/rAF 视觉逻辑，且 onMounted 在 jsdom 下主动早退，
 * 故数值逻辑只测抽出的 `emberCount` 纯函数；composable 本体只做
 * 挂载/卸载冒烟（不断言画面）。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { emberCount, useEmberField } from './useEmberField'

describe('emberCount', () => {
  it('常态按面积缩放且有下限 18', () => {
    expect(emberCount(800, 600, false)).toBe(Math.round((800 * 600) / 16000))
    expect(emberCount(1, 1, false)).toBe(18)
    expect(emberCount(0, 0, false)).toBe(18)
  })

  it('冷却态减量约 45% 且下限 10', () => {
    expect(emberCount(800, 600, true)).toBe(Math.round(Math.round((800 * 600) / 16000) * 0.45))
    expect(emberCount(1, 1, true)).toBe(10)
  })

  it('同面积下冷却态恒少于常态', () => {
    expect(emberCount(1920, 1080, true)).toBeLessThan(emberCount(1920, 1080, false))
  })
})

describe('useEmberField 冒烟', () => {
  it('jsdom 下挂载静默降级不抛错', () => {
    const canvas = ref<HTMLCanvasElement | null>(null)
    expect(() => useEmberField(canvas, { cold: ref(false) })).not.toThrow()
  })
})
