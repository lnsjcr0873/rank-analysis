/**
 * `singleSummary.spec.ts` 单测。
 *
 * 用「五人完全对称」与「一人独吞」两类构造覆盖：
 * 1. **理应贡献比的核心性质**：五人等量时每人恰好 = 1.0；一人独吞时 = 5.0。
 *    这是跨局综合分的输入，错了整张卡的分就错。
 * 2. **与队友强弱无关**：同样两局，只改队友数值，本人占比/理应贡献比不应变
 *    （只有 `*ToTeamMax` / `*ToMax` 会变——这正是只拿理应贡献比跨局聚合的原因）。
 * 3. **降级纪律**：单人队、队总为 0、时长为 0 均不产生 NaN/Infinity。
 */

import { describe, expect, it } from 'vitest'

import type { SelfGameStats } from './types'
import { computeSingleSummary } from './singleSummary'

/** 构造一名归一化参与者；未指定字段走「均衡默认值」 */
function makeStats(over: Partial<SelfGameStats> = {}): SelfGameStats {
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
    spell1Id: 4,
    spell2Id: 7,
    soloKills: null,
    enemyMissingPings: null,
    ...over
  }
}

/** 构造一支 5 人队 + 5 人敌队（默认完全均衡） */
function makeTeams(selfOver: Partial<SelfGameStats> = {}) {
  const team = [
    makeStats({ participantId: 1, puuid: 'p-1', ...selfOver }),
    makeStats({ participantId: 2, puuid: 'p-2' }),
    makeStats({ participantId: 3, puuid: 'p-3' }),
    makeStats({ participantId: 4, puuid: 'p-4' }),
    makeStats({ participantId: 5, puuid: 'p-5' })
  ]
  const enemy = [6, 7, 8, 9, 10].map(id =>
    makeStats({ participantId: id, puuid: `p-${id}`, teamId: 200 })
  )
  return { self: team[0], team, everyone: [...team, ...enemy] }
}

/** 所有字段均为有限数（NaN / Infinity 即为 bug） */
function expectAllFinite(result: Record<string, unknown>) {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') {
      expect(Number.isFinite(value), `${key} 应为有限数，实得 ${value}`).toBe(true)
    }
  }
}

const DURATION = 1800 // 30 分钟

describe('computeSingleSummary · 理应贡献比', () => {
  it('五人等量时每人恰好 1.0', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.championDamageRatioToExpectedContribution).toBeCloseTo(1, 10)
    expect(s.damageTakenRatioToExpectedContribution).toBeCloseTo(1, 10)
    expect(s.goldRatioToExpectedContribution).toBeCloseTo(1, 10)
    expect(s.visionScoreRatioToExpectedContribution).toBeCloseTo(1, 10)
  })

  it('一人独吞全队伤害时该比值为 5.0（= 队伍人数）', () => {
    const team = [
      makeStats({ totalDamageDealtToChampions: 100000 }),
      makeStats({ totalDamageDealtToChampions: 0 }),
      makeStats({ totalDamageDealtToChampions: 0 }),
      makeStats({ totalDamageDealtToChampions: 0 }),
      makeStats({ totalDamageDealtToChampions: 0 })
    ]
    const everyone = [
      ...team,
      ...[6, 7, 8, 9, 10].map(id => makeStats({ participantId: id, teamId: 200 }))
    ]
    const s = computeSingleSummary(team[0], team, everyone, DURATION)
    expect(s.championDamageRatioToExpectedContribution).toBeCloseTo(5, 10)
  })

  it('伤害占队比与理应贡献比互相可推（占比 × 队伍人数）', () => {
    const { self, team, everyone } = makeTeams({ totalDamageDealtToChampions: 50000 })
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.championDamagePercentageOfTeam * 5).toBeCloseTo(
      s.championDamageRatioToExpectedContribution,
      10
    )
  })
})

