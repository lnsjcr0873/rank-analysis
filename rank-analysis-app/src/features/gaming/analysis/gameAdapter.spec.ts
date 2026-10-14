/**
 * `gameAdapter.spec.ts` 单测。
 *
 * 重点锁三类移植易错点：
 * 1. **字段改名**：`damageDealtToTurrets` → `totalDamageToTowers`；
 * 2. **可选字段语义**：`visionScore` 缺失必须是 `null`（≠ 0）、非斗魂 `subteamPlacement`
 *    的 0 必须归一为 `null`（否则会被当成"第 0 名"）；
 * 3. **分路别名**：`MID`/`ADC`/`SUPPORT` 与 Rust `normalize_lane` 逐项一致。
 */

import { describe, expect, it } from 'vitest'

import type { Game, Participant } from '@renderer/types/domain/match'

import {
  SUMMONER_SPELL_FLASH_ID,
  getParticipantIdentities,
  getParticipants,
  hasFlash,
  normalizeGame,
  normalizePosition,
  toBasicInfo,
  toSelfGameStats
} from './gameAdapter'

/** 构造一名参与者；只写测试关心的字段，其余走默认 */
function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    participantId: 1,
    teamId: 100,
    championId: 103,
    spell1Id: 4,
    spell2Id: 7,
    win: true,
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
      kills: 5,
      deaths: 2,
      assists: 8,
      goldEarned: 12000,
      goldSpent: 11000,
      totalDamageDealtToChampions: 25000,
      totalDamageDealt: 40000,
      totalDamageTaken: 18000,
      totalHeal: 3000,
      totalMinionsKilled: 180,
      neutralMinionsKilled: 45,
      damageDealtToTurrets: 3200,
      groupRate: 0.5,
      goldEarnedRate: 0.2,
      damageDealtToChampionsRate: 0.28,
      damageTakenRate: 0.19,
      healRate: 0.1,
      playerSubteamId: 0,
      subteamPlacement: 0,
      visionScore: 42
    } as Participant['stats'],
    ...overrides
  }
}

/** 构造一局；participants 数组下标 +1 即 participantId */
function makeGame(participants: Participant[], overrides: Partial<Game> = {}): Game {
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

  const game: Game = {
    mvp: '',
    gameId: 9000001,
    gameCreationDate: '2026-10-01T12:00:00.000Z',
    gameDuration: 1830,
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
    ...overrides
  }
  return game
}

/** 5v5 标准阵容：蓝队 100（1-5）、红队 200（6-10） */
function makeFullGame(): Game {
  const participants: Participant[] = []
  for (let i = 1; i <= 10; i++) {
    participants.push(
      makeParticipant({
        participantId: i,
        teamId: i <= 5 ? 100 : 200,
        championId: 100 + i
      })
    )
  }
  return makeGame(participants)
}

describe('normalizePosition', () => {
  it('认全部标准分路', () => {
    expect(normalizePosition('TOP')).toBe('TOP')
    expect(normalizePosition('JUNGLE')).toBe('JUNGLE')
    expect(normalizePosition('MIDDLE')).toBe('MIDDLE')
    expect(normalizePosition('BOTTOM')).toBe('BOTTOM')
    expect(normalizePosition('UTILITY')).toBe('UTILITY')
  })

  it('认国服别名 MID / ADC / SUPPORT（与 Rust normalize_lane 一致）', () => {
    expect(normalizePosition('MID')).toBe('MIDDLE')
    expect(normalizePosition('ADC')).toBe('BOTTOM')
    expect(normalizePosition('SUPPORT')).toBe('UTILITY')
  })

  it('大小写与空白不敏感', () => {
    expect(normalizePosition('jungle')).toBe('JUNGLE')
    expect(normalizePosition('  top  ')).toBe('TOP')
  })

  it('无法识别时返回 null 而非猜测', () => {
    expect(normalizePosition('NONE')).toBeNull()
    expect(normalizePosition('DUO_CARRY')).toBeNull()
    expect(normalizePosition('')).toBeNull()
    expect(normalizePosition(undefined)).toBeNull()
    expect(normalizePosition(null)).toBeNull()
  })
})

describe('getParticipants / getParticipantIdentities', () => {
  it('优先取 gameDetail（enrich_game_detail 已填满 10 人）', () => {
    const game = makeFullGame()
    expect(getParticipants(game)).toHaveLength(10)
    expect(getParticipantIdentities(game)).toHaveLength(10)
  })

  it('gameDetail 为空时回退到顶层 participants', () => {
    const game = makeGame([makeParticipant()])
    game.gameDetail = {
      endOfGameResult: '',
      participantIdentities: [],
      participants: []
    }
    expect(getParticipants(game)).toHaveLength(1)
  })
})

describe('toBasicInfo', () => {
  it('解析 ISO 创建时间为毫秒（winLoss 的活跃 session 判定依赖它）', () => {
    const game = makeGame([makeParticipant()])
    const basic = toBasicInfo(game)
    expect(basic.gameCreation).toBe(Date.parse('2026-10-01T12:00:00.000Z'))
    expect(Number.isFinite(basic.gameCreation)).toBe(true)
  })

  it('时间解析失败返回 0 而非 NaN（避免污染比较链）', () => {
    const game = makeGame([makeParticipant()], { gameCreationDate: 'not-a-date' })
    expect(toBasicInfo(game).gameCreation).toBe(0)
  })

  it('CHERRY 局标记 isCherrySubteam', () => {
    const cherry = makeGame([makeParticipant()], { gameMode: 'CHERRY' })
    expect(toBasicInfo(cherry).isCherrySubteam).toBe(true)
    expect(toBasicInfo(makeGame([makeParticipant()])).isCherrySubteam).toBe(false)
  })

  it('透传时长/队列/模式/地图', () => {
    const basic = toBasicInfo(makeGame([makeParticipant()]))
    expect(basic).toMatchObject({
      gameDuration: 1830,
      queueId: 420,
      gameType: 'MATCHED_GAME',
      mapId: 11,
      gameMode: 'CLASSIC'
    })
  })
})

