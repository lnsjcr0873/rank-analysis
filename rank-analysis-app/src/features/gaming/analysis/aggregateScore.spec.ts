/**
 * `aggregateScore.spec.ts` 单测。
 *
 * 最核心的一条是 **`computeAggregateScore` 在单局场景下必须与 Rust
 * `score_participants` 给出相同总分**——因为此时：
 * - `winRate ∈ {0,1}`，跨局斜坡 `linear(r, 0.5, 1, 1)` 退化为 Rust 的 0/1 二值；
 * - `avgKda = (K+A)/max(D,1)` 与 Rust `score_dimensions` 的 KDA 口径逐字一致；
 * - 其余 7 维都是「单局值算分」，结构相同。
 *
 * 这条断言把「两侧共用同一套权重」从注释承诺变成可执行事实。期望值 2.6245 是
 * 独立按 Rust 公式手算的常量，改任一侧权重都会让它变红。
 */

import { describe, expect, it } from 'vitest'

import { AGGREGATE_SCORE_MAX } from './constants'
import {
  computeAggregateScore,
  scoreCsPerMinute,
  scoreExpectedContribution,
  scoreHealing,
  scoreKda,
  scoreParticipation,
  scoreWinRate
} from './aggregateScore'
import type { PreparedGame, SelfGameStats, SingleSummaryAnalysis } from './types'

function makeSelf(over: Partial<SelfGameStats> = {}): SelfGameStats {
  return {
    participantId: 1,
    championId: 103,
    puuid: 'p-1',
    teamId: 100,
    position: 'MIDDLE',
    kills: 4,
    deaths: 4,
    assists: 6,
    kda: 2.5,
    win: true,
    goldEarned: 10000,
    cs: 200,
    totalDamageDealtToChampions: 20000,
    totalDamageTaken: 20000,
    totalDamageToTowers: 2000,
    totalHeal: 1000,
    visionScore: 40,
    subteamPlacement: null,
    subteamId: 0,
    spell1Id: 4,
    spell2Id: 7,
    soloKills: null,
    enemyMissingPings: null,
    ...over
  }
}

function makeSingle(over: Partial<SingleSummaryAnalysis> = {}): SingleSummaryAnalysis {
  return {
    championDamageRatioToTeamMax: 1,
    championDamageRatioToExpectedContribution: 1,
    championDamageRatioToMax: 1,
    championDamagePercentageOfTeam: 0.2,
    championDamagePerMinute: 400,
    damageTakenRatioToTeamMax: 1,
    damageTakenRatioToExpectedContribution: 1,
    damageTakenRatioToMax: 1,
    damageTakenPercentageOfTeam: 0.2,
    healingRatioToTeamAverageDamageTaken: 0.25,
    teamParticipantCount: 5,
    goldRatioToTeamMax: 1,
    goldRatioToExpectedContribution: 1,
    goldRatioToMax: 1,
    goldPercentageOfTeam: 0.2,
    csRatioToTeamMax: 1,
    csRatioToMax: 1,
    csPercentageOfTeam: 0.2,
    csPerMinute: 200 / 30,
    towerDamageRatioToTeamMax: 1,
    towerDamageRatioToMax: 1,
    towerDamagePercentageOfTeam: 0.2,
    visionScorePercentageOfTeam: 0.2,
    visionScoreRatioToExpectedContribution: 1,
    kda: 2.5,
    win: true,
    killParticipation: 0.5,
    damageGoldEfficiency: 2,
    killDamageEfficiency: 1,
    ...over
  }
}

function makeGame(over: Partial<SingleSummaryAnalysis> = {}): PreparedGame {
  const self = makeSelf()
  return {
    gameId: 1,
    basic: {
      gameId: 1,
      gameCreation: 0,
      gameDuration: 1800,
      gameType: 'MATCHED_GAME',
      queueId: 420,
      gameMode: 'CLASSIC',
      mapId: 11,
      isCherrySubteam: false
    },
    self,
    teamMates: [self],
    everyone: [self],
    single: makeSingle(over)
  }
}

