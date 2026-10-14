/**
 * `index.spec.ts` 编排层单测。
 *
 * 重点锁三类跨模块行为：
 * 1. **筛选口径**：PvE 队列与非 MATCHED_GAME 必须被排除（否则污染整张画像）；
 * 2. **排序与截断**：必须"先按时间倒序再截断"，否则留下的是最旧的 N 局；
 * 3. **空态纪律**：无可用对局返回 null（而非全零对象），且绝不编造数字。
 */

import { describe, expect, it } from 'vitest'

import type { Game, Participant } from '@renderer/types/domain/match'

import { DEFAULT_GAME_LIMIT, analyzePlayerProfile, shouldIncludeGame } from './index'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-05T12:00:00.000Z')

/**
 * rank 的 TS `Participant` 接口未声明 `timeline`（Rust `model.rs` 有，经 IPC 透传）。
 * 全仓已有 4 处 `as unknown as` 绕行，本目录沿用同一约定，不在本次改动共享类型。
 */
type ParticipantWithTimeline = Participant & { timeline?: { lane?: string; role?: string } }

function makeParticipant(pid: number, over: Partial<Participant> = {}): ParticipantWithTimeline {
  return {
    participantId: pid,
    teamId: pid <= 5 ? 100 : 200,
    championId: 100 + pid,
    spell1Id: 4,
    spell2Id: 7,
    win: true,
    // 真实 LCU 数据带 timeline（Rust Participant 有该字段，TS Participant 接口未声明，
    // 故全仓已有 4 处 `as unknown as` 绕行）。这里同样用 cast，与 gameAdapter 保持一致；
    // 缺失时 position 为 null 且分路分布会跳过。
    timeline: { lane: pid === 2 ? 'JUNGLE' : 'MID', role: 'SOLO' },
    stats: {
      win: true,
      item0: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      perk0: 0,
      perkPrimaryStyle: 0,
      perkSubStyle: 0,
      playerAugment1: 0,
      playerAugment2: 0,
      playerAugment3: 0,
      playerAugment4: 0,
      playerAugment5: 0,
      playerAugment6: 0,
      kills: 4,
      deaths: 4,
      assists: 6,
      goldEarned: 10000,
      goldSpent: 9000,
      totalDamageDealtToChampions: 20000,
      totalDamageDealt: 35000,
      totalDamageTaken: 20000,
      totalHeal: 1000,
      totalMinionsKilled: 180,
      neutralMinionsKilled: 45,
      damageDealtToTurrets: 2000,
      groupRate: 0.5,
      goldEarnedRate: 0.2,
      damageDealtToChampionsRate: 0.2,
      damageTakenRate: 0.2,
      healRate: 0.1,
      playerSubteamId: 0,
      subteamPlacement: 0,
      visionScore: 40
    } as Participant['stats'],
    ...over
  }
}

function makeGame(gameId: number, createdAtMs: number, over: Partial<Game> = {}): Game {
  const participants = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(pid => makeParticipant(pid))
  const identities = participants.map((p, i) => ({
    player: {
      accountId: i,
      platformId: 'TENCENT-1',
      gameName: `P${p.participantId}`,
      tagLine: 'T',
      summonerName: `P${p.participantId}`,
      summonerId: i,
      puuid: `puuid-${p.participantId}`
    }
  }))

  return {
    mvp: '',
    gameId,
    gameCreationDate: new Date(createdAtMs).toISOString(),
    gameDuration: 1800,
    gameMode: 'CLASSIC',
    gameType: 'MATCHED_GAME',
    mapId: 11,
    queueId: 420,
    queueName: '单双排',
    platformId: 'TENCENT-1',
    participantIdentities: identities,
    participants,
    gameDetail: {
      endOfGameResult: '',
      participantIdentities: identities,
      participants
    },
    ...over
  }
}

const SELF = 'puuid-1'

describe('shouldIncludeGame', () => {
  it('普通排位局纳入', () => {
    expect(shouldIncludeGame(makeGame(1, NOW - HOUR))).toBe(true)
  })

  it('PvE 队列排除（大乱斗 / 无限火力 / 机器人 / 无限乱斗 / 激斗）', () => {
    for (const queueId of [450, 300, 900, 1000, 700]) {
      expect(shouldIncludeGame(makeGame(1, NOW, { queueId })), `queueId ${queueId}`).toBe(false)
    }
  })

  it('非 MATCHED_GAME 排除', () => {
    expect(shouldIncludeGame(makeGame(1, NOW, { gameType: 'CUSTOM_GAME' }))).toBe(false)
    expect(shouldIncludeGame(makeGame(1, NOW, { gameType: 'TUTORIAL_GAME' }))).toBe(false)
  })

  it('gameType 为空时按纳入处理（老数据缺字段，不因此丢弃整局）', () => {
    expect(shouldIncludeGame(makeGame(1, NOW, { gameType: '' }))).toBe(true)
  })
})

