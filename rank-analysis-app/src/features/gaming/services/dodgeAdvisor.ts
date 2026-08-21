/**
 * 选人期「秒退/对局质量诊断决策引擎」（Dodge Advisor & Match Quality Engine）
 *
 * 依据我方队友状态、敌方威胁画像、阵容平衡与双方胜率对比：
 * - qualityScore: 0~100 综合对局期望分（>=75 极佳开局，60~74 均势对局，45~59 劣势需谨慎，<45 建议秒退止损）
 * - recommendation: 'play' | 'caution' | 'dodge'
 * - expectedLpEv: 开局期望 LP 变动 vs 秒退固定 -5 LP
 * - riskFactors / advantageFactors: 人类可读的归因明细
 */

import type { LineupScore } from './lineupScore'
import type { ThreatRating } from '@renderer/services/scouting'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

export type DodgeRecommendation = 'play' | 'caution' | 'dodge'

export interface QualityFactor {
  level: 'critical' | 'warning' | 'info' | 'positive'
  title: string
  detail: string
}

export interface DodgeAdvisorResult {
  /** 对局质量得分 0~100（50为标准基准） */
  qualityScore: number
  /** 决策建议：开局 / 谨慎 / 秒退 */
  recommendation: DodgeRecommendation
  /** 预计本局胜率（0~100%） */
  predictedWinRate: number
  /** 预期排位分期望 (EV)：以标准 +20/-20 LP 测算 */
  expectedLpEv: number
  /** 核心风险点 */
  risks: QualityFactor[]
  /** 核心优势点 */
  advantages: QualityFactor[]
  /** 总结一句话建议 */
  summary: string
}

export interface DodgeAdvisorInput {
  myTeamScore?: LineupScore | null
  theirTeamScore?: LineupScore | null
  threatRatings?: ThreatRating[]
  teammateProfiles?: (RecentPlayerProfile | null | undefined)[]
  myPosition?: string
  isRankedQueue?: boolean
}

/**
 * 评估选人期对局质量与秒退建议
 */
export function evaluateDodgeQuality(input: DodgeAdvisorInput): DodgeAdvisorResult {
  const {
    myTeamScore,
    theirTeamScore,
    threatRatings = [],
    teammateProfiles = [],
    isRankedQueue = true
  } = input

  let baseScore = 50
  const risks: QualityFactor[] = []
  const advantages: QualityFactor[] = []

  // 1. 阵容胜率与强度对比
  const myRate = myTeamScore?.score ?? 50
  const theirRate = theirTeamScore?.score ?? 50
  const rateDiff = myRate - theirRate

  if (myTeamScore?.score && theirTeamScore?.score) {
    baseScore += rateDiff * 1.5
    if (rateDiff >= 4) {
      advantages.push({
        level: 'positive',
        title: '阵容胜率占优',
        detail: `我方阵容平均胜率 ${myRate.toFixed(1)}% 高于敌方 ${theirRate.toFixed(1)}%`
      })
    } else if (rateDiff <= -4) {
      risks.push({
        level: 'warning',
        title: '阵容基础胜率偏低',
        detail: `我方阵容平均胜率 ${myRate.toFixed(1)}% 明显落后于敌方 ${theirRate.toFixed(1)}%`
      })
    }
  }

  // 2. 敌方高危威胁画像（绝活哥 / 连胜 / 代练嫌疑）
  const highThreats = threatRatings.filter(
    t => t.threatLevel === 'High' || t.threatLevel === 'Critical'
  )
  if (highThreats.length > 0) {
    baseScore -= highThreats.length * 8
    highThreats.forEach(t => {
      const reasons = [...t.caveats, ...t.styleTags]
      risks.push({
        level: t.threatLevel === 'Critical' ? 'critical' : 'warning',
        title: `敌方高危对位: ${t.position || '对手'}`,
        detail: reasons.join('；') || '对线极具压迫感'
      })
    })
  }

  // 3. 队友状态检测（补位、练英雄、连败心态）
  teammateProfiles.forEach((p, idx) => {
    if (!p) return
    const pos = p.mainPosition !== 'UNCLEAR' ? p.mainPosition : `队友${idx + 1}`

    // 补位严重度
    if (p.currentLanePlayedRatio < 0.2 && p.mainPosition !== 'UNCLEAR') {
      baseScore -= 7
      risks.push({
        level: 'warning',
        title: `${pos} 补位玩家`,
        detail: '近期极少游玩该位置，熟练度偏低'
      })
    }

    // 连败/近况
    if (p.streak?.kind === 'loss' && p.streak.count >= 3) {
      baseScore -= 6
      risks.push({
        level: 'warning',
        title: `${pos} 近期连败`,
        detail: `近期遭遇 ${p.streak.count} 连败，可能处于心态波动期`
      })
    } else if (p.streak?.kind === 'win' && p.streak.count >= 3) {
      baseScore += 6
      advantages.push({
        level: 'positive',
        title: `${pos} 连胜势头`,
        detail: `当前保持 ${p.streak.count} 连胜，手感火热`
      })
    }

    // 绝活哥加成
    if (p.currentChampionMastery?.isOnetrick) {
      baseScore += 5
      advantages.push({
        level: 'positive',
        title: `${pos} 绝活英雄`,
        detail: '英雄专精极高，前期线权保障'
      })
    }
  })

  // 4. 最终归一化与决策判定
  const qualityScore = Math.max(10, Math.min(95, Math.round(baseScore)))
  const predictedWinRate = Math.max(20, Math.min(80, Math.round(40 + (qualityScore / 100) * 20)))

  // 标准胜 +20 / 败 -20 LP 计算期望收益
  const expectedLpEv =
    Math.round(((predictedWinRate / 100) * 20 - ((100 - predictedWinRate) / 100) * 20) * 10) / 10

  let recommendation: DodgeRecommendation = 'play'
  let summary = '当前对局各线势均力敌，推荐正常开局。'

  if (qualityScore >= 70) {
    recommendation = 'play'
    summary = '我方各路状态饱满、阵容契合度高，极佳赢面局！'
  } else if (qualityScore <= 40 && isRankedQueue) {
    recommendation = 'dodge'
    summary = `局势极度劣势（期望净收益 ${expectedLpEv > 0 ? '+' : ''}${expectedLpEv} LP），建议秒退（-5 LP）止损保护隐藏分。`
  } else if (qualityScore < 60) {
    recommendation = 'caution'
    summary = '存在个别对位劣势或补位，前期需注重稳健防守与视野。'
  }

  return {
    qualityScore,
    recommendation,
    predictedWinRate,
    expectedLpEv,
    risks,
    advantages,
    summary
  }
}