describe('computeSingleSummary · 理应贡献比只看队内相对份额', () => {
  it('整队同倍放大时不变（与绝对量级无关，故可跨局聚合）', () => {
    const base = makeTeams()
    const r1 = computeSingleSummary(base.self, base.team, base.everyone, DURATION)

    const scaledTeam = base.team.map(p => ({
      ...p,
      totalDamageDealtToChampions: p.totalDamageDealtToChampions * 5
    }))
    const scaledEveryone = scaledTeam.concat(base.everyone.filter(p => p.teamId === 200))
    // 注意 self 必须取自 scaledTeam（整队含本人一同放大），否则本人没放大就不是"整队放大"
    const r2 = computeSingleSummary(scaledTeam[0], scaledTeam, scaledEveryone, DURATION)

    expect(r2.championDamageRatioToExpectedContribution).toBeCloseTo(
      r1.championDamageRatioToExpectedContribution,
      10
    )
  })

  it('只放大敌方输出时理应贡献比不变，但「相对全场最高」口径会变', () => {
    const base = makeTeams()
    const r1 = computeSingleSummary(base.self, base.team, base.everyone, DURATION)

    // 敌方一人输出暴涨 → 全场最高值被拉高
    const boostedEveryone = base.everyone.map(p =>
      p.participantId === 6 ? { ...p, totalDamageDealtToChampions: 500000 } : p
    )
    const r2 = computeSingleSummary(base.self, base.team, boostedEveryone, DURATION)

    // 理应贡献比只认队友，不受敌方影响
    expect(r2.championDamageRatioToExpectedContribution).toBeCloseTo(
      r1.championDamageRatioToExpectedContribution,
      10
    )
    // 而 RatioToMax 认全场，必须跟着变
    expect(r2.championDamageRatioToMax).not.toBeCloseTo(r1.championDamageRatioToMax, 6)
  })

  it('只放大队友输出时理应贡献比会变（它反映队内份额，不是绝对值）', () => {
    const base = makeTeams()
    const r1 = computeSingleSummary(base.self, base.team, base.everyone, DURATION)

    const fatTeam = base.team.map(p =>
      p.puuid === 'p-1' ? p : { ...p, totalDamageDealtToChampions: 90000 }
    )
    const fatEveryone = fatTeam.concat(base.everyone.filter(p => p.teamId === 200))
    const r2 = computeSingleSummary(base.self, fatTeam, fatEveryone, DURATION)

    expect(r2.championDamageRatioToExpectedContribution).toBeLessThan(
      r1.championDamageRatioToExpectedContribution
    )
  })
})

describe('computeSingleSummary · 队伍人数与占队比', () => {
  it('teamParticipantCount 为队伍人数（含本人）', () => {
    const { self, team, everyone } = makeTeams()
    expect(computeSingleSummary(self, team, everyone, DURATION).teamParticipantCount).toBe(5)
  })

  it('人均输出时占队比为 0.2', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.championDamagePercentageOfTeam).toBeCloseTo(0.2, 10)
    expect(s.goldPercentageOfTeam).toBeCloseTo(0.2, 10)
    expect(s.csPercentageOfTeam).toBeCloseTo(0.2, 10)
  })

  it('perMinute 指标用时长/60 作分母', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.csPerMinute).toBeCloseTo(200 / 30, 10)
    expect(s.championDamagePerMinute).toBeCloseTo(20000 / 30, 10)
  })

  it('治疗比的是队均承伤（不是队总承伤）', () => {
    const { self, team, everyone } = makeTeams({ totalHeal: 5000 })
    const s = computeSingleSummary(self, team, everyone, DURATION)
    // 队总承伤 100000 / 5 人 = 队均 20000
    expect(s.healingRatioToTeamAverageDamageTaken).toBeCloseTo(0.25, 10)
  })

  it('参团率 = (K+A) / 队总击杀（队友各 4 击杀 ⇒ 队总 8+16=24）', () => {
    const { self, team, everyone } = makeTeams({ kills: 8, assists: 4 })
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.killParticipation).toBeCloseTo(12 / 24, 10)
  })

  it('伤金转化 = 输出 / 经济', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.damageGoldEfficiency).toBeCloseTo(2, 10)
  })
})

