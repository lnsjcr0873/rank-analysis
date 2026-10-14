/**
 * `playerAnalysis.spec.ts` 单测。
 *
 * 重点锁三件事：
 * 1. **零新增网络**——入参只用 session 已有的 `matchHistory`；
 * 2. **缓存指纹正确**——只含影响结果的字段（`championId` / `pickState` 变化不得
 *    让画像缓存失效，否则选人期每秒重算 10 人画像）；
 * 3. **降级而非中断**——单玩家失败不影响其余玩家。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Game, Participant } from '@renderer/types/domain/match'

import {
  analyzePlayer,
  analyzeRoster,
  clearProfileCache,
  fingerprintGames,
  profileCacheSize
} from './playerAnalysis'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-05T12:00:00.000Z')

function makeParticipant(pid: number): Participant & { timeline?: { lane?: string } } {
  return {
    participantId: pid,
    teamId: pid <= 5 ? 100 : 200,
    championId: 100 + pid,
    spell1Id: 4,
    spell2Id: 7,
    win: true,
    timeline: { lane: 'MID' },
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
    } as Participant['stats']
  }
}

function makeGame(gameId: number, createdAtMs: number, over: Partial<Game> = {}): Game {
  const participants = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(makeParticipant)
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
    gameDetail: { endOfGameResult: '', participantIdentities: identities, participants },
    ...over
  }
}

/**
 * 构造 session 玩家。
 *
 * 注意真实结构：puuid 在 `summoner.puuid`，**不在** `SessionSummoner` 顶层
 * （见 types/domain/gaming.ts）。此处只提供分析所需字段。
 */
function makePlayer(puuid: string, games: Game[]) {
  return {
    summoner: { puuid, gameName: 'X', tagLine: 'T', summonerLevel: 100 } as never,
    matchHistory: {
      platformId: 'TENCENT-1',
      begIndex: 0,
      endIndex: 49,
      games: { games }
    }
  }
}

beforeEach(() => {
  clearProfileCache()
  vi.restoreAllMocks()
})

describe('fingerprintGames', () => {
  it('空数组返回固定标记', () => {
    expect(fingerprintGames([])).toBe('empty')
  })

  it('局数与各局 gameId+时长相同 ⇒ 指纹相同', () => {
    const a = [makeGame(1, NOW), makeGame(2, NOW - HOUR)]
    const b = [makeGame(1, NOW), makeGame(2, NOW - HOUR)]
    expect(fingerprintGames(a)).toBe(fingerprintGames(b))
  })

  it('局数不同 ⇒ 指纹不同', () => {
    expect(fingerprintGames([makeGame(1, NOW)])).not.toBe(
      fingerprintGames([makeGame(1, NOW), makeGame(2, NOW)])
    )
  })

  it('时长不同 ⇒ 指纹不同（perMinute 指标会变）', () => {
    const a = [makeGame(1, NOW, { gameDuration: 1800 })]
    const b = [makeGame(1, NOW, { gameDuration: 2400 })]
    expect(fingerprintGames(a)).not.toBe(fingerprintGames(b))
  })

  it('**不含 championId**（选人期变化不得让画像缓存失效）', () => {
    const base = makeGame(1, NOW)
    const picked = makeGame(1, NOW)
    // 只改 participants[0].championId
    picked.participants[0].championId = 999
    picked.gameDetail.participants[0].championId = 999
    expect(fingerprintGames([picked])).toBe(fingerprintGames([base]))
  })
})

