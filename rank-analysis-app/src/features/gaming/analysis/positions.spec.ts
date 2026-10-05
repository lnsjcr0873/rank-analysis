/**
 * `positions.spec.ts` 单测。
 *
 * 重点锁三类语义：
 * 1. **分路 null 必须跳过**（否则「常玩分路」被稀释失真）；
 * 2. **斗魂队伍数是推算的**（统计全场有效 `subteamId` 个数），且判不出时
 *    跳过名次统计而非猜默认值；
 * 3. **斗魂名次缺失不影响胜负**（名次为 null 的局仍要计入胜率）。
 */

import { describe, expect, it } from 'vitest'

import {
  computeCherryWinLoss,
  computeChampions,
  computePositions,
  computeWinLossMap,
  getCherryTeamCount,
  isCherryPlacementWin
} from './positions'
import type { PreparedGame, SelfGameStats, SingleSummaryAnalysis } from './types'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-05T12:00:00.000Z')

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
 * @param gameMode 游戏模式（决定是否斗魂）
 * @param everyone 自定义全场（用于构造斗魂小队）
 */
function makeGame(
  selfOver: Partial<SelfGameStats> = {},
  gameMode = 'CLASSIC',
  everyone?: SelfGameStats[]
): PreparedGame {
  const self = makeSelf({ subteamPlacement: gameMode === 'CHERRY' ? 1 : null, ...selfOver })
  const all = everyone ?? [self]
  return {
    gameId: self.championId,
    basic: {
      gameId: self.championId,
      gameCreation: NOW - HOUR,
      gameDuration: 1800,
      gameType: 'MATCHED_GAME',
      queueId: gameMode === 'CHERRY' ? 1750 : 420,
      gameMode,
      mapId: 11,
      isCherrySubteam: gameMode === 'CHERRY'
    },
    self,
    teamMates: all.filter(p => p.teamId === self.teamId),
    everyone: all,
    single: makeSingle({ win: self.win, kda: self.kda })
  }
}

describe('computePositions', () => {
  it('统计各分路场次', () => {
    const games = [
      makeGame({ position: 'MIDDLE' }),
      makeGame({ position: 'MIDDLE' }),
      makeGame({ position: 'JUNGLE' })
    ]
    expect(computePositions(games)).toEqual({ MIDDLE: 2, JUNGLE: 1 })
  })

  it('分路为 null 时跳过而非计入 NONE', () => {
    const games = [makeGame({ position: 'MIDDLE' }), makeGame({ position: null })]
    const map = computePositions(games)
    expect(map).toEqual({ MIDDLE: 1 })
    expect(Object.keys(map)).not.toContain('NONE')
  })

  it('空输入返回空对象', () => {
    expect(computePositions([])).toEqual({})
  })
})

describe('getCherryTeamCount', () => {
  it('统计全场出现过的有效小队 ID 个数', () => {
    const everyone = [1, 2, 3, 3].map(subteamId =>
      makeSelf({ subteamId, subteamPlacement: subteamId })
    )
    expect(getCherryTeamCount(makeGame({}, 'CHERRY', everyone))).toBe(3)
  })

  it('名次 ≤ 0 的参与者不参与计数（数据未落定）', () => {
    const everyone = [
      makeSelf({ subteamId: 1, subteamPlacement: 1 }),
      makeSelf({ subteamId: 2, subteamPlacement: 2 }),
      makeSelf({ subteamId: 9, subteamPlacement: 0 })
    ]
    expect(getCherryTeamCount(makeGame({}, 'CHERRY', everyone))).toBe(2)
  })

  it('无有效 subteamId 时返回 0（判不出，不猜默认值）', () => {
    expect(getCherryTeamCount(makeGame({}, 'CHERRY', [makeSelf({ subteamId: 0 })]))).toBe(0)
  })
})

describe('isCherryPlacementWin', () => {
  it('前一半名次算赢（floor(teamCount/2)）', () => {
    // 8 队 → floor(4) = 4，前 4 名算赢
    expect(isCherryPlacementWin(4, 8)).toBe(true)
    expect(isCherryPlacementWin(5, 8)).toBe(false)
    // 4 队 → 前 2 名
    expect(isCherryPlacementWin(2, 4)).toBe(true)
    expect(isCherryPlacementWin(3, 4)).toBe(false)
  })

  it('名次 ≤ 0 不算赢', () => {
    expect(isCherryPlacementWin(0, 8)).toBe(false)
  })
})

