/**
 * `analysis/utils.ts` 单测。
 *
 * 重点锁三类容易在移植中被"顺手优化"掉的语义：
 * 1. `noZero` 对 0 / NaN / 负数的处理；
 * 2. `calculateCoefficientOfVariation` 的 -1 哨兵（不可与 0 混淆）；
 * 3. `avgOrOne` 与 `avgIfAllNonNull` 的降级差异。
 */

import { describe, expect, it } from 'vitest'

import {
  avgIfAllNonNull,
  avgOrNull,
  avgOrOne,
  avgOrZero,
  calculateCoefficientOfVariation,
  findOutliersByIqr,
  noZero,
  standardize,
  sumOrZero
} from './utils'

describe('noZero', () => {
  it('0 落到 1', () => {
    expect(noZero(0)).toBe(1)
  })

  it('NaN 也落到 1（Akari 的 `value || 1` 语义）', () => {
    expect(noZero(Number.NaN)).toBe(1)
  })

  it('正常值原样返回，包括负数', () => {
    expect(noZero(5)).toBe(5)
    expect(noZero(0.25)).toBe(0.25)
    expect(noZero(-3)).toBe(-3)
  })
})

describe('avgOrZero', () => {
  it('空数组返回 0', () => {
    expect(avgOrZero([])).toBe(0)
  })

  it('求算术平均', () => {
    expect(avgOrZero([1, 2, 3])).toBe(2)
  })
})

describe('avgOrOne', () => {
  it('空数组返回 1 而非 0（效率类指标的"无差异"语义）', () => {
    expect(avgOrOne([])).toBe(1)
  })

  it('与 avgOrZero 在非空时一致', () => {
    expect(avgOrOne([1, 2, 3])).toBe(avgOrZero([1, 2, 3]))
  })

  it('空样本不会把效率指标拉到 0', () => {
    expect(avgOrOne([])).not.toBe(0)
  })
})

describe('avgOrNull', () => {
  it('空数组返回 null（数据不足，不编数字）', () => {
    expect(avgOrNull([])).toBeNull()
  })

  it('非空返回均值', () => {
    expect(avgOrNull([2, 4])).toBe(3)
  })
})

describe('avgIfAllNonNull', () => {
  it('空数组返回 null', () => {
    expect(avgIfAllNonNull([])).toBeNull()
  })

  it('全部非 null 时返回均值', () => {
    expect(avgIfAllNonNull([1, 2, 3])).toBe(2)
  })

  it('任一元素为 null 即整体 null（拒绝半数样本算均值）', () => {
    expect(avgIfAllNonNull([1, null, 3])).toBeNull()
    expect(avgIfAllNonNull([null, null])).toBeNull()
  })

  it('与 avgOrNull 的差异：非空但含 null 时返回不同', () => {
    const samples = [1, null, 3]
    expect(avgIfAllNonNull(samples)).toBeNull()
    expect(avgOrNull(samples as number[])).not.toBeNull()
  })
})

describe('standardize', () => {
  it('空数组返回空', () => {
    expect(standardize([])).toEqual([])
  })

  it('线性映射到 0..1', () => {
    expect(standardize([10, 20, 30])).toEqual([0, 0.5, 1])
  })

  it('全等时返回全 0（避免除零）', () => {
    expect(standardize([5, 5, 5])).toEqual([0, 0, 0])
  })

  it('保持原顺序', () => {
    expect(standardize([30, 10, 20])).toEqual([1, 0, 0.5])
  })
})

describe('calculateCoefficientOfVariation', () => {
  it('空数组返回 -1 哨兵', () => {
    expect(calculateCoefficientOfVariation([])).toBe(-1)
  })

  it('均值为 0 返回 -1 哨兵', () => {
    expect(calculateCoefficientOfVariation([0, 0, 0])).toBe(-1)
  })

  it('全等时返回 0（零波动，与 -1 哨兵必须可区分）', () => {
    expect(calculateCoefficientOfVariation([5, 5, 5])).toBe(0)
    expect(calculateCoefficientOfVariation([5, 5, 5])).not.toBe(-1)
  })

  it('波动越大 CV 越大', () => {
    const stable = calculateCoefficientOfVariation([10, 10.5, 9.5, 10.2])
    const volatile = calculateCoefficientOfVariation([1, 20, 3, 15])
    expect(stable).toBeLessThan(volatile)
  })

  it('正值集合返回非负 CV', () => {
    expect(calculateCoefficientOfVariation([1, 2, 3])).toBeGreaterThanOrEqual(0)
  })
})

describe('findOutliersByIqr', () => {
  it('无离群时两侧为空', () => {
    const data = [1, 2, 3, 4, 5]
    const { below, over } = findOutliersByIqr(data)
    expect(below).toEqual([])
    expect(over).toEqual([])
  })

  it('挑出极端高值', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 100]
    const { over } = findOutliersByIqr(data)
    expect(over).toEqual([100])
  })

  it('挑出极端低值', () => {
    const data = [-100, 1, 2, 3, 4, 5, 6, 7, 8]
    const { below } = findOutliersByIqr(data)
    expect(below).toEqual([-100])
  })

  it('threshold 越大越保守（Akari 面板用 0.65 而非默认 1.5）', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 20]
    const loose = findOutliersByIqr(data, undefined, 0.65)
    const tight = findOutliersByIqr(data, undefined, 5)
    expect(loose.over.length).toBeGreaterThanOrEqual(tight.over.length)
  })

  it('支持 keyGetter 取对象字段', () => {
    const data = [{ kda: 1 }, { kda: 2 }, { kda: 3 }, { kda: 2.5 }]
    const { below, over } = findOutliersByIqr(data, d => d.kda)
    expect(below).toEqual([])
    expect(over).toEqual([])
  })

  it('空数组不抛错', () => {
    expect(() => findOutliersByIqr([])).not.toThrow()
    expect(findOutliersByIqr([])).toEqual({ below: [], over: [] })
  })
})

describe('sumOrZero', () => {
  it('空数组返回 0', () => {
    expect(sumOrZero([])).toBe(0)
  })

  it('求和', () => {
    expect(sumOrZero([1, 2, 3])).toBe(6)
  })
})
