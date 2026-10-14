/**
 * 名册墙列数计算单测。
 *
 * 锁住 Akari 的 `columnsNeed` 口径，并锁住原型第一版踩过的坑：
 * 「左右分栏」时固定 5 列 × 240px 会撑破 flex 列宽 —— 公式必须计入 gap。
 */

import { describe, expect, it } from 'vitest'

import {
  CARD_WIDTH_PX,
  GRID_GAP_PX,
  WALL_PADDING_PX,
  calcColumns,
  calcColumnsFromContainer
} from './columns'

describe('calcColumns · Akari columnsNeed 口径', () => {
  it('宽容器给到 8 列上限（但不超过队伍人数）', () => {
    // 需要 > 240*(8+0.25) = 1980
    expect(calcColumns(2400, 10)).toBe(8)
  })

  it('常见宽屏给 5 列（240×5 + gap 恰好容纳）', () => {
    // 5 列需 > 240*5.25 = 1260；gap 折算：(W+8)/248 >= 5 ⇒ W >= 1232
    expect(calcColumns(1280, 5)).toBe(5)
  })

  it('不超过队伍人数（3 人队最多 3 列）', () => {
    expect(calcColumns(2400, 3)).toBe(3)
  })

  it('窄容器降到 2 列 / 1 列', () => {
    // 2 列需 > 240*2.25 = 540；gap 折算：(W+8)/248 >= 2 ⇒ W >= 488
    expect(calcColumns(560, 5)).toBe(2)
    expect(calcColumns(300, 5)).toBe(1)
  })

  it('极窄容器至少 1 列（不返回 0）', () => {
    expect(calcColumns(10, 5)).toBe(1)
  })

  it('人数为 0 时返回 1（避免 grid 塌成 0 列导致不可见）', () => {
    expect(calcColumns(2400, 0)).toBe(1)
  })

  it('人数为负数不崩', () => {
    expect(calcColumns(2400, -3)).toBe(1)
  })
})

describe('calcColumns · 计入 gap 的上界修正', () => {
  it('不算 gap 时会多算一列，算 gap 后修正（原型第一版的真实 bug）', () => {
    const width = 1240
    // Akari 原式只看 240*(col+0.25)：1240 > 1260 不成立 ⇒ 4
    const akariOnly = [8, 7, 6, 5, 4, 3].find(col => width > CARD_WIDTH_PX * (col + 0.25)) ?? 3
    expect(akariOnly).toBe(4)
    // 计入 gap：5 张卡 + 4 个 gap = 1200 + 32 = 1232 ≤ 1240 ⇒ 确实放得下 5 张
    expect((width + GRID_GAP_PX) / (CARD_WIDTH_PX + GRID_GAP_PX)).toBeGreaterThanOrEqual(5)
    // 本实现取两者较小 ⇒ 4，不会因少算 gap 而超宽
    expect(calcColumns(width, 5)).toBe(4)
  })

  it('真正放不下时不超宽：W < n*240 + (n-1)*gap 时列数正确收敛', () => {
    const width = 1200
    const cols = calcColumns(width, 8)
    const needed = cols * CARD_WIDTH_PX + (cols - 1) * GRID_GAP_PX
    expect(needed).toBeLessThanOrEqual(width)
  })
})

describe('calcColumnsFromContainer', () => {
  it('扣除容器 padding 后再算', () => {
    const containerWidth = 1300
    expect(calcColumnsFromContainer(containerWidth, 5)).toBe(
      calcColumns(containerWidth - WALL_PADDING_PX, 5)
    )
  })

  it('常用宽度下得到预期列数', () => {
    // 1600px 主窗：扣 32 padding = 1568 ⇒ 6 列上限、gap 折算 6 ⇒ 6
    expect(calcColumnsFromContainer(1600, 10)).toBe(6)
    // 1200px：扣 32 = 1168 ⇒ gap 折算 (1176)/248 = 4
    expect(calcColumnsFromContainer(1200, 10)).toBe(4)
    // 820px（窄窗）：扣 32 = 788 ⇒ (796)/248 = 3
    expect(calcColumnsFromContainer(820, 10)).toBe(3)
  })
})
