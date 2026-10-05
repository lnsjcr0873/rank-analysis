/**
 * `aggregateSummary.spec.ts` 单测。
 *
 * 重点锁三类语义：
 * 1. `avgKda` 是**跨局合并**口径而非场均均值（小死亡数局不能把结果拉飞）；
 * 2. **时钟注入**：`computeWinLoss` 的活跃 session 判定必须可确定复现
 *    （Akari 直接调 `Date.now()` 导致其测试不可靠，本实现改为注入 `nowMs`）；
 * 3. SGP 独有字段的 `avgIfAllNonNull` 降级（半数样本不得出均值）。
 */

import { describe, expect, it } from 'vitest'

import { ACTIVE_SESSION_GAP_MS, ACTIVE_SESSION_LATEST_WINDOW_MS } from './constants'
import {
  computeAggregatedSummary,
  computeSpells,
  computeTeamSide,
  computeWinLoss
} from './aggregateSummary'
import type { PreparedGame, SelfGameStats, SingleSummaryAnalysis } from './types'

const HOUR = 60 * 60 * 1000
const DURATION_SEC = 1800

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
    csPerMinute: 6.67,
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

/**
 * 构造一局。
 * @param selfOver 本人覆盖
 * @param singleOver 单局分析覆盖
 * @param gameCreationMs 该局的创建时间（毫秒）
 */
function makeGame(
  selfOver: Partial<SelfGameStats> = {},
  singleOver: Partial<SingleSummaryAnalysis> = {},
  gameCreationMs = 0
): PreparedGame {
  const self = makeSelf(selfOver)
  return {
    gameId: selfOver.championId ?? 1,
    basic: {
      gameId: 1,
      gameCreation: gameCreationMs,
      gameDuration: DURATION_SEC,
      gameType: 'MATCHED_GAME',
      queueId: 420,
      gameMode: 'CLASSIC',
      mapId: 11,
      isCherrySubteam: false
    },
    self,
    teamMates: [self],
    everyone: [self],
    single: makeSingle({ win: self.win, kda: self.kda, ...singleOver })
  }
}

describe('computeAggregatedSummary', () => {
  it('空输入不抛错且不产生 NaN', () => {
    const s = computeAggregatedSummary([])
    expect(Number.isNaN(s.avgKda)).toBe(false)
    expect(s.kills).toBe(0)
  })

  it('累计 K/D/A 为跨局求和', () => {
    const games = [
      makeGame({ kills: 5, deaths: 2, assists: 8 }),
      makeGame({ kills: 3, deaths: 7, assists: 4 })
    ]
    const s = computeAggregatedSummary(games)
    expect(s.kills).toBe(8)
    expect(s.deaths).toBe(9)
    expect(s.assists).toBe(12)
  })

  it('avgKda 用跨局合并口径 (ΣK+ΣA)/ΣD，而非场均 KDA 的均值', () => {
    // 一场 0 死 30 杀 + 一场 1 死 0 杀
    // 场均均值口径 = (15.5 + 0.5)/2 = 8.0
    // 合并口径   = (30+0+0)/(0+1) = 30
    const games = [
      makeGame({ kills: 30, deaths: 0, assists: 0, kda: 30 }),
      makeGame({ kills: 0, deaths: 1, assists: 0, kda: 0 })
    ]
    expect(computeAggregatedSummary(games).avgKda).toBe(30)
  })

  it('总死亡为 0 时 avgKda 有限（noZero 兜底）', () => {
    const s = computeAggregatedSummary([makeGame({ kills: 10, deaths: 0, assists: 5, kda: 15 })])
    expect(Number.isFinite(s.avgKda)).toBe(true)
  })

  it('winRate = 胜场数 / 总场数', () => {
    const games = [
      makeGame({ win: true }),
      makeGame({ win: true }),
      makeGame({ win: false }),
      makeGame({ win: false })
    ]
    expect(computeAggregatedSummary(games).winRate).toBe(0.5)
  })

  it('avgCsPerMinute 等字段取单局分析的均值', () => {
    const games = [makeGame({}, { csPerMinute: 6 }), makeGame({}, { csPerMinute: 8 })]
    expect(computeAggregatedSummary(games).avgCsPerMinute).toBe(7)
  })

  it('avgKillDamageEfficiency 用 avgOrOne：空输入取 1 而非 0', () => {
    expect(computeAggregatedSummary([]).avgKillDamageEfficiency).toBe(1)
  })

  it('视野分缺失按 0 计入 avgVisionScore', () => {
    const s = computeAggregatedSummary([
      makeGame({ visionScore: null }),
      makeGame({ visionScore: 40 })
    ])
    expect(s.avgVisionScore).toBe(20)
  })

  it('kdaCv 在全等时为 0（可与 -1 哨兵区分）', () => {
    const games = [makeGame({ kda: 3 }), makeGame({ kda: 3 })]
    expect(computeAggregatedSummary(games).kdaCv).toBe(0)
  })

  it('kdaCv 空输入为 -1 哨兵', () => {
    expect(computeAggregatedSummary([]).kdaCv).toBe(-1)
  })

  it('SGP 独有字段：全为 null 时整体 null（不编数字）', () => {
    const s = computeAggregatedSummary([makeGame(), makeGame()])
    expect(s.avgSoloKills).toBeNull()
    expect(s.avgEnemyMissingPings).toBeNull()
  })

  it('SGP 独有字段：任一局缺失即整体 null（拒绝半数样本均值）', () => {
    const games = [makeGame({ soloKills: 3 }), makeGame({ soloKills: null })]
    expect(computeAggregatedSummary(games).avgSoloKills).toBeNull()
  })

  it('SGP 独有字段：全部有值时正常出均值', () => {
    const games = [makeGame({ soloKills: 2 }), makeGame({ soloKills: 4 })]
    expect(computeAggregatedSummary(games).avgSoloKills).toBe(3)
  })
})

