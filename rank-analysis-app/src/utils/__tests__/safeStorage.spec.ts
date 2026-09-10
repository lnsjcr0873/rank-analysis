import { describe, it, expect, vi, beforeEach } from 'vitest'
import { safeSetItem, safeSetJson, safeRemoveItem, isQuotaExceeded } from '../safeStorage'

describe('safeSetItem', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('写入成功返回 written 且落盘', () => {
    expect(safeSetItem('k', 'v')).toBe('written')
    expect(localStorage.getItem('k')).toBe('v')
  })

  it('QuotaExceededError 归类为 quota（不静默）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage exploded', 'QuotaExceededError')
    })
    expect(safeSetItem('k', 'v')).toBe('quota')
    spy.mockRestore()
  })

  it('普通异常（隐私模式等）归类为 error', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(safeSetItem('k', 'v')).toBe('error')
    spy.mockRestore()
  })
})

describe('isQuotaExceeded', () => {
  it('识别标准 DOMException name', () => {
    expect(isQuotaExceeded(new DOMException('quota', 'QuotaExceededError'))).toBe(true)
  })

  it('识别旧式 code===22', () => {
    expect(isQuotaExceeded({ code: 22 })).toBe(true)
  })

  it('普通错误 / 非对象不误判', () => {
    expect(isQuotaExceeded(new Error('boom'))).toBe(false)
    expect(isQuotaExceeded('boom')).toBe(false)
    expect(isQuotaExceeded(null)).toBe(false)
  })
})

describe('safeSetJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('序列化并写入对象', () => {
    expect(safeSetJson('obj', { a: 1, b: 'x' })).toBe('written')
    expect(JSON.parse(localStorage.getItem('obj')!)).toEqual({ a: 1, b: 'x' })
  })

  it('循环引用序列化失败归一为 error，不抛出', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(safeSetJson('circ', circular)).toBe('error')
  })
})

describe('safeRemoveItem', () => {
  it('删除且不抛异常', () => {
    localStorage.setItem('k', 'v')
    safeRemoveItem('k')
    expect(localStorage.getItem('k')).toBeNull()
  })
})