describe('toSelfGameStats', () => {
  const identity = {
    player: {
      accountId: 0,
      platformId: 'TENCENT-1',
      gameName: 'Me',
      tagLine: 'T',
      summonerName: 'Me',
      summonerId: 0,
      puuid: 'puuid-1'
    }
  }

  it('字段改名：damageDealtToTurrets → totalDamageToTowers', () => {
    const s = toSelfGameStats(makeParticipant(), identity)
    expect(s.totalDamageToTowers).toBe(3200)
  })

  it('补刀含野怪（totalMinionsKilled + neutralMinionsKilled）', () => {
    expect(toSelfGameStats(makeParticipant(), identity).cs).toBe(225)
  })

  it('KDA = (K+A)/max(D,1)，0 死亡不产生 Infinity', () => {
    expect(toSelfGameStats(makeParticipant(), identity).kda).toBe(6.5)
    const noDeath = makeParticipant()
    noDeath.stats.deaths = 0
    expect(toSelfGameStats(noDeath, identity).kda).toBe(13)
  })

  it('visionScore 缺失归一为 null 而非 0（区分「没做视野」与「数据缺失」）', () => {
    const p = makeParticipant()
    p.stats.visionScore = undefined
    expect(toSelfGameStats(p, identity).visionScore).toBeNull()
  })

  it('subteamPlacement 为 0 时归一为 null（避免被当成「第 0 名」）', () => {
    expect(toSelfGameStats(makeParticipant(), identity).subteamPlacement).toBeNull()
  })

  it('斗魂名次保留真实值', () => {
    const p = makeParticipant()
    p.stats.subteamPlacement = 3
    expect(toSelfGameStats(p, identity).subteamPlacement).toBe(3)
  })

  it('SGP 独有字段恒为 null（rank 无 soloKills / 敌方消失信号）', () => {
    const s = toSelfGameStats(makeParticipant(), identity)
    expect(s.soloKills).toBeNull()
    expect(s.enemyMissingPings).toBeNull()
  })

  it('胜负取自 stats.win（而非 Participant.win）', () => {
    const win = toSelfGameStats(makeParticipant(), identity)
    expect(win.win).toBe(true)

    const lose = makeParticipant()
    lose.stats.win = false
    expect(toSelfGameStats(lose, identity).win).toBe(false)
  })

  it('从 timeline.lane 读分路', () => {
    const p = makeParticipant()
    ;(p as unknown as { timeline?: { lane?: string } }).timeline = { lane: 'JUNGLE' }
    expect(toSelfGameStats(p, identity).position).toBe('JUNGLE')
  })

  it('timeline 缺失时回退 teamPosition', () => {
    const p = makeParticipant()
    ;(p as unknown as { teamPosition?: string }).teamPosition = 'SUPPORT'
    expect(toSelfGameStats(p, identity).position).toBe('UTILITY')
  })

  it('timeline 与 teamPosition 都缺失时 position 为 null', () => {
    expect(toSelfGameStats(makeParticipant(), identity).position).toBeNull()
  })
})

describe('normalizeGame', () => {
  it('按 puuid 定位本人，并给出同队与全场', () => {
    const game = makeFullGame()
    const result = normalizeGame(game, 'puuid-3')
    expect(result).not.toBeNull()
    expect(result!.self.participantId).toBe(3)
    expect(result!.teamMates).toHaveLength(5)
    expect(result!.everyone).toHaveLength(10)
  })

  it('同队判定按 teamId（teamMates 含本人）', () => {
    const result = normalizeGame(makeFullGame(), 'puuid-3')!
    expect(result.teamMates.every(s => s.teamId === result.self.teamId)).toBe(true)
    expect(result.teamMates.some(s => s.puuid === 'puuid-3')).toBe(true)
  })

  it('红队玩家看到自己队为 200', () => {
    const result = normalizeGame(makeFullGame(), 'puuid-8')!
    expect(result.self.teamId).toBe(200)
    expect(result.teamMates).toHaveLength(5)
  })

  it('puuid 在本局找不到时返回 null（跨区归属变化 / 身份缺失）', () => {
    expect(normalizeGame(makeFullGame(), 'puuid-999')).toBeNull()
  })
})

describe('hasFlash', () => {
  const base = toSelfGameStats(makeParticipant(), undefined)

  it('任一技能位为闪现即算带闪现', () => {
    expect(hasFlash({ ...base, spell1Id: SUMMONER_SPELL_FLASH_ID, spell2Id: 7 })).toBe(true)
    expect(hasFlash({ ...base, spell1Id: 4, spell2Id: 21 })).toBe(true)
  })

  it('两个技能位都不是闪现则 false', () => {
    expect(hasFlash({ ...base, spell1Id: 21, spell2Id: 7 })).toBe(false)
  })

  it('技能位为 null（数据缺失）不算带闪现', () => {
    expect(hasFlash({ ...base, spell1Id: null, spell2Id: null })).toBe(false)
  })
})
