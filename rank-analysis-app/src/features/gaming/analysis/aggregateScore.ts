/**
 * 跨局综合分（`computeAggregateScore`）—— **9 维 / 满分 17**。
 *
 * 移植自 Akari `analysis/player/{scoring,aggregate/akari}.ts`（78 + 111 行）。
 *
 * ⚠️ **与 Rust `PlayerScore` 是同名不同量，切勿互相代入**（设计文档 ADR-2）：
 * | | 本文件（跨局聚合） | Rust `score_participants`（单局） |
 * |---|---|---|
 * | 输入 | 一个玩家最近 N 局 | 一局的 10 人 |
 * | KDA | 跨局合并 KDA | 该局 KDA |
 * | 胜负 | **连续斜坡** `winRate ∈ [0.5,1] → [0,1]` | 0 / 1 二值 |
 * | 伤害·承伤·经济·视野 | 先按局算分再取均值 `avg(score(game_i))` | 该局内算分 |
 * | 治疗·补刀·参团 | 用**聚合值**算分 | 该局值算分 |
 *
 * 数学结构不同 ⇒ 把 N 局喂给 Rust 会让它按 `team_id` 跨局求和，结果无意义。
 * 两者共用 `constants.ts` 的同一套权重，由两侧的 pin 测试锁死（见 constants.spec.ts）。
 *
 * 权重依据：
 * - 伤害 3 分（最能区分强度）、承伤/治疗/补刀/经济/参团/视野各 2 分、KDA/胜负各 1 分。
 * - 「理应贡献比」类维度只在 [1.0, 2.0] 区间计分（经济收窄到 1.5，因其离散度更高）。
 */

import {
  AGGREGATE_SCORE_MAX,
  EXTRAORDINARY_MIN_COUNT,
  EXTRAORDINARY_THRESHOLD,
  FULL_SCORE_CS,
  FULL_SCORE_DAMAGE,
  FULL_SCORE_GOLD,
  FULL_SCORE_HEAL,
  FULL_SCORE_KDA,
  FULL_SCORE_PARTICIPATION,
  FULL_SCORE_TAKEN,
  FULL_SCORE_VISION,
  FULL_SCORE_WIN,
  HEAL_RATIO_MAX,
  HEAL_RATIO_MIN,
  HEAL_RATIO_SOLO_MAX,
  CS_MAX_PER_MIN,
  CS_MIN_PER_MIN,
  KDA_BASELINE,
  KDA_SLOPE,
  OUTSTANDING_MIN_COUNT,
  OUTSTANDING_THRESHOLD,
  PARTICIPATION_MIN,
  RATIO_MAX,
  RATIO_MAX_GOLD,
  RATIO_MIN,
  WIN_RATE_BASELINE
} from './constants'
import type { AggregateScore, PreparedGame } from './types'
import { avgOrZero } from './utils'

/** 线性归一：`clamp(value, min, max)` 后映射到 [0, maxScore] */
function linearRange(value: number, min: number, max: number, maxScore: number): number {
  // 与 Rust `score.rs::linear` 同款防御：区间退化的常量不应产出 NaN
  if (max <= min) return 0
  const clamped = Math.min(Math.max(value, min), max)
  return ((clamped - min) / (max - min)) * maxScore
}

/**
 * KDA 维度：`sqrt(kda - 2) * 3/7`，封顶 1 分。
 *
 * 用 sqrt 而非线性：KDA 8 与 KDA 16 的差距远小于 2 与 3 的差距，
 * 线性会让高 KDA 段迅速饱和、失去区分度。
 */
export function scoreKda(kda: number): number {
  const effective = Math.max(kda - KDA_BASELINE, 0)
  return Math.min(Math.max(Math.sqrt(effective) * KDA_SLOPE, 0), FULL_SCORE_KDA)
}

/**
 * 胜负维度：跨局胜率的连续斜坡。
 *
 * 与单局分的 0/1 二值不同（见文件头对照表）——胜率 0.6 的玩家不该拿 0 分。
 */
export function scoreWinRate(winRate: number): number {
  return linearRange(winRate, WIN_RATE_BASELINE, 1, FULL_SCORE_WIN)
}

/** 「理应贡献比」维度：在 [1.0, fullRatio] 区间计分 */
export function scoreExpectedContribution(
  ratio: number,
  fullRatio: number,
  maxScore: number
): number {
  return linearRange(ratio, RATIO_MIN, fullRatio, maxScore)
}

