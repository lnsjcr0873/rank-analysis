/**
 * **跨语言同步契约测试**（Rust `score.rs` ↔ 本目录 `constants.ts`）。
 *
 * 名册墙的「17 分」徽章用的是**跨局聚合分**（TS 侧 `aggregateScore.ts`），
 * 而 MVP/SVP、详情页评分页签、决策回测用的是 **Rust 单局分**
 * （`command/score.rs::score_participants`）。两者共用同一套 9 维权重与基线，
 * 但数学结构不同（详见设计文档 ADR-2），因此**必须靠测试把权重钉死**，
 * 否则任一侧改阈值会静默分叉，用户会看到「同一套 17 分制两处算出不同分」。
 *
 * 本测试断言本目录常量与 Rust 侧的**字面量逐一相等**。Rust 侧有对应的
 * `score_constants_pin_tests.rs`，两侧改任一常量都会各自 CI 失败，
 * 从而强制另一侧同步。
 *
 * 唯一有意分歧：`WIN_RATE_BASELINE`。它只服务跨局胜率斜坡，
 * Rust 无跨局路径（单局 winRate ∈ {0,1}，斜坡退化为 0/1），
 * 故 Rust `score.rs` 中没有对应常量——下面 `intentional_divergences` 显式记录这一点。
 */

import { describe, expect, it } from 'vitest'

import {
  AGGREGATE_SCORE_MAX,
  CS_MAX_PER_MIN,
  CS_MIN_PER_MIN,
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
  KDA_BASELINE,
  KDA_SLOPE,
  OUTSTANDING_MIN_COUNT,
  OUTSTANDING_THRESHOLD,
  PARTICIPATION_MIN,
  RATIO_MAX,
  RATIO_MAX_GOLD,
  RATIO_MIN
} from './constants'

/**
 * 跨局聚合分「有意分歧」清单。
 *
 * 每条必须写明「Rust 为何没有 / 为什么不需要」，否则后来者会误当成漏移植
 * 而补上，造成重复实现。
 */
const intentional_divergences: Record<string, string> = {
  WIN_RATE_BASELINE:
    'Rust score_participants 只有单局路径，单局 winRate ∈ {0,1}，斜坡退化为「赢满分/输 0 分」；' +
    '跨局连续胜率斜坡只在 TS 侧 aggregateScore 使用。'
}

describe('analysis/constants 跨语言同步契约', () => {
  /**
   * Rust `command/score.rs` 常量名 → TS 常量 → **期望字面量**。
   *
   * 这是真正的钉子：Rust 侧 `score_constants_pin_tests.rs` 断言同一批字面量。
   * 任一侧改动 → 该侧测试变红 → CI 强制另一侧同步。
   * 三个值必须同时相等，任何一边漂移都会红。
   */
  const pin: Array<[rustConst: string, tsValue: number, literal: number]> = [
    ['KDA_BASELINE', KDA_BASELINE, 2.0],
    ['KDA_SLOPE', KDA_SLOPE, 3.0 / 7.0],
    ['FULL_SCORE_KDA', FULL_SCORE_KDA, 1.0],
    ['FULL_SCORE_WIN', FULL_SCORE_WIN, 1.0],
    ['FULL_SCORE_DAMAGE', FULL_SCORE_DAMAGE, 3.0],
    ['FULL_SCORE_TAKEN', FULL_SCORE_TAKEN, 2.0],
    ['HEAL_RATIO_MIN', HEAL_RATIO_MIN, 0.2],
    ['HEAL_RATIO_MAX', HEAL_RATIO_MAX, 1.4],
    ['FULL_SCORE_HEAL', FULL_SCORE_HEAL, 2.0],
    ['CS_MIN_PER_MIN', CS_MIN_PER_MIN, 5.0],
    ['CS_MAX_PER_MIN', CS_MAX_PER_MIN, 10.0],
    ['FULL_SCORE_CS', FULL_SCORE_CS, 2.0],
    ['FULL_SCORE_GOLD', FULL_SCORE_GOLD, 2.0],
    ['KP_MIN', PARTICIPATION_MIN, 0.3],
    ['FULL_SCORE_PARTICIPATION', FULL_SCORE_PARTICIPATION, 2.0],
    ['FULL_SCORE_VISION', FULL_SCORE_VISION, 2.0],
    ['RATIO_MIN_DAMAGE', RATIO_MIN, 1.0],
    ['RATIO_MAX_DAMAGE', RATIO_MAX, 2.0],
    ['RATIO_MIN_TAKEN', RATIO_MIN, 1.0],
    ['RATIO_MAX_TAKEN', RATIO_MAX, 2.0],
    ['RATIO_MIN_GOLD', RATIO_MIN, 1.0],
    ['RATIO_MAX_GOLD', RATIO_MAX_GOLD, 1.5],
    ['RATIO_MIN_VISION', RATIO_MIN, 1.0],
    ['RATIO_MAX_VISION', RATIO_MAX, 2.0]
  ]

  it.each(pin)(
    'Rust score.rs 的 %s 与 TS 侧同值常量保持一致（期望 %f）',
    (_rustName, tsValue, literal) => {
      expect(tsValue).toBe(literal)
    }
  )

  it('9 维满分之和恰为 17（与 Rust AKARI_MAX_SCORE 一致）', () => {
    expect(AGGREGATE_SCORE_MAX).toBe(17)
    expect(AGGREGATE_SCORE_MAX).toBe(
      FULL_SCORE_KDA +
        FULL_SCORE_WIN +
        FULL_SCORE_DAMAGE +
        FULL_SCORE_TAKEN +
        FULL_SCORE_HEAL +
        FULL_SCORE_CS +
        FULL_SCORE_GOLD +
        FULL_SCORE_PARTICIPATION +
        FULL_SCORE_VISION
    )
  })

  it('单人队伍治疗满分线（1.0）低于多人队伍（1.4），保证单人不会被治疗刷高', () => {
    expect(HEAL_RATIO_SOLO_MAX).toBeLessThan(HEAL_RATIO_MAX)
  })

  it('承伤/伤害/视野共用 [1.0, 2.0] 区间，经济收窄为 [1.0, 1.5]', () => {
    expect(RATIO_MIN).toBe(1.0)
    expect(RATIO_MAX).toBe(2.0)
    expect(RATIO_MAX_GOLD).toBe(1.5)
    // 经济上限必须严于标准维度，否则经济会挤占其他维度的权重感
    expect(RATIO_MAX_GOLD).toBeLessThan(RATIO_MAX)
  })

  it('非凡门槛严于卓越门槛，且各自样本数要求递增', () => {
    expect(EXTRAORDINARY_THRESHOLD).toBeGreaterThan(OUTSTANDING_THRESHOLD)
    expect(EXTRAORDINARY_MIN_COUNT).toBeGreaterThan(OUTSTANDING_MIN_COUNT)
  })

  it('有意分歧均写明了 Rust 侧不需要的理由', () => {
    for (const [name, reason] of Object.entries(intentional_divergences)) {
      expect(name.length).toBeGreaterThan(0)
      expect(reason).toContain('Rust')
    }
  })
})