describe('computeSingleSummary · killDamageEfficiency', () => {
  it('击杀占比与输出占比相等时为 1', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, DURATION)
    expect(s.killDamageEfficiency).toBeCloseTo(1, 10)
  })

  it('输出占比高于击杀占比时 < 1（伤害型）', () => {
    const team = [
      makeStats({ kills: 0, totalDamageDealtToChampions: 80000 }),
      ...[2, 3, 4, 5].map(id =>
        makeStats({ participantId: id, kills: 5, totalDamageDealtToChampions: 5000 })
      )
    ]
    const everyone = [
      ...team,
      ...[6, 7, 8, 9, 10].map(id => makeStats({ participantId: id, teamId: 200 }))
    ]
    const s = computeSingleSummary(team[0], team, everyone, DURATION)
    expect(s.killDamageEfficiency).toBeLessThan(1)
  })

  it('队总击杀为 0 时取 1（无效率差异）', () => {
    const team = [
      makeStats({ kills: 0 }),
      makeStats({ participantId: 2, kills: 0 }),
      makeStats({ participantId: 3, kills: 0 }),
      makeStats({ participantId: 4, kills: 0 }),
      makeStats({ participantId: 5, kills: 0 })
    ]
    const everyone = [
      ...team,
      ...[6, 7, 8, 9, 10].map(id => makeStats({ participantId: id, teamId: 200 }))
    ]
    expect(computeSingleSummary(team[0], team, everyone, DURATION).killDamageEfficiency).toBe(1)
  })
})

describe('computeSingleSummary · 降级纪律', () => {
  it('单人队时理应贡献比为 0（无「队均」概念，不记满）', () => {
    const solo = makeStats()
    const s = computeSingleSummary(solo, [solo], [solo, makeStats({ teamId: 200 })], DURATION)
    expect(s.championDamageRatioToExpectedContribution).toBe(0)
    expect(s.goldRatioToExpectedContribution).toBe(0)
    expect(s.visionScoreRatioToExpectedContribution).toBe(0)
    expect(s.teamParticipantCount).toBe(1)
  })

  it('全队数值为 0 时不产生 Infinity（noZero 兜底）', () => {
    const team = [1, 2, 3, 4, 5].map(id =>
      makeStats({ participantId: id, totalDamageDealtToChampions: 0, goldEarned: 0, cs: 0 })
    )
    const everyone = [
      ...team,
      ...[6, 7, 8, 9, 10].map(id => makeStats({ participantId: id, teamId: 200 }))
    ]
    const s = computeSingleSummary(team[0], team, everyone, DURATION)
    expectAllFinite(s as unknown as Record<string, unknown>)
    expect(s.championDamagePercentageOfTeam).toBe(0)
  })

  it('对局时长为 0 时 perMinute 指标有限（不为 Infinity）', () => {
    const { self, team, everyone } = makeTeams()
    const s = computeSingleSummary(self, team, everyone, 0)
    expectAllFinite(s as unknown as Record<string, unknown>)
  })

  it('视野分缺失（null）时按 0 参与计算，且占比有限', () => {
    const team = [
      makeStats({ visionScore: null }),
      makeStats({ participantId: 2, visionScore: null }),
      makeStats({ participantId: 3, visionScore: null }),
      makeStats({ participantId: 4, visionScore: null }),
      makeStats({ participantId: 5, visionScore: null })
    ]
    const everyone = [
      ...team,
      ...[6, 7, 8, 9, 10].map(id => makeStats({ participantId: id, teamId: 200 }))
    ]
    const s = computeSingleSummary(team[0], team, everyone, DURATION)
    expectAllFinite(s as unknown as Record<string, unknown>)
  })

  it('正常输入全部有限', () => {
    const { self, team, everyone } = makeTeams()
    expectAllFinite(
      computeSingleSummary(self, team, everyone, DURATION) as unknown as Record<string, unknown>
    )
  })
})