describe('各维度评分函数', () => {
  it('KDA：2 分以下记 0，6.1 以上封顶 1', () => {
    expect(scoreKda(1)).toBe(0)
    expect(scoreKda(2)).toBe(0)
    expect(scoreKda(2.5)).toBeCloseTo(Math.sqrt(0.5) * (3 / 7), 12)
    expect(scoreKda(100)).toBe(1)
  })

  it('KDA 用 sqrt 而非线性：KDA 8 与 16 的分差远小于 2 与 3', () => {
    const low = scoreKda(3) - scoreKda(2)
    const high = scoreKda(16) - scoreKda(8)
    expect(high).toBeLessThan(low)
  })

  it('胜率：50% 记 0，100% 记满分，中间连续', () => {
    expect(scoreWinRate(0.5)).toBe(0)
    expect(scoreWinRate(1)).toBe(1)
    expect(scoreWinRate(0.75)).toBeCloseTo(0.5, 12)
  })

  it('理应贡献比：1.0 记 0，达满分线记满分', () => {
    expect(scoreExpectedContribution(1, 2, 3)).toBe(0)
    expect(scoreExpectedContribution(2, 2, 3)).toBe(3)
    expect(scoreExpectedContribution(1.5, 2, 3)).toBeCloseTo(1.5, 12)
  })

  it('理应贡献比：低于 1.0 记 0（不倒扣）', () => {
    expect(scoreExpectedContribution(0.5, 2, 3)).toBe(0)
  })

  it('治疗：多人队满分线 1.4，单人队降到 1.0', () => {
    expect(scoreHealing(1.4, 5)).toBe(2)
    expect(scoreHealing(1.4, 1)).toBe(2)
    // 同样 1.0 的治疗比值，单人队拿分更高（分母更低）
    expect(scoreHealing(1, 1)).toBeGreaterThan(scoreHealing(1, 5))
  })

  it('补刀：5/分记 0，10/分记满分', () => {
    expect(scoreCsPerMinute(5)).toBe(0)
    expect(scoreCsPerMinute(10)).toBe(2)
    expect(scoreCsPerMinute(7.5)).toBe(1)
  })

  it('参团：30% 记 0，100% 记满分', () => {
    expect(scoreParticipation(0.3)).toBe(0)
    expect(scoreParticipation(1)).toBe(2)
    expect(scoreParticipation(0.65)).toBeCloseTo(1, 12)
  })
})

describe('computeAggregateScore · 与 Rust 单局分的对拍', () => {
  /**
   * 单局 + 均衡数据下的期望总分。
   *
   * 独立按 Rust `score.rs::score_dimensions` 手算：
   *   kda        = sqrt(2.5-2) * 3/7          = 0.30304576
   *   win        = 1（winRate=1 → 斜坡满值）   = 1
   *   damage     = linear(1.0, 1.0, 2.0, 3)  = 0
   *   damageTaken= linear(1.0, 1.0, 2.0, 2)  = 0
   *   heal       = linear(0.25, 0.2, 1.4, 2) = 0.08333333
   *   cs         = linear(6.6667, 5, 10, 2)   = 0.66666667
   *   gold       = linear(1.0, 1.0, 1.5, 2)  = 0
   *   participation = linear(0.5, 0.3, 1, 2) = 0.57142857
   *   vision     = linear(1.0, 1.0, 2.0, 2)  = 0
   *   合计                                    = 2.62447443
   */
  it('单局均衡局的总分与 Rust 公式手算值一致', () => {
    const score = computeAggregateScore([makeGame()], 2.5, 1)
    expect(score.total).toBeCloseTo(2.6244744, 6)
  })

  it('单局败局的胜负项记 0（与 Rust 二值一致）', () => {
    const score = computeAggregateScore([makeGame()], 2.5, 0)
    expect(score.winRateScore).toBe(0)
    expect(score.total).toBeCloseTo(1.6244744, 6)
  })
})