describe('analyzePlayer', () => {
  it('正常数据出画像', () => {
    const player = makePlayer('puuid-1', [makeGame(1, NOW - HOUR), makeGame(2, NOW - 2 * HOUR)])
    const r = analyzePlayer(player, { nowMs: NOW })
    expect(r.profile).not.toBeNull()
    expect(r.profile!.count).toBe(2)
    expect(r.emptyReason).toBeNull()
  })

  it('无对局 ⇒ no-games', () => {
    const r = analyzePlayer(makePlayer('puuid-1', []), { nowMs: NOW })
    expect(r.profile).toBeNull()
    expect(r.emptyReason).toBe('no-games')
  })

  it('有对局但全被筛选（清一色大乱斗）⇒ all-filtered', () => {
    const games = [makeGame(1, NOW, { queueId: 450 }), makeGame(2, NOW, { queueId: 450 })]
    const r = analyzePlayer(makePlayer('puuid-1', games), { nowMs: NOW })
    expect(r.profile).toBeNull()
    expect(r.emptyReason).toBe('all-filtered')
  })

  it('同参数二次调用命中缓存（返回同一对象引用）', () => {
    const player = makePlayer('puuid-1', [makeGame(1, NOW - HOUR)])
    const a = analyzePlayer(player, { nowMs: NOW })
    const b = analyzePlayer(player, { nowMs: NOW })
    expect(b).toBe(a)
    expect(profileCacheSize()).toBe(1)
  })

  it('limit 变化 ⇒ 不同缓存条目', () => {
    const player = makePlayer('puuid-1', [makeGame(1, NOW - HOUR), makeGame(2, NOW - 2 * HOUR)])
    analyzePlayer(player, { nowMs: NOW, limit: 50 })
    analyzePlayer(player, { nowMs: NOW, limit: 20 })
    expect(profileCacheSize()).toBe(2)
  })

  it('对局新增 ⇒ 缓存失效并重算', () => {
    const p1 = makePlayer('puuid-1', [makeGame(1, NOW - HOUR)])
    const first = analyzePlayer(p1, { nowMs: NOW })
    const p2 = makePlayer('puuid-1', [makeGame(1, NOW - HOUR), makeGame(2, NOW - 2 * HOUR)])
    const second = analyzePlayer(p2, { nowMs: NOW })
    expect(second).not.toBe(first)
    expect(second.profile!.count).toBe(2)
  })

  it('clearProfileCache 后重算', () => {
    const player = makePlayer('puuid-1', [makeGame(1, NOW - HOUR)])
    const first = analyzePlayer(player, { nowMs: NOW })
    clearProfileCache()
    expect(profileCacheSize()).toBe(0)
    const second = analyzePlayer(player, { nowMs: NOW })
    expect(second).not.toBe(first)
    expect(second.profile!.count).toBe(first.profile!.count)
  })

  it('缓存容量有界（不会无界增长）', () => {
    // 每次都用不同对局集合制造新 key
    for (let i = 0; i < 200; i++) {
      const games = [makeGame(1000 + i, NOW - i * 60000)]
      analyzePlayer(makePlayer('puuid-1', games), { nowMs: NOW })
    }
    expect(profileCacheSize()).toBeLessThanOrEqual(128)
  })
})

describe('analyzeRoster · 降级而非中断', () => {
  it('批量分析 10 人全部返回条目', () => {
    const games = [makeGame(1, NOW - HOUR)]
    const players = Array.from({ length: 10 }, (_, i) =>
      makePlayer(
        `puuid-${i + 1}`,
        games.map(g => ({ ...g, gameId: g.gameId + i }))
      )
    )
    const map = analyzeRoster(players, { nowMs: NOW })
    expect(map.size).toBe(10)
  })

  it('部分玩家无对局时，其余玩家仍出画像（9 卡 + 1 空态卡）', () => {
    const games = [makeGame(1, NOW - HOUR)]
    const players = [
      makePlayer('puuid-1', games),
      makePlayer('puuid-2', []),
      makePlayer(
        'puuid-3',
        games.map(g => ({ ...g, gameId: 99 }))
      )
    ]
    const map = analyzeRoster(players, { nowMs: NOW })
    expect(map.get('puuid-1')!.profile).not.toBeNull()
    expect(map.get('puuid-2')!.emptyReason).toBe('no-games')
    expect(map.get('puuid-3')!.profile).not.toBeNull()
  })

  it('单个玩家数据畸形抛错时不影响其余玩家', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const games = [makeGame(1, NOW - HOUR)]
    // 构造一个会让 analyzePlayerProfile 内部抛错的玩家：games 非数组
    const broken = {
      summoner: { puuid: 'puuid-broken' } as never,
      matchHistory: {
        platformId: 'TENCENT-1',
        begIndex: 0,
        endIndex: 49,
        games: { games: 'not-an-array' as unknown as Game[] }
      }
    }
    const map = analyzeRoster([broken as never, makePlayer('puuid-1', games)], { nowMs: NOW })
    expect(map.size).toBe(2)
    expect(map.get('puuid-broken')!.profile).toBeNull()
    expect(map.get('puuid-1')!.profile).not.toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it('空名册返回空 Map', () => {
    expect(analyzeRoster([], { nowMs: NOW }).size).toBe(0)
  })
})
