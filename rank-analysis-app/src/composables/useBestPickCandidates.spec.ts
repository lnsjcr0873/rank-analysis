/**
 * useBestPickCandidates 单测：
 * 排序（我方置首）/ 占用排除（ban/已亮/敌锁）/ 候选池懒加载（一次性）/
 * 落列规则（对位 vs 协同）/ 显示条件。
 * 数据层（useSessionSync）已由 composable 单测覆盖，这里直接注入 reactive 会话。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, isRef, nextTick, reactive } from 'vue'

import { invoke } from '@tauri-apps/api/core'
import type { SessionData, Subteam, SessionSummoner } from '@renderer/types/domain/gaming'
import type { Summoner } from '@renderer/types/domain/player'
import { useBestPickCandidates } from './useBestPickCandidates'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// 测试 fixture：只填被 composable 读取的字段，其余以满足类型为准
const fixturePlayer = (
  puuid: string,
  championId = 0,
  pickState = 'none',
  assignedPosition?: string
): SessionSummoner =>
  ({
    championId,
    championKey: '',
    summoner: { puuid, gameName: puuid, tagLine: 'X' } as unknown as Summoner,
    pickState,
    ...(assignedPosition ? { assignedPosition } : {})
  }) as unknown as SessionSummoner

const makeSubteam = (subteamId: number, players: SessionSummoner[]): Subteam => ({
  subteamId,
  players
})

const makeSession = (over: Partial<SessionData> = {}): SessionData =>
  reactive<SessionData>({
    phase: 'ChampSelect',
    type: 'RANKED_FLEX',
    typeCn: '',
    queueId: 420,
    gameMode: 'SR',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams: [],
    ...over
  })

const myPuuid = computed(() => 'me')
const opggMode = computed(() => 'ranked' as const)

const setup = (s: SessionData, over: Partial<Parameters<typeof useBestPickCandidates>[0]> = {}) =>
  useBestPickCandidates({
    sessionData: s,
    mySummonerPuuid: myPuuid,
    opggMode,
    ...over
  })

const mockPool = async (ids: number[]): Promise<void> => {
  vi.mocked(invoke).mockResolvedValue(ids.map(v => ({ value: v, label: String(v) })))
}

describe('useBestPickCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('orderedSubteams 排序', () => {
    it('我方置首，其余按 subteamId 升序', () => {
      const s = makeSession({
        subteams: [
          makeSubteam(3, [fixturePlayer('e1')]),
          makeSubteam(1, [fixturePlayer('me')]),
          makeSubteam(2, [fixturePlayer('e2')])
        ]
      })
      const { orderedSubteams } = setup(s)
      expect(orderedSubteams.value.map(t => t.subteamId)).toEqual([1, 2, 3])
    })

    it('mySubteamId 无匹配时按升序返回且不报错', () => {
      const s = makeSession({ mySubteamId: 99, subteams: [makeSubteam(2, []), makeSubteam(1, [])] })
      const { orderedSubteams } = setup(s)
      expect(orderedSubteams.value.map(t => t.subteamId)).toEqual([1, 2])
    })

    it('empty subteams 返回空数组', () => {
      const s = makeSession({ subteams: [] })
      const { orderedSubteams } = setup(s)
      expect(orderedSubteams.value).toEqual([])
    })
  })

  describe('bestPickCandidates 占用排除', () => {
    it('排除双方 ban / 我方已亮 / 敌方已锁', async () => {
      await mockPool([1, 2, 3, 4, 5, 6])
      const s = makeSession({
        subteams: [
          makeSubteam(1, [fixturePlayer('me', 1, 'intent'), fixturePlayer('m2', 2, 'locked')]),
          makeSubteam(2, [fixturePlayer('e1', 3, 'locked')])
        ],
        champSelect: { stage: 'picking', myBans: [4], theirBans: [5] }
      })
      const { bestPickCandidates } = setup(s)
      await vi.waitFor(() => expect(bestPickCandidates.value).toEqual([6]))
    })

    it('ban 态的我方玩家不计入「已亮」', async () => {
      await mockPool([1, 2])
      const s = makeSession({
        subteams: [makeSubteam(1, [fixturePlayer('me', 1, 'banning')])]
      })
      const { teammatePickedIds } = setup(s)
      expect(teammatePickedIds.value).toEqual([])
    })

    it('候选池未就绪时返回空数组', () => {
      vi.mocked(invoke).mockRejectedValue(new Error('lcu down'))
      const s = makeSession({ subteams: [makeSubteam(1, [])] })
      const { bestPickCandidates } = setup(s)
      expect(bestPickCandidates.value).toEqual([])
    })
  })

  describe('候选池懒加载', () => {
    it('ranked+ChampSelect+敌方有锁时拉取一次，后续变化不重拉', async () => {
      await mockPool([10])
      const s = makeSession({
        subteams: [makeSubteam(1, []), makeSubteam(2, [fixturePlayer('e1', 10, 'locked')])]
      })
      const { showBestPicks } = setup(s)
      await vi.waitFor(() => expect(showBestPicks.value).toBe(true))
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_champion_options')

      // 再来一个敌方锁定：不应二次拉取
      s.subteams[1].players.push(fixturePlayer('e2', 11, 'locked'))
      await nextTick()
      await new Promise(r => setTimeout(r, 0))
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
    })

    it('非 ranked 模式不显示推荐条（拉取行为与 ranked 一致，仅显示被门控）', async () => {
      await mockPool([10])
      const s = makeSession({
        subteams: [makeSubteam(1, []), makeSubteam(2, [fixturePlayer('e1', 10, 'locked')])]
      })
      const { showBestPicks } = setup(s, { opggMode: computed(() => 'aram' as const) })
      await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalled())
      expect(showBestPicks.value).toBe(false)
    })

    it('Lobby 阶段不拉取', async () => {
      await mockPool([])
      const s = makeSession({
        phase: 'Lobby',
        subteams: [makeSubteam(1, []), makeSubteam(2, [fixturePlayer('e1', 10, 'locked')])]
      })
      setup(s)
      await new Promise(r => setTimeout(r, 0))
      expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    })
  })

  describe('panelForColumn 落列规则', () => {
    const ctx = () => {
      const s = makeSession({
        subteams: [
          makeSubteam(1, [fixturePlayer('me', 0), fixturePlayer('m2', 20, 'intent')]),
          makeSubteam(2, [fixturePlayer('e1', 0)])
        ]
      })
      return { s, bp: setup(s) }
    }

    it('敌方已锁 ≥2 → 敌方列（我方列关闭）', () => {
      const { s, bp } = ctx()
      s.subteams[1].players[0] = fixturePlayer('e1', 30, 'locked')
      s.subteams[1].players.push(fixturePlayer('e2', 40, 'locked'))
      expect(bp.panelForColumn(s.subteams[1])).toBe(true)
      expect(bp.panelForColumn(s.subteams[0])).toBe(false)
    })

    it('敌方 0 锁 + 我方队友有亮 → 我方列（纯协同）', () => {
      const { s, bp } = ctx()
      expect(bp.panelForColumn(s.subteams[0])).toBe(true)
      expect(bp.panelForColumn(s.subteams[1])).toBe(false)
    })

    it('敌方 1 锁且我方无亮 → 两列都不显示', () => {
      const { s, bp } = ctx()
      s.subteams[1].players[0] = fixturePlayer('e1', 30, 'locked')
      s.subteams[0].players[1] = fixturePlayer('m2', 0, 'none')
      expect(bp.panelForColumn(s.subteams[0])).toBe(false)
      expect(bp.panelForColumn(s.subteams[1])).toBe(false)
    })
  })

  describe('showBestPicks 显示条件', () => {
    it('ranked + ChampSelect + 池就绪 → true', async () => {
      await mockPool([1])
      const s = makeSession({
        subteams: [makeSubteam(1, []), makeSubteam(2, [fixturePlayer('e1', 1, 'locked')])]
      })
      const { showBestPicks } = setup(s)
      await vi.waitFor(() => expect(showBestPicks.value).toBe(true))
    })

    it('非选人阶段 → false', async () => {
      await mockPool([1])
      const s = makeSession({
        phase: 'Lobby',
        subteams: [makeSubteam(1, []), makeSubteam(2, [fixturePlayer('e1', 1, 'locked')])]
      })
      const { showBestPicks } = setup(s)
      await new Promise(r => setTimeout(r, 0))
      expect(showBestPicks.value).toBe(false)
    })
  })

  it('myBans/theirBans 无 champSelect 时为空数组且为响应式', () => {
    const s = makeSession({ subteams: [makeSubteam(1, [])] })
    const { myBans, theirBans } = setup(s)
    expect(myBans.value).toEqual([])
    expect(theirBans.value).toEqual([])
    expect(isRef(myBans)).toBe(true)
  })
})
