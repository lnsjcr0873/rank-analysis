/**
 * A7/C4 赛后评审计算：雷达轴 + 多边形坐标（纯函数，供 ReviewTab 与单测）。
 *
 * 归一化口径：每根轴取全场最大值 max(...players.map(value)) 为分母——两张多边形同尺度可比，
 * avg 与 self 均 ≤1、真实反映全场相对表现。
 */

import type { JudgePlayer } from './judges'

export interface RadarAxis {
  label: string
  /** 被选中玩家归一化值 0..1 */
  self: number
  /** 全场均值归一化值 0..1 */
  avg: number
}

const EPS = 1e-6

function kdaOf(p: JudgePlayer): number {
  return p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths
}

/** 计算八轴雷达数据；找不到 me 时 found=false、axes 全零。 */
export function computeReviewAxes(
  players: JudgePlayer[],
  meName: string
): { axes: RadarAxis[]; found: boolean } {
  const zero = (label: string): RadarAxis => ({ label, self: 0, avg: 0 })
  const me = players.find(p => p.name === meName)
  if (!players.length || !me) {
    return {
      axes: ['KDA', '伤害', '承伤', '参团率', '塔伤', '治疗', '经济', '每死承伤'].map(zero),
      found: false
    }
  }

  const total = (pick: (p: JudgePlayer) => number) => players.reduce((s, p) => s + pick(p), 0)
  const totalDmg = total(p => p.damageDealt) || 1
  const totalTaken = total(p => p.damageTaken) || 1
  const totalTurret = total(p => p.turretDamage) || 1

  const teamKillsOf = (p: JudgePlayer) =>
    players.filter(x => x.team === p.team).reduce((s, x) => s + x.kills, 0) || 1

  const metrics: Array<{ label: string; value: (p: JudgePlayer) => number }> = [
    { label: 'KDA', value: kdaOf },
    { label: '伤害', value: p => p.damageDealt / totalDmg },
    { label: '承伤', value: p => p.damageTaken / totalTaken },
    { label: '参团率', value: p => (p.kills + p.assists) / teamKillsOf(p) },
    { label: '塔伤', value: p => p.turretDamage / totalTurret },
    { label: '治疗', value: p => p.heal },
    { label: '经济', value: p => p.goldEarned },
    { label: '每死承伤', value: p => p.damageTaken / Math.max(1, p.deaths) }
  ]

  const axes = metrics.map(({ label, value }) => {
    const allValues = players.map(value).filter(Number.isFinite)
    const maxRaw = allValues.length ? Math.max(...allValues, EPS) : EPS
    const avgRaw = total(value) / Math.max(1, players.length)
    const selfRaw = value(me)
    const validSelf = Number.isFinite(selfRaw) ? selfRaw : 0
    const validAvg = Number.isFinite(avgRaw) ? avgRaw : 0
    return {
      label,
      self: Number(Math.min(1, Math.max(0, validSelf / maxRaw)).toFixed(3)),
      avg: Number(Math.min(1, Math.max(0, validAvg / maxRaw)).toFixed(3))
    }
  })
  return { axes, found: true }
}

/** 雷达多边形顶点串（从顶部起顺时针）。values 与 axes 等长，取值 0..1。 */
export function radarPoints(values: number[], cx: number, cy: number, r: number): string {
  const n = values.length
  if (!n) return ''
  return values
    .map((v, i) => {
      const clamped = Math.min(Math.max(v, 0), 1)
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
      const x = cx + Math.cos(angle) * r * clamped
      const y = cy + Math.sin(angle) * r * clamped
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
