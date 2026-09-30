import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 探针开关必须只认 `?debug=1`，且**默认关闭时不得注册 rAF**。
 *
 * 最后一条是硬要求：浮窗是透明置顶常驻窗口，正常使用时每帧都多跑一个
 * callback 属于白付成本。测试用「mount 前后 rAF 调用数」钉住它。
 */
import { OVERLAY_DEBUG_KEY } from '../useOverlayDebug'

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/overlay.html${search}`)
}

describe('overlayDebugEnabled', () => {
  beforeEach(() => setSearch(''))
  afterEach(() => setSearch(''))

  it('无参数时为 false', async () => {
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(false)
  })

  it('?debug=1 时为 true', async () => {
    setSearch('?debug=1')
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(true)
  })

  it('?debug=0 / ?debug=false / debug 无值 均为 false', async () => {
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    for (const s of ['?debug=0', '?debug=false', '?debug', '?debug=']) {
      setSearch(s)
      expect(overlayDebugEnabled()).toBe(false)
    }
  })

  it('debug 参数在其它 query 之后也能识别', async () => {
    setSearch('?foo=bar&debug=1')
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(true)
  })
})

/**
 * 打包态开关：浮窗 URL 由 Rust 端固定为 `overlay.html`，没法附加 query，
 * 所以 localStorage 是打包后唯一的启用途径。没有它探针对实测就无效。
 */
describe('overlayDebug localStorage toggle', () => {
  beforeEach(() => {
    setSearch('')
    localStorage.removeItem(OVERLAY_DEBUG_KEY)
    vi.resetModules()
  })
  afterEach(() => {
    setSearch('')
    localStorage.removeItem(OVERLAY_DEBUG_KEY)
  })

  it('默认关闭', async () => {
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(false)
  })

  it('enableOverlayDebug 后为 true', async () => {
    const { overlayDebugEnabled, enableOverlayDebug } = await import('../useOverlayDebug')
    enableOverlayDebug()
    expect(overlayDebugEnabled()).toBe(true)
  })

  it('disableOverlayDebug 后回到 false', async () => {
    const { overlayDebugEnabled, enableOverlayDebug, disableOverlayDebug } =
      await import('../useOverlayDebug')
    enableOverlayDebug()
    disableOverlayDebug()
    expect(overlayDebugEnabled()).toBe(false)
  })

  it('localStorage 为 "0" 视为关闭（不靠「键不存在」判断）', async () => {
    localStorage.setItem(OVERLAY_DEBUG_KEY, '0')
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(false)
  })

  it('query 开关优先于 localStorage 关闭状态', async () => {
    localStorage.setItem(OVERLAY_DEBUG_KEY, '0')
    setSearch('?debug=1')
    const { overlayDebugEnabled } = await import('../useOverlayDebug')
    expect(overlayDebugEnabled()).toBe(true)
  })
})

describe('useOverlayDebug 关闭时不注册 rAF', () => {
  beforeEach(() => {
    setSearch('')
    vi.resetModules()
  })
  afterEach(() => {
    setSearch('')
    vi.restoreAllMocks()
  })

  it('默认关闭时 requestAnimationFrame 一次都不调用', async () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

    const { useOverlayDebug } = await import('../useOverlayDebug')
    // 生命周期钩子在无组件实例时是 no-op，直接调用探针即可验证「不注册」
    useOverlayDebug(() => true)

    expect(rafSpy).not.toHaveBeenCalled()
  })
})