describe('computeTeamSide', () => {
  it('按 teamId 区分蓝红方', () => {
    const games = [makeGame({ teamId: 100 }), makeGame({ teamId: 100 }), makeGame({ teamId: 200 })]
    expect(computeTeamSide(games)).toEqual({ blueSideCount: 2, redSideCount: 1 })
  })

  it('斗魂 teamId（CHERRY-*）不计入任一侧', () => {
    expect(computeTeamSide([makeGame({ teamId: 3 })])).toEqual({
      blueSideCount: 0,
      redSideCount: 0
    })
  })
})

describe('computeSpells', () => {
  it('统计带闪现的局，按 spell1 位判 charges', () => {
    const games = [
      makeGame({ spell1Id: 4, spell2Id: 7 }), // 闪现未用完
      makeGame({ spell1Id: 7, spell2Id: 4 }), // 闪现已用完
      makeGame({ spell1Id: 21, spell2Id: 7 }) // 无闪现
    ]
    expect(computeSpells(games)).toEqual({ flashOnD: 1, flashOnF: 1 })
  })

  it('技能位为 null 时不算带闪现', () => {
    expect(computeSpells([makeGame({ spell1Id: null, spell2Id: null })])).toEqual({
      flashOnD: 0,
      flashOnF: 0
    })
  })
})

describe('computeWinLoss · 连胜/连跪', () => {
  /** games 需时间倒序（最近在前） */
  const NOW = Date.parse('2026-10-05T12:00:00.000Z')

  it('空输入返回全零', () => {
    const wl = computeWinLoss([], NOW)
    expect(wl).toMatchObject({ count: 0, wins: 0, losses: 0, winningStreak: 0, losingStreak: 0 })
  })

  it('连胜从最近一局往前数，遇败即停', () => {
    const games = [
      makeGame({ win: true }, {}, NOW - HOUR),
      makeGame({ win: true }, {}, NOW - 2 * HOUR),
      makeGame({ win: true }, {}, NOW - 3 * HOUR),
      makeGame({ win: false }, {}, NOW - 4 * HOUR)
    ]
    const wl = computeWinLoss(games, NOW)
    expect(wl.winningStreak).toBe(3)
    expect(wl.losingStreak).toBe(0)
  })

  it('连跪同理', () => {
    const games = [
      makeGame({ win: false }, {}, NOW - HOUR),
      makeGame({ win: false }, {}, NOW - 2 * HOUR),
      makeGame({ win: true }, {}, NOW - 3 * HOUR)
    ]
    const wl = computeWinLoss(games, NOW)
    expect(wl.losingStreak).toBe(2)
    expect(wl.winningStreak).toBe(0)
  })

  it('全胜时 winningStreak 等于总场数', () => {
    const games = [true, true, true, true].map((win, i) => makeGame({ win }, {}, NOW - i * HOUR))
    expect(computeWinLoss(games, NOW).winningStreak).toBe(4)
  })
})

describe('computeWinLoss · 活跃 session（时钟注入）', () => {
  const NOW = Date.parse('2026-10-05T12:00:00.000Z')
  /** 距今 `hoursAgo` 小时打完的一局 */
  const gameAgo = (win: boolean, hoursAgo: number) =>
    makeGame({ win }, {}, NOW - hoursAgo * HOUR - DURATION_SEC * 1000)

  it('最近一局在 4h 内才累加活跃 session', () => {
    const games = [gameAgo(true, 1), gameAgo(true, 2), gameAgo(true, 3)]
    const wl = computeWinLoss(games, NOW)
    expect(wl.activeSessionWins).toBe(3)
  })

  it('最近一局已超 4h 则活跃 session 归零（上周的连胜不算当前连胜）', () => {
    const games = [gameAgo(true, 5), gameAgo(true, 6)]
    const wl = computeWinLoss(games, NOW)
    expect(wl.activeSessionWins).toBe(0)
    // 但总连胜数照常统计
    expect(wl.winningStreak).toBe(2)
  })

  it('相邻间隔超 8h 即切段', () => {
    const games = [gameAgo(true, 1), gameAgo(true, 10)]
    const wl = computeWinLoss(games, NOW)
    expect(wl.activeSessionWins).toBe(1)
    expect(wl.winningStreak).toBe(2)
  })

  it('胜负混合时分别累计', () => {
    const games = [gameAgo(true, 1), gameAgo(false, 2), gameAgo(true, 3)]
    const wl = computeWinLoss(games, NOW)
    expect(wl.activeSessionWins).toBe(2)
    expect(wl.activeSessionLosses).toBe(1)
  })

  it('同样的输入 + 同样的 nowMs ⇒ 完全可复现（Akari 原实现做不到这点）', () => {
    const games = [gameAgo(true, 1), gameAgo(false, 2)]
    expect(computeWinLoss(games, NOW)).toEqual(computeWinLoss(games, NOW))
  })

  it('阈值常量与设计一致（防止误改窗口大小）', () => {
    expect(ACTIVE_SESSION_LATEST_WINDOW_MS).toBe(4 * HOUR)
    expect(ACTIVE_SESSION_GAP_MS).toBe(8 * HOUR)
  })
})
