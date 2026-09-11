/**
 * 评审计算单测：八轴归一化与雷达坐标。
 */
import { describe, expect, it } from 'vitest'

import type { JudgePlayer } from '../judges'
import { computeReviewAxes, radarPoints } from '../review'

const P = (over: Partial<JudgePlayer> & { name: string }): JudgePlayer => ({
  championName: 'X',
  team: 100,
  win: true,
  kills: 5,
  deaths: 2,
  assists: 5,
  damageDealt: 20_000,
  damageTaken: 10_000,
  turretDamage: 1_000,
  heal: 300,
  goldEarned: 12_000,
  ...over
})

describe('computeReviewAxes', () => {
  const players = [P({ name: 'a' }), P({ name: 'b', damageDealt: 40_000 })]

  it('me 找不到时 found=false 且全零', () => {
    const r = computeReviewAxes(players, 'nobody')
    expect(r.found).toBe(false)
    expect(r.axes.every(a => a.self === 0 && a.avg === 0)).toBe(true)
  })

  it('归一化：全场最高为 1，非最高玩家根据相对值正确缩放', () => {
    const { axes, found } = computeReviewAxes(players, 'b')
    expect(found).toBe(true)
    const dmg = axes.find(a => a.label === '伤害')!
    expect(dmg.self).toBe(1) // b 是全场最高
    expect(dmg.avg).toBeCloseTo(0.75, 2) // 均值 30000 / 峰值 40000

    const { axes: axesA } = computeReviewAxes(players, 'a')
    const dmgA = axesA.find(a => a.label === '伤害')!
    expect(dmgA.self).toBeCloseTo(0.5, 2) // a 为 20000 / 峰值 40000 = 0.5
    expect(dmgA.avg).toBeCloseTo(0.75, 2) // 均值 30000 / 峰值 40000 = 0.75
  })

  it('恒等指标（两人相同值）双方都到顶 1', () => {
    const same = [P({ name: 'a' }), P({ name: 'b' })]
    const { axes } = computeReviewAxes(same, 'a')
    // 归一化分母 = max(self, avg) → 相同时双方同为 1
    expect(axes.every(a => a.self === 1 && a.avg === 1)).toBe(true)
  })
})

describe('radarPoints', () => {
  it('全 1 输出正 n 边形顶点（首点在正上方）', () => {
    const pts = radarPoints([1, 1, 1, 1], 100, 100, 80)
    expect(pts.split(' ').length).toBe(4)
    expect(pts.startsWith('100.0,20.0')).toBe(true) // cx, cy-r
  })

  it('数值被钳制到 0..1 且空数组返回空串', () => {
    expect(radarPoints([2, -1], 0, 0, 10)).toBe('0.0,-10.0 0.0,0.0')
    expect(radarPoints([], 0, 0, 10)).toBe('')
  })

  it('Remake/脏数据 NaN/Infinity 被清洗为 0，不拼出 NaN 坐标', () => {
    // 四顶点顺序：上→右→下→左；NaN/Infinity/-Infinity 均按 0 落中心点，
    // 0.5 落左中点 (cx-r*0.5, cy)
    expect(radarPoints([NaN, Infinity, -Infinity, 0.5], 100, 100, 80)).toBe(
      '100.0,100.0 100.0,100.0 100.0,100.0 60.0,100.0'
    )
    expect(radarPoints([NaN], 0, 0, 10)).toBe('0.0,0.0')
  })
})