describe('computeAggregateScore · 聚合口径', () => {
  it('KDA / 胜率用聚合值（跨局合并 KDA、跨局胜率）', () => {
    // 两局：KDA 分别为 2 与 4，合并 (ΣK+ΣA)/ΣD 由调用方给出 3
    const games = [makeGame(), makeGame()]
    const score = computeAggregateScore(games, 3, 0.75)
    expect(score.kdaScore).toBeCloseTo(scoreKda(3), 12)
    expect(score.winRateScore).toBeCloseTo(scoreWinRate(0.75), 12)
  })

  it('理应贡献类维度取「按局算分的均值」而非「均值的分」', () => {
    // 两局占比分别为 0 与 2：各局算分 0 与 3，均值 1.5
    // 而先求均值(1.0)再算分会得到 0 —— 两者必须不同
    const games = [
      makeGame({ championDamageRatioToExpectedContribution: 0 }),
      makeGame({ championDamageRatioToExpectedContribution: 2 })
    ]
    const score = computeAggregateScore(games, 2.5, 1)
    expect(score.damageScore).toBeCloseTo(1.5, 12)
  })

  it('9 维之和即 total', () => {
    const s = computeAggregateScore([makeGame()], 2.5, 1)
    const sum =
      s.kdaScore +
      s.winRateScore +
      s.damageScore +
      s.damageTakenScore +
      s.healingScore +
      s.csScore +
      s.goldScore +
      s.participationScore +
      s.visionScore
    expect(s.total).toBeCloseTo(sum, 12)
  })

  it('maxScore 恒为 17', () => {
    expect(computeAggregateScore([makeGame()], 2.5, 1).maxScore).toBe(17)
    expect(AGGREGATE_SCORE_MAX).toBe(17)
  })

  it('全维度拉满时 total 不超过 17', () => {
    const perfect = makeGame({
      championDamageRatioToExpectedContribution: 2,
      damageTakenRatioToExpectedContribution: 2,
      healingRatioToTeamAverageDamageTaken: 1.4,
      csPerMinute: 10,
      goldRatioToExpectedContribution: 1.5,
      killParticipation: 1,
      visionScoreRatioToExpectedContribution: 2
    })
    const score = computeAggregateScore([perfect], 9, 1)
    expect(score.total).toBeLessThanOrEqual(17)
    expect(score.total).toBeGreaterThan(16)
  })
})

describe('computeAggregateScore · 档位门槛', () => {
  const strong = makeGame({
    championDamageRatioToExpectedContribution: 2,
    damageTakenRatioToExpectedContribution: 2,
    healingRatioToTeamAverageDamageTaken: 1.4,
    csPerMinute: 10,
    goldRatioToExpectedContribution: 1.5,
    killParticipation: 1,
    visionScoreRatioToExpectedContribution: 2
  })

  it('卓越需同时满足分数与样本数', () => {
    const few = computeAggregateScore([strong], 9, 1)
    expect(few.total).toBeGreaterThan(6.5)
    // 样本不足则不打标
    expect(few.outstanding).toBe(false)

    const enough = computeAggregateScore(new Array(5).fill(strong), 9, 1)
    expect(enough.outstanding).toBe(true)
  })

  it('非凡需同时满足分数与 8 局样本', () => {
    const five = computeAggregateScore(new Array(5).fill(strong), 9, 1)
    expect(five.total).toBeGreaterThan(8)
    expect(five.extraordinary).toBe(false)

    const eight = computeAggregateScore(new Array(8).fill(strong), 9, 1)
    expect(eight.extraordinary).toBe(true)
  })

  it('空输入不抛错且 total 为有限数', () => {
    const s = computeAggregateScore([], 0, 0)
    expect(Number.isFinite(s.total)).toBe(true)
    expect(s.outstanding).toBe(false)
    expect(s.extraordinary).toBe(false)
  })
})