/**
 * 治疗维度：相对**队均承伤**的比值。
 *
 * 单人/双人队（teamCount < 3）把满分线降到 1.0，否则 1v1 场景里治疗占比天然
 * 超过多人队的队均，容易被刷高。与 Rust `score_dimensions` 的 `team_size >= 3` 分支一致。
 */
export function scoreHealing(ratio: number, teamParticipantCount: number): number {
  const fullRatio = teamParticipantCount >= 3 ? HEAL_RATIO_MAX : HEAL_RATIO_SOLO_MAX
  return linearRange(ratio, HEAL_RATIO_MIN, fullRatio, FULL_SCORE_HEAL)
}

/** 补刀维度：每分钟补刀 */
export function scoreCsPerMinute(csPerMinute: number): number {
  return linearRange(csPerMinute, CS_MIN_PER_MIN, CS_MAX_PER_MIN, FULL_SCORE_CS)
}

/** 参团维度：参团率 */
export function scoreParticipation(killParticipation: number): number {
  return linearRange(killParticipation, PARTICIPATION_MIN, 1, FULL_SCORE_PARTICIPATION)
}

/**
 * 计算一名玩家的跨局综合分。
 *
 * 混合口径（与 Akari 一致，刻意不对称）：
 * - `kda` / `winRate` 用**聚合值**（跨局合并 KDA、跨局胜率）；
 * - 伤害/承伤/经济/视野 用「先按局算分再取均值」——这几个维度的绝对值随对局时长
 *   与版本剧烈波动，只有"每局相对队均的贡献"才可跨局比较；
 * - 治疗/补刀/参团 用「聚合值算分」——它们本身就是率值，取均值再算分更稳。
 *
 * @param games 已按时间倒序的 `PreparedGame` 列表
 * @param avgKda 跨局合并 KDA（`computeAggregatedSummary().avgKda`）
 * @param winRate 跨局胜率（`computeAggregatedSummary().winRate`）
 */
export function computeAggregateScore(
  games: PreparedGame[],
  avgKda: number,
  winRate: number
): AggregateScore {
  const summaries = games.map(g => g.single)

  const kdaScore = scoreKda(avgKda)
  const winRateScore = scoreWinRate(winRate)
  const damageScore = avgOrZero(
    summaries.map(s =>
      scoreExpectedContribution(
        s.championDamageRatioToExpectedContribution,
        RATIO_MAX,
        FULL_SCORE_DAMAGE
      )
    )
  )
  const damageTakenScore = avgOrZero(
    summaries.map(s =>
      scoreExpectedContribution(
        s.damageTakenRatioToExpectedContribution,
        RATIO_MAX,
        FULL_SCORE_TAKEN
      )
    )
  )
  const healingScore = avgOrZero(
    summaries.map(s => scoreHealing(s.healingRatioToTeamAverageDamageTaken, s.teamParticipantCount))
  )
  const csScore = avgOrZero(summaries.map(s => scoreCsPerMinute(s.csPerMinute)))
  const goldScore = avgOrZero(
    summaries.map(s =>
      scoreExpectedContribution(s.goldRatioToExpectedContribution, RATIO_MAX_GOLD, FULL_SCORE_GOLD)
    )
  )
  const participationScore = avgOrZero(summaries.map(s => scoreParticipation(s.killParticipation)))
  const visionScore = avgOrZero(
    summaries.map(s =>
      scoreExpectedContribution(
        s.visionScoreRatioToExpectedContribution,
        RATIO_MAX,
        FULL_SCORE_VISION
      )
    )
  )

  const total =
    kdaScore +
    winRateScore +
    damageScore +
    damageTakenScore +
    healingScore +
    csScore +
    goldScore +
    participationScore +
    visionScore

  return {
    kdaScore,
    winRateScore,
    damageScore,
    damageTakenScore,
    healingScore,
    csScore,
    goldScore,
    participationScore,
    visionScore,
    total,
    maxScore: AGGREGATE_SCORE_MAX,
    // 门槛须同时满足分数与样本数，避免 2 场 8 分就贴「非凡」
    outstanding: total >= OUTSTANDING_THRESHOLD && games.length >= OUTSTANDING_MIN_COUNT,
    extraordinary: total >= EXTRAORDINARY_THRESHOLD && games.length >= EXTRAORDINARY_MIN_COUNT
  }
}
