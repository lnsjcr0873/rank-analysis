/**
 * `buildRoster` 单测——覆盖普通 5v5、大乱斗、CHERRY 多队、选人期匿名、局内。
 *
 * 这些场景的差异正是名册层必须处理干净的：分组顺序、复合 key、「我」标注、
 * 常用位置在局内仍然有效。
 */

import { describe, it, expect } from 'vitest'
import { buildRoster, rosterMemberKey, rosterGroupLabel, EMPTY_ROSTER } from '../roster'
import type { SessionData, SessionSummoner, Subteam } from '@renderer/types/domain/gaming'
import { defaultUserTag } from '@renderer/types/domain/analysis'

/** 构造一个最小可用的玩家对象。 */
/** 空 `queueMap`（Rank 类型要求两个键存在，值留空对象即可满足结构）。 */
const EMPTY_RANK = {
  queueMap: { RANKED_SOLO_5x5: {} as never, RANKED_FLEX_SR: {} as never }
}

function player(puuid = '', over: Partial<SessionSummoner> = {}): SessionSummoner {
  return {
    championId: 0,
    championKey: '',
    summoner: {
      gameName: 'p',
      tagLine: 't',
      summonerLevel: 100,
      profileIconId: 1,
      profileIconKey: '',
      puuid,
      platformIdCn: ''
    },
    matchHistory: {
      platformId: '',
      begIndex: 0,
      endIndex: 0,
      games: { games: [] }
    },
    userTag: defaultUserTag(),
    rank: EMPTY_RANK,
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    ...over
  }
}

/** 构造标准 CLASSIC 两组（我方 5 人 / 敌方 5 人）。 */
function classicSession(over: Partial<SessionData> = {}): SessionData {
  const mine = Array.from({ length: 5 }, (_, i) => player(`mine-${i}`))
  const enemy = Array.from({ length: 5 }, (_, i) => player(`enemy-${i}`))
  const subteams: Subteam[] = [
    { subteamId: 1, players: mine },
    { subteamId: 2, players: enemy }
  ]
  return {
    phase: 'ChampSelect',
    type: 'RANKED_SOLO_5x5',
    typeCn: '单双排',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams,
    ...over
  }
}

describe('rosterMemberKey', () => {
  it('puuid 非空时用 puuid', () => {
    expect(rosterMemberKey('abc', 1, 0)).toBe('abc')
  })

  it('选人期敌方匿名时回退到 anon 复合 key', () => {
    // 选人期敌方 puuid 为空串，若直接当 key 会 5 个人全部撞成同一行
    expect(rosterMemberKey('', 2, 3)).toBe('anon-2-3')
  })

  it('不同分组/序号的匿名玩家 key 不冲突', () => {
    expect(rosterMemberKey('', 2, 0)).not.toBe(rosterMemberKey('', 2, 1))
    expect(rosterMemberKey('', 1, 0)).not.toBe(rosterMemberKey('', 2, 0))
  })
})

describe('rosterGroupLabel', () => {
  it('CLASSIC 走我方/敌方', () => {
    expect(rosterGroupLabel(1, true, false)).toBe('我方')
    expect(rosterGroupLabel(2, false, false)).toBe('敌方')
  })

  it('CHERRY 非我方小队走「第 N 小队」', () => {
    expect(rosterGroupLabel(3, false, true)).toBe('第 3 小队')
    expect(rosterGroupLabel(1, true, true)).toBe('我方')
  })
})