describe('analyzePlayerProfile · 空态与筛选', () => {
  it('无可用对局返回 null（不返回全零对象）', () => {
    expect(analyzePlayerProfile([], SELF, NOW)).toBeNull()
  })

  it('全部被 PvE 过滤掉时返回 null', () => {
    const games = [makeGame(1, NOW - HOUR, { queueId: 450 }), makeGame(2, NOW, { queueId: 450 })]
    expect(analyzePlayerProfile(games, SELF, NOW)).toBeNull()
  })

  it('PvE 局不计入 count，但普通局仍出画像', () => {
    const games = [
      makeGame(1, NOW - HOUR),
      makeGame(2, NOW - 2 * HOUR, { queueId: 450 }),
      makeGame(3, NOW - 3 * HOUR)
    ]
    const profile = analyzePlayerProfile(games, SELF, NOW)!
    expect(profile.count).toBe(2)
  })

  it('puuid 在所有局都找不到时返回 null', () => {
    expect(analyzePlayerProfile([makeGame(1, NOW)], 'puuid-999', NOW)).toBeNull()
  })
})

describe('analyzePlayerProfile · 排序与截断', () => {
  it('games 按时间倒序（最近在前）', () => {
    const games = [
      makeGame(1, NOW - 3 * HOUR),
      makeGame(2, NOW - 1 * HOUR),
      makeGame(3, NOW - 2 * HOUR)
    ]
    const profile = analyzePlayerProfile(games, SELF, NOW)!
    expect(profile.games.map(g => g.gameId)).toEqual([2, 3, 1])
  })

  it('先倒序再截断 ⇒ 留下的是最近的 N 局', () => {
    const games = [
      makeGame(1, NOW - 5 * HOUR),
      makeGame(2, NOW - 1 * HOUR),
      makeGame(3, NOW - 4 * HOUR),
      makeGame(4, NOW - 2 * HOUR)
    ]
    const profile = analyzePlayerProfile(games, SELF, NOW, { limit: 2 })!
    // 最近的 2 局是 id=2（1h 前）与 id=4（2h 前），不是 id=1/2
    expect(profile.games.map(g => g.gameId)).toEqual([2, 4])
  })

  it('limit 大于实际局数时全取', () => {
    const games = [makeGame(1, NOW - HOUR), makeGame(2, NOW)]
    expect(analyzePlayerProfile(games, SELF, NOW, { limit: 50 })!.count).toBe(2)
  })

  it('默认 limit 为 50（对齐 Akari matchHistoryLoadCount）', () => {
    expect(DEFAULT_GAME_LIMIT).toBe(50)
  })
})

describe('analyzePlayerProfile · 各模块接线', () => {
  const threeGames = [
    makeGame(1, NOW - HOUR, { gameDuration: 1800 }),
    makeGame(2, NOW - 2 * HOUR),
    makeGame(3, NOW - 3 * HOUR, { queueId: 440, gameMode: 'CLASSIC' })
  ]

  it('summary / score / winLoss / positions / champions 均已填充', () => {
    const p = analyzePlayerProfile(threeGames, SELF, NOW)!
    expect(p.count).toBe(3)
    expect(p.summary.kills).toBe(12)
    expect(p.score.maxScore).toBe(17)
    expect(p.winLoss.all.count).toBe(3)
    expect(p.winLoss.normal.count).toBe(3)
    expect(p.winLoss.cherry.count).toBe(0)
    expect(Object.keys(p.positions).length).toBeGreaterThan(0)
    expect(p.champions.length).toBeGreaterThan(0)
    expect(p.spells).toHaveProperty('flashOnD')
    expect(p.teamSide).toHaveProperty('blueSideCount')
  })

  it('单局分析已挂在每局上（供战绩列表直接渲染）', () => {
    const p = analyzePlayerProfile(threeGames, SELF, NOW)!
    for (const g of p.games) {
      expect(g.single).toHaveProperty('championDamagePercentageOfTeam')
      expect(g.single).toHaveProperty('killParticipation')
      expect(g.basic.gameId).toBe(g.gameId)
    }
  })

  it('本人队伍判定正确（teamMates 含本人）', () => {
    const p = analyzePlayerProfile(threeGames, SELF, NOW)!
    for (const g of p.games) {
      expect(g.teamMates).toHaveLength(5)
      expect(g.everyone).toHaveLength(10)
    }
  })

  it('可复现：同输入同 nowMs 结果完全一致', () => {
    const a = analyzePlayerProfile(threeGames, SELF, NOW)!
    const b = analyzePlayerProfile(threeGames, SELF, NOW)!
    expect(a.summary).toEqual(b.summary)
    expect(a.score).toEqual(b.score)
    expect(a.winLoss).toEqual(b.winLoss)
  })
})