describe('computeCherryWinLoss', () => {
  /** 造一场斗魂局：teamCount 8 队，本人名次 placement */
  const cherryGame = (placement: number | null, win: boolean) =>
    makeGame(
      { subteamPlacement: placement, win },
      'CHERRY',
      [1, 2, 3, 4, 5, 6, 7, 8].map(subteamId =>
        makeSelf({ subteamId, subteamPlacement: subteamId, participantId: subteamId })
      )
    )

  it('统计第 1 名次数与前半数率', () => {
    const games = [cherryGame(1, true), cherryGame(4, true), cherryGame(5, false)]
    const wl = computeCherryWinLoss(games, NOW)
    expect(wl.count).toBe(3)
    expect(wl.top1s).toBe(1)
    expect(wl.topHalfFinishes).toBe(2)
    expect(wl.top1Rate).toBeCloseTo(1 / 3, 10)
    expect(wl.topHalfRate).toBeCloseTo(2 / 3, 10)
  })

  it('平均名次只统计有名次的局', () => {
    const games = [cherryGame(2, true), cherryGame(4, true), cherryGame(null, false)]
    const wl = computeCherryWinLoss(games, NOW)
    expect(wl.avgSubteamPlacement).toBe(3)
  })

  it('名次缺失的局仍计入胜负（不影响胜率分母）', () => {
    const games = [cherryGame(1, true), cherryGame(null, false)]
    const wl = computeCherryWinLoss(games, NOW)
    expect(wl.count).toBe(2)
    expect(wl.wins).toBe(1)
    expect(wl.winRate).toBe(0.5)
    // 但名次统计只有 1 个样本
    expect(wl.top1s).toBe(1)
  })

  it('小队数判不出时跳过名次统计（不猜默认队伍数）', () => {
    const games = [makeGame({ subteamPlacement: 1, subteamId: 0 }, 'CHERRY')]
    const wl = computeCherryWinLoss(games, NOW)
    expect(wl.avgSubteamPlacement).toBe(0)
  })

  it('空输入返回全零', () => {
    const wl = computeCherryWinLoss([], NOW)
    expect(wl).toMatchObject({ count: 0, top1s: 0, topHalfFinishes: 0, avgSubteamPlacement: 0 })
  })
})

describe('computeWinLossMap', () => {
  it('按 gameMode 拆成 all / normal / cherry 三桶', () => {
    const games = [
      makeGame({ win: true }, 'CLASSIC'),
      makeGame({ win: false }, 'CLASSIC'),
      makeGame({ win: true }, 'CHERRY')
    ]
    const map = computeWinLossMap(games, NOW)
    expect(map.all.count).toBe(3)
    expect(map.normal.count).toBe(2)
    expect(map.cherry.count).toBe(1)
    expect(map.normal.wins).toBe(1)
  })

  it('全部为普通局时 cherry 桶为空但结构完整', () => {
    const map = computeWinLossMap([makeGame()], NOW)
    expect(map.cherry.count).toBe(0)
    expect(map.cherry.top1Rate).toBe(0)
  })
})

describe('computeChampions', () => {
  it('按英雄分桶并按场次降序', () => {
    const games = [
      makeGame({ championId: 103 }),
      makeGame({ championId: 103 }),
      makeGame({ championId: 103 }),
      makeGame({ championId: 222 }),
      makeGame({ championId: 61 })
    ]
    const champions = computeChampions(games, NOW)
    // 103 有 3 场排最前；222 与 61 各 1 场，按 championId 升序 tiebreak ⇒ 61 在 222 前
    expect(champions.map(c => c.championId)).toEqual([103, 61, 222])
    expect(champions[0].count).toBe(3)
  })

  it('同场次按 championId 升序，保证卡片顺序不抖动', () => {
    const games = [makeGame({ championId: 222 }), makeGame({ championId: 103 })]
    expect(computeChampions(games, NOW).map(c => c.championId)).toEqual([103, 222])
  })

  it('每个英雄独立算分与胜负（不与总样本混合）', () => {
    const games = [
      // 阿狸 3 场全胜
      ...[1, 2, 3].map(() => makeGame({ championId: 103, win: true, kda: 5 })),
      // 金克丝 2 场全败
      ...[1, 2].map(() => makeGame({ championId: 222, win: false, kda: 1 }))
    ]
    const champions = computeChampions(games, NOW)
    const akali = champions.find(c => c.championId === 103)!
    const jinx = champions.find(c => c.championId === 222)!
    expect(akali.winLoss.wins).toBe(3)
    expect(akali.winLoss.winRate).toBe(1)
    expect(jinx.winLoss.wins).toBe(0)
    expect(jinx.winLoss.winRate).toBe(0)
    // 各英雄的 17 分独立计算
    expect(akali.score.total).toBeGreaterThan(jinx.score.total)
  })

  it('championId 为 0 的局跳过', () => {
    const games = [makeGame({ championId: 0 }), makeGame({ championId: 103 })]
    const champions = computeChampions(games, NOW)
    expect(champions).toHaveLength(1)
    expect(champions[0].championId).toBe(103)
  })

  it('每个桶带上自己的分路分布', () => {
    const games = [
      makeGame({ championId: 103, position: 'MIDDLE' }),
      makeGame({ championId: 103, position: 'JUNGLE' }),
      makeGame({ championId: 103, position: 'MIDDLE' })
    ]
    expect(computeChampions(games, NOW)[0].positions).toEqual({ MIDDLE: 2, JUNGLE: 1 })
  })

  it('空输入返回空数组', () => {
    expect(computeChampions([], NOW)).toEqual([])
  })
})