describe('buildRoster', () => {
  it('无 subteams 时返回空名册', () => {
    const empty = buildRoster({
      phase: '',
      type: '',
      typeCn: '',
      queueId: 0,
      gameMode: '',
      isMultiTeam: false,
      mySubteamId: 0,
      subteams: []
    })
    expect(empty).toEqual(EMPTY_ROSTER)
  })

  it('CLASSIC：两组，我方第一', () => {
    const roster = buildRoster(classicSession())
    expect(roster.groups).toHaveLength(2)
    expect(roster.groups[0].label).toBe('我方')
    expect(roster.groups[0].isMine).toBe(true)
    expect(roster.groups[1].label).toBe('敌方')
    expect(roster.groups[1].kind).toBe('enemy')
    expect(roster.members).toHaveLength(10)
  })

  it('大乱斗：仍是两组 × 5 人，期望人数为 5（后端 CLASSIC 口径）', () => {
    const roster = buildRoster(
      classicSession({
        queueId: 2400,
        typeCn: '海克斯大乱斗',
        phase: 'InProgress'
      })
    )
    expect(roster.groups).toHaveLength(2)
    expect(roster.expectedSize).toBe(5)
    expect(roster.groups[0].members).toHaveLength(5)
  })

  it('mySubteamId 为 0 时不崩，按 subteamId 升序', () => {
    const roster = buildRoster(classicSession({ mySubteamId: 0 }))
    expect(roster.groups.map(g => g.subteamId)).toEqual([1, 2])
    expect(roster.groups.every(g => g.isMine)).toBe(false)
  })

  it('标出「我」且只标一个', () => {
    const roster = buildRoster(classicSession(), 'mine-2')
    const selves = roster.members.filter(m => m.isSelf)
    expect(selves).toHaveLength(1)
    expect(selves[0].player.summoner.puuid).toBe('mine-2')
  })

  it('myPuuid 为空时不误标「我」', () => {
    const roster = buildRoster(classicSession(), '')
    expect(roster.members.filter(m => m.isSelf)).toHaveLength(0)
  })

  it('选人期匿名敌方获得互不冲突的 key', () => {
    const session = classicSession()
    // 模拟选人期：敌方 puuid 全空
    session.subteams[1].players.forEach(p => (p.summoner.puuid = ''))
    const roster = buildRoster(session)
    const enemyKeys = roster.groups[1].members.map(m => m.key)
    expect(new Set(enemyKeys).size).toBe(5)
    expect(enemyKeys[0]).toBe('anon-2-0')
  })

  it('CHERRY：多小队平铺，我方第一、其余按 subteamId 升序', () => {
    const mk = (id: number, n: number): Subteam => ({
      subteamId: id,
      players: Array.from({ length: n }, (_, i) => player(`p${id}-${i}`))
    })
    const session = classicSession({
      gameMode: 'CHERRY',
      isMultiTeam: true,
      queueId: 1750,
      subteams: [mk(3, 2), mk(1, 2), mk(2, 2)],
      mySubteamId: 2
    })
    const roster = buildRoster(session)
    expect(roster.groups.map(g => g.subteamId)).toEqual([2, 1, 3])
    expect(roster.groups.map(g => g.label)).toEqual(['我方', '第 1 小队', '第 3 小队'])
    expect(roster.groups.every(g => g.kind === 'mine' || g.kind === 'squad')).toBe(true)
    expect(roster.isMultiTeam).toBe(true)
  })

  it('常用位置在局内仍然透传（后端会回填 selectedPosition）', () => {
    const session = classicSession({ phase: 'InProgress' })
    session.subteams[0].players[0].assignedPosition = 'middle'
    const roster = buildRoster(session)
    expect(roster.isChampSelect).toBe(false)
    expect(roster.groups[0].members[0].assignedPosition).toBe('middle')
  })

  it('选人期标记与 champSelect 视图透传', () => {
    const session = classicSession()
    session.champSelect = { stage: 'banning', myBans: [1], theirBans: [2] }
    session.subteams[0].players[0].pickState = 'picking'
    const roster = buildRoster(session)
    expect(roster.isChampSelect).toBe(true)
    expect(roster.champSelect?.stage).toBe('banning')
    expect(roster.groups[0].members[0].pickState).toBe('picking')
  })

  it('未锁定英雄记为 championId 0，不编造英雄', () => {
    const roster = buildRoster(classicSession())
    expect(roster.members.every(m => m.championId === 0)).toBe(true)
  })

  it('gameLimit 限制每名成员的近期对局条数', () => {
    const session = classicSession()
    const games = Array.from({ length: 20 }, (_, i) => ({ gameId: String(i) }) as never)
    session.subteams[0].players[0].matchHistory.games.games = games
    const roster = buildRoster(session, '', 6)
    expect(roster.groups[0].members[0].recentGames).toHaveLength(6)
  })

  it('recentData 透传，供行组件直接渲染胜率/KDA', () => {
    const session = classicSession()
    session.subteams[0].players[0].userTag.recentData.kda = 3.5
    session.subteams[0].players[0].userTag.recentData.selectWins = 8
    const roster = buildRoster(session)
    expect(roster.groups[0].members[0].recent.kda).toBe(3.5)
    expect(roster.groups[0].members[0].recent.selectWins).toBe(8)
  })

  it('预组队标记透传', () => {
    const session = classicSession()
    session.subteams[0].players[0].preGroupMarkers = { name: '1 组', type: 'success' }
    const roster = buildRoster(session)
    expect(roster.groups[0].members[0].preGroupName).toBe('1 组')
    expect(roster.groups[0].members[0].preGroupType).toBe('success')
  })

  it('空组也保留并带期望人数（占位提示）', () => {
    const session = classicSession()
    session.subteams.push({ subteamId: 3, players: [] })
    const roster = buildRoster(session)
    const emptyGroup = roster.groups.find(g => g.subteamId === 3)
    expect(emptyGroup).toBeDefined()
    expect(emptyGroup?.members).toHaveLength(0)
    expect(emptyGroup?.expectedSize).toBe(5)
  })
})
